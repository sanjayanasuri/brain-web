"""
Brain Web Web Search API Endpoints

Native web search endpoints for Brain Web.
"""
from fastapi import APIRouter, Query, HTTPException
from typing import Optional
import logging

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
)

logger = logging.getLogger("brain_web")

router = APIRouter(prefix="/web-search", tags=["web-search"])


@router.get("/search")
async def search_endpoint(
    query: str = Query(..., description="Search query"),
    engines: Optional[str] = Query(None, description="Comma-separated engines (google,bing,duckduckgo,brave)"),
    language: str = Query("en", description="Language code"),
    time_range: Optional[str] = Query(None, description="Time filter: day, week, month, year"),
    rerank: bool = Query(False, description="Enable AI semantic reranking for better relevance"),
):
    """
    Search the web using SearXNG (aggregates multiple search engines).
    
    Enhanced with AI semantic reranking for better relevance.
    Returns search results with titles, URLs, and snippets.
    """
    try:
        results = await search_web(
            query=query,
            engines=engines,
            language=language,
            time_range=time_range,
            rerank=rerank,
        )
        return {
            "query": query,
            "results": results,
            "number_of_results": len(results),
        }
    except Exception as e:
        logger.error(f"Search endpoint error: {e}")
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


@router.get("/fetch")
async def fetch_endpoint(
    url: str = Query(..., description="URL to fetch content from"),
    max_length: int = Query(10000, description="Maximum content length"),
    format: str = Query("text", description="Output format: text, markdown, or html"),
    stealth_mode: str = Query("medium", description="Anti-bot bypass: off, low, medium, high"),
    render_js: bool = Query(False, description="Enable JavaScript rendering for SPAs (Playwright/Selenium)"),
):
    """
    Fetch and extract clean content from a webpage with enhanced metadata.
    
    Uses Trafilatura for high-quality content extraction (Firecrawl-quality).
    Supports stealth mode for protected sites and JavaScript rendering for SPAs.
    """
    try:
        result = await fetch_page_content(
            url=url,
            max_length=max_length,
            format=format,
            stealth_mode=stealth_mode,
            render_js=render_js,
        )
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
    engines: Optional[str] = Query(None, description="Comma-separated engines"),
    language: str = Query("en", description="Language code"),
    time_range: Optional[str] = Query(None, description="Time filter: day, week, month, year"),
    max_content_length: int = Query(10000, description="Maximum content length per page"),
    format: str = Query("text", description="Output format: text, markdown, or html"),
    rerank: bool = Query(False, description="Enable AI semantic reranking for better relevance"),
    stealth_mode: str = Query("medium", description="Anti-bot bypass: off, low, medium, high"),
    render_js: bool = Query(False, description="Enable JavaScript rendering for SPAs"),
    translate_to: Optional[str] = Query(None, description="Translate content to target language code (e.g., 'es', 'fr', 'de')"),
):
    """
    Search the web and automatically fetch full content from top results.
    
    Enhanced with AI reranking, stealth mode, JavaScript rendering, and metadata extraction.
    This is the main endpoint used by Brain Web for getting current information.
    It searches via SearXNG and then scrapes the actual content from the top results.
    """
    try:
        result = await search_and_fetch(
            query=query,
            num_results=num_results,
            engines=engines,
            language=language,
            time_range=time_range,
            max_content_length=max_content_length,
            format=format,
            rerank=rerank,
            stealth_mode=stealth_mode,
            render_js=render_js,
            translate_to=translate_to,
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
    max_content_length: int = Query(30000, description="Max content length per result"),
    stealth_mode: str = Query("off", description="Anti-bot bypass: off, low, medium, high"),
):
    """
    Perform comprehensive research across multiple queries in parallel.
    
    Processes multiple queries simultaneously and compiles results into a unified report.
    Perfect for deep research on complex topics.
    """
    try:
        query_list = [q.strip() for q in queries.split(",") if q.strip()]
        if not query_list:
            raise HTTPException(status_code=400, detail="No valid queries provided")
        if len(query_list) > 10:
            raise HTTPException(status_code=400, detail="Maximum 10 queries allowed")
        
        result = await deep_research(
            queries=query_list,
            breadth=breadth,
            time_range=time_range,
            max_content_length=max_content_length,
            stealth_mode=stealth_mode,
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Deep research endpoint error: {e}")
        raise HTTPException(status_code=500, detail=f"Deep research failed: {str(e)}")


@router.get("/youtube-transcript")
async def youtube_transcript_endpoint(
    video: str = Query(..., description="YouTube URL or video ID"),
    format: str = Query("text", description="Output format: text, json, or srt"),
    lang: Optional[str] = Query(None, description="Preferred language code"),
    translate: Optional[str] = Query(None, description="Translate to target language"),
    start: Optional[int] = Query(None, description="Start time in seconds"),
    end: Optional[int] = Query(None, description="End time in seconds"),
):
    """
    Fetch YouTube video transcript for LLM consumption.
    
    Supports multiple formats, language selection, translation, and time slicing.
    """
    try:
        result = await get_youtube_transcript(
            video=video,
            format=format,
            lang=lang,
            translate=translate,
            start=start,
            end=end,
        )
        return result
    except Exception as e:
        logger.error(f"YouTube transcript endpoint error: {e}")
        raise HTTPException(status_code=500, detail=f"YouTube transcript failed: {str(e)}")


@router.get("/crawl-site")
async def crawl_site_endpoint(
    start_url: str = Query(..., description="Starting URL to crawl"),
    max_pages: int = Query(50, description="Maximum pages to crawl (1-200)", ge=1, le=200),
    max_depth: int = Query(2, description="Maximum crawl depth (0-5)", ge=0, le=5),
    format: str = Query("markdown", description="Output format: text, markdown, or html"),
    url_patterns: Optional[str] = Query(None, description="Comma-separated regex patterns to include"),
    exclude_patterns: Optional[str] = Query(None, description="Comma-separated regex patterns to exclude"),
    stealth_mode: str = Query("off", description="Anti-bot bypass: off, low, medium, high"),
    obey_robots: bool = Query(True, description="Respect robots.txt"),
):
    """
    Recursively crawl an entire website and extract content from multiple pages.
    
    Uses Scrapy for industrial-strength web crawling.
    Perfect for documentation sites, blogs, knowledge bases.
    """
    try:
        result = await crawl_site(
            start_url=start_url,
            max_pages=max_pages,
            max_depth=max_depth,
            format=format,
            url_patterns=url_patterns,
            exclude_patterns=exclude_patterns,
            stealth_mode=stealth_mode,
            obey_robots=obey_robots,
        )
        return result
    except Exception as e:
        logger.error(f"Crawl site endpoint error: {e}")
        raise HTTPException(status_code=500, detail=f"Site crawl failed: {str(e)}")


@router.get("/translate")
async def translate_endpoint(
    text: str = Query(..., description="Text to translate"),
    target_language: str = Query(..., description="Target language code (e.g., 'en', 'es', 'fr')"),
    source_language: Optional[str] = Query(None, description="Source language code (auto-detect if not provided)"),
):
    """
    Translate text to target language.
    
    Uses free translation APIs (Google Translate) or LLM as fallback.
    """
    try:
        translated = await translate_content(
            text=text,
            target_language=target_language,
            source_language=source_language,
        )
        if not translated:
            raise HTTPException(status_code=500, detail="Translation failed")
        return {
            "original": text,
            "translated": translated,
            "source_language": source_language or "auto",
            "target_language": target_language,
        }
    except HTTPException:
        raise
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
