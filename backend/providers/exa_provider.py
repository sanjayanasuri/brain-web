import asyncio
import json
import logging
import random
from dataclasses import dataclass
from datetime import datetime, timedelta
from email.utils import parsedate_to_datetime
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.parse import urlparse

import httpx

from config_exa_query_policy import ExaSearchProfile, get_exa_query_policy_config
from providers.result_utils import clamp_int, normalize_search_item, utcnow_iso

logger = logging.getLogger("brain_web")

DEFAULT_HTTP_TIMEOUT_SECONDS = 30.0
EXA_HTTP_MAX_ATTEMPTS = 4
EXA_HTTP_BACKOFF_BASE_SECONDS = 0.5
EXA_HTTP_BACKOFF_CAP_SECONDS = 8.0
EXA_RETRYABLE_STATUS_CODES = {408, 409, 425, 429, 500, 502, 503, 504}


@dataclass(frozen=True)
class ResolvedExaSearchPolicy:
    profile_name: str
    search_type: str
    category: Optional[str]
    content_mode: str
    content_max_characters: int
    max_age_hours: Optional[int]
    include_domains: Tuple[str, ...]
    exclude_domains: Tuple[str, ...]


def _normalize_query(query: str) -> str:
    return (query or "").strip()


def _parse_exa_result_text(result: Dict[str, Any]) -> str:
    text = result.get("text")
    if isinstance(text, str):
        return text

    highlights = result.get("highlights")
    if isinstance(highlights, list):
        parts = [str(h).strip() for h in highlights if str(h).strip()]
        return "\n".join(parts)
    if isinstance(highlights, str):
        return highlights
    return ""


def _parse_exa_contents_results_payload(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    results = data.get("results")
    if isinstance(results, list):
        return [r for r in results if isinstance(r, dict)]
    if isinstance(results, dict):
        nested = results.get("results")
        if isinstance(nested, list):
            return [r for r in nested if isinstance(r, dict)]
    return []


def _coerce_domains(values: Optional[Sequence[str]]) -> Tuple[str, ...]:
    if not values:
        return tuple()
    out: List[str] = []
    seen = set()
    for item in values:
        if item is None:
            continue
        v = str(item).strip().lower()
        if not v or v in seen:
            continue
        seen.add(v)
        out.append(v)
    return tuple(out)


def _matches_rule(query_lower: str, rule) -> bool:
    if rule.match_all and not all(term in query_lower for term in rule.match_all):
        return False
    if rule.match_any and not any(term in query_lower for term in rule.match_any):
        return False
    return True


def _resolve_profile_from_query(query: str, *, profile_name: Optional[str] = None) -> ExaSearchProfile:
    cfg = get_exa_query_policy_config()
    if profile_name:
        profile = cfg.profiles.get(profile_name)
        if profile:
            return profile
        logger.warning("Unknown Exa policy profile %r; falling back to default", profile_name)

    q = _normalize_query(query).lower()
    for rule in cfg.rules:
        if _matches_rule(q, rule):
            return cfg.profiles[rule.profile]
    return cfg.profiles[cfg.default_profile]


def resolve_exa_search_policy(
    query: str,
    *,
    profile_name: Optional[str] = None,
    category: Optional[str] = None,
    use_contents: bool = True,
    content_mode: Optional[str] = None,
    content_max_length: Optional[int] = None,
    max_age_hours: Optional[int] = None,
    include_domains: Optional[Sequence[str]] = None,
    exclude_domains: Optional[Sequence[str]] = None,
) -> ResolvedExaSearchPolicy:
    profile = _resolve_profile_from_query(query, profile_name=profile_name)

    resolved_content_mode = (content_mode or profile.content_mode or "text").strip().lower()
    if not use_contents:
        resolved_content_mode = "none"

    resolved_content_max = clamp_int(
        content_max_length if content_max_length is not None else profile.content_max_characters,
        default=12000,
        minimum=0,
        maximum=100000,
    )

    inc = _coerce_domains(include_domains) or profile.include_domains
    exc = _coerce_domains(exclude_domains) or profile.exclude_domains
    if inc and exc:
        logger.warning("Both include/exclude domains provided; using include_domains and dropping exclude_domains")
        exc = tuple()

    return ResolvedExaSearchPolicy(
        profile_name=profile.name,
        search_type=profile.search_type or "auto",
        category=(category if category is not None else profile.category),
        content_mode=resolved_content_mode,
        content_max_characters=resolved_content_max,
        max_age_hours=max_age_hours if max_age_hours is not None else profile.max_age_hours,
        include_domains=inc,
        exclude_domains=exc,
    )


def _build_contents_payload(mode: str, max_characters: int) -> Optional[Dict[str, Any]]:
    if mode == "none":
        return None
    if mode == "highlights":
        return {"highlights": {"max_characters": max(0, int(max_characters))}}
    return {"text": {"max_characters": max(0, int(max_characters))}}


def _apply_time_range(payload: Dict[str, Any], time_range: Optional[str]) -> None:
    if not time_range:
        return
    ranges = {"day": 1, "week": 7, "month": 30, "year": 365}
    days = ranges.get(str(time_range).lower())
    if not days:
        return
    payload["startPublishedDate"] = (datetime.utcnow() - timedelta(days=days)).isoformat() + "Z"


def _exa_headers(api_key: str) -> Dict[str, str]:
    return {"x-api-key": api_key, "content-type": "application/json"}


def _get_exa_api_key() -> Optional[str]:
    from config import EXA_API_KEY

    if not EXA_API_KEY:
        logger.error("EXA_API_KEY not found")
        return None
    return EXA_API_KEY


def _build_contents_text_payload(max_length: int, *, camel_case: bool = False) -> Dict[str, Any]:
    max_chars = clamp_int(max_length, default=20000, minimum=1000, maximum=100000)
    if camel_case:
        return {"text": {"maxCharacters": max_chars}}
    return {"text": {"max_characters": max_chars}}


def _parse_retry_after_seconds(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        seconds = float(raw)
        return max(0.0, seconds)
    except Exception:
        pass
    try:
        dt = parsedate_to_datetime(raw)
        # Normalize naive datetimes to UTC-like behavior.
        if dt.tzinfo is None:
            target_ts = dt.timestamp()
        else:
            target_ts = dt.timestamp()
        delay = target_ts - datetime.utcnow().timestamp()
        return max(0.0, delay)
    except Exception:
        return None


def _compute_retry_delay_seconds(attempt: int, *, retry_after: Optional[float] = None) -> float:
    if retry_after is not None:
        return min(EXA_HTTP_BACKOFF_CAP_SECONDS, max(0.0, retry_after))
    exp = EXA_HTTP_BACKOFF_BASE_SECONDS * (2 ** max(0, attempt - 1))
    jitter = random.uniform(0.0, 0.25)
    return min(EXA_HTTP_BACKOFF_CAP_SECONDS, exp + jitter)


async def _exa_request_json(
    method: str,
    url: str,
    *,
    api_key: str,
    json_body: Optional[Dict[str, Any]] = None,
    params: Optional[Dict[str, Any]] = None,
    timeout_seconds: float = DEFAULT_HTTP_TIMEOUT_SECONDS,
    max_attempts: int = EXA_HTTP_MAX_ATTEMPTS,
) -> Dict[str, Any]:
    """
    Shared Exa HTTP JSON request helper with retries/backoff/rate-limit handling.
    Retries network errors and retryable HTTP statuses (including 429).
    """
    attempts = max(1, int(max_attempts))
    last_exc: Optional[Exception] = None
    method_upper = (method or "GET").upper()

    for attempt in range(1, attempts + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout_seconds, follow_redirects=True) as client:
                resp = await client.request(
                    method_upper,
                    url,
                    headers=_exa_headers(api_key) if method_upper != "GET" else {"x-api-key": api_key},
                    json=json_body,
                    params=params,
                )

            if resp.status_code >= 400:
                retry_after = _parse_retry_after_seconds(resp.headers.get("Retry-After"))
                body_preview = (resp.text or "")[:300]
                if resp.status_code in EXA_RETRYABLE_STATUS_CODES and attempt < attempts:
                    delay_s = _compute_retry_delay_seconds(attempt, retry_after=retry_after)
                    logger.warning(
                        "Exa HTTP %s %s returned %s (attempt %s/%s). Retrying in %.2fs. body=%r",
                        method_upper,
                        url,
                        resp.status_code,
                        attempt,
                        attempts,
                        delay_s,
                        body_preview,
                    )
                    await asyncio.sleep(delay_s)
                    continue
                try:
                    resp.raise_for_status()
                except Exception as e:
                    last_exc = e
                    raise

            data = resp.json()
            if not isinstance(data, dict):
                return {"data": data}
            return data

        except httpx.HTTPStatusError as e:
            last_exc = e
            # Non-retryable or attempts exhausted.
            raise
        except httpx.RequestError as e:
            last_exc = e
            if attempt >= attempts:
                raise
            delay_s = _compute_retry_delay_seconds(attempt)
            logger.warning(
                "Exa HTTP network error on %s %s (attempt %s/%s): %s. Retrying in %.2fs",
                method_upper,
                url,
                attempt,
                attempts,
                e,
                delay_s,
            )
            await asyncio.sleep(delay_s)

    if last_exc:
        raise last_exc
    raise RuntimeError(f"Exa HTTP request failed unexpectedly: {method_upper} {url}")


def _exa_contents_item_to_page(result: Dict[str, Any], *, default_url: Optional[str] = None, max_length: int = 20000) -> Dict[str, Any]:
    text = _parse_exa_result_text(result)
    return {
        "title": str(result.get("title") or ""),
        "content": text[: clamp_int(max_length, default=20000, minimum=1000, maximum=100000)],
        "url": str(result.get("url") or default_url or ""),
        "metadata": {
            "author": result.get("author"),
            "date": result.get("publishedDate") or result.get("published_date"),
            "provider": "exa",
            "retrieved_at": utcnow_iso(),
            **({"exa_id": result.get("id")} if result.get("id") else {}),
        },
        "source_type": "web_page",
        "engine": "exa",
    }


def _collect_contents_subpages(root_result: Dict[str, Any]) -> List[Dict[str, Any]]:
    candidates = [
        root_result.get("subpages"),
        root_result.get("subpageResults"),
        root_result.get("subpagesResults"),
        root_result.get("children"),
    ]
    for candidate in candidates:
        if isinstance(candidate, list):
            return [item for item in candidate if isinstance(item, dict)]
        if isinstance(candidate, dict):
            nested = candidate.get("results")
            if isinstance(nested, list):
                return [item for item in nested if isinstance(item, dict)]
    return []


def _maybe_extract_task_id(task: Dict[str, Any]) -> Optional[str]:
    for key in ("id", "taskId", "researchId", "uuid"):
        value = task.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _normalize_exa_answer_response(query: str, raw: Dict[str, Any], policy: ResolvedExaSearchPolicy) -> Dict[str, Any]:
    answer_text = (
        raw.get("answer")
        or raw.get("response")
        or raw.get("text")
        or raw.get("content")
        or ""
    )
    citations_raw = raw.get("citations")
    if not isinstance(citations_raw, list):
        citations_raw = raw.get("sources") if isinstance(raw.get("sources"), list) else []

    citations: List[Dict[str, Any]] = []
    for item in citations_raw or []:
        if isinstance(item, dict):
            citations.append(
                {
                    "title": item.get("title") or item.get("name"),
                    "url": item.get("url"),
                    "snippet": item.get("snippet") or _parse_exa_result_text(item)[:400],
                    "provider": "exa",
                }
            )
        elif isinstance(item, str):
            citations.append({"title": None, "url": item, "snippet": None, "provider": "exa"})

    return {
        "query": query,
        "answer": str(answer_text or ""),
        "citations": citations,
        "policy": {
            "profile_name": policy.profile_name,
            "category": policy.category,
            "search_type": policy.search_type,
            "content_mode": policy.content_mode,
            "content_max_characters": policy.content_max_characters,
            "max_age_hours": policy.max_age_hours,
            "include_domains": list(policy.include_domains),
            "exclude_domains": list(policy.exclude_domains),
        },
        "raw": raw,
    }


def _normalize_research_task(task: Dict[str, Any]) -> Dict[str, Any]:
    task_id = _maybe_extract_task_id(task)
    status = task.get("status")
    citations = task.get("citations") if isinstance(task.get("citations"), list) else []
    events = task.get("events") if isinstance(task.get("events"), list) else None
    output = task.get("output")
    return {
        "id": task_id,
        "status": status,
        "instructions": task.get("instructions"),
        "model": task.get("model"),
        "created_at": task.get("createdAt") or task.get("created_at"),
        "updated_at": task.get("updatedAt") or task.get("updated_at"),
        "completed_at": task.get("completedAt") or task.get("completed_at"),
        "answer": task.get("answer") or task.get("report") or task.get("result"),
        "output": output,
        "citations": citations,
        "events": events,
        "error": task.get("error"),
        "raw": task,
    }


def _is_terminal_research_status(status: Optional[str]) -> bool:
    s = (status or "").strip().lower()
    return s in {"completed", "failed", "error", "cancelled", "canceled"}


async def search_exa(
    query: str,
    num_results: int = 10,
    use_contents: bool = True,
    time_range: Optional[str] = None,
    content_max_length: int = 20000,
    category: Optional[str] = None,
    max_age_hours: Optional[int] = None,
    policy_name: Optional[str] = None,
    content_mode: Optional[str] = None,
    include_domains: Optional[Sequence[str]] = None,
    exclude_domains: Optional[Sequence[str]] = None,
) -> List[Dict[str, Any]]:
    """Search the web using Exa with policy-driven endpoint configuration."""
    exa_api_key = _get_exa_api_key()
    if not exa_api_key:
        return []

    q = _normalize_query(query)
    if not q:
        return []

    policy = resolve_exa_search_policy(
        q,
        profile_name=policy_name,
        category=category,
        use_contents=use_contents,
        content_mode=content_mode,
        content_max_length=content_max_length,
        max_age_hours=max_age_hours,
        include_domains=include_domains,
        exclude_domains=exclude_domains,
    )

    payload: Dict[str, Any] = {
        "query": q,
        "type": policy.search_type,
        "num_results": clamp_int(num_results, default=10, minimum=1, maximum=25),
    }
    if policy.category is not None:
        payload["category"] = policy.category
    _apply_time_range(payload, time_range)
    if policy.max_age_hours is not None:
        payload["maxAgeHours"] = int(policy.max_age_hours)
    if policy.include_domains:
        payload["includeDomains"] = list(policy.include_domains)
    if policy.exclude_domains:
        payload["excludeDomains"] = list(policy.exclude_domains)

    contents_payload = _build_contents_payload(policy.content_mode, policy.content_max_characters)
    if contents_payload is not None:
        payload["contents"] = contents_payload

    url = "https://api.exa.ai/search"
    try:
        data = await _exa_request_json(
            "POST",
            url,
            api_key=exa_api_key,
            json_body=payload,
        )
    except Exception as e:
        logger.error("Exa search failed: %s", e)
        return []

    results: List[Dict[str, Any]] = []
    for r in data.get("results", []) or []:
        if not isinstance(r, dict):
            continue
        content = _parse_exa_result_text(r)
        results.append(
            normalize_search_item(
                title=str(r.get("title") or "Untitled"),
                url=str(r.get("url") or ""),
                content=content,
                snippet=content[:500] if content else "",
                engine="exa",
                score=float(r.get("score") or 1.0),
                source_type="web_page",
                metadata={
                    "author": r.get("author"),
                    "date": r.get("publishedDate") or r.get("published_date"),
                    "exa_id": r.get("id"),
                    "provider": "exa",
                    "policy_profile": policy.profile_name,
                    "category": policy.category,
                    "content_mode": policy.content_mode,
                    "max_age_hours": policy.max_age_hours,
                },
            )
        )
    return results


async def fetch_page_content(url: str, max_length: int = 20000) -> Optional[Dict[str, Any]]:
    """Fetch clean text from a URL using Exa /contents with documented payload shape."""
    exa_api_key = _get_exa_api_key()
    if not exa_api_key:
        return None

    target_url = (url or "").strip()
    if not target_url:
        return None

    api_url = "https://api.exa.ai/contents"
    payload = {"urls": [target_url], **_build_contents_text_payload(max_length, camel_case=False)}

    try:
        data = await _exa_request_json(
            "POST",
            api_url,
            api_key=exa_api_key,
            json_body=payload,
        )
    except Exception as e:
        logger.error("Exa contents fetch failed for %s: %s", target_url, e)
        return None

    results = _parse_exa_contents_results_payload(data)
    if not results:
        return None
    r = results[0] or {}
    if not isinstance(r, dict):
        return None
    return _exa_contents_item_to_page(r, default_url=target_url, max_length=max_length)


async def discover_site_pages(start_url: str, max_pages: int = 20, *, content_max_length: int = 12000) -> List[Dict[str, Any]]:
    """
    Best-effort site discovery using Exa search with domain filtering.
    This is safer than assuming Exa crawl endpoint semantics without runtime verification.
    """
    target = (start_url or "").strip()
    if not target:
        return []
    domain = urlparse(target).netloc
    if not domain:
        return []

    query = f"site:{domain} {domain}"
    return await search_exa(
        query=query,
        num_results=clamp_int(max_pages, default=20, minimum=1, maximum=50),
        use_contents=True,
        content_max_length=content_max_length,
        include_domains=[domain],
        policy_name="default_web",
    )


async def search_exa_news(query: str, limit: int = 10, *, max_age_hours: int = 1) -> List[Dict[str, Any]]:
    return await search_exa(
        query=query,
        num_results=limit,
        time_range="day",
        policy_name="news_live",
        category="news",
        max_age_hours=max_age_hours,
    )


async def crawl_site_exa(
    start_url: str,
    max_pages: int = 20,
    *,
    content_max_length: int = 12000,
    subpage_target: str = "content",
) -> Dict[str, Any]:
    """
    Crawl a site using Exa /contents subpages support (verified API capability).
    Falls back to a normalized empty result if the provider returns no pages.
    """
    exa_api_key = _get_exa_api_key()
    if not exa_api_key:
        return {"crawl_summary": {"url": start_url, "pages": 0, "method": "exa_contents_subpages"}, "pages": []}

    target = (start_url or "").strip()
    if not target:
        return {"crawl_summary": {"url": start_url, "pages": 0, "method": "exa_contents_subpages"}, "pages": []}

    api_url = "https://api.exa.ai/contents"
    subpages = clamp_int(max_pages, default=20, minimum=1, maximum=100)
    target_mode = (subpage_target or "content").strip()

    payload_variants: List[Dict[str, Any]] = [
        {
            "ids": [target],
            **_build_contents_text_payload(content_max_length, camel_case=True),
            "subpages": subpages,
            "subpageTarget": target_mode,
        },
        {
            "ids": [target],
            **_build_contents_text_payload(content_max_length, camel_case=False),
            "subpages": subpages,
            "subpageTarget": target_mode,
        },
        {
            "urls": [target],
            **_build_contents_text_payload(content_max_length, camel_case=False),
            "subpages": subpages,
            "subpageTarget": target_mode,
        },
        {
            "urls": [target],
            **_build_contents_text_payload(content_max_length, camel_case=False),
            "subpages": subpages,
            "subpage_target": target_mode,
        },
    ]

    data: Optional[Dict[str, Any]] = None
    last_error: Optional[Exception] = None
    for payload in payload_variants:
        try:
            data = await _exa_request_json(
                "POST",
                api_url,
                api_key=exa_api_key,
                json_body=payload,
            )
            break
        except Exception as e:
            last_error = e
            continue

    if data is None:
        logger.error("Exa crawl via /contents subpages failed for %s: %s", target, last_error)
        return {"crawl_summary": {"url": target, "pages": 0, "method": "exa_contents_subpages"}, "pages": []}

    results = _parse_exa_contents_results_payload(data)
    if not results:
        return {"crawl_summary": {"url": target, "pages": 0, "method": "exa_contents_subpages"}, "pages": []}

    root_result = results[0]
    page_dicts: List[Dict[str, Any]] = []
    root_page = _exa_contents_item_to_page(root_result, default_url=target, max_length=content_max_length)
    if root_page.get("url") or root_page.get("content") or root_page.get("title"):
        page_dicts.append(root_page)

    for sub in _collect_contents_subpages(root_result):
        page = _exa_contents_item_to_page(sub, max_length=content_max_length)
        if page.get("url") or page.get("content") or page.get("title"):
            page_dicts.append(page)

    # Deduplicate by URL/title while preserving order.
    seen = set()
    normalized_pages: List[Dict[str, Any]] = []
    for page in page_dicts:
        key = (page.get("url") or "", page.get("title") or "")
        if key in seen:
            continue
        seen.add(key)
        normalized_pages.append(page)

    return {
        "crawl_summary": {
            "url": target,
            "domain": urlparse(target).netloc,
            "pages": len(normalized_pages),
            "method": "exa_contents_subpages",
            "subpages_requested": subpages,
            "subpage_target": target_mode,
        },
        "pages": normalized_pages[:subpages],
        "raw": data,
    }


async def answer_exa(
    query: str,
    *,
    policy_name: Optional[str] = None,
    category: Optional[str] = None,
    content_mode: Optional[str] = None,
    content_max_length: int = 12000,
    max_age_hours: Optional[int] = None,
    include_domains: Optional[Sequence[str]] = None,
    exclude_domains: Optional[Sequence[str]] = None,
    stream: bool = False,
    use_text: bool = True,
    output_schema: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Exa /answer wrapper using the same policy resolution used by /search.
    Returns a normalized shape plus the raw response.
    """
    exa_api_key = _get_exa_api_key()
    if not exa_api_key:
        return None

    q = _normalize_query(query)
    if not q:
        return None

    policy = resolve_exa_search_policy(
        q,
        profile_name=policy_name,
        category=category,
        use_contents=True,
        content_mode=content_mode,
        content_max_length=content_max_length,
        max_age_hours=max_age_hours,
        include_domains=include_domains,
        exclude_domains=exclude_domains,
    )

    base_payload: Dict[str, Any] = {
        "query": q,
        "stream": bool(stream),
        "text": bool(use_text),
    }
    if output_schema is not None:
        base_payload["outputSchema"] = output_schema

    enriched_payload = dict(base_payload)
    # Exa answer supports many search controls; keep this best-effort and fallback to base payload on 4xx.
    if policy.category is not None:
        enriched_payload["category"] = policy.category
    if policy.max_age_hours is not None:
        enriched_payload["maxAgeHours"] = int(policy.max_age_hours)
    if policy.include_domains:
        enriched_payload["includeDomains"] = list(policy.include_domains)
    if policy.exclude_domains:
        enriched_payload["excludeDomains"] = list(policy.exclude_domains)

    url = "https://api.exa.ai/answer"
    payload_attempts = [enriched_payload]
    if enriched_payload != base_payload:
        payload_attempts.append(base_payload)

    data: Optional[Dict[str, Any]] = None
    last_error: Optional[Exception] = None
    for payload in payload_attempts:
        try:
            data = await _exa_request_json(
                "POST",
                url,
                api_key=exa_api_key,
                json_body=payload,
            )
            break
        except Exception as e:
            last_error = e
            continue

    if data is None:
        logger.error("Exa answer failed for query %r: %s", q, last_error)
        return None

    if not isinstance(data, dict):
        try:
            data = json.loads(str(data))
        except Exception:
            data = {"answer": str(data)}
    return _normalize_exa_answer_response(q, data, policy)


async def create_research_task_exa(
    instructions: str,
    *,
    model: Optional[str] = None,
    output_schema: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    exa_api_key = _get_exa_api_key()
    if not exa_api_key:
        return None
    body: Dict[str, Any] = {"instructions": (instructions or "").strip()}
    if not body["instructions"]:
        return None
    if model:
        body["model"] = str(model).strip()
    if output_schema is not None:
        body["outputSchema"] = output_schema

    try:
        data = await _exa_request_json(
            "POST",
            "https://api.exa.ai/research/v0/tasks",
            api_key=exa_api_key,
            json_body=body,
        )
    except Exception as e:
        logger.error("Exa research task create failed: %s", e)
        return None

    if not isinstance(data, dict):
        return None
    return _normalize_research_task(data)


async def get_research_task_exa(
    task_id: str,
    *,
    include_events: bool = False,
) -> Optional[Dict[str, Any]]:
    exa_api_key = _get_exa_api_key()
    if not exa_api_key:
        return None
    resolved_task_id = (task_id or "").strip()
    if not resolved_task_id:
        return None

    params: Dict[str, Any] = {}
    if include_events:
        params["includeEvents"] = "true"

    try:
        data = await _exa_request_json(
            "GET",
            f"https://api.exa.ai/research/v0/tasks/{resolved_task_id}",
            api_key=exa_api_key,
            params=params or None,
        )
    except Exception as e:
        logger.error("Exa research task get failed for %s: %s", resolved_task_id, e)
        return None

    if not isinstance(data, dict):
        return None
    return _normalize_research_task(data)


async def list_research_tasks_exa(
    *,
    limit: int = 20,
    cursor: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    exa_api_key = _get_exa_api_key()
    if not exa_api_key:
        return None
    params: Dict[str, Any] = {"limit": clamp_int(limit, default=20, minimum=1, maximum=100)}
    if cursor:
        params["cursor"] = str(cursor)

    try:
        data = await _exa_request_json(
            "GET",
            "https://api.exa.ai/research/v0/tasks",
            api_key=exa_api_key,
            params=params,
        )
    except Exception as e:
        logger.error("Exa research task list failed: %s", e)
        return None

    if not isinstance(data, dict):
        return None

    items_raw = data.get("items")
    if not isinstance(items_raw, list):
        items_raw = data.get("tasks") if isinstance(data.get("tasks"), list) else []

    return {
        "items": [_normalize_research_task(item) for item in items_raw if isinstance(item, dict)],
        "cursor": data.get("cursor") or data.get("nextCursor") or data.get("next_cursor"),
        "raw": data,
    }


async def wait_for_research_task_exa(
    task_id: str,
    *,
    timeout_seconds: int = 180,
    poll_interval_seconds: float = 2.0,
    include_events: bool = False,
) -> Optional[Dict[str, Any]]:
    resolved_task_id = (task_id or "").strip()
    if not resolved_task_id:
        return None
    timeout_s = max(1, int(timeout_seconds))
    interval_s = max(0.5, float(poll_interval_seconds))

    deadline = datetime.utcnow().timestamp() + timeout_s
    last_task: Optional[Dict[str, Any]] = None
    while datetime.utcnow().timestamp() < deadline:
        task = await get_research_task_exa(resolved_task_id, include_events=include_events)
        if task is None:
            break
        last_task = task
        if _is_terminal_research_status(task.get("status")):
            task["polled"] = True
            task["timed_out"] = False
            return task
        await asyncio.sleep(interval_s)

    if last_task is None:
        return None
    last_task["polled"] = True
    last_task["timed_out"] = True
    return last_task
