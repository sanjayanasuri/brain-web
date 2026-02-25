import csv
import io
import logging
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

import httpx
from diskcache import Cache

from config_web_search_routing import get_web_search_routing_config
from providers.result_utils import build_market_quote_content, normalize_search_item, utcnow_iso

logger = logging.getLogger("brain_web")

cache = Cache("/tmp/brainweb_websearch_cache")

MARKET_QUOTE_CACHE_TTL_SECONDS = 15
FX_RATE_CACHE_TTL_SECONDS = 60
MACRO_INDICATOR_CACHE_TTL_SECONDS = 300

_ROUTING_CONFIG = get_web_search_routing_config()

STOCK_QUERY_HINTS = _ROUTING_CONFIG.stock_query_hints
CRYPTO_QUERY_HINTS = _ROUTING_CONFIG.crypto_query_hints
FX_QUERY_HINTS = _ROUTING_CONFIG.fx_query_hints
MACRO_QUERY_HINTS = _ROUTING_CONFIG.macro_query_hints
STRICT_METRIC_QUERY_HINTS = _ROUTING_CONFIG.strict_metric_hints
STOCK_TICKER_STOPWORDS = set(_ROUTING_CONFIG.stock_ticker_stopwords)
COMMON_COMPANY_TICKERS = dict(_ROUTING_CONFIG.company_tickers)
COMMON_CRYPTO_TICKERS = dict(_ROUTING_CONFIG.crypto_tickers)
CURRENCY_NAME_TO_CODE = dict(_ROUTING_CONFIG.currency_name_to_code)
MACRO_INDICATOR_SPECS: List[Dict[str, Any]] = [dict(item) for item in _ROUTING_CONFIG.macro_indicators]


@dataclass(frozen=True)
class StructuredProviderRoute:
    name: str
    detector: Callable[[str], bool]
    fetcher: Callable[[str], Awaitable[Optional[Dict[str, Any]]]]


def looks_like_stock_quote_query(query: str) -> bool:
    q = (query or "").lower()
    if not q:
        return False
    if re.search(r"\$[a-z]{1,6}\b", q):
        return True
    return any(hint in q for hint in STOCK_QUERY_HINTS)


def resolve_stock_symbol(query: str) -> Optional[str]:
    if not query:
        return None

    q_lower = query.lower()
    for alias, symbol in COMMON_COMPANY_TICKERS.items():
        if re.search(rf"\b{re.escape(alias)}\b", q_lower):
            return symbol

    dollar_match = re.search(r"\$([A-Za-z]{1,6})\b", query)
    if dollar_match:
        return dollar_match.group(1).upper()

    if not looks_like_stock_quote_query(query):
        return None

    explicit = re.search(r"(?:ticker|symbol|stock)\s*[:=]?\s*([A-Za-z]{1,6})\b", query, flags=re.I)
    if explicit:
        candidate = explicit.group(1).upper()
        if candidate not in STOCK_TICKER_STOPWORDS:
            return candidate

    paren = re.search(r"\(([A-Z]{1,6})\)", query)
    if paren and paren.group(1) not in STOCK_TICKER_STOPWORDS:
        return paren.group(1)

    uppercase_tokens = re.findall(r"\b[A-Z]{1,6}\b", query)
    for token in uppercase_tokens:
        if token not in STOCK_TICKER_STOPWORDS:
            return token
    return None


def looks_like_crypto_query(query: str) -> bool:
    q = (query or "").lower()
    if not q:
        return False
    if any(hint in q for hint in CRYPTO_QUERY_HINTS):
        return True
    return bool(re.search(r"\b(BTC|ETH|SOL|DOGE|XRP|ADA|BNB)\b", query or "", flags=re.I))


def resolve_crypto_symbol(query: str) -> Optional[str]:
    if not query:
        return None
    q_lower = query.lower()
    for alias, yahoo_symbol in COMMON_CRYPTO_TICKERS.items():
        if re.search(rf"\b{re.escape(alias)}\b", q_lower):
            return yahoo_symbol

    if not looks_like_crypto_query(query):
        return None

    token_match = re.search(r"\b(BTC|ETH|SOL|DOGE|XRP|ADA|BNB)\b", query, flags=re.I)
    if token_match:
        return COMMON_CRYPTO_TICKERS.get(token_match.group(1).lower())
    return None


def looks_like_fx_query(query: str) -> bool:
    q = (query or "").lower()
    if not q:
        return False
    if any(hint in q for hint in FX_QUERY_HINTS):
        return True
    if re.search(r"\b[A-Z]{3}\s*(?:/|to|->|vs)\s*[A-Z]{3}\b", query or ""):
        return True
    return "exchange" in q and "rate" in q


def _extract_amount_prefix(query: str, code: str) -> float:
    if not query or not code:
        return 1.0
    m = re.search(rf"(\d+(?:\.\d+)?)\s*{re.escape(code)}\b", query, flags=re.I)
    if not m:
        return 1.0
    try:
        return float(m.group(1))
    except Exception:
        return 1.0


def resolve_fx_pair(query: str) -> Optional[Dict[str, Any]]:
    if not query:
        return None

    pair_match = re.search(r"\b([A-Z]{3})\s*(?:/|to|->|vs)\s*([A-Z]{3})\b", query)
    if pair_match:
        base = pair_match.group(1).upper()
        quote = pair_match.group(2).upper()
        if base != quote:
            return {"base": base, "quote": quote, "amount": _extract_amount_prefix(query, base)}

    q_lower = query.lower()
    found_codes: List[str] = []
    for name, code in sorted(CURRENCY_NAME_TO_CODE.items(), key=lambda kv: len(kv[0]), reverse=True):
        if re.search(rf"\b{re.escape(name)}\b", q_lower) and code not in found_codes:
            found_codes.append(code)
        if len(found_codes) >= 2:
            break

    if len(found_codes) >= 2 and looks_like_fx_query(query):
        base, quote = found_codes[0], found_codes[1]
        if base != quote:
            return {"base": base, "quote": quote, "amount": _extract_amount_prefix(query, base)}
    return None


def looks_like_macro_query(query: str) -> bool:
    q = (query or "").lower()
    return bool(q and any(hint in q for hint in MACRO_QUERY_HINTS))


def resolve_macro_indicator(query: str) -> Optional[Dict[str, Any]]:
    if not query:
        return None
    q_lower = query.lower()
    for spec in MACRO_INDICATOR_SPECS:
        aliases = spec.get("aliases") or []
        if any(alias in q_lower for alias in aliases):
            return spec
    return None


def looks_like_structured_metric_query(query: str) -> bool:
    return (
        looks_like_fx_query(query)
        or looks_like_crypto_query(query)
        or looks_like_macro_query(query)
        or looks_like_stock_quote_query(query)
    )


def is_strict_metric_query(query: str) -> bool:
    q = (query or "").lower()
    return any(term in q for term in STRICT_METRIC_QUERY_HINTS)


async def _fetch_yahoo_quote(symbol: str) -> Optional[Dict[str, Any]]:
    symbol = (symbol or "").strip().upper()
    if not symbol or not re.fullmatch(r"[A-Z0-9=.\-]{1,16}", symbol):
        return None
    url = "https://query1.finance.yahoo.com/v7/finance/quote"
    headers = {"accept": "application/json", "user-agent": "BrainWeb/1.0 (+market-quote)"}
    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            resp = await client.get(url, params={"symbols": symbol}, headers=headers)
            resp.raise_for_status()
            payload = resp.json()
    except Exception as e:
        logger.warning("Yahoo Finance quote lookup failed for %s: %s", symbol, e)
        return None
    results = (((payload or {}).get("quoteResponse") or {}).get("result") or [])
    return results[0] if results else None


def _normalize_yahoo_quote_result(raw: Dict[str, Any], *, metric_kind: str, source_type: str) -> Optional[Dict[str, Any]]:
    if not raw:
        return None
    resolved_symbol = str(raw.get("symbol") or "").upper()
    if not resolved_symbol:
        return None
    price = raw.get("regularMarketPrice")
    if price is None:
        return None

    market_ts = raw.get("regularMarketTime")
    as_of = None
    if isinstance(market_ts, (int, float)) and market_ts > 0:
        try:
            as_of = datetime.utcfromtimestamp(int(market_ts)).replace(microsecond=0).isoformat() + "Z"
        except Exception:
            as_of = None

    structured = {
        "kind": metric_kind,
        "symbol": resolved_symbol,
        "name": raw.get("longName") or raw.get("shortName") or resolved_symbol,
        "price": raw.get("regularMarketPrice"),
        "currency": raw.get("currency"),
        "change": raw.get("regularMarketChange"),
        "change_percent": raw.get("regularMarketChangePercent"),
        "market_cap": raw.get("marketCap"),
        "volume": raw.get("regularMarketVolume"),
        "avg_volume_3m": raw.get("averageDailyVolume3Month"),
        "exchange": raw.get("fullExchangeName") or raw.get("exchange"),
        "market_state": raw.get("marketState"),
        "quote_type": raw.get("quoteType"),
        "as_of": as_of or utcnow_iso(),
        "provider": "yahoo_finance",
        "provider_url": f"https://finance.yahoo.com/quote/{resolved_symbol}",
        "source_delay_note": "May be delayed depending on exchange/data entitlements."
    }
    label = "crypto quote" if metric_kind == "crypto_quote" else "live market quote"
    content = build_market_quote_content(structured)
    return normalize_search_item(
        title=f"{structured['name']} ({resolved_symbol}) {label}",
        url=structured["provider_url"],
        content=content,
        snippet=content[:240],
        engine="yahoo_finance",
        source_type=source_type,
        structured_data=structured,
        is_realtime=True,
        metadata={
            "symbol": resolved_symbol,
            "provider": "yahoo_finance",
            "as_of": structured["as_of"],
            "exchange": structured.get("exchange"),
            "currency": structured.get("currency"),
            "market_state": structured.get("market_state"),
            "quote_type": structured.get("quote_type"),
            "source_delay_note": structured["source_delay_note"],
        },
    )


async def get_stock_quote(symbol: str) -> Optional[Dict[str, Any]]:
    symbol = (symbol or "").strip().upper()
    if not symbol or not re.fullmatch(r"[A-Z]{1,6}", symbol):
        return None
    cache_key = f"market:quote:yahoo:stock:{symbol}"
    cached = cache.get(cache_key)
    if cached:
        return cached
    raw = await _fetch_yahoo_quote(symbol)
    result = _normalize_yahoo_quote_result(raw or {}, metric_kind="stock_quote", source_type="market_quote")
    if result:
        cache.set(cache_key, result, expire=MARKET_QUOTE_CACHE_TTL_SECONDS)
    return result


async def get_crypto_quote(symbol_or_query: str) -> Optional[Dict[str, Any]]:
    if re.fullmatch(r"[A-Z0-9]{2,10}-[A-Z]{3,4}", (symbol_or_query or "").strip().upper()):
        yahoo_symbol = (symbol_or_query or "").strip().upper()
    else:
        yahoo_symbol = resolve_crypto_symbol(symbol_or_query or "")
    if not yahoo_symbol:
        return None
    cache_key = f"market:quote:yahoo:crypto:{yahoo_symbol}"
    cached = cache.get(cache_key)
    if cached:
        return cached
    raw = await _fetch_yahoo_quote(yahoo_symbol)
    result = _normalize_yahoo_quote_result(raw or {}, metric_kind="crypto_quote", source_type="crypto_quote")
    if result:
        cache.set(cache_key, result, expire=MARKET_QUOTE_CACHE_TTL_SECONDS)
    return result


async def get_fx_rate(query: str) -> Optional[Dict[str, Any]]:
    pair = resolve_fx_pair(query)
    if not pair:
        return None
    base = str(pair["base"]).upper()
    quote = str(pair["quote"]).upper()
    amount = float(pair.get("amount") or 1.0)
    cache_key = f"fx:frankfurter:{base}:{quote}:{amount}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    api_url = "https://api.frankfurter.app/latest"
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(api_url, params={"from": base, "to": quote, "amount": amount})
            resp.raise_for_status()
            payload = resp.json()
    except Exception as e:
        logger.warning("FX rate lookup failed for %s/%s: %s", base, quote, e)
        return None

    rates = (payload or {}).get("rates") or {}
    rate_value = rates.get(quote)
    if rate_value is None:
        return None

    try:
        amt_num = float((payload or {}).get("amount", amount))
        rate_num = float(rate_value)
        per_unit = rate_num / amt_num if amt_num else None
    except Exception:
        amt_num = amount
        rate_num = None
        per_unit = None

    date_str = (payload or {}).get("date")
    as_of = f"{date_str}T00:00:00Z" if isinstance(date_str, str) and date_str else utcnow_iso()
    inverse = (1.0 / per_unit) if per_unit not in (None, 0) else None
    structured = {
        "kind": "fx_rate",
        "base": base,
        "quote": quote,
        "amount": amt_num,
        "converted_amount": rate_num,
        "rate": per_unit,
        "inverse_rate": inverse,
        "as_of": as_of,
        "provider": "frankfurter",
        "provider_url": f"https://api.frankfurter.app/latest?from={base}&to={quote}&amount={amt_num}",
    }
    rate_text = f"{per_unit:.6f}" if isinstance(per_unit, (int, float)) else str(per_unit)
    inverse_text = f"{inverse:.6f}" if isinstance(inverse, (int, float)) else "N/A"
    content = (
        f"{base}/{quote} exchange rate is {rate_text}. "
        f"{amt_num:g} {base} = {rate_num:g} {quote}. "
        f"Inverse rate ({quote}/{base}) is {inverse_text}. "
        f"As of {as_of}. source: frankfurter"
    )
    result = normalize_search_item(
        title=f"{base}/{quote} exchange rate",
        url=structured["provider_url"],
        content=content,
        snippet=content[:240],
        engine="frankfurter",
        source_type="fx_rate",
        structured_data=structured,
        is_realtime=True,
        metadata={"provider": "frankfurter", "as_of": as_of, "base": base, "quote": quote},
    )
    cache.set(cache_key, result, expire=FX_RATE_CACHE_TTL_SECONDS)
    return result


def _parse_fred_csv_rows(csv_text: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    if not csv_text:
        return rows
    try:
        reader = csv.DictReader(io.StringIO(csv_text))
    except Exception:
        return rows
    for row in reader:
        date_str = (row.get("DATE") or row.get("date") or "").strip()
        value_str = (row.get("VALUE") or row.get("value") or "").strip()
        if not date_str or not value_str or value_str == ".":
            continue
        try:
            value = float(value_str)
            dt = datetime.fromisoformat(date_str)
        except Exception:
            continue
        rows.append({"date": date_str, "datetime": dt, "value": value})
    rows.sort(key=lambda r: r["datetime"])
    return rows


def _compute_yoy_percent(rows: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if len(rows) < 13:
        return None
    latest = rows[-1]
    latest_dt = latest["datetime"]
    candidates = [r for r in rows if (latest_dt - r["datetime"]).days >= 330]
    if not candidates:
        return None
    prior = candidates[-1]
    if prior["value"] == 0:
        return None
    yoy = ((latest["value"] - prior["value"]) / prior["value"]) * 100.0
    return {"latest": latest, "prior": prior, "value": yoy, "basis": "year_over_year_percent_change"}


async def get_macro_indicator(query: str) -> Optional[Dict[str, Any]]:
    spec = resolve_macro_indicator(query)
    if not spec:
        return None
    series_id = spec["series_id"]
    cache_key = f"macro:fred:{series_id}:{spec.get('transform') or 'raw'}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    csv_url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}"
    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            resp = await client.get(csv_url)
            resp.raise_for_status()
            csv_text = resp.text
    except Exception as e:
        logger.warning("FRED indicator lookup failed for %s: %s", series_id, e)
        return None

    rows = _parse_fred_csv_rows(csv_text)
    if not rows:
        return None

    latest = rows[-1]
    value = latest["value"]
    transform = spec.get("transform")
    transform_metadata: Dict[str, Any] = {}
    if transform == "yoy_percent":
        yoy_result = _compute_yoy_percent(rows)
        if not yoy_result:
            return None
        value = yoy_result["value"]
        transform_metadata = {
            "transform": "yoy_percent",
            "prior_observation_date": yoy_result["prior"]["date"],
            "prior_observation_value": yoy_result["prior"]["value"],
            "latest_raw_value": yoy_result["latest"]["value"],
            "basis": yoy_result["basis"],
        }

    as_of = f"{latest['date']}T00:00:00Z"
    provider_url = f"https://fred.stlouisfed.org/series/{series_id}"
    structured = {
        "kind": "macro_indicator",
        "indicator_key": series_id,
        "series_id": series_id,
        "title": spec["title"],
        "value": value,
        "unit": spec.get("unit"),
        "observation_date": latest["date"],
        "as_of": as_of,
        "provider": "fred",
        "provider_url": provider_url,
        "raw_series_csv_url": csv_url,
        **transform_metadata,
    }
    value_text = f"{value:.4f}" if isinstance(value, (int, float)) else str(value)
    unit = f" {spec.get('unit')}" if spec.get("unit") else ""
    transform_note = " (derived YoY)" if transform == "yoy_percent" else ""
    content = f"{spec['title']} is {value_text}{unit}{transform_note}. Observation date: {latest['date']}. source: FRED ({series_id})"
    result = normalize_search_item(
        title=spec["title"],
        url=provider_url,
        content=content,
        snippet=content[:240],
        engine="fred",
        source_type="macro_indicator",
        structured_data=structured,
        is_realtime=True,
        metadata={
            "provider": "fred",
            "series_id": series_id,
            "as_of": as_of,
            "observation_date": latest["date"],
            "unit": spec.get("unit"),
            **({"transform": transform} if transform else {}),
        },
    )
    cache.set(cache_key, result, expire=MACRO_INDICATOR_CACHE_TTL_SECONDS)
    return result


async def search_live_structured_data(query: str) -> Optional[Dict[str, Any]]:
    if not query:
        return None

    routes: Tuple[StructuredProviderRoute, ...] = (
        StructuredProviderRoute(name="fx", detector=looks_like_fx_query, fetcher=get_fx_rate),
        StructuredProviderRoute(name="macro", detector=looks_like_macro_query, fetcher=get_macro_indicator),
        StructuredProviderRoute(name="crypto", detector=looks_like_crypto_query, fetcher=get_crypto_quote),
        StructuredProviderRoute(
            name="stock",
            detector=looks_like_stock_quote_query,
            fetcher=lambda q: get_stock_quote(resolve_stock_symbol(q) or ""),
        ),
    )

    for route in routes:
        if not route.detector(query):
            continue
        try:
            result = await route.fetcher(query)
        except Exception as e:
            logger.warning("Structured provider '%s' failed for query %r: %s", route.name, query, e)
            continue
        if result:
            return result
    return None


async def search_live_market_data(query: str) -> Optional[Dict[str, Any]]:
    return await search_live_structured_data(query)
