import json
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


@dataclass(frozen=True)
class WebSearchRoutingConfig:
    stock_query_hints: Tuple[str, ...]
    crypto_query_hints: Tuple[str, ...]
    fx_query_hints: Tuple[str, ...]
    macro_query_hints: Tuple[str, ...]
    strict_metric_hints: Tuple[str, ...]
    stock_ticker_stopwords: Tuple[str, ...]
    company_tickers: Dict[str, Optional[str]]
    crypto_tickers: Dict[str, str]
    currency_name_to_code: Dict[str, str]
    macro_indicators: Tuple[Dict[str, Any], ...]


_CONFIG_LOCK = threading.Lock()
_CONFIG_CACHE: Optional[WebSearchRoutingConfig] = None


def _default_config_path() -> Path:
    return Path(__file__).with_name("web_search_routing_config.json")


def _dedupe_preserve_order(values: List[str]) -> Tuple[str, ...]:
    out: List[str] = []
    seen = set()
    for raw in values:
        if not isinstance(raw, str):
            continue
        item = raw.strip()
        if not item or item in seen:
            continue
        seen.add(item)
        out.append(item)
    return tuple(out)


def _expect_dict(raw: Any, field_name: str) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError(f"web search routing config field '{field_name}' must be an object")
    return raw


def _expect_list(raw: Any, field_name: str) -> List[Any]:
    if not isinstance(raw, list):
        raise ValueError(f"web search routing config field '{field_name}' must be a list")
    return raw


def _normalize_str_map(
    raw: Dict[str, Any],
    *,
    field_name: str,
    allow_null_values: bool = False,
    key_case: str = "lower",
    value_case: Optional[str] = None,
) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for key, value in raw.items():
        if not isinstance(key, str):
            raise ValueError(f"{field_name} keys must be strings")
        k = key.strip()
        if not k:
            continue
        if key_case == "lower":
            k = k.lower()
        elif key_case == "upper":
            k = k.upper()

        if value is None and allow_null_values:
            out[k] = None
            continue

        if not isinstance(value, str):
            raise ValueError(f"{field_name} values must be strings")

        v = value.strip()
        if value_case == "lower":
            v = v.lower()
        elif value_case == "upper":
            v = v.upper()
        out[k] = v
    return out


def _normalize_macro_indicators(raw_items: List[Any]) -> Tuple[Dict[str, Any], ...]:
    normalized: List[Dict[str, Any]] = []
    required = {"series_id", "title", "aliases"}
    for idx, raw in enumerate(raw_items):
        if not isinstance(raw, dict):
            raise ValueError(f"macro_indicators[{idx}] must be an object")
        missing = [k for k in required if k not in raw]
        if missing:
            raise ValueError(f"macro_indicators[{idx}] missing required fields: {', '.join(missing)}")

        aliases_raw = _expect_list(raw.get("aliases"), f"macro_indicators[{idx}].aliases")
        aliases = tuple(a.strip().lower() for a in aliases_raw if isinstance(a, str) and a.strip())
        if not aliases:
            raise ValueError(f"macro_indicators[{idx}].aliases must include at least one alias")

        item = {
            "series_id": str(raw.get("series_id", "")).strip().upper(),
            "kind": str(raw.get("kind", "macro_indicator")).strip() or "macro_indicator",
            "title": str(raw.get("title", "")).strip(),
            "unit": (str(raw["unit"]).strip() if raw.get("unit") is not None else None),
            "aliases": list(aliases),
            "transform": (str(raw["transform"]).strip() if raw.get("transform") is not None else None),
            "provider": str(raw.get("provider", "fred")).strip().lower() or "fred",
        }
        if not item["series_id"] or not item["title"]:
            raise ValueError(f"macro_indicators[{idx}] must have non-empty series_id and title")
        normalized.append(item)
    return tuple(normalized)


def _parse_config(raw: Dict[str, Any]) -> WebSearchRoutingConfig:
    query_hints = _expect_dict(raw.get("query_hints"), "query_hints")

    stock_hints = [str(v).strip().lower() for v in _expect_list(query_hints.get("stock"), "query_hints.stock") if str(v).strip()]
    crypto_hints = [str(v).strip().lower() for v in _expect_list(query_hints.get("crypto"), "query_hints.crypto") if str(v).strip()]
    fx_hints = [str(v).strip().lower() for v in _expect_list(query_hints.get("fx"), "query_hints.fx") if str(v).strip()]
    macro_hints = [str(v).strip().lower() for v in _expect_list(query_hints.get("macro"), "query_hints.macro") if str(v).strip()]

    strict_metric_hints = [str(v).strip().lower() for v in _expect_list(raw.get("strict_metric_hints"), "strict_metric_hints") if str(v).strip()]
    stopwords = [str(v).strip().upper() for v in _expect_list(raw.get("stock_ticker_stopwords"), "stock_ticker_stopwords") if str(v).strip()]

    company_tickers = _normalize_str_map(
        _expect_dict(raw.get("company_tickers"), "company_tickers"),
        field_name="company_tickers",
        allow_null_values=True,
        key_case="lower",
        value_case="upper",
    )
    crypto_tickers = _normalize_str_map(
        _expect_dict(raw.get("crypto_tickers"), "crypto_tickers"),
        field_name="crypto_tickers",
        allow_null_values=False,
        key_case="lower",
        value_case="upper",
    )
    currency_name_to_code = _normalize_str_map(
        _expect_dict(raw.get("currency_name_to_code"), "currency_name_to_code"),
        field_name="currency_name_to_code",
        allow_null_values=False,
        key_case="lower",
        value_case="upper",
    )
    macro_indicators = _normalize_macro_indicators(_expect_list(raw.get("macro_indicators"), "macro_indicators"))

    return WebSearchRoutingConfig(
        stock_query_hints=_dedupe_preserve_order(stock_hints),
        crypto_query_hints=_dedupe_preserve_order(crypto_hints),
        fx_query_hints=_dedupe_preserve_order(fx_hints),
        macro_query_hints=_dedupe_preserve_order(macro_hints),
        strict_metric_hints=_dedupe_preserve_order(strict_metric_hints),
        stock_ticker_stopwords=_dedupe_preserve_order(stopwords),
        company_tickers=company_tickers,
        crypto_tickers=crypto_tickers,
        currency_name_to_code=currency_name_to_code,
        macro_indicators=macro_indicators,
    )


def _load_raw_config_from_path(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def get_web_search_routing_config(*, force_reload: bool = False) -> WebSearchRoutingConfig:
    global _CONFIG_CACHE
    if _CONFIG_CACHE is not None and not force_reload:
        return _CONFIG_CACHE

    with _CONFIG_LOCK:
        if _CONFIG_CACHE is not None and not force_reload:
            return _CONFIG_CACHE

        config_path_str = os.getenv("WEB_SEARCH_ROUTING_CONFIG_PATH")
        config_path = Path(config_path_str).expanduser() if config_path_str else _default_config_path()
        raw = _load_raw_config_from_path(config_path)
        _CONFIG_CACHE = _parse_config(raw)
        return _CONFIG_CACHE
