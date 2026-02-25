"""
Brain Web Native Web Search Service

Production-oriented orchestration layer:
- Exa provider for web/news/document retrieval and extraction
- Structured metrics provider for exact live financial/economic values

This module preserves the legacy public API used across the codebase while
routing requests through provider modules and query policies.
"""

import asyncio
import hashlib
import json
import logging
import re
from enum import Enum
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from diskcache import Cache

# Import Graph Retrieval dependencies
try:
    from services_retrieval_plans import run_plan
    GRAPH_RETRIEVAL_AVAILABLE = True
except ImportError:
    GRAPH_RETRIEVAL_AVAILABLE = False

# AI libraries for native agents
from services_model_router import model_router, TASK_SEARCH, TASK_SYNTHESIS
from providers.exa_provider import (
    LEARNING_OUTPUT_SCHEMA,
    answer_exa as exa_answer_provider,
    crawl_site_exa as exa_crawl_site_provider,
    create_research_task_exa as exa_create_research_task_provider,
    discover_site_pages,
    fetch_page_content as exa_fetch_page_content,
    get_research_task_exa as exa_get_research_task_provider,
    list_research_tasks_exa as exa_list_research_tasks_provider,
    search_exa as exa_search_provider,
    search_exa_news,
    wait_for_research_task_exa as exa_wait_research_task_provider,
)
from providers.result_utils import clamp_int, dedupe_results
from providers.structured_metrics_provider import (
    get_crypto_quote,
    get_fx_rate,
    get_macro_indicator,
    get_stock_quote,
    is_strict_metric_query,
    looks_like_structured_metric_query,
    resolve_crypto_symbol,
    resolve_fx_pair,
    resolve_macro_indicator,
    resolve_stock_symbol,
    search_live_market_data,
    search_live_structured_data,
)

OPENAI_AVAILABLE = model_router.client is not None

logger = logging.getLogger("brain_web")

# Initialize cache
cache = Cache("/tmp/brainweb_websearch_cache")
WEB_SEARCH_CACHE_TTL_SECONDS = 3600

LEGACY_SEARCH_KWARGS = {
    "engines",
    "rerank",
    "stealth_mode",
    "auto_bypass",
    "categories",
    "format",
}


class SearchFocus(str, Enum):
    GENERAL = "general"
    ACADEMIC = "academic"
    YOUTUBE = "youtube"
    REDDIT = "reddit"
    GITHUB = "github"


# Backward-compatible public wrappers
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
    include_domains: Optional[List[str]] = None,
    exclude_domains: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    return await exa_search_provider(
        query=query,
        num_results=num_results,
        use_contents=use_contents,
        time_range=time_range,
        content_max_length=content_max_length,
        category=category,
        max_age_hours=max_age_hours,
        policy_name=policy_name,
        content_mode=content_mode,
        include_domains=include_domains,
        exclude_domains=exclude_domains,
    )


async def fetch_page_content(url: str, max_length: int = 20000) -> Optional[Dict[str, Any]]:
    return await exa_fetch_page_content(url=url, max_length=max_length)


async def answer_web(query: str, **kwargs) -> Optional[Dict[str, Any]]:
    """
    Unified answer wrapper:
    - strict metric queries return deterministic structured metric summaries
    - other queries use Exa /answer with policy-driven search controls
    """
    if looks_like_structured_metric_query(query):
        structured = await search_live_structured_data(query)
        if structured and (is_strict_metric_query(query) or kwargs.get("prefer_realtime_only", False)):
            content = structured.get("content") or structured.get("snippet") or ""
            return {
                "query": query,
                "answer": content,
                "citations": [
                    {
                        "title": structured.get("title"),
                        "url": structured.get("url"),
                        "snippet": structured.get("snippet"),
                        "provider": structured.get("engine"),
                    }
                ],
                "structured_metric": structured,
                "source": "structured_metric_provider",
                "raw": {"structured_metric": structured},
            }

    use_learning_schema = bool(kwargs.get("use_learning_schema", False))
    output_schema = kwargs.get("output_schema")
    if output_schema is None and use_learning_schema:
        output_schema = LEARNING_OUTPUT_SCHEMA
    return await exa_answer_provider(
        query=query,
        policy_name=kwargs.get("policy_name"),
        category=kwargs.get("category"),
        content_mode=kwargs.get("content_mode"),
        content_max_length=clamp_int(kwargs.get("content_max_length"), default=12000, minimum=1000, maximum=100000),
        max_age_hours=kwargs.get("max_age_hours"),
        include_domains=kwargs.get("include_domains"),
        exclude_domains=kwargs.get("exclude_domains"),
        stream=bool(kwargs.get("stream", False)),
        use_text=bool(kwargs.get("use_text", True)),
        output_schema=output_schema,
    )


async def create_exa_research_task(
    instructions: str,
    *,
    model: Optional[str] = None,
    output_schema: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    return await exa_create_research_task_provider(
        instructions=instructions,
        model=model,
        output_schema=output_schema,
    )


async def get_exa_research_task(task_id: str, *, include_events: bool = False) -> Optional[Dict[str, Any]]:
    return await exa_get_research_task_provider(task_id=task_id, include_events=include_events)


async def list_exa_research_tasks(*, limit: int = 20, cursor: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return await exa_list_research_tasks_provider(limit=limit, cursor=cursor)


async def wait_for_exa_research_task(
    task_id: str,
    *,
    timeout_seconds: int = 180,
    poll_interval_seconds: float = 2.0,
    include_events: bool = False,
) -> Optional[Dict[str, Any]]:
    return await exa_wait_research_task_provider(
        task_id=task_id,
        timeout_seconds=timeout_seconds,
        poll_interval_seconds=poll_interval_seconds,
        include_events=include_events,
    )


def _ignore_legacy_search_kwargs(kwargs: Dict[str, Any]) -> None:
    ignored = {k: kwargs.get(k) for k in LEGACY_SEARCH_KWARGS if k in kwargs}
    if ignored:
        logger.debug("Ignoring legacy web search options after provider refactor: %s", ignored)


def _stable_str_list(values: Any) -> List[str]:
    if not isinstance(values, (list, tuple)):
        return []
    out = []
    for v in values:
        s = str(v).strip().lower()
        if s:
            out.append(s)
    return sorted(set(out))


def _build_search_cache_key(query: str, kwargs: Dict[str, Any], exa_num_results: int, content_max_length: int, time_range: Optional[str]) -> str:
    payload = {
        "query": query,
        "time_range": time_range,
        "exa_num_results": exa_num_results,
        "content_max_length": content_max_length,
        "policy_name": kwargs.get("policy_name"),
        "category": kwargs.get("category"),
        "max_age_hours": kwargs.get("max_age_hours"),
        "content_mode": kwargs.get("content_mode"),
        "include_realtime": bool(kwargs.get("include_realtime", True)),
        "include_web_context": bool(kwargs.get("include_web_context", True)),
        "prefer_realtime_only": bool(kwargs.get("prefer_realtime_only", False)),
        "include_domains": _stable_str_list(kwargs.get("include_domains")),
        "exclude_domains": _stable_str_list(kwargs.get("exclude_domains")),
    }
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()[:24]
    return f"search:web:v4:{digest}"


async def search_web(query: str, **kwargs) -> List[Dict[str, Any]]:
    """
    Unified real-time search wrapper.
    Routes exact metric queries to structured providers and all other web retrieval
    to Exa. Keeps backward compatibility with legacy kwargs.
    """
    _ignore_legacy_search_kwargs(kwargs)
    num_results = clamp_int(kwargs.get("num_results"), default=10, minimum=1, maximum=25)
    time_range = kwargs.get("time_range")
    content_max_length = clamp_int(kwargs.get("content_max_length"), default=20000, minimum=1000, maximum=100000)

    include_realtime = bool(kwargs.get("include_realtime", True))
    include_web_context = bool(kwargs.get("include_web_context", True))
    prefer_realtime_only = bool(kwargs.get("prefer_realtime_only", False))

    structured_result: Optional[Dict[str, Any]] = None
    if include_realtime and looks_like_structured_metric_query(query):
        structured_result = await search_live_structured_data(query)
        if structured_result and (is_strict_metric_query(query) or prefer_realtime_only):
            if num_results <= 1 or not include_web_context:
                return [structured_result]

    exa_num_results = max(1, num_results - (1 if structured_result else 0))
    cache_key = _build_search_cache_key(query, kwargs, exa_num_results, content_max_length, time_range)
    cached_web_results = cache.get(cache_key)
    if cached_web_results is None:
        try:
            cached_web_results = await search_exa(
                query=query,
                num_results=exa_num_results,
                use_contents=True,
                time_range=time_range,
                content_max_length=content_max_length,
                policy_name=kwargs.get("policy_name"),
                category=kwargs.get("category"),
                max_age_hours=kwargs.get("max_age_hours"),
                content_mode=kwargs.get("content_mode"),
                include_domains=kwargs.get("include_domains"),
                exclude_domains=kwargs.get("exclude_domains"),
            )
        except Exception as e:
            logger.warning("Exa search provider failure in search_web", extra={"query": query, "error": str(e)})
            cached_web_results = []
        cache.set(cache_key, cached_web_results, expire=WEB_SEARCH_CACHE_TTL_SECONDS)

    if structured_result:
        return dedupe_results([structured_result] + list(cached_web_results))[:num_results]
    return list(cached_web_results)[:num_results]


async def search_and_fetch(query: str, num_results: int = 3, **kwargs) -> Dict[str, Any]:
    """
    Search and return normalized fetched content for each result.
    Preserves the legacy response shape while adding structured metadata fields.
    """
    _ignore_legacy_search_kwargs(kwargs)
    max_content_length = clamp_int(kwargs.get("max_content_length"), default=15000, minimum=1000, maximum=100000)

    results = await search_web(
        query,
        num_results=num_results,
        time_range=kwargs.get("time_range"),
        content_max_length=max_content_length,
        include_realtime=kwargs.get("include_realtime", True),
        include_web_context=kwargs.get("include_web_context", True),
        prefer_realtime_only=kwargs.get("prefer_realtime_only", False),
    )

    normalized_results = []
    fetched_count = 0

    for r in results[: clamp_int(num_results, default=3, minimum=1, maximum=25)]:
        search_result = {
            "title": r.get("title", "Untitled"),
            "url": r.get("url", ""),
            "snippet": r.get("snippet", ""),
            "engine": r.get("engine", "web"),
            "source_type": r.get("source_type", "web_page"),
            "is_realtime": bool(r.get("is_realtime")),
            "structured_data": r.get("structured_data"),
            "score": r.get("score", 1.0),
        }

        fetched_content = None
        fetch_status = "failed"

        if r.get("content"):
            fetched_content = {
                "title": r.get("title", "Untitled"),
                "content": (r.get("content") or "")[:max_content_length],
                "url": r.get("url", ""),
                "metadata": r.get("metadata") or {},
                "source_type": r.get("source_type", "web_page"),
                "engine": r.get("engine", "web"),
                "structured_data": r.get("structured_data"),
                "is_realtime": bool(r.get("is_realtime")),
            }
            fetch_status = "success"
        elif r.get("url") and r.get("source_type") == "web_page":
            fetched = await fetch_page_content(url=r["url"], max_length=max_content_length)
            if fetched:
                fetched_content = {
                    **fetched,
                    "structured_data": r.get("structured_data"),
                    "is_realtime": bool(r.get("is_realtime")),
                }
                fetch_status = "success"

        if fetch_status == "success":
            fetched_count += 1

        normalized_results.append(
            {
                "search_result": search_result,
                "fetched_content": fetched_content
                or {
                    "title": r.get("title", "Untitled"),
                    "content": "",
                    "url": r.get("url", ""),
                    "metadata": r.get("metadata") or {},
                    "source_type": r.get("source_type", "web_page"),
                    "engine": r.get("engine", "web"),
                    "structured_data": r.get("structured_data"),
                    "is_realtime": bool(r.get("is_realtime")),
                },
                "fetch_status": fetch_status,
            }
        )

    return {
        "query": query,
        "results": normalized_results,
        "num_results_found": len(results),
        "num_results_fetched": fetched_count,
    }


class QueryClassifier:
    @staticmethod
    async def classify(query: str, history=None) -> Dict:
        prompt = (
            "Analyze if this query needs web search and its focus "
            "(general, academic, youtube, reddit, github). "
            f"Query: {query}\nHistory: {history}\n"
            'Return JSON: {"focus": "...", "skip_search": bool}'
        )
        try:
            raw = model_router.completion(
                task_type=TASK_SEARCH,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
            )
            return json.loads(raw)
        except Exception:
            return {"focus": "general", "skip_search": False}


class ResearcherAgent:
    def __init__(self):
        pass

    async def execute(self, query: str, active_graph_id: str = "default", history: List[Dict] = None) -> Dict[str, Any]:
        classification = await QueryClassifier.classify(query, history)
        if classification.get("skip_search"):
            return {"answer": "No search needed.", "sources": []}

        collected_context = []
        all_sources = []

        for _ in range(3):
            tools = [
                {"type": "function", "function": {"name": "web_search", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}}}},
                {"type": "function", "function": {"name": "graph_search", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}}}},
                {"type": "function", "function": {"name": "done"}},
            ]

            response = model_router.client.chat.completions.create(
                model=model_router.get_model_for_task(TASK_SEARCH),
                messages=[
                    {"role": "system", "content": "You are a research agent. Use web_search (Exa/structured providers) or graph_search."},
                    {"role": "user", "content": f"Researching: {query}\nContext: {collected_context}"},
                ],
                tools=tools,
            )

            msg = response.choices[0].message
            if not msg.tool_calls:
                break

            for tc in msg.tool_calls:
                args = json.loads(tc.function.arguments)
                if tc.function.name == "done":
                    return await self._synthesize(query, all_sources)
                if tc.function.name == "web_search":
                    results = await search_web(args["query"], num_results=5)
                    all_sources.extend(results)
                    collected_context.append("\n".join([f"- {r['title']}: {r['content'][:500]}" for r in results[:3]]))
                if tc.function.name == "graph_search":
                    collected_context.append(await self._perform_graph_search(args["query"], active_graph_id))

        return await self._synthesize(query, all_sources)

    async def _perform_graph_search(self, query: str, graph_id: str) -> str:
        if not GRAPH_RETRIEVAL_AVAILABLE:
            return "Graph retrieval unavailable."
        try:
            from db_neo4j import driver
            with driver.session() as session:
                result = run_plan(session=session, query=query, intent="definition_overview", graph_id=graph_id)
                return f"Summary: {result.context.get('summary', '')}"
        except Exception:
            return "Graph search failed."

    async def _synthesize(self, query: str, sources: List[Dict]) -> Dict[str, Any]:
        unique = {s["url"]: s for s in sources}.values()
        context = "\n".join(
            [f"[{i+1}] {s['title']} ({s['url']}): {s['content'][:1000]}" for i, s in enumerate(list(unique)[:5])]
        )
        answer = model_router.completion(task_type=TASK_SYNTHESIS, messages=[{"role": "user", "content": f"Query: {query}\nSources:\n{context}"}])
        return {"answer": answer, "sources": list(unique)[:10]}


class NewsAggregator:
    CATEGORIES = {
        "tech": "AI news",
        "science": "science breakthroughs",
        "culture": "cultural trends",
        "sports": "sports",
        "entertainment": "gaming news",
    }

    @staticmethod
    async def fetch_category_news(cat: str, limit: int = 10):
        return await search_exa_news(NewsAggregator.CATEGORIES.get(cat, cat), limit=limit, max_age_hours=1)

    @staticmethod
    async def get_discover_feed():
        cats = ["tech", "science", "entertainment", "culture"]
        results = await asyncio.gather(*[NewsAggregator.fetch_category_news(c, 4) for c in cats])
        return {c: r for c, r in zip(cats, results)}


def _stringify_research_output(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=True, indent=2)
    except Exception:
        return str(value)


def _format_exa_research_task_result_for_report(query: str, task: Optional[Dict[str, Any]]) -> str:
    if not task:
        return f"## {query}\nExa research task failed to return a result."
    answer = (task.get("answer") or "").strip()
    if not answer:
        answer = _stringify_research_output(task.get("output")).strip()
    citations = task.get("citations") if isinstance(task.get("citations"), list) else []
    citation_lines = []
    for c in citations[:10]:
        if isinstance(c, dict):
            title = c.get("title") or c.get("name") or "Source"
            url = c.get("url") or ""
            citation_lines.append(f"- {title}: {url}".rstrip(": "))
        elif isinstance(c, str):
            citation_lines.append(f"- {c}")
    body = answer or "No answer text returned."
    if citation_lines:
        body += "\n\nSources:\n" + "\n".join(citation_lines)
    return f"## {query}\n{body}"


async def deep_research(queries: List[str], breadth: int = 3, **kwargs) -> Dict[str, Any]:
    use_exa_research = bool(kwargs.get("use_exa_research", False))
    if use_exa_research:
        wait_for_completion = bool(kwargs.get("exa_research_wait", True))
        timeout_seconds = clamp_int(kwargs.get("exa_research_timeout_seconds"), default=240, minimum=5, maximum=1800)
        poll_interval_seconds = float(kwargs.get("exa_research_poll_interval_seconds", 2.0) or 2.0)
        include_events = bool(kwargs.get("exa_research_include_events", False))
        model = kwargs.get("exa_research_model")
        output_schema = kwargs.get("exa_research_output_schema")

        async def _run_query_exa_research(q: str) -> Dict[str, Any]:
            task = await create_exa_research_task(
                instructions=q,
                model=model,
                output_schema=output_schema,
            )
            if task and wait_for_completion and task.get("id"):
                task = await wait_for_exa_research_task(
                    task_id=task["id"],
                    timeout_seconds=timeout_seconds,
                    poll_interval_seconds=poll_interval_seconds,
                    include_events=include_events,
                ) or task
            return {"query": q, "exa_research_task": task}

        exa_query_results = await asyncio.gather(*[_run_query_exa_research(q) for q in queries[:10]])
        report_sections = [
            _format_exa_research_task_result_for_report(item["query"], item.get("exa_research_task"))
            for item in exa_query_results
        ]
        return {
            "mode": "exa_research_tasks",
            "query_results": exa_query_results,
            "compiled_report": "# Deep Research Report (Exa Research)\n\n" + "\n\n".join(report_sections),
        }

    tasks = [search_and_fetch(q, num_results=breadth, **kwargs) for q in queries[:10]]
    results = await asyncio.gather(*tasks)
    report = "# Deep Research Report\n\n" + "\n".join(
        [
            f"## {q}\n" + "\n".join([f"### {r['search_result']['title']}\n{r['fetched_content']['content'][:1000]}" for r in res['results']])
            for q, res in zip(queries, results)
        ]
    )
    return {"query_results": results, "compiled_report": report}


async def crawl_site(start_url: str, max_pages: int = 20, **kwargs) -> Dict[str, Any]:
    """
    Production crawl flow:
    1) try Exa /contents subpages (verified Exa crawl capability)
    2) fallback to Exa domain discovery search if subpages are unavailable
    """
    content_max_length = clamp_int(kwargs.get("max_content_length"), default=12000, minimum=1000, maximum=100000)
    exa_crawl = await exa_crawl_site_provider(
        start_url,
        max_pages=max_pages,
        content_max_length=content_max_length,
        subpage_target=str(kwargs.get("subpage_target") or "content"),
    )
    exa_pages = exa_crawl.get("pages") or []
    if exa_pages:
        return exa_crawl

    pages = await discover_site_pages(
        start_url,
        max_pages=max_pages,
        content_max_length=content_max_length,
    )
    if not pages:
        main = await fetch_page_content(start_url)
        return {
            "crawl_summary": {
                "url": start_url,
                "pages": 1 if main else 0,
                "method": "exa_contents_subpages_fallback_single_fetch",
            },
            "pages": [main] if main else [],
        }

    formatted_pages = [
        {
            "title": p.get("title", ""),
            "url": p.get("url", ""),
            "content": p.get("content", ""),
            "metadata": p.get("metadata", {}),
        }
        for p in pages[: max(1, int(max_pages))]
    ]
    return {
        "crawl_summary": {
            "url": start_url,
            "domain": urlparse(start_url).netloc,
            "pages": len(formatted_pages),
            "method": "exa_search_domain_discovery_fallback",
        },
        "pages": formatted_pages,
    }


async def get_youtube_transcript(video: str, **kwargs) -> Dict[str, Any]:
    """Fetch YouTube transcript if library available."""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi

        video_id = (
            re.search(r"(?:v=|/)([0-9A-Za-z_-]{11}).*", video).group(1)
            if "youtube.com" in video or "youtu.be" in video
            else video
        )
        transcript = YouTubeTranscriptApi.get_transcript(video_id)
        content = "\n".join([t["text"] for t in transcript])
        return {"success": True, "transcript": content, "video_id": video_id}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def translate_content(text: str, target: str = "en", **kwargs) -> Optional[str]:
    """Simple LLM-based translation."""
    try:
        return model_router.completion(
            task_type=TASK_SYNTHESIS,
            messages=[{"role": "user", "content": f"Translate to {target}: {text[:2000]}"}],
        )
    except Exception:
        return None
