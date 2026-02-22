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
    time_range: Optional[str] = Query(None, description="Time filter: day, week, month, year"),
):
    """
    Search the web using Exa Neural Search.
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
    Search the web and automatically fetch full content from top results using Exa.
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
):
    """
    Crawl a specific site using Exa extraction.
    """
    try:
        result = await crawl_site(start_url=start_url, max_pages=max_pages)
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
