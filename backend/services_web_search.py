"""
Brain Web Native Web Search Service

Uses Exa.ai (Neural Search) exclusively for high-fidelity information retrieval.
Completely streamlined with no fallbacks.
"""
import httpx
import json
import asyncio
import logging
import random
import re
from typing import List, Dict, Optional, Any
from enum import Enum
from datetime import datetime, timedelta
from diskcache import Cache
from urllib.parse import urlparse

# Import Graph Retrieval dependencies
try:
    from services_retrieval_plans import run_plan
    GRAPH_RETRIEVAL_AVAILABLE = True
except ImportError:
    GRAPH_RETRIEVAL_AVAILABLE = False

# AI libraries for native agents
from services_model_router import model_router, TASK_SEARCH, TASK_SYNTHESIS
OPENAI_AVAILABLE = model_router.client is not None

logger = logging.getLogger("brain_web")

# Initialize cache
cache = Cache("/tmp/brainweb_websearch_cache")

class SearchFocus(str, Enum):
    GENERAL = "general"
    ACADEMIC = "academic"
    YOUTUBE = "youtube"
    REDDIT = "reddit"
    GITHUB = "github"

async def search_exa(
    query: str,
    num_results: int = 10,
    use_contents: bool = True,
    time_range: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Search the web using Exa (Neural Search)."""
    from config import EXA_API_KEY
    if not EXA_API_KEY:
        logger.error("EXA_API_KEY not found")
        return []
        
    url = "https://api.exa.ai/search"
    headers = {"x-api-key": EXA_API_KEY, "content-type": "application/json"}
    
    payload = {
        "query": query,
        "numResults": num_results,
        "useAutoprompt": True,
        "type": "neural"
    }
    
    if use_contents:
        payload["contents"] = {"text": True}
        
    if time_range:
        now = datetime.now()
        ranges = {"day": 1, "week": 7, "month": 30, "year": 365}
        days = ranges.get(time_range.lower(), 0)
        if days:
            payload["startPublishedDate"] = (now - timedelta(days=days)).isoformat()

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
            
            results = []
            for r in data.get("results", []):
                content = r.get("text", "")
                results.append({
                    "title": r.get("title", "Untitled"),
                    "url": r.get("url", ""),
                    "content": content,
                    "snippet": content[:500] if content else "",
                    "engine": "exa",
                    "score": r.get("score", 1.0),
                    "metadata": {
                        "author": r.get("author"),
                        "date": r.get("publishedDate"),
                        "exa_id": r.get("id"),
                    }
                })
            return results
    except Exception as e:
        logger.error(f"Exa search failed: {e}")
        return []

async def search_web(query: str, **kwargs) -> List[Dict[str, Any]]:
    """Clean wrapper for web search."""
    cache_key = f"search:web:{query}:{kwargs.get('time_range')}"
    cached = cache.get(cache_key)
    if cached: return cached
    
    results = await search_exa(query, time_range=kwargs.get("time_range"))
    if results: cache.set(cache_key, results, expire=3600)
    return results

async def fetch_page_content(url: str, max_length: int = 20000) -> Optional[Dict[str, Any]]:
    """Fetch clean text from a URL using Exa's extraction."""
    from config import EXA_API_KEY
    if not EXA_API_KEY: return None

    api_url = "https://api.exa.ai/contents"
    headers = {"x-api-key": EXA_API_KEY, "content-type": "application/json"}
    payload = {"ids": [url], "text": True}

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(api_url, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
            r = data.get("results", [{}])[0]
            if not r: return None
            
            return {
                "title": r.get("title", ""),
                "content": r.get("text", "")[:max_length],
                "url": r.get("url", ""),
                "metadata": {"author": r.get("author"), "date": r.get("publishedDate")}
            }
    except Exception:
        return None

async def search_and_fetch(query: str, num_results: int = 3, **kwargs) -> Dict[str, Any]:
    """Search and get full contents efficiently."""
    results = await search_exa(query, num_results=num_results, use_contents=True, time_range=kwargs.get("time_range"))
    return {
        "query": query,
        "results": [{
            "search_result": {"title": r["title"], "url": r["url"], "snippet": r["snippet"]},
            "fetched_content": {"title": r["title"], "content": r["content"], "metadata": r["metadata"]},
            "fetch_status": "success"
        } for r in results],
        "num_results_found": len(results),
        "num_results_fetched": len(results),
    }

class QueryClassifier:
    @staticmethod
    async def classify(query: str, history=None) -> Dict:
        prompt = f"Analyze if this query needs web search and its focus (general, academic, youtube, reddit, github). Query: {query}\nHistory: {history}\nReturn JSON: {{\"focus\": \"...\", \"skip_search\": bool}}"
        try:
            raw = model_router.completion(task_type=TASK_SEARCH, messages=[{"role": "user", "content": prompt}], response_format={"type": "json_object"})
            return json.loads(raw)
        except Exception:
            return {"focus": "general", "skip_search": False}

class ResearcherAgent:
    def __init__(self): pass
    
    async def execute(self, query: str, active_graph_id: str = "default", history: List[Dict] = None) -> Dict[str, Any]:
        classification = await QueryClassifier.classify(query, history)
        if classification.get("skip_search"): return {"answer": "No search needed.", "sources": []}

        collected_context = []
        all_sources = []
        
        for i in range(3):
            tools = [
                {"type": "function", "function": {"name": "web_search", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}}}},
                {"type": "function", "function": {"name": "graph_search", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}}}},
                {"type": "function", "function": {"name": "done"}}
            ]
            
            response = model_router.client.chat.completions.create(
                model=model_router.get_model_for_task(TASK_SEARCH),
                messages=[{"role": "system", "content": "You are a research agent. Use web_search (Exa) or graph_search."}, 
                          {"role": "user", "content": f"Researching: {query}\nContext: {collected_context}"}],
                tools=tools
            )

            msg = response.choices[0].message
            if not msg.tool_calls: break

            for tc in msg.tool_calls:
                args = json.loads(tc.function.arguments)
                if tc.function.name == "done": return await self._synthesize(query, all_sources)
                if tc.function.name == "web_search":
                    results = await search_exa(args["query"], num_results=5, use_contents=True)
                    all_sources.extend(results)
                    collected_context.append("\n".join([f"- {r['title']}: {r['content'][:500]}" for r in results[:3]]))
                if tc.function.name == "graph_search":
                    collected_context.append(await self._perform_graph_search(args["query"], active_graph_id))

        return await self._synthesize(query, all_sources)

    async def _perform_graph_search(self, query: str, graph_id: str) -> str:
        if not GRAPH_RETRIEVAL_AVAILABLE: return "Graph retrieval unavailable."
        try:
            from db_neo4j import driver
            with driver.session() as session:
                result = run_plan(session=session, query=query, intent="definition_overview", graph_id=graph_id)
                return f"Summary: {result.context.get('summary', '')}"
        except Exception: return "Graph search failed."

    async def _synthesize(self, query: str, sources: List[Dict]) -> Dict[str, Any]:
        unique = {s['url']: s for s in sources}.values()
        context = "\n".join([f"[{i+1}] {s['title']} ({s['url']}): {s['content'][:1000]}" for i, s in enumerate(list(unique)[:5])])
        answer = model_router.completion(task_type=TASK_SYNTHESIS, messages=[{"role": "user", "content": f"Query: {query}\nSources:\n{context}"}])
        return {"answer": answer, "sources": list(unique)[:10]}

class NewsAggregator:
    CATEGORIES = {"tech": "AI news", "science": "science breakthroughs", "culture": "cultural trends", "sports": "sports", "entertainment": "gaming news"}
    @staticmethod
    async def fetch_category_news(cat: str, limit: int = 10):
        return await search_exa(NewsAggregator.CATEGORIES.get(cat, cat), num_results=limit, time_range="day")
    @staticmethod
    async def get_discover_feed():
        cats = ["tech", "science", "entertainment", "culture"]
        results = await asyncio.gather(*[NewsAggregator.fetch_category_news(c, 4) for c in cats])
        return {c: r for c, r in zip(cats, results)}

async def deep_research(queries: List[str], breadth: int = 3, **kwargs) -> Dict[str, Any]:
    tasks = [search_and_fetch(q, num_results=breadth, **kwargs) for q in queries[:10]]
    results = await asyncio.gather(*tasks)
    report = "# Deep Research Report\n\n" + "\n".join([f"## {q}\n" + "\n".join([f"### {r['search_result']['title']}\n{r['fetched_content']['content'][:1000]}" for r in res['results']]) for q, res in zip(queries, results)])
    return {"query_results": results, "compiled_report": report}

async def crawl_site(start_url: str, max_pages: int = 20, **kwargs) -> Dict[str, Any]:
    """Simple crawl using Exa's similar/discovered contents if possible, or just sequential."""
    domain = urlparse(start_url).netloc
    # Exa doesn't have a 'crawl' endpoint but we can find similar links. 
    # For now, let's keep it very simple or just return the main page.
    main = await fetch_page_content(start_url)
    return {"crawl_summary": {"url": start_url, "pages": 1}, "pages": [main] if main else []}

async def get_youtube_transcript(video: str, **kwargs) -> Dict[str, Any]:
    """Fetch YouTube transcript if library available."""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        video_id = re.search(r'(?:v=|\/)([0-9A-Za-z_-]{11}).*', video).group(1) if "youtube.com" in video or "youtu.be" in video else video
        transcript = YouTubeTranscriptApi.get_transcript(video_id)
        content = "\n".join([t['text'] for t in transcript])
        return {"success": True, "transcript": content, "video_id": video_id}
    except Exception as e:
        return {"success": False, "error": str(e)}

async def translate_content(text: str, target: str = "en", **kwargs) -> Optional[str]:
    """Simple LLM-based translation."""
    try:
        return model_router.completion(task_type=TASK_SYNTHESIS, messages=[{"role": "user", "content": f"Translate to {target}: {text[:2000]}"}])
    except Exception: return None
