"""
Brain Web Web Search API Endpoints

Native web search endpoints for Brain Web.
"""
from fastapi import APIRouter, Query, HTTPException, Depends
from typing import Any, Dict, List, Optional
import logging
import threading
import time
from collections import defaultdict
from pydantic import BaseModel, Field

from auth import require_auth
from config import WEB_SEARCH_RATE_LIMIT_PER_MINUTE

from services_web_search import (
    search_web,
    fetch_page_content,
    search_and_fetch,
    deep_research,
    get_youtube_transcript,
    crawl_site,
    ResearcherAgent,
    QueryClassifier,
    NewsAggregator,
    translate_content,
    get_stock_quote,
    search_live_market_data,
    resolve_stock_symbol,
    answer_web,
    create_exa_research_task,
    get_exa_research_task,
    list_exa_research_tasks,
    wait_for_exa_research_task,
)

logger = logging.getLogger("brain_web")

# Simple per-(tenant,user) in-memory limiter for web-search endpoints.
# In production at scale, replace with Redis distributed limiter.
_web_rate_limit_store: Dict[str, list] = defaultdict(list)
_web_rate_limit_lock = threading.Lock()


def _check_web_rate_limit(*, tenant_id: str, user_id: str) -> bool:
    key = f"{tenant_id}:{user_id}"
    with _web_rate_limit_lock:
        now = time.time()
        _web_rate_limit_store[key] = [ts for ts in _web_rate_limit_store[key] if now - ts < 60]
        if len(_web_rate_limit_store[key]) >= WEB_SEARCH_RATE_LIMIT_PER_MINUTE:
            return False
        _web_rate_limit_store[key].append(now)
        return True


def _require_web_access(auth: dict = Depends(require_auth)) -> dict:
    tenant_id = auth.get("tenant_id")
    user_id = auth.get("user_id")
    if not tenant_id or not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not _check_web_rate_limit(tenant_id=tenant_id, user_id=user_id):
        raise HTTPException(
            status_code=429,
            detail=f"Web search rate limit exceeded ({WEB_SEARCH_RATE_LIMIT_PER_MINUTE}/min)",
        )
    return auth


router = APIRouter(prefix="/web-search", tags=["web-search"], dependencies=[Depends(_require_web_access)])


class ExaAnswerRequest(BaseModel):
    query: str = Field(..., description="Question/query to answer with Exa")
    policy_name: Optional[str] = Field(default=None, description="Optional Exa policy profile override")
    category: Optional[str] = Field(default=None, description="Optional Exa category override, e.g. news")
    content_mode: Optional[str] = Field(default=None, description="Optional content mode override: text/highlights")
    content_max_length: int = Field(default=12000, ge=1000, le=100000)
    max_age_hours: Optional[int] = Field(default=None, ge=-1, le=24 * 365)
    include_domains: Optional[List[str]] = None
    exclude_domains: Optional[List[str]] = None
    use_text: bool = True
    output_schema: Optional[Dict[str, Any]] = None
    prefer_realtime_only: bool = False


class ExaResearchTaskCreateRequest(BaseModel):
    instructions: str = Field(..., description="Research instructions for Exa research task")
    model: Optional[str] = Field(default=None, description="Optional Exa research model override")
    output_schema: Optional[Dict[str, Any]] = None
    wait: bool = Field(default=False, description="Poll until completion before returning")
    timeout_seconds: int = Field(default=180, ge=1, le=1800)
    poll_interval_seconds: float = Field(default=2.0, ge=0.5, le=30.0)
    include_events: bool = Field(default=False, description="Include task events when polling/getting task")


@router.get("/search")
async def search_endpoint(
    query: str = Query(..., description="Search query"),
    time_range: Optional[str] = Query(None, description="Time filter: day, week, month, year"),
):
    """
    Unified real-time search:
    - Exa for web/document search and extraction
    - Structured live market quotes for stock price/metric queries
    """
    try:
        results = await search_web(query=query, time_range=time_range)
        return {
            "query": query,
            "results": results,
            "number_of_results": len(results),
        }
    except Exception as e:
        logger.error(f"Search endpoint error: {e}")
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


@router.get("/stock-quote")
async def stock_quote_endpoint(
    symbol: Optional[str] = Query(None, description="Ticker symbol, e.g. NVDA"),
    query: Optional[str] = Query(None, description="Natural language query, e.g. 'current stock price of nvidia'"),
):
    """
    Fetch a structured live stock quote snapshot (price, change, market cap, volume).
    """
    try:
        resolved_symbol = (symbol or "").strip().upper() or (resolve_stock_symbol(query or "") if query else None)
        if not resolved_symbol:
            raise HTTPException(
                status_code=400,
                detail="Provide a ticker symbol or a stock price query that includes a recognizable company/ticker",
            )

        result = await get_stock_quote(resolved_symbol)
        if not result and query:
            # One retry through query router in case alias resolution logic expands later.
            result = await search_live_market_data(query)
        if not result:
            raise HTTPException(status_code=404, detail=f"No quote data found for symbol '{resolved_symbol}'")

        return {
            "success": True,
            "symbol": resolved_symbol,
            "query": query,
            "result": result,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Stock quote endpoint error: {e}")
        raise HTTPException(status_code=500, detail=f"Stock quote lookup failed: {str(e)}")


@router.get("/live-metric")
async def live_metric_endpoint(
    query: str = Query(..., description="Natural-language live metric query, e.g. 'BTC price', 'USD to EUR exchange rate', 'US inflation rate'"),
):
    """
    Resolve structured live metrics (stocks, crypto, FX, macro indicators) using the provider router.
    """
    try:
        result = await search_live_market_data(query)
        if not result:
            raise HTTPException(status_code=404, detail="No structured live metric provider matched the query")
        return {"success": True, "query": query, "result": result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Live metric endpoint error: {e}")
        raise HTTPException(status_code=500, detail=f"Live metric lookup failed: {str(e)}")


@router.post("/exa/answer")
async def exa_answer_endpoint(req: ExaAnswerRequest):
    """
    Exa-backed answer endpoint with policy-driven controls.
    Strict metric queries may be answered by structured providers for deterministic values.
    """
    try:
        result = await answer_web(
            query=req.query,
            policy_name=req.policy_name,
            category=req.category,
            content_mode=req.content_mode,
            content_max_length=req.content_max_length,
            max_age_hours=req.max_age_hours,
            include_domains=req.include_domains,
            exclude_domains=req.exclude_domains,
            use_text=req.use_text,
            output_schema=req.output_schema,
            prefer_realtime_only=req.prefer_realtime_only,
        )
        if not result:
            raise HTTPException(status_code=502, detail="Exa answer returned no result")
        return {"success": True, **result}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Exa answer endpoint error: {e}")
        raise HTTPException(status_code=500, detail=f"Exa answer failed: {str(e)}")


@router.post("/exa/research/tasks")
async def exa_research_create_task_endpoint(req: ExaResearchTaskCreateRequest):
    """
    Create an Exa research task. Optionally poll until completion.
    """
    try:
        task = await create_exa_research_task(
            instructions=req.instructions,
            model=req.model,
            output_schema=req.output_schema,
        )
        if not task:
            raise HTTPException(status_code=502, detail="Failed to create Exa research task")

        if req.wait and task.get("id"):
            polled = await wait_for_exa_research_task(
                task_id=task["id"],
                timeout_seconds=req.timeout_seconds,
                poll_interval_seconds=req.poll_interval_seconds,
                include_events=req.include_events,
            )
            if polled:
                return {"success": True, "task": polled}
        return {"success": True, "task": task}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Exa research create endpoint error: {e}")
        raise HTTPException(status_code=500, detail=f"Exa research task creation failed: {str(e)}")


@router.get("/exa/research/tasks")
async def exa_research_list_tasks_endpoint(
    limit: int = Query(20, ge=1, le=100, description="Number of tasks to return"),
    cursor: Optional[str] = Query(None, description="Pagination cursor"),
):
    """List Exa research tasks."""
    try:
        data = await list_exa_research_tasks(limit=limit, cursor=cursor)
        if data is None:
            raise HTTPException(status_code=502, detail="Failed to list Exa research tasks")
        return {"success": True, **data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Exa research list endpoint error: {e}")
        raise HTTPException(status_code=500, detail=f"Exa research task list failed: {str(e)}")


@router.get("/exa/research/tasks/{task_id}")
async def exa_research_get_task_endpoint(
    task_id: str,
    include_events: bool = Query(False, description="Include task events"),
    wait: bool = Query(False, description="Poll until terminal task status"),
    timeout_seconds: int = Query(180, ge=1, le=1800),
    poll_interval_seconds: float = Query(2.0, ge=0.5, le=30.0),
):
    """Get an Exa research task (or wait for completion)."""
    try:
        if wait:
            task = await wait_for_exa_research_task(
                task_id=task_id,
                timeout_seconds=timeout_seconds,
                poll_interval_seconds=poll_interval_seconds,
                include_events=include_events,
            )
        else:
            task = await get_exa_research_task(task_id=task_id, include_events=include_events)
        if not task:
            raise HTTPException(status_code=404, detail=f"Exa research task '{task_id}' not found")
        return {"success": True, "task": task}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Exa research get endpoint error: {e}")
        raise HTTPException(status_code=500, detail=f"Exa research task lookup failed: {str(e)}")


@router.get("/fetch")
async def fetch_endpoint(
    url: str = Query(..., description="URL to fetch content from"),
    max_length: int = Query(20000, description="Maximum content length"),
):
    """
    Fetch and extract clean content from a webpage using Exa.
    """
    try:
        result = await fetch_page_content(url=url, max_length=max_length)
        if not result:
            raise HTTPException(status_code=404, detail="Failed to fetch content from URL")
        return {
            "success": True,
            "url": url,
            **result,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Fetch endpoint error: {e}")
        raise HTTPException(status_code=500, detail=f"Fetch failed: {str(e)}")


@router.get("/search-and-fetch")
async def search_and_fetch_endpoint(
    query: str = Query(..., description="Search query"),
    num_results: int = Query(3, description="Number of results to fetch (1-5)", ge=1, le=5),
    time_range: Optional[str] = Query(None, description="Time filter: day, week, month, year"),
    max_content_length: int = Query(15000, description="Maximum content length per page"),
):
    """
    Search and fetch top results using the unified real-time retrieval layer.
    Web/document queries use Exa; supported stock metric queries return structured live quotes.
    """
    try:
        result = await search_and_fetch(
            query=query,
            num_results=num_results,
            time_range=time_range,
            max_content_length=max_content_length,
        )
        return result
    except Exception as e:
        logger.error(f"Search-and-fetch endpoint error: {e}")
        raise HTTPException(status_code=500, detail=f"Search and fetch failed: {str(e)}")


@router.get("/deep-research")
async def deep_research_endpoint(
    queries: str = Query(..., description="Comma-separated list of research queries (max 10)"),
    breadth: int = Query(3, description="Number of results per query (1-5)", ge=1, le=5),
    time_range: Optional[str] = Query(None, description="Time filter: day, week, month, year"),
    use_exa_research: bool = Query(False, description="Use Exa Research tasks instead of search-and-fetch"),
    exa_research_wait: bool = Query(True, description="Wait for Exa research task completion before returning"),
    exa_research_timeout_seconds: int = Query(240, ge=5, le=1800, description="Max time to wait for each Exa research task"),
):
    """
    Perform comprehensive research across multiple queries in parallel using Exa.
    """
    try:
        query_list = [q.strip() for q in queries.split(",") if q.strip()]
        if not query_list:
            raise HTTPException(status_code=400, detail="No valid queries provided")
        
        result = await deep_research(
            queries=query_list,
            breadth=breadth,
            time_range=time_range,
            use_exa_research=use_exa_research,
            exa_research_wait=exa_research_wait,
            exa_research_timeout_seconds=exa_research_timeout_seconds,
        )
        return result
    except Exception as e:
        logger.error(f"Deep research endpoint error: {e}")
        raise HTTPException(status_code=500, detail=f"Deep research failed: {str(e)}")


@router.get("/youtube-transcript")
async def youtube_transcript_endpoint(
    video: str = Query(..., description="YouTube URL or video ID"),
):
    """
    Fetch YouTube video transcript.
    """
    try:
        result = await get_youtube_transcript(video=video)
        return result
    except Exception as e:
        logger.error(f"YouTube transcript endpoint error: {e}")
        raise HTTPException(status_code=500, detail=f"YouTube transcript failed: {str(e)}")


@router.get("/crawl-site")
async def crawl_site_endpoint(
    start_url: str = Query(..., description="Starting URL to crawl"),
    max_pages: int = Query(20, description="Maximum pages to crawl"),
    subpage_target: str = Query("content", description="Exa subpage crawl target (e.g. content/path)"),
):
    """
    Crawl a specific site using Exa extraction.
    """
    try:
        result = await crawl_site(start_url=start_url, max_pages=max_pages, subpage_target=subpage_target)
        return result
    except Exception as e:
        logger.error(f"Crawl site endpoint error: {e}")
        raise HTTPException(status_code=500, detail=f"Site crawl failed: {str(e)}")


@router.get("/translate")
async def translate_endpoint(
    text: str = Query(..., description="Text to translate"),
    target_language: str = Query(..., description="Target language code (e.g., 'en', 'es', 'fr')"),
):
    """
    Translate text using LLM.
    """
    try:
        translated = await translate_content(text=text, target=target_language)
        if not translated:
            raise HTTPException(status_code=500, detail="Translation failed")
        return {
            "original": text,
            "translated": translated,
            "target_language": target_language,
        }
    except Exception as e:
        logger.error(f"Translate endpoint error: {e}")
        raise HTTPException(status_code=500, detail=f"Translation failed: {str(e)}")


@router.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "service": "brain-web-web-search"}

@router.post("/research")
async def research_endpoint(
    query: str = Query(..., description="Research query"),
    active_graph_id: str = Query("default", description="Active graph space ID"),
):
    """
    Perform native, graph-aware research using the ResearcherAgent.
    Iteratively searches the web and your knowledge graph to provide high-fidelity answers.
    """
    try:
        agent = ResearcherAgent()
        result = await agent.execute(query, active_graph_id=active_graph_id)
        return result
    except Exception as e:
        logger.error(f"Research agent error: {e}")
        raise HTTPException(status_code=500, detail=f"Research unsuccessful: {str(e)}")

@router.post("/classify")
async def classify_endpoint(
    query: str = Query(..., description="Query to classify"),
):
    """Classify a query focus and search requirements."""
    try:
        result = await QueryClassifier.classify(query)
        return result
    except Exception as e:
        logger.error(f"Classification error: {e}")
        raise HTTPException(status_code=500, detail=f"Classification failed: {str(e)}")

@router.get("/discover-news")
async def discover_news_endpoint():
    """Fetch top news across multiple categories for the Discover feed."""
    try:
        return await NewsAggregator.get_discover_feed()
    except Exception as e:
        logger.error(f"Discover news error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch discover news: {str(e)}")

@router.get("/news-category")
async def news_category_endpoint(
    category: str = Query(..., description="Category: tech, science, culture, sports, entertainment"),
    limit: int = Query(10, description="Number of results"),
):
    """Fetch news for a specific category."""
    try:
        results = await NewsAggregator.fetch_category_news(category, limit)
        return {"category": category, "results": results}
    except Exception as e:
        logger.error(f"Category news error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch news for {category}: {str(e)}")
