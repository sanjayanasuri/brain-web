from datetime import datetime
from typing import Any, Dict, List, Optional


def utcnow_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def clamp_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        value_int = int(value)
    except Exception:
        return default
    return max(minimum, min(maximum, value_int))


def compact_number(value: Any) -> Optional[str]:
    try:
        num = float(value)
    except Exception:
        return None
    abs_num = abs(num)
    if abs_num >= 1_000_000_000_000:
        return f"{num / 1_000_000_000_000:.2f}T"
    if abs_num >= 1_000_000_000:
        return f"{num / 1_000_000_000:.2f}B"
    if abs_num >= 1_000_000:
        return f"{num / 1_000_000:.2f}M"
    if abs_num >= 1_000:
        return f"{num / 1_000:.2f}K"
    return f"{num:.2f}"


def normalize_search_item(
    *,
    title: str,
    url: str,
    content: str,
    snippet: Optional[str],
    engine: str,
    score: float = 1.0,
    metadata: Optional[Dict[str, Any]] = None,
    source_type: str = "web_page",
    structured_data: Optional[Dict[str, Any]] = None,
    is_realtime: bool = False,
) -> Dict[str, Any]:
    md = dict(metadata or {})
    md.setdefault("retrieved_at", utcnow_iso())
    md.setdefault("provider", md.get("provider") or engine)
    return {
        "title": title or "Untitled",
        "url": url or "",
        "content": content or "",
        "snippet": (snippet if snippet is not None else (content or "")[:500])[:500],
        "engine": engine,
        "score": score,
        "source_type": source_type,
        "is_realtime": bool(is_realtime),
        "structured_data": structured_data,
        "metadata": md,
    }


def dedupe_results(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    deduped: List[Dict[str, Any]] = []
    for item in results:
        key = (item.get("url") or "", item.get("title") or "", item.get("engine") or "")
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def build_market_quote_content(structured: Dict[str, Any]) -> str:
    symbol = structured.get("symbol") or ""
    name = structured.get("name") or symbol
    price = structured.get("price")
    currency = structured.get("currency") or ""
    change = structured.get("change")
    change_pct = structured.get("change_percent")
    market_cap = structured.get("market_cap")
    volume = structured.get("volume")
    as_of = structured.get("as_of")
    provider = structured.get("provider") or "market data provider"

    price_str = f"{price:.2f}" if isinstance(price, (int, float)) else str(price)
    change_str = f"{change:+.2f}" if isinstance(change, (int, float)) else str(change)
    pct_str = f"{change_pct:+.2f}%" if isinstance(change_pct, (int, float)) else str(change_pct)

    parts = [f"{name} ({symbol}) is trading at {price_str} {currency}".strip()]
    if change is not None and change_pct is not None:
        parts.append(f"(change {change_str}, {pct_str})")
    if market_cap is not None:
        compact_mc = compact_number(market_cap) or str(market_cap)
        parts.append(f"market cap {compact_mc}")
    if volume is not None:
        compact_vol = compact_number(volume) or str(volume)
        parts.append(f"volume {compact_vol}")
    if as_of:
        parts.append(f"as of {as_of}")
    parts.append(f"source: {provider}")
    return ". ".join([p for p in parts if p]).replace(". (change", " (change")
