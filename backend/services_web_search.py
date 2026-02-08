"""
Brain Web Native Web Search Service

Provides web search and content extraction capabilities using Perplexica (replacing SearXNG).
Enhanced with advanced features: stealth mode, AI reranking, caching, metadata extraction.
This is adapted from open-source approaches but integrated natively into Brain Web.
"""
import httpx
import trafilatura
import json
from diskcache import Cache
import random
import asyncio
import io
from typing import List, Dict, Optional, Any
import logging
from urllib.parse import urlparse
import re
from datetime import datetime
from enum import Enum

# Import Graph Retrieval dependencies (Portions of api_retrieval logic)
try:
    from db_neo4j import get_neo4j_session
    from services_retrieval_plans import run_plan
    GRAPH_RETRIEVAL_AVAILABLE = True
except ImportError:
    GRAPH_RETRIEVAL_AVAILABLE = False

# AI libraries for native agents
try:
    from openai import OpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False

try:
    from dateutil import parser as date_parser
    DATEUTIL_AVAILABLE = True
except ImportError:
    DATEUTIL_AVAILABLE = False

# Optional advanced features
try:
    from flashrank import Ranker, RerankRequest
    FLASHRANK_AVAILABLE = True
except ImportError:
    FLASHRANK_AVAILABLE = False

try:
    from curl_cffi.requests import AsyncSession
    CURL_CFFI_AVAILABLE = True
except ImportError:
    CURL_CFFI_AVAILABLE = False

try:
    from playwright.async_api import async_playwright, Browser, Page
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False

try:
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options as ChromeOptions
    from selenium.webdriver.chrome.service import Service as ChromeService
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    SELENIUM_AVAILABLE = True
except ImportError:
    SELENIUM_AVAILABLE = False


logger = logging.getLogger("brain_web")

# Initialize cache (DiskCache for persistent caching)
cache = Cache("/tmp/brainweb_websearch_cache")

# Global Ranker (lazy loaded)
_ranker = None

# Rate limiting: track requests per domain
_domain_rate_limits: Dict[str, List[float]] = {}
_rate_limit_lock = asyncio.Lock()

# Retry configuration
MAX_RETRIES = 3
INITIAL_RETRY_DELAY = 1.0  # seconds
MAX_RETRY_DELAY = 10.0  # seconds

async def search_web(
    query: str,
    engines: Optional[str] = None,
    language: str = "en",
    time_range: Optional[str] = None,
    rerank: bool = False,
    context: str = None,
) -> List[Dict[str, Any]]:
    """
    Search the web using DuckDuckGo (via duckduckgo_search) with optional AI semantic reranking.
    Replaces the previous Perplexica integration.
    """
    # Check cache
    cache_key = f"search:ddg:{query}:{engines}:{language}:{time_range}:{rerank}"
    cached = cache.get(cache_key)
    if cached:
        logger.info(f"Cache hit for query: {query}")
        return cached
    
    try:
        from duckduckgo_search import DDGS
        
        # Map time_range to DDG format
        # DDG supports: d (day), w (week), m (month), y (year)
        timelimit = None
        if time_range:
            mapping = {"day": "d", "week": "w", "month": "m", "year": "y"}
            timelimit = mapping.get(time_range.lower(), time_range)

        # Region mapping (approximate)
        region = "wt-wt" # World-wide
        if language and language != "en":
            region = f"us-{language}" # Fallback
            
        results = []
        
        # Use sync DDGS in a thread or direct if async supported (AsyncDDGS is available in newer versions, checking...)
        # Safer to use synchronous DDGS text search for stability, it's fast enough.
        # Running in executor to avoid blocking main loop
        def _run_search():
            with DDGS() as ddgs:
                # limited to 10 results for speed/relevance
                return list(ddgs.text(keywords=query, region=region, timelimit=timelimit, max_results=10))
        
        ddg_results = await asyncio.to_thread(_run_search)
        
        for r in ddg_results:
            results.append({
                "title": r.get('title', ''),
                "url": r.get('href', ''),
                "content": r.get('body', ''),
                "engine": "duckduckgo",
                "score": 1.0,
            })

            # AI Semantic Reranking
        if rerank and results and FLASHRANK_AVAILABLE:
            try:
                ranker = get_ranker()
                if ranker:
                    from flashrank import RerankRequest
                    rerank_request = RerankRequest(
                        query=query,
                        passages=[
                            {"id": i, "text": f"{r['title']} {r['content'][:200]}", "meta": r}
                            for i, r in enumerate(results)
                        ]
                    )
                    ranked = ranker.rerank(rerank_request)
                    results = [r["meta"] for r in ranked]
            except Exception as e:
                logger.warning(f"Reranking failed: {e}")
            
        cache.set(cache_key, results, expire=3600)
        return results
            
    except ImportError:
        logger.error("duckduckgo-search not installed. Please install: pip install duckduckgo-search")
        return []
    except Exception as e:
        logger.exception(f"Web search failed: {e}")
        return []

class SearchFocus(str, Enum):
    GENERAL = "general"
    ACADEMIC = "academic"
    YOUTUBE = "youtube"
    WOLFRAM_ALPHA = "wolfram_alpha"
    REDDIT = "reddit"
    GITHUB = "github"

class QueryClassifier:
    """Port of Perplexica Classifier logic to Python."""
    
    @staticmethod
    async def classify(query: str, chat_history: List[Dict[str, str]] = None) -> Dict[str, Any]:
        """Classify query for focus area and search requirements."""
        if not OPENAI_AVAILABLE:
            return {"focus": SearchFocus.GENERAL, "skip_search": False, "standalone_query": query}
            
        from config import OPENAI_API_KEY
        client = OpenAI(api_key=OPENAI_API_KEY)
        
        prompt = f"""Analyze the user's query and classify it.
QUERY: {query}
HISTORY: {json.dumps(chat_history[-2:]) if chat_history else "[]"}

Return JSON ONLY:
{{
  "focus": "general|academic|youtube|wolfram_alpha|reddit|github",
  "skip_search": boolean,
  "standalone_query": "rephrased query for search engines",
  "reasoning": "brief explanation"
}}

Rules:
- General: Any typical search
- Academic: Scientific papers, research, formal knowledge
- YouTube: Video-specific info, tutorials, visual demos
- Reddit/GitHub: Discussion or code specific
- skip_search: True if it's purely conversational or greeting
"""

        try:
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "system", "content": "You are a research classifier. Return only valid JSON."},
                          {"role": "user", "content": prompt}],
                response_format={ "type": "json_object" }
            )
            result = json.loads(response.choices[0].message.content)
            return result
        except Exception as e:
            logger.warning(f"Classification failed: {e}")
            return {"focus": SearchFocus.GENERAL, "skip_search": False, "standalone_query": query}

class ResearcherAgent:
    """
    Python-native implementation of Perplexica's Researcher.
    Uses iterative tool-calling to gather info from Web and Knowledge Graph.
    """
    def __init__(self, api_key: str = None):
        from config import OPENAI_API_KEY
        self.api_key = api_key or OPENAI_API_KEY
        self.client = OpenAI(api_key=self.api_key) if OPENAI_AVAILABLE else None

    async def execute(self, query: str, active_graph_id: str = "default", history: List[Dict] = None) -> Dict[str, Any]:
        """Main Research Loop (Iterative ReAct)."""
        if not self.client:
            return {"answer": "Agent system unavailable.", "sources": []}

        # 1. Classify
        classification = await QueryClassifier.classify(query, history)
        if classification.get("skip_search"):
            return {"answer": "I don't need to search to answer this.", "sources": []}

        # 2. Iterative Research Loop
        max_iterations = 3
        collected_context = []
        all_sources = []
        
        for i in range(max_iterations):
            # Decide next step
            prompt = self._build_research_prompt(query, classification, collected_context, i, max_iterations)
            
            tools = [
                {
                    "type": "function",
                    "function": {
                        "name": "web_search",
                        "description": "Search the web for real-time information.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "query": {"type": "string", "description": "The search query"},
                                "focus": {"type": "string", "enum": ["general", "academic", "youtube", "reddit"], "default": "general"}
                            },
                            "required": ["query"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "graph_search",
                        "description": "Search the personal knowledge graph for existing concepts and connections.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "query": {"type": "string", "description": "The query to search in the graph"}
                            },
                            "required": ["query"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "done",
                        "description": "Call this when you have enough information to answer the user's request."
                    }
                }
            ]

            response = self.client.chat.completions.create(
                model="gpt-4o",
                messages=[{"role": "system", "content": "You are a deep-research agent. Use tools to gather facts."},
                          {"role": "user", "content": prompt}],
                tools=tools,
                tool_choice="auto"
            )

            msg = response.choices[0].message
            if not msg.tool_calls:
                break

            for tool_call in msg.tool_calls:
                tool_name = tool_call.function.name
                args = json.loads(tool_call.function.arguments)

                if tool_name == "done":
                    return await self._synthesize(query, all_sources, active_graph_id)

                elif tool_name == "web_search":
                    results = await search_web(args["query"], engines=args.get("focus", "web"))
                    all_sources.extend(results)
                    # Add snippet to context
                    context_snippet = f"WEB SEARCH RESULTS FOR '{args['query']}':\n" + \
                                     "\n".join([f"- {r['title']}: {r['content'][:300]}" for r in results[:3]])
                    collected_context.append(context_snippet)

                elif tool_name == "graph_search":
                    graph_results = await self._perform_graph_search(args["query"], active_graph_id)
                    context_snippet = f"KNOWLEDGE GRAPH RESULTS FOR '{args['query']}':\n{graph_results}"
                    collected_context.append(context_snippet)

        # Final synthesis if loop finishes without 'done'
        return await self._synthesize(query, all_sources, active_graph_id)

    async def _perform_graph_search(self, query: str, graph_id: str) -> str:
        """Helper to run a graph retrieval plan."""
        if not GRAPH_RETRIEVAL_AVAILABLE:
            return "Graph retrieval not available."
            
        try:
            # Note: We need a way to get a session here. 
            # In a real async environment, we'd use a dependency or manager.
            # For now, we'll try to get a temporary session if possible.
            from db_neo4j import driver
            with driver.session() as session:
                result = run_plan(
                    session=session,
                    query=query,
                    intent="definition_overview", # Default for agent search
                    graph_id=graph_id,
                    branch_id="main", # Default branch for now
                    limit=5,
                    detail_level="summary"
                )
                summary = result.context.get("summary", "")
                entities = ", ".join([e["name"] for e in result.context.get("focus_entities", [])])
                return f"Summary: {summary}\nEntities: {entities}"
        except Exception as e:
            logger.error(f"Graph search tool failed: {e}")
            return f"Error searching graph: {e}"

    def _build_research_prompt(self, query: str, classification: Dict, context: List[str], iteration: int, max_iter: int) -> str:
        context_str = "\n\n".join(context) if context else "No information gathered yet."
        return f"""Conduct deep research for: {query}
Focus Area: {classification['focus']}
Iteration: {iteration + 1}/{max_iter}

GATHERED CONTEXT:
{context_str}

Decide your next action. Use web_search for fresh facts, or graph_search to check personal knowledge.
If you have sufficient information, call done."""

    async def _synthesize(self, query: str, sources: List[Dict], graph_id: str) -> Dict[str, Any]:
        """Final synthesis step."""
        # Deduplicate sources by URL
        unique_sources = []
        seen_urls = set()
        for s in sources:
            if s['url'] not in seen_urls:
                unique_sources.append(s)
                seen_urls.add(s['url'])

        context = "\n".join([f"[{i+1}] {s['title']} ({s['url']}): {s['content'][:1000]}" 
                             for i, s in enumerate(unique_sources[:8])])
        
        prompt = f"""Answer the query based on the sources provided. Include citations as [1], [2], etc.
QUERY: {query}
SOURCES:
{context}

Return a detailed, informative response that connects web facts with your internal knowledge."""

        try:
            response = self.client.chat.completions.create(
                model="gpt-4o",
                messages=[{"role": "system", "content": "You are a helpful research assistant."},
                          {"role": "user", "content": prompt}]
            )
            return {
                "answer": response.choices[0].message.content,
                "sources": unique_sources[:15]
            }
        except Exception as e:
            logger.error(f"Synthesis failed: {e}")
            return {"answer": "Error generating response.", "sources": unique_sources[:15]}


class NewsAggregator:
    """Service to fetch and categorize news for the Discover pillar."""
    
    CATEGORIES = {
        "tech": ["latest artificial intelligence news", "semiconductor industry updates", "new consumer electronics 2026", "software engineering trends"],
        "science": ["recent space exploration discoveries", "biotechnology breakthroughs", "climate change research updates", "physics new discoveries"],
        "finance": ["stock market daily summary", "global economy news", "cryptocurrency market updates", "venture capital trends 2026"],
        "culture": ["contemporary art exhibitions 2026", "new literature releases", "cultural trends global", "philosophy today"],
        "sports": ["major league sports results", "olympic preparations news", "global soccer updates", "extreme sports trends"],
        "entertainment": ["new movie releases 2026", "music industry latest", "streaming service trends", "gaming industry news"]
    }

    @staticmethod
    async def fetch_category_news(category: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Fetch fresh news for a specific category."""
        queries = NewsAggregator.CATEGORIES.get(category.lower(), NewsAggregator.CATEGORIES["tech"])
        selected_query = random.choice(queries)
        
        # Use Perplexica search with time_range='day' for freshness
        results = await search_web(
            query=selected_query,
            time_range="day",
            rerank=True
        )
        
        if not results:
            # Fallback to 'week' if nothing found for 'day'
            results = await search_web(
                query=selected_query,
                time_range="week",
                rerank=True
            )
            
        return results[:limit]

    @staticmethod
    async def get_discover_feed() -> Dict[str, List[Dict[str, Any]]]:
        """Fetch top news across all categories for the main feed."""
        categories_to_fetch = ["tech", "finance", "science", "entertainment"]
        tasks = [NewsAggregator.fetch_category_news(cat, limit=4) for cat in categories_to_fetch]
        results = await asyncio.gather(*tasks)
        
        return {
            cat: res for cat, res in zip(categories_to_fetch, results)
        }


async def _check_rate_limit(domain: str, max_requests: int = 10, window_seconds: int = 60) -> bool:
    """
    Check if domain is within rate limit.
    
    Args:
        domain: Domain to check
        max_requests: Maximum requests per window
        window_seconds: Time window in seconds
        
    Returns:
        True if within limit, False if rate limited
    """
    async with _rate_limit_lock:
        now = asyncio.get_event_loop().time()
        
        # Clean old entries
        if domain in _domain_rate_limits:
            _domain_rate_limits[domain] = [
                timestamp for timestamp in _domain_rate_limits[domain]
                if now - timestamp < window_seconds
            ]
        else:
            _domain_rate_limits[domain] = []
        
        # Check limit
        if len(_domain_rate_limits[domain]) >= max_requests:
            return False
        
        # Record this request
        _domain_rate_limits[domain].append(now)
        return True


async def _retry_with_backoff(
    func,
    max_retries: int = MAX_RETRIES,
    initial_delay: float = INITIAL_RETRY_DELAY,
    max_delay: float = MAX_RETRY_DELAY,
    exponential_base: float = 2.0,
    jitter: bool = True,
):
    """
    Retry a function with exponential backoff and jitter.
    
    Args:
        func: Async function to retry
        max_retries: Maximum number of retries
        initial_delay: Initial delay in seconds
        max_delay: Maximum delay in seconds
        exponential_base: Base for exponential backoff
        jitter: Add random jitter to prevent thundering herd
    """
    last_exception = None
    
    for attempt in range(max_retries + 1):
        try:
            return await func()
        except Exception as e:
            last_exception = e
            
            if attempt < max_retries:
                # Calculate delay with exponential backoff
                delay = min(initial_delay * (exponential_base ** attempt), max_delay)
                
                # Add jitter (random 0-25% of delay)
                if jitter:
                    jitter_amount = delay * random.uniform(0, 0.25)
                    delay += jitter_amount
                
                logger.warning(f"Retry attempt {attempt + 1}/{max_retries} after {delay:.2f}s: {e}")
                await asyncio.sleep(delay)
            else:
                logger.error(f"All {max_retries} retry attempts failed: {e}")
                raise last_exception
    
    raise last_exception


async def fetch_with_stealth(
    url: str,
    stealth_mode: str = "off",
    auto_bypass: bool = False,
) -> Dict[str, Any]:
    """
    Fetch URL with advanced stealth mode (anti-bot bypass).
    
    Includes rate limiting and retry logic with exponential backoff.
    
    Args:
        url: URL to fetch
        stealth_mode: "off", "low", "medium", "high"
        auto_bypass: Automatically escalate if blocked
        
    Returns:
        Dict with html, status_code, final_url, fetch_method
    """
    domain = urlparse(url).netloc
    
    # Check rate limit
    if not await _check_rate_limit(domain, max_requests=10, window_seconds=60):
        raise Exception(f"Rate limit exceeded for {domain}")
    
    # Wrap fetch in retry logic
    async def _fetch():
        return await _fetch_with_stealth_impl(url, stealth_mode, auto_bypass)
    
    return await _retry_with_backoff(_fetch)


async def _fetch_with_stealth_impl(
    url: str,
    stealth_mode: str = "off",
    auto_bypass: bool = False,
) -> Dict[str, Any]:
    """
    Internal implementation of stealth fetch.
    """
    # User-Agent rotation
    user_agents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    ]
    
    user_agent = random.choice(user_agents) if stealth_mode != "off" else user_agents[0]
    
    # High-level stealth with curl_cffi (TLS fingerprint matching)
    if stealth_mode == "high" and CURL_CFFI_AVAILABLE:
        try:
            async with AsyncSession() as session:
                response = await session.get(
                    url,
                    impersonate="chrome120",  # TLS fingerprint
                    headers={
                        "User-Agent": user_agent,
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        "Accept-Language": "en-US,en;q=0.9",
                        "Accept-Encoding": "gzip, deflate, br",
                        "sec-ch-ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                        "sec-ch-ua-mobile": "?0",
                        "sec-ch-ua-platform": '"Windows"',
                        "Sec-Fetch-Dest": "document",
                        "Sec-Fetch-Mode": "navigate",
                        "Sec-Fetch-Site": "none",
                        "Sec-Fetch-User": "?1",
                    },
                    timeout=30.0
                )
                return {
                    "html": response.text,
                    "status_code": response.status_code,
                    "final_url": str(response.url),
                    "fetch_method": "stealth_high",
                }
        except Exception as e:
            logger.warning(f"High stealth failed, falling back: {e}")
            # Fall through to medium stealth
    
    # Medium stealth: UA + randomized headers
    if stealth_mode in ["medium", "high"]:
        headers = {
            "User-Agent": user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": random.choice(["en-US,en;q=0.9", "en-GB,en;q=0.9", "en-US,en;q=0.9,es;q=0.8"]),
            "Accept-Encoding": "gzip, deflate, br",
            "DNT": "1",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
        }
        # Randomize header order
        headers = dict(random.sample(list(headers.items()), len(headers)))
    else:
        # Low stealth or off: just UA rotation
        headers = {
            "User-Agent": user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
        }
    
    try:
        async with httpx.AsyncClient(
            timeout=30.0,
            follow_redirects=True,
            headers=headers,
            http2=True  # Enable HTTP/2 for better stealth
        ) as client:
            response = await client.get(url)
            response.raise_for_status()
            
            return {
                "html": response.text,
                "status_code": response.status_code,
                "final_url": str(response.url),
                "fetch_method": f"stealth_{stealth_mode}" if stealth_mode != "off" else "standard",
            }
    except Exception as e:
        logger.warning(f"Failed to fetch {url}: {e}")
        raise


async def fetch_pdf_content(url: str, max_length: int = 50000) -> Optional[Dict[str, Any]]:
    """
    Fetch and extract text from a PDF URL.
    
    Uses the same PDF extraction library as local PDF ingestion for consistency.
    This ensures web PDFs and local PDFs are processed identically.
    
    Args:
        url: URL to PDF file
        max_length: Maximum content length
        
    Returns:
        Dict with title, content, metadata, url, or None if fails
    """
    try:
        # Fetch PDF bytes
        fetch_result = await fetch_with_stealth(url, stealth_mode="off", auto_bypass=False)
        pdf_bytes = fetch_result.get("html", "").encode() if isinstance(fetch_result.get("html"), str) else None
        
        if not pdf_bytes:
            # Try fetching as binary
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                response = await client.get(url)
                response.raise_for_status()
                pdf_bytes = response.content
        
        if not pdf_bytes or len(pdf_bytes) < 100:  # PDFs should be at least 100 bytes
            logger.warning(f"Failed to fetch PDF from {url}")
            return None
        
        # Use the same PDF extraction service as local ingestion
        from services_pdf_enhanced import extract_pdf_enhanced
        
        pdf_result = extract_pdf_enhanced(
            pdf_bytes=pdf_bytes,
            use_ocr=False,  # OCR is slow, skip for web search
            extract_tables=True,  # Extract tables for better context
        )
        
        if not pdf_result or not pdf_result.full_text:
            logger.warning(f"PDF extraction failed for {url}")
            return None
        
        # Extract metadata
        metadata = {
            "title": pdf_result.metadata.title or "",
            "author": pdf_result.metadata.author or "",
            "page_count": pdf_result.metadata.page_count,
            "extraction_method": pdf_result.extraction_method,
        }
        
        # Truncate content if needed
        content = pdf_result.full_text
        if len(content) > max_length:
            content = content[:max_length] + "..."
        
        return {
            "title": metadata.get("title", ""),
            "content": content,
            "metadata": metadata,
            "url": url,
            "format": "text",
            "is_pdf": True,
        }
        
    except Exception as e:
        logger.warning(f"Failed to fetch PDF from {url}: {e}")
        return None


async def fetch_page_content(
    url: str,
    max_length: int = 10000,
    format: str = "text",
    stealth_mode: str = "medium",
    auto_bypass: bool = False,
    render_js: bool = False,
) -> Optional[Dict[str, Any]]:
    """
    Fetch and extract clean content from a webpage with enhanced metadata.
    
    Uses Trafilatura for high-quality extraction (Firecrawl-quality).
    Automatically detects and extracts PDFs using the same library as local PDF ingestion.
    
    Args:
        url: URL to fetch
        max_length: Maximum content length to return
        format: Output format ("text", "markdown", "html")
        stealth_mode: Anti-bot bypass level ("off", "low", "medium", "high")
        auto_bypass: Auto-escalate if blocked
        render_js: Enable JavaScript rendering (Playwright/Selenium)
        
    Returns:
        Dict with title, content, metadata, url, or None if fetch fails
    """
    try:
        # Check if URL is a PDF
        if url.lower().endswith('.pdf'):
            return await fetch_pdf_content(url, max_length)
        
        html_content = ""
        final_url = url
        user_agents = [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        ]
        
        headers = {
            "User-Agent": random.choice(user_agents) if stealth_mode != "off" else user_agents[0],
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
        }
        
        # Use fetch_with_stealth for rate limiting and retries
        fetch_result = await fetch_with_stealth(url, stealth_mode, auto_bypass)
        html_content = fetch_result["html"]
        final_url = fetch_result["final_url"]
        
        # Check if response is actually a PDF
        if isinstance(html_content, bytes):
            if html_content.startswith(b'%PDF'):
                return await fetch_pdf_content(url, max_length)
            html_content = html_content.decode('utf-8', errors='ignore')
        elif isinstance(html_content, str) and html_content.startswith('%PDF'):
            return await fetch_pdf_content(url, max_length)
        
        # Detect and fetch pagination if content seems incomplete
        pagination_content = ""
        if html_content and isinstance(html_content, str):
            # Check if page mentions pagination
            if "next page" in html_content.lower() or "continue reading" in html_content.lower():
                pagination_urls = await _detect_pagination(url, html_content)
                if pagination_urls:
                    # Fetch first pagination page
                    try:
                        next_page = await fetch_page_content(
                            url=pagination_urls[0],
                            max_length=max_length // 2,  # Half length for pagination
                            format=format,
                            stealth_mode=stealth_mode,
                            render_js=render_js,
                        )
                        if next_page:
                            pagination_content = next_page.get("content", "")
                    except Exception as e:
                        logger.warning(f"Failed to fetch pagination: {e}")
            
        # Extract images for OCR (if enabled in future)
        # For now, we extract image URLs but don't process them
        soup_for_images = BeautifulSoup(html_content, 'html.parser')
        image_urls = []
        for img in soup_for_images.find_all('img', src=True):
            img_url = img.get('src', '')
            if img_url:
                # Resolve relative URLs
                if img_url.startswith('//'):
                    img_url = 'https:' + img_url
                elif img_url.startswith('/'):
                    from urllib.parse import urljoin
                    img_url = urljoin(final_url, img_url)
                image_urls.append(img_url)
        
        # Use Trafilatura with metadata extraction
        if format == "markdown":
            extracted = trafilatura.extract(
                html_content,
                include_comments=False,
                include_tables=True,
                include_images=False,
                include_links=False,
                output_format='markdown',
                url=final_url,
                with_metadata=True
            )
        elif format == "html":
            extracted = trafilatura.extract(
                html_content,
                include_comments=False,
                include_tables=True,
                include_images=False,
                include_links=False,
                output_format='xml',
                url=final_url,
                with_metadata=True
            )
        else:  # text or json
            extracted = trafilatura.extract(
                html_content,
                include_comments=False,
                include_tables=True,
                include_images=False,
                include_links=False,
                output_format='json',
                url=final_url,
                with_metadata=True
            )
        
        metadata = {}
        content = ""
        
        if extracted:
            if format == "json" or (format == "text" and extracted.startswith("{")):
                data = json.loads(extracted)
                metadata = {
                    "title": data.get("title") or "",
                    "author": data.get("author") or "",
                    "sitename": data.get("sitename") or "",
                    "date": data.get("date") or "",
                    "description": data.get("description") or "",
                    "language": data.get("language") or "",
                }
                content = data.get("text") or ""
            else:
                # Markdown or HTML format
                content = extracted
                # Extract basic metadata
                soup = BeautifulSoup(html_content, 'html.parser')
                if soup.title:
                    metadata["title"] = soup.title.string
        else:
            # Fallback to BeautifulSoup
            soup = BeautifulSoup(html_content, 'html.parser')
            for script in soup(["script", "style"]):
                script.decompose()
            content = soup.get_text(separator=' ', strip=True)
            if soup.title:
                metadata["title"] = soup.title.string
        
        # Extract structured data (JSON-LD, microdata, schema.org)
        structured_data = _extract_structured_data(html_content)
        if structured_data:
            metadata["structured_data"] = structured_data
        
        # Validate content and check credibility
        validation = _validate_content_claims(content, final_url, metadata)
        metadata["validation"] = validation
        
        # Store image URLs for potential OCR processing
        if image_urls:
            metadata["image_urls"] = image_urls[:10]  # Limit to first 10 images
            
            # Optional: Extract text from images using OCR
            # This is disabled by default as it's slow, but can be enabled
            if False:  # Set to True to enable image OCR
                image_texts = []
                for img_url in image_urls[:3]:  # Limit to first 3 images
                    try:
                        img_text = await _extract_image_text(img_url)
                        if img_text:
                            image_texts.append({"url": img_url, "text": img_text})
                    except Exception as e:
                        logger.warning(f"Image OCR failed for {img_url}: {e}")
                
                if image_texts:
                    metadata["image_texts"] = image_texts
        
        # Clean empty metadata
        metadata = {k: v for k, v in metadata.items() if v}
        
        # Append pagination content if available
        if pagination_content:
            content = content + "\n\n--- Continued from next page ---\n\n" + pagination_content
            metadata["has_pagination"] = True
        
        # Discover and fetch related content
        related_content = await _discover_related_content(html_content, final_url, max_length // 2)
        if related_content:
            content = content + "\n\n--- Related Content ---\n\n" + related_content
            metadata["has_related_content"] = True
        
        # Summarize long content before truncation (if content is very long)
        original_content = content
        if len(content) > max_length * 2:  # If content is 2x max_length, summarize it
            summary = _summarize_content(content, max_length)
            if summary:
                content = summary
                metadata["was_summarized"] = True
                metadata["original_length"] = len(original_content)
        
        # Truncate if needed
        if len(content) > max_length:
            content = content[:max_length] + "..."
            
        return {
            "title": metadata.get("title", ""),
            "content": content,
            "metadata": metadata,
            "url": final_url,
            "format": format,
        }
            
    except Exception as e:
        logger.warning(f"Failed to fetch content from {url}: {e}")
        return None


async def search_and_fetch(
    query: str,
    num_results: int = 3,
    engines: Optional[str] = None,
    language: str = "en",
    time_range: Optional[str] = None,
    max_content_length: int = 10000,
    format: str = "text",
    rerank: bool = False,
    stealth_mode: str = "medium",
    render_js: bool = False,
    translate_to: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Search the web and automatically fetch full content from top results.
    
    Enhanced with AI reranking, stealth mode, and metadata extraction.
    This is the main function used by Brain Web for getting current information.
    
    Args:
        query: Search query
        num_results: Number of results to fetch content from (1-5)
        engines: Comma-separated list of engines
        language: Language code
        time_range: Time filter
        max_content_length: Maximum content length per page
        format: Output format ("text", "markdown", "html")
        rerank: Enable AI semantic reranking for better relevance
        stealth_mode: Anti-bot bypass level
        
    Returns:
        Dict with query, results (with fetched_content and metadata), and stats
    """
    # Step 1: Search with optional reranking
    search_results = await search_web(
        query=query,
        engines=engines,
        language=language,
        time_range=time_range,
        rerank=rerank,
    )
    
    if not search_results:
        return {
            "query": query,
            "results": [],
            "num_results_found": 0,
            "num_results_fetched": 0,
        }
    
    # Step 2: Fetch content from top N results in parallel
    async def fetch_one(result: Dict[str, Any]) -> Dict[str, Any]:
        url = result.get("url", "")
        if not url:
            return {
                "search_result": result,
                "fetch_status": "error",
            }
        
        fetched = await fetch_page_content(
            url=url,
            max_length=max_content_length,
            format=format,
            stealth_mode=stealth_mode,
            render_js=render_js,
        )
        
        if fetched and fetched.get("content") and len(fetched.get("content", "").strip()) > 0:
            # Calculate content quality score
            quality_score = _calculate_content_quality(fetched)
            
            # Translate content if requested
            content = fetched.get("content", "")
            original_language = fetched.get("metadata", {}).get("language", "auto")
            if translate_to and translate_to != original_language and content:
                translated = await translate_content(content, target_language=translate_to, source_language=original_language)
                if translated:
                    content = translated
                    fetched["metadata"]["translated_to"] = translate_to
                    fetched["metadata"]["original_language"] = original_language
            
            return {
                "search_result": {
                    "title": result.get("title", ""),
                    "url": url,
                    "snippet": result.get("snippet", ""),
                    "graph": result.get("graph"),
                },
                "fetched_content": {
                    "title": fetched.get("title", ""),
                    "content": content,
                    "metadata": fetched.get("metadata", {}),
                    "quality_score": quality_score,
                },
                "fetch_status": "success",
            }
        else:
            return {
                "search_result": {
                    "title": result.get("title", ""),
                    "url": url,
                    "snippet": result.get("snippet", ""),
                    "graph": result.get("graph"),
                },
                "fetch_status": "failed",
            }
    
    # Fetch all in parallel for speed
    fetch_tasks = [fetch_one(result) for result in search_results[:num_results]]
    results_with_content = await asyncio.gather(*fetch_tasks)
    
    # Deduplicate results based on content similarity
    results_with_content = _deduplicate_results(results_with_content)
    
    # Sort by combined score (quality + credibility)
    def get_combined_score(result):
        fetched = result.get("fetched_content", {})
        quality = fetched.get("quality_score", {}).get("overall", 0)
        credibility = fetched.get("credibility_score", 50)
        # Weight: 60% quality, 40% credibility
        return (quality * 0.6) + (credibility * 0.4)
    
    results_with_content.sort(key=get_combined_score, reverse=True)
    
    successful_fetches = sum(1 for r in results_with_content if r.get("fetch_status") == "success")
    
    return {
        "query": query,
        "results": results_with_content,
        "num_results_found": len(search_results),
        "num_results_fetched": successful_fetches,
        "successful_fetches": successful_fetches,
        "failed_fetches": num_results - successful_fetches,
    }


async def deep_research(
    queries: List[str],
    breadth: int = 3,
    time_range: Optional[str] = None,
    max_content_length: int = 30000,
    stealth_mode: str = "off",
) -> Dict[str, Any]:
    """
    Perform comprehensive research across multiple queries in parallel.
    
    Args:
        queries: List of research queries (max 10)
        breadth: Results per query (1-5)
        time_range: Time filter
        max_content_length: Max content per result
        stealth_mode: Anti-bot bypass level
        
    Returns:
        Dict with research summary and compiled report
    """
    if len(queries) > 10:
        queries = queries[:10]
    
    # Process all queries in parallel
    async def research_one(query: str) -> Dict[str, Any]:
        result = await search_and_fetch(
            query=query,
            num_results=breadth,
            time_range=time_range,
            max_content_length=max_content_length,
            format="markdown",
            stealth_mode=stealth_mode,
        )
        return {
            "query": query,
            "results": result.get("results", []),
            "num_found": result.get("num_results_found", 0),
            "num_fetched": result.get("num_results_fetched", 0),
        }
    
    query_results = await asyncio.gather(*[research_one(q) for q in queries])
    
    # Compile report
    compiled_report = "# Deep Research Report\n\n"
    for qr in query_results:
        compiled_report += f"## {qr['query']}\n\n"
        for i, result in enumerate(qr.get("results", []), 1):
            if result.get("fetch_status") == "success":
                content = result.get("fetched_content", {}).get("content", "")
                compiled_report += f"### {i}. {result.get('search_result', {}).get('title', '')}\n\n"
                compiled_report += f"{content[:2000]}...\n\n"
                compiled_report += f"Source: {result.get('search_result', {}).get('url', '')}\n\n"
    
    return {
        "research_summary": {
            "total_queries": len(queries),
            "successful_queries": len([qr for qr in query_results if qr.get("num_fetched", 0) > 0]),
            "total_results_found": sum(qr.get("num_found", 0) for qr in query_results),
            "total_successful_fetches": sum(qr.get("num_fetched", 0) for qr in query_results),
        },
        "queries": queries,
        "query_results": query_results,
        "compiled_report": compiled_report,
    }


async def translate_content(
    text: str,
    target_language: str = "en",
    source_language: Optional[str] = None,
) -> Optional[str]:
    """
    Translate content to target language.
    
    Uses free translation APIs (Google Translate, etc.) or LLM as fallback.
    
    Args:
        text: Text to translate
        target_language: Target language code (e.g., "en", "es", "fr")
        source_language: Source language code (auto-detect if None)
        
    Returns:
        Translated text or None if translation fails
    """
    try:
        # Try googletrans (free, no API key needed)
        try:
            from googletrans import Translator
            translator = Translator()
            result = translator.translate(text, dest=target_language, src=source_language)
            return result.text if result else None
        except ImportError:
            # Fallback to LLM translation
            try:
                from config import OPENAI_API_KEY
                from openai import OpenAI
                
                if not OPENAI_API_KEY:
                    return None
                
                client = OpenAI(api_key=OPENAI_API_KEY)
                
                language_names = {
                    "en": "English", "es": "Spanish", "fr": "French", "de": "German",
                    "it": "Italian", "pt": "Portuguese", "ru": "Russian", "ja": "Japanese",
                    "zh": "Chinese", "ko": "Korean", "ar": "Arabic", "hi": "Hindi",
                }
                target_lang_name = language_names.get(target_language, target_language)
                
                response = client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {"role": "system", "content": f"You are a professional translator. Translate the following text to {target_lang_name}. Preserve the original meaning and tone."},
                        {"role": "user", "content": text[:5000]}  # Limit input length
                    ],
                    temperature=0.3,
                    max_tokens=2000,
                )
                
                return response.choices[0].message.content.strip()
                
            except Exception as e:
                logger.warning(f"LLM translation failed: {e}")
                return None
                
    except Exception as e:
        logger.warning(f"Translation failed: {e}")
        return None


async def get_youtube_transcript(
    video: str,
    format: str = "text",
    lang: Optional[str] = None,
    translate: Optional[str] = None,
    start: Optional[int] = None,
    end: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Fetch YouTube video transcript.
    
    Args:
        video: YouTube URL or video ID
        format: Output format ("text", "json", "srt")
        lang: Preferred language code
        translate: Translate to target language
        start: Start time in seconds
        end: End time in seconds
        
    Returns:
        Dict with transcript and metadata
    """
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        import re
        
        # Extract video ID from URL
        video_id = video
        if "youtube.com" in video or "youtu.be" in video:
            match = re.search(r'(?:v=|\/)([0-9A-Za-z_-]{11}).*', video)
            if match:
                video_id = match.group(1)
        
        # Get transcript
        transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
        
        # Try to get transcript in preferred language
        transcript = None
        if lang:
            try:
                transcript = transcript_list.find_transcript([lang])
            except:
                transcript = transcript_list.find_generated_transcript([lang])
        else:
            transcript = transcript_list.find_generated_transcript(['en'])
        
        # Translate if requested
        if translate and transcript:
            transcript = transcript.translate(translate)
        
        # Get transcript data
        transcript_data = transcript.fetch()
        
        # Apply time range if specified
        if start or end:
            transcript_data = [
                item for item in transcript_data
                if (start is None or item['start'] >= start) and
                   (end is None or item['start'] + item['duration'] <= end)
            ]
        
        # Format output
        if format == "json":
            content = transcript_data
        elif format == "srt":
            # Convert to SRT format
            srt_lines = []
            for i, item in enumerate(transcript_data, 1):
                start_time = _format_timestamp(item['start'])
                end_time = _format_timestamp(item['start'] + item['duration'])
                srt_lines.append(f"{i}\n{start_time} --> {end_time}\n{item['text']}\n")
            content = "\n".join(srt_lines)
        else:  # text
            content = "\n".join([item['text'] for item in transcript_data])
        
        return {
            "success": True,
            "video_id": video_id,
            "video_url": f"https://www.youtube.com/watch?v={video_id}",
            "format": format,
            "language": lang or "auto",
            "translated_to": translate,
            "time_range": {"start": start, "end": end} if start or end else None,
            "stats": {
                "segment_count": len(transcript_data),
                "word_count": len(content.split()),
                "duration_seconds": sum(item['duration'] for item in transcript_data),
            },
            "transcript": content,
        }
        
    except ImportError:
        return {
            "success": False,
            "error": "YouTube transcript API not available. Install: pip install youtube-transcript-api",
        }
    except Exception as e:
        logger.error(f"YouTube transcript extraction failed: {e}")
        return {
            "success": False,
            "error": str(e),
        }


def _calculate_content_quality(fetched_content: Dict[str, Any]) -> Dict[str, Any]:
    """
    Calculate content quality score based on multiple factors.
    
    Returns:
        Dict with quality metrics and overall score (0-100)
    """
    try:
        content = fetched_content.get("content", "")
        metadata = fetched_content.get("metadata", {})
        url = fetched_content.get("url", "")
        
        scores = {}
        
        # 1. Content length score (longer is generally better, up to a point)
        content_length = len(content)
        if content_length < 100:
            length_score = 20  # Too short
        elif content_length < 500:
            length_score = 50
        elif content_length < 2000:
            length_score = 80
        elif content_length < 10000:
            length_score = 90
        else:
            length_score = 85  # Very long might be less focused
        scores["length"] = length_score
        
        # 2. Metadata completeness
        metadata_fields = ["title", "author", "date", "description"]
        metadata_count = sum(1 for field in metadata_fields if metadata.get(field))
        metadata_score = (metadata_count / len(metadata_fields)) * 100
        scores["metadata"] = metadata_score
        
        # 3. Readability (simple heuristic: sentence length, word count)
        sentences = content.split('.')
        words = content.split()
        if sentences and words:
            avg_sentence_length = len(words) / len(sentences) if sentences else 0
            # Good readability: 15-20 words per sentence
            if 10 <= avg_sentence_length <= 25:
                readability_score = 90
            elif 5 <= avg_sentence_length < 10 or 25 < avg_sentence_length <= 35:
                readability_score = 70
            else:
                readability_score = 50
        else:
            readability_score = 30
        scores["readability"] = readability_score
        
        # 4. Domain authority (simple heuristic based on URL)
        domain = urlparse(url).netloc.lower() if url else ""
        domain_score = 50  # Default
        if domain:
            # Known authoritative domains
            authoritative_domains = [
                'edu', 'gov', 'org', 'wikipedia.org', 'github.com',
                'stackoverflow.com', 'reddit.com', 'medium.com',
            ]
            if any(auth in domain for auth in authoritative_domains):
                domain_score = 85
            elif domain.endswith('.edu') or domain.endswith('.gov'):
                domain_score = 90
            elif 'blog' in domain or 'news' in domain:
                domain_score = 60
        scores["domain"] = domain_score
        
        # 5. Content structure (has paragraphs, headings)
        has_structure = bool(re.search(r'\n\n|\n#', content))
        structure_score = 80 if has_structure else 40
        scores["structure"] = structure_score
        
        # 6. Spam indicators (simple heuristics)
        spam_indicators = [
            len(re.findall(r'click here|buy now|limited time', content, re.I)) > 3,
            len(re.findall(r'http[s]?://', content)) > 10,  # Too many links
            content.count('!') > content.count('.') * 2,  # Too many exclamations
        ]
        spam_score = 100 - (sum(spam_indicators) * 20)
        spam_score = max(0, min(100, spam_score))
        scores["spam"] = spam_score
        
        # Calculate weighted overall score
        weights = {
            "length": 0.15,
            "metadata": 0.15,
            "readability": 0.20,
            "domain": 0.20,
            "structure": 0.15,
            "spam": 0.15,
        }
        
        overall_score = sum(scores[key] * weights[key] for key in weights)
        overall_score = round(overall_score, 1)
        
        return {
            "overall": overall_score,
            "breakdown": scores,
            "grade": "A" if overall_score >= 80 else "B" if overall_score >= 60 else "C" if overall_score >= 40 else "D",
        }
        
    except Exception as e:
        logger.warning(f"Failed to calculate content quality: {e}")
        return {"overall": 50, "breakdown": {}, "grade": "C"}


def _deduplicate_results(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Remove duplicate or near-duplicate results using content similarity.
    
    Uses simple hash-based deduplication for now.
    Can be enhanced with simhash for fuzzy matching.
    """
    try:
        seen_hashes = set()
        deduplicated = []
        
        for result in results:
            if result.get("fetch_status") != "success":
                deduplicated.append(result)
                continue
            
            content = result.get("fetched_content", {}).get("content", "")
            if not content:
                deduplicated.append(result)
                continue
            
            # Create a simple hash from normalized content
            # Normalize: lowercase, remove extra whitespace, take first 500 chars
            normalized = re.sub(r'\s+', ' ', content.lower().strip()[:500])
            content_hash = hash(normalized)
            
            # Check for exact duplicates
            if content_hash in seen_hashes:
                continue
            
            # Check for near-duplicates (similar URLs or titles)
            url = result.get("search_result", {}).get("url", "")
            title = result.get("search_result", {}).get("title", "").lower()
            
            is_duplicate = False
            for seen_result in deduplicated:
                seen_url = seen_result.get("search_result", {}).get("url", "")
                seen_title = seen_result.get("search_result", {}).get("title", "").lower()
                
                # Same domain and similar title = likely duplicate
                if url and seen_url:
                    url_domain = urlparse(url).netloc
                    seen_domain = urlparse(seen_url).netloc
                    if url_domain == seen_domain and title and seen_title:
                        # Simple similarity check
                        words1 = set(title.split())
                        words2 = set(seen_title.split())
                        if len(words1) > 0 and len(words2) > 0:
                            similarity = len(words1 & words2) / len(words1 | words2)
                            if similarity > 0.7:  # 70% word overlap
                                is_duplicate = True
                                break
            
            if not is_duplicate:
                seen_hashes.add(content_hash)
                deduplicated.append(result)
        
        return deduplicated
        
    except Exception as e:
        logger.warning(f"Failed to deduplicate results: {e}")
        return results


def _summarize_content(content: str, target_length: int = 5000) -> Optional[str]:
    """
    Summarize long content using LLM to preserve key information.
    
    Args:
        content: Content to summarize
        target_length: Target length for summary
        
    Returns:
        Summarized content or None if summarization fails
    """
    try:
        from config import OPENAI_API_KEY
        from openai import OpenAI
        
        if not OPENAI_API_KEY:
            return None
        
        client = OpenAI(api_key=OPENAI_API_KEY)
        
        # Only summarize if content is significantly longer than target
        if len(content) < target_length * 1.5:
            return None
        
        # Create summary prompt
        prompt = f"""Summarize the following content, preserving all key facts, dates, numbers, and important details. 
Keep the summary concise but comprehensive. Target length: approximately {target_length} characters.

Content:
{content[:20000]}  # Limit input to avoid token limits

Summary:"""
        
        response = client.chat.completions.create(
            model="gpt-4o-mini",  # Use cheaper model for summarization
            messages=[
                {"role": "system", "content": "You are a helpful assistant that creates concise, factual summaries."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=min(target_length // 4, 2000),  # Rough estimate
            temperature=0.3,  # Lower temperature for more factual summaries
        )
        
        summary = response.choices[0].message.content.strip()
        return summary if summary else None
        
    except Exception as e:
        logger.warning(f"Content summarization failed: {e}")
        return None


async def _extract_image_text(image_url: str) -> Optional[str]:
    """
    Extract text from an image using OCR.
    
    Args:
        image_url: URL to image
        
    Returns:
        Extracted text or None if OCR fails
    """
    try:
        # Try pytesseract first (if available)
        try:
            import pytesseract
            from PIL import Image
            import io
            
            # Fetch image
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(image_url)
                response.raise_for_status()
                image_bytes = response.content
            
            # Open image
            image = Image.open(io.BytesIO(image_bytes))
            
            # Run OCR
            text = pytesseract.image_to_string(image)
            return text.strip() if text.strip() else None
            
        except ImportError:
            # Try EasyOCR as fallback
            try:
                import easyocr
                
                # Initialize reader (cache it globally if needed)
                reader = easyocr.Reader(['en'], gpu=False)
                
                # Fetch image
                async with httpx.AsyncClient(timeout=10.0) as client:
                    response = await client.get(image_url)
                    response.raise_for_status()
                    image_bytes = response.content
                
                # Run OCR
                results = reader.readtext(image_bytes)
                text = ' '.join([result[1] for result in results])
                return text.strip() if text.strip() else None
                
            except ImportError:
                logger.warning("No OCR library available (pytesseract or easyocr)")
                return None
                
    except Exception as e:
        logger.warning(f"Image OCR failed for {image_url}: {e}")
        return None


async def _discover_related_content(html_content: str, base_url: str, max_length: int = 5000) -> Optional[str]:
    """
    Discover and fetch related content from the same page or related articles.
    
    Looks for:
    - "Related articles" sections
    - "See also" links
    - "Read more" sections
    - Links in "related" or "similar" divs
    
    Args:
        html_content: HTML content of the page
        base_url: Base URL for resolving relative links
        max_length: Maximum length of related content to fetch
        
    Returns:
        Combined related content or None
    """
    try:
        soup = BeautifulSoup(html_content, 'html.parser')
        related_urls = []
        
        # Find related content sections
        related_selectors = [
            ('div', {'class': re.compile(r'related|similar|also.*read|read.*more', re.I)}),
            ('section', {'class': re.compile(r'related|similar', re.I)}),
            ('aside', {'class': re.compile(r'related|similar', re.I)}),
            ('nav', {'class': re.compile(r'related|similar', re.I)}),
        ]
        
        for tag, attrs in related_selectors:
            sections = soup.find_all(tag, attrs)
            for section in sections:
                links = section.find_all('a', href=True)
                for link in links[:5]:  # Limit to 5 per section
                    href = link.get('href', '')
                    if href:
                        from urllib.parse import urljoin
                        absolute_url = urljoin(base_url, href)
                        # Only add if same domain and not already in list
                        if urlparse(absolute_url).netloc == urlparse(base_url).netloc:
                            if absolute_url not in related_urls:
                                related_urls.append(absolute_url)
        
        # Also look for common "related article" patterns in links
        for link in soup.find_all('a', href=True, string=re.compile(r'related|similar|read more|see also', re.I)):
            href = link.get('href', '')
            if href:
                from urllib.parse import urljoin
                absolute_url = urljoin(base_url, href)
                if urlparse(absolute_url).netloc == urlparse(base_url).netloc:
                    if absolute_url not in related_urls:
                        related_urls.append(absolute_url)
        
        # Fetch related content (limit to 3 to avoid too much overhead)
        related_contents = []
        for related_url in related_urls[:3]:
            try:
                related_fetched = await fetch_page_content(
                    url=related_url,
                    max_length=max_length,
                    format="text",
                    stealth_mode="off",  # Use standard mode for related content
                    render_js=False,
                )
                if related_fetched and related_fetched.get("content"):
                    related_contents.append({
                        "url": related_url,
                        "title": related_fetched.get("title", ""),
                        "content": related_fetched.get("content", "")[:max_length],
                    })
            except Exception as e:
                logger.warning(f"Failed to fetch related content from {related_url}: {e}")
                continue
        
        if related_contents:
            # Combine related content
            combined = "\n\n".join([
                f"### {rc['title']}\n{rc['content']}\nSource: {rc['url']}"
                for rc in related_contents
            ])
            return combined[:max_length * 3]  # Limit total length
        
        return None
        
    except Exception as e:
        logger.warning(f"Failed to discover related content: {e}")
        return None


def _validate_content_claims(content: str, url: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
    """
    Validate content by checking for fact-checking signals and source credibility.
    
    This is a lightweight fact-checking approach that:
    1. Checks source credibility (domain authority)
    2. Looks for citation patterns
    3. Detects unsupported claims
    4. Cross-references with known facts (if available)
    
    Args:
        content: Content to validate
        url: Source URL
        metadata: Content metadata
        
    Returns:
        Dict with validation results and credibility score
    """
    try:
        validation = {
            "credibility_score": 50,  # Default
            "signals": {},
            "warnings": [],
            "verified_claims": [],
        }
        
        domain = urlparse(url).netloc.lower()
        
        # 1. Source credibility check
        source_credibility = 50
        high_credibility_domains = [
            'edu', 'gov', 'org', 'wikipedia.org', 'github.com',
            'nature.com', 'science.org', 'pubmed.ncbi.nlm.nih.gov',
            'arxiv.org', 'ieee.org', 'acm.org',
        ]
        
        if any(auth in domain for auth in high_credibility_domains):
            source_credibility = 90
        elif domain.endswith('.edu') or domain.endswith('.gov'):
            source_credibility = 95
        elif 'news' in domain or 'blog' in domain:
            source_credibility = 60
        elif 'wiki' in domain:
            source_credibility = 80
        
        validation["signals"]["source_credibility"] = source_credibility
        validation["credibility_score"] = source_credibility
        
        # 2. Citation patterns (academic/scientific content usually has citations)
        citation_patterns = [
            r'\[?\d+\]?',  # [1], [2], etc.
            r'\([A-Z][a-z]+ et al\.?,?\s*\d{4}\)',  # (Author et al., 2024)
            r'https?://[^\s]+',  # URLs (external references)
            r'doi\.org/[^\s]+',  # DOI links
        ]
        
        citation_count = sum(len(re.findall(pattern, content)) for pattern in citation_patterns)
        has_citations = citation_count > 3
        
        validation["signals"]["has_citations"] = has_citations
        validation["signals"]["citation_count"] = citation_count
        
        if has_citations:
            validation["credibility_score"] = min(100, validation["credibility_score"] + 10)
        
        # 3. Detect unsupported claims (statements without evidence)
        unsupported_patterns = [
            r'studies?\s+(?:show|prove|demonstrate|indicate)\s+that',  # "studies show that" without citation
            r'research\s+(?:shows|proves|demonstrates)',  # "research shows" without citation
            r'experts?\s+(?:say|believe|think)',  # "experts say" without attribution
        ]
        
        unsupported_claims = []
        for pattern in unsupported_patterns:
            matches = re.findall(pattern, content, re.I)
            if matches and not has_citations:
                unsupported_claims.extend(matches)
        
        if unsupported_claims:
            validation["warnings"].append(f"Found {len(unsupported_claims)} potentially unsupported claims")
            validation["credibility_score"] = max(0, validation["credibility_score"] - 5)
        
        validation["signals"]["unsupported_claims_count"] = len(unsupported_claims)
        
        # 4. Check for fact-checking indicators
        fact_check_indicators = [
            'peer-reviewed', 'peer reviewed',
            'published in', 'journal',
            'verified', 'fact-checked',
            'source:', 'reference:',
        ]
        
        has_fact_check_indicators = any(indicator in content.lower() for indicator in fact_check_indicators)
        validation["signals"]["has_fact_check_indicators"] = has_fact_check_indicators
        
        if has_fact_check_indicators:
            validation["credibility_score"] = min(100, validation["credibility_score"] + 5)
        
        # 5. Date freshness (recent content might be more reliable for current events)
        date = metadata.get("date", "")
        if date and DATEUTIL_AVAILABLE:
            try:
                parsed_date = date_parser.parse(date)
                days_old = (datetime.now() - parsed_date.replace(tzinfo=None)).days
                
                # Recent content (within 1 year) gets slight boost
                if days_old < 365:
                    validation["signals"]["is_recent"] = True
                    validation["signals"]["days_old"] = days_old
                    if days_old < 30:
                        validation["credibility_score"] = min(100, validation["credibility_score"] + 5)
            except:
                pass
        
        # 6. Author credibility (if available)
        author = metadata.get("author", "")
        if author:
            # Check for institutional affiliations
            institutional_patterns = [
                r'university', r'professor', r'phd', r'doctor',
                r'institute', r'research', r'laboratory',
            ]
            has_institutional_affiliation = any(
                re.search(pattern, author, re.I) for pattern in institutional_patterns
            )
            
            if has_institutional_affiliation:
                validation["signals"]["author_credibility"] = "high"
                validation["credibility_score"] = min(100, validation["credibility_score"] + 5)
            else:
                validation["signals"]["author_credibility"] = "unknown"
        
        # Normalize credibility score
        validation["credibility_score"] = max(0, min(100, validation["credibility_score"]))
        validation["credibility_grade"] = (
            "A" if validation["credibility_score"] >= 80 else
            "B" if validation["credibility_score"] >= 60 else
            "C" if validation["credibility_score"] >= 40 else "D"
        )
        
        return validation
        
    except Exception as e:
        logger.warning(f"Content validation failed: {e}")
        return {
            "credibility_score": 50,
            "signals": {},
            "warnings": [f"Validation error: {str(e)}"],
            "verified_claims": [],
            "credibility_grade": "C",
        }


def _extract_structured_data(html_content: str) -> Optional[Dict[str, Any]]:
    """
    Extract structured data from HTML (JSON-LD, microdata, schema.org).
    
    Returns:
        Dict with extracted structured data or None
    """
    try:
        soup = BeautifulSoup(html_content, 'html.parser')
        structured_data = {}
        
        # Extract JSON-LD (most common)
        json_ld_scripts = soup.find_all('script', type='application/ld+json')
        json_ld_data = []
        for script in json_ld_scripts:
            try:
                data = json.loads(script.string)
                if isinstance(data, dict):
                    json_ld_data.append(data)
                elif isinstance(data, list):
                    json_ld_data.extend(data)
            except (json.JSONDecodeError, AttributeError):
                continue
        
        if json_ld_data:
            structured_data['json_ld'] = json_ld_data
        
        # Extract microdata (itemscope, itemprop)
        microdata = {}
        items = soup.find_all(attrs={'itemscope': True})
        for item in items[:10]:  # Limit to first 10 items
            item_type = item.get('itemtype', '')
            props = {}
            for prop in item.find_all(attrs={'itemprop': True}):
                prop_name = prop.get('itemprop', '')
                prop_value = prop.get('content') or prop.get_text(strip=True)
                if prop_value:
                    props[prop_name] = prop_value
            if props:
                microdata[item_type or 'Unknown'] = props
        
        if microdata:
            structured_data['microdata'] = microdata
        
        # Extract Open Graph and Twitter Card metadata
        og_data = {}
        twitter_data = {}
        
        # Open Graph
        for meta in soup.find_all('meta', property=re.compile(r'^og:')):
            prop = meta.get('property', '').replace('og:', '')
            content = meta.get('content', '')
            if content:
                og_data[prop] = content
        
        # Twitter Card
        for meta in soup.find_all('meta', attrs={'name': re.compile(r'^twitter:')}):
            name = meta.get('name', '').replace('twitter:', '')
            content = meta.get('content', '')
            if content:
                twitter_data[name] = content
        
        if og_data:
            structured_data['open_graph'] = og_data
        if twitter_data:
            structured_data['twitter_card'] = twitter_data
        
        # Extract common schema.org types
        schema_types = {}
        for schema_type in ['Article', 'NewsArticle', 'BlogPosting', 'Organization', 'Person', 'Event', 'Product']:
            items = soup.find_all(attrs={'itemtype': re.compile(f'.*{schema_type}')})
            if items:
                schema_items = []
                for item in items[:5]:  # Limit to 5 per type
                    item_data = {}
                    for prop in item.find_all(attrs={'itemprop': True}):
                        prop_name = prop.get('itemprop', '')
                        prop_value = prop.get('content') or prop.get_text(strip=True)
                        if prop_value:
                            item_data[prop_name] = prop_value
                    if item_data:
                        schema_items.append(item_data)
                if schema_items:
                    schema_types[schema_type.lower()] = schema_items
        
        if schema_types:
            structured_data['schema_types'] = schema_types
        
        return structured_data if structured_data else None
        
    except Exception as e:
        logger.warning(f"Failed to extract structured data: {e}")
        return None


def _format_timestamp(seconds: float) -> str:
    """Format seconds to SRT timestamp format (HH:MM:SS,mmm)"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


async def _detect_pagination(url: str, html_content: str) -> List[str]:
    """
    Detect pagination links (next page, page 2, etc.).
    
    Returns:
        List of pagination URLs
    """
    try:
        soup = BeautifulSoup(html_content, 'html.parser')
        pagination_urls = []
        
        # Common pagination patterns
        pagination_selectors = [
            ('a', {'rel': 'next'}),
            ('a', {'class': re.compile(r'next|pagination.*next', re.I)}),
            ('a', {'aria-label': re.compile(r'next', re.I)}),
            ('a', {'href': re.compile(r'page[=\/](\d+)|p=(\d+)|paged?=(\d+)', re.I)}),
        ]
        
        for tag, attrs in pagination_selectors:
            links = soup.find_all(tag, attrs)
            for link in links:
                href = link.get('href', '')
                if href:
                    from urllib.parse import urljoin
                    absolute_url = urljoin(url, href)
                    if absolute_url not in pagination_urls:
                        pagination_urls.append(absolute_url)
        
        return pagination_urls[:5]  # Limit to 5 pagination links
        
    except Exception as e:
        logger.warning(f"Failed to detect pagination: {e}")
        return []


async def crawl_site(
    start_url: str,
    max_pages: int = 50,
    max_depth: int = 2,
    format: str = "markdown",
    url_patterns: Optional[str] = None,
    exclude_patterns: Optional[str] = None,
    stealth_mode: str = "off",
    obey_robots: bool = True,
) -> Dict[str, Any]:
    """
    Recursively crawl an entire website and extract content from multiple pages.
    
    Uses async HTTP requests for crawling (works well with FastAPI).
    For heavy-duty crawling, Scrapy can be added later.
    
    Args:
        start_url: Starting URL to crawl
        max_pages: Maximum pages to crawl (1-200)
        max_depth: Maximum crawl depth (0-5)
        format: Output format ("text", "markdown", "html")
        url_patterns: Comma-separated regex patterns to include
        exclude_patterns: Comma-separated regex patterns to exclude
        stealth_mode: Anti-bot bypass level
        obey_robots: Respect robots.txt (default: True, note: not fully implemented yet)
        
    Returns:
        Dict with crawl summary and pages
    """
    try:
        # Simplified crawler using async HTTP requests (no Scrapy reactor conflicts)
        # For full Scrapy support, would need separate process/subprocess
        from urllib.parse import urljoin, urlparse
        import re
        
        parsed = urlparse(start_url)
        base_domain = parsed.netloc
        visited_urls = set()
        pages_to_crawl = [(start_url, 0)]  # (url, depth)
        results = []
        
        url_pattern_list = [p.strip() for p in url_patterns.split(",")] if url_patterns else []
        exclude_pattern_list = [p.strip() for p in exclude_patterns.split(",")] if exclude_patterns else []
        
        while pages_to_crawl and len(results) < max_pages:
            current_url, current_depth = pages_to_crawl.pop(0)
            
            if current_url in visited_urls or current_depth > max_depth:
                continue
            
            visited_urls.add(current_url)
            
            # Check URL patterns
            if url_pattern_list and not any(re.search(p, current_url) for p in url_pattern_list):
                continue
            if exclude_pattern_list and any(re.search(p, current_url) for p in exclude_pattern_list):
                continue
            
            # Fetch page
            fetched = await fetch_page_content(
                url=current_url,
                max_length=50000,  # More content for crawled pages
                format=format,
                stealth_mode=stealth_mode,
            )
            
            if fetched:
                results.append({
                    "url": current_url,
                    "status_code": 200,
                    "depth": current_depth,
                    "metadata": fetched.get("metadata", {}),
                    "content": fetched.get("content", ""),
                    "word_count": len(fetched.get("content", "").split()),
                    "format": format,
                })
                
                # Extract links for next depth level
                if current_depth < max_depth and len(results) < max_pages:
                    try:
                        # Re-fetch HTML to extract links (we need the raw HTML, not extracted content)
                        fetch_result = await fetch_with_stealth(current_url, stealth_mode, False)
                        html_for_links = fetch_result["html"]
                        soup = BeautifulSoup(html_for_links, 'html.parser')
                        for link in soup.find_all('a', href=True):
                            href = link['href']
                            absolute_url = urljoin(current_url, href)
                            parsed_link = urlparse(absolute_url)
                            
                            # Only follow same domain
                            if parsed_link.netloc == base_domain and absolute_url not in visited_urls:
                                # Check patterns
                                if url_pattern_list and not any(re.search(p, absolute_url) for p in url_pattern_list):
                                    continue
                                if exclude_pattern_list and any(re.search(p, absolute_url) for p in exclude_pattern_list):
                                    continue
                                pages_to_crawl.append((absolute_url, current_depth + 1))
                    except Exception as e:
                        logger.warning(f"Link extraction failed for {current_url}: {e}")
        
        return {
            "crawl_summary": {
                "start_url": start_url,
                "pages_crawled": len(results),
                "max_pages_requested": max_pages,
                "max_depth": max_depth,
                "format": format,
                "stealth_mode": stealth_mode,
            },
            "pages": results,
            "total_words": sum(r.get("word_count", 0) for r in results),
        }
        
    except Exception as e:
        logger.error(f"Site crawl failed: {e}")
        return {
            "error": str(e),
            "crawl_summary": {
                "start_url": start_url,
                "pages_crawled": 0,
            },
            "pages": [],
        }
