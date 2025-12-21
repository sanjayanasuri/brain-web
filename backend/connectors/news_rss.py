"""
News RSS connector for fetching news articles from RSS feeds.
"""
import hashlib
import re
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
import feedparser
import requests
from bs4 import BeautifulSoup

from connectors.base import BaseConnector, SourceDocument


class NewsRSSConnector(BaseConnector):
    """
    Connector for RSS news feeds.
    By default, only ingests title/description/link.
    Can optionally fetch full text if allow_fulltext_fetch=True.
    """
    
    def __init__(self):
        """Initialize News RSS connector with session."""
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5"
        })
        # Add retries
        from requests.adapters import HTTPAdapter
        from urllib3.util.retry import Retry
        retry_strategy = Retry(
            total=3,
            backoff_factor=1,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET"]
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        self.session.mount("http://", adapter)
        self.session.mount("https://", adapter)
        self.session.timeout = 30
    
    @property
    def name(self) -> str:
        return "news"
    
    def _extract_main_content(self, html: str, url: str) -> str:
        """
        Extract main content from article HTML.
        Uses same heuristic as IR connector.
        """
        soup = BeautifulSoup(html, "html.parser")
        
        # Remove script, style, nav, footer
        for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
            tag.decompose()
        
        # Try <article> first
        article = soup.find("article")
        if article:
            text = article.get_text(separator=" ", strip=True)
            if len(text) > 500:
                return text
        
        # Find largest div by text length
        divs = soup.find_all("div")
        best_div = None
        best_length = 0
        
        for div in divs:
            text = div.get_text(separator=" ", strip=True)
            length = len(text)
            if 500 < length < 50000 and length > best_length:
                best_length = length
                best_div = div
        
        if best_div:
            return best_div.get_text(separator=" ", strip=True)
        
        # Fallback: get body text
        body = soup.find("body")
        if body:
            return body.get_text(separator=" ", strip=True)
        
        return soup.get_text(separator=" ", strip=True)
    
    def _fetch_full_text(self, url: str) -> Optional[str]:
        """
        Fetch full text from article URL.
        Returns None if paywall detected or extraction fails.
        """
        try:
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
            
            # Check for paywall
            content_lower = response.text.lower()
            if any(term in content_lower for term in ["subscribe", "paywall", "premium", "members only", "sign in to continue"]):
                print(f"[News RSS] Warning: Possible paywall detected for {url}, skipping full text")
                return None
            
            # Extract main content
            text = self._extract_main_content(response.text, url)
            
            if not text or len(text) < 200:
                return None
            
            return text
        except Exception as e:
            print(f"[News RSS] ERROR: Failed to fetch full text from {url}: {e}")
            return None
    
    def fetch(
        self,
        ticker: str,
        company: Dict[str, Any],
        since_days: int,
        limit: int
    ) -> List[SourceDocument]:
        """
        Fetch news articles from RSS feeds.
        """
        documents = []
        news_config = company.get("news", {})
        
        if not news_config:
            print(f"[News RSS] No news config for {ticker}, skipping")
            return documents
        
        rss_feeds = news_config.get("rss_feeds", [])
        if not rss_feeds:
            print(f"[News RSS] No RSS feeds configured for {ticker}")
            return documents
        
        allow_fulltext = news_config.get("allow_fulltext_fetch", False)
        
        cutoff_date = datetime.now() - timedelta(days=since_days)
        
        for feed_url in rss_feeds:
            print(f"[News RSS] Fetching from feed: {feed_url}")
            try:
                # Parse RSS feed
                feed = feedparser.parse(feed_url)
                
                if feed.bozo:
                    print(f"[News RSS] Warning: Feed parsing issues for {feed_url}: {feed.bozo_exception}")
                
                entries = feed.entries[:limit]  # Limit entries per feed
                
                for entry in entries:
                    if len(documents) >= limit:
                        break
                    
                    # Check date
                    published_at = None
                    if hasattr(entry, "published_parsed") and entry.published_parsed:
                        try:
                            pub_date = datetime(*entry.published_parsed[:6])
                            if pub_date < cutoff_date:
                                continue
                            published_at = pub_date.isoformat()
                        except Exception:
                            pass
                    elif hasattr(entry, "published"):
                        # Try to parse published string
                        try:
                            pub_date = datetime.strptime(entry.published, "%a, %d %b %Y %H:%M:%S %z")
                            if pub_date.replace(tzinfo=None) < cutoff_date:
                                continue
                            published_at = pub_date.isoformat()
                        except Exception:
                            pass
                    
                    # Get title, description, link
                    title = getattr(entry, "title", "") or ""
                    description = getattr(entry, "description", "") or ""
                    link = getattr(entry, "link", "") or ""
                    
                    if not title and not description:
                        continue
                    
                    # Build text content
                    text_parts = [title]
                    if description:
                        text_parts.append(description)
                    
                    raw_text = "\n\n".join(text_parts)
                    
                    # Optionally fetch full text
                    if allow_fulltext and link:
                        full_text = self._fetch_full_text(link)
                        if full_text:
                            raw_text = full_text
                    
                    # Generate external_id
                    entry_id = getattr(entry, "id", link) or link
                    external_id = f"NEWS:{hashlib.sha256(feed_url.encode() + entry_id.encode()).hexdigest()[:16]}"
                    
                    doc = SourceDocument(
                        source_type="NEWS_RSS",
                        doc_type="NEWS",
                        ticker=ticker,
                        company_name=company.get("company_name"),
                        title=title,
                        published_at=published_at,
                        url=link,
                        external_id=external_id,
                        raw_text=raw_text,
                        metadata={
                            "feed_url": feed_url,
                            "entry_id": entry_id,
                            "fulltext_fetched": allow_fulltext and link and len(raw_text) > len(description) + 100
                        }
                    )
                    documents.append(doc)
                
            except Exception as e:
                print(f"[News RSS] ERROR: Failed to fetch from feed {feed_url}: {e}")
        
        print(f"[News RSS] Fetched {len(documents)} documents for {ticker}")
        return documents
