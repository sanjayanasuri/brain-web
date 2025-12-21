"""
Investor Relations (IR) connector for press releases and shareholder letters.
"""
import re
import hashlib
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from urllib.parse import urljoin, urlparse
import requests
from bs4 import BeautifulSoup

from connectors.base import BaseConnector, SourceDocument


class IRConnector(BaseConnector):
    """
    Connector for Investor Relations pages (press releases, shareholder letters).
    """
    
    def __init__(self):
        """Initialize IR connector with session."""
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
        return "ir"
    
    def _extract_main_content(self, html: str, url: str) -> str:
        """
        Extract main content from HTML page using heuristics.
        Tries to find <article>, then largest <div> by text length.
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
            # Prefer divs with substantial text but not too large (likely wrapper)
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
    
    def _extract_links_from_page(
        self,
        html: str,
        base_url: str,
        include_patterns: Optional[List[str]] = None,
        exclude_patterns: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """
        Extract links from an index page.
        Returns list of {url, title, date} dicts.
        """
        soup = BeautifulSoup(html, "html.parser")
        links = []
        
        # Find all links
        for a_tag in soup.find_all("a", href=True):
            href = a_tag["href"]
            title = a_tag.get_text(strip=True)
            
            # Resolve relative URLs
            full_url = urljoin(base_url, href)
            
            # Apply include/exclude patterns
            if include_patterns:
                if not any(re.search(pattern, full_url, re.IGNORECASE) for pattern in include_patterns):
                    continue
            
            if exclude_patterns:
                if any(re.search(pattern, full_url, re.IGNORECASE) for pattern in exclude_patterns):
                    continue
            
            # Try to extract date from nearby text
            date_str = None
            parent = a_tag.parent
            if parent:
                parent_text = parent.get_text()
                # Look for date patterns
                date_match = re.search(r'(\d{4}[-/]\d{1,2}[-/]\d{1,2})', parent_text)
                if date_match:
                    date_str = date_match.group(1)
            
            if title and len(title) > 10:  # Only substantial titles
                links.append({
                    "url": full_url,
                    "title": title,
                    "date": date_str
                })
        
        return links
    
    def _fetch_and_extract_page(self, url: str, doc_type: str) -> Optional[SourceDocument]:
        """
        Fetch a page and extract content.
        Returns SourceDocument or None if extraction fails.
        """
        try:
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
            
            # Check if it's a paywall or blocked page
            content_lower = response.text.lower()
            if any(term in content_lower for term in ["subscribe", "paywall", "premium", "members only"]):
                print(f"[IR] Warning: Possible paywall detected for {url}, skipping full text")
                # Still return title + description if available
                soup = BeautifulSoup(response.text, "html.parser")
                title = soup.find("title")
                title_text = title.get_text(strip=True) if title else ""
                return SourceDocument(
                    source_type="IR",
                    doc_type=doc_type,
                    ticker="",  # Will be set by caller
                    title=title_text,
                    url=url,
                    external_id=f"IR:{hashlib.sha256(url.encode()).hexdigest()[:16]}",
                    raw_text=title_text[:2000],  # Just title
                    metadata={"paywall_detected": True}
                )
            
            # Extract main content
            text = self._extract_main_content(response.text, url)
            
            if not text or len(text) < 200:
                print(f"[IR] Warning: Page {url} has insufficient content ({len(text)} chars)")
                # Still return what we have
                soup = BeautifulSoup(response.text, "html.parser")
                title = soup.find("title")
                title_text = title.get_text(strip=True) if title else ""
                text = title_text + " " + text[:2000]
            
            # Extract title
            soup = BeautifulSoup(response.text, "html.parser")
            title = soup.find("title")
            title_text = title.get_text(strip=True) if title else url
            
            # Try to extract published date
            published_at = None
            # Look for meta tags
            meta_date = soup.find("meta", property="article:published_time")
            if meta_date and meta_date.get("content"):
                published_at = meta_date["content"]
            else:
                # Look for date in text
                date_match = re.search(r'(\d{4}[-/]\d{1,2}[-/]\d{1,2})', response.text)
                if date_match:
                    published_at = date_match.group(1)
            
            return SourceDocument(
                source_type="IR",
                doc_type=doc_type,
                ticker="",  # Will be set by caller
                title=title_text,
                published_at=published_at,
                url=url,
                external_id=f"IR:{hashlib.sha256(url.encode()).hexdigest()[:16]}",
                raw_text=text,
                metadata={"ir_page_url": url}
            )
        except Exception as e:
            print(f"[IR] ERROR: Failed to fetch/extract {url}: {e}")
            return None
    
    def fetch(
        self,
        ticker: str,
        company: Dict[str, Any],
        since_days: int,
        limit: int
    ) -> List[SourceDocument]:
        """
        Fetch IR documents (press releases, shareholder letters).
        """
        documents = []
        ir_config = company.get("ir", {})
        
        if not ir_config:
            print(f"[IR] No IR config for {ticker}, skipping")
            return documents
        
        cutoff_date = datetime.now() - timedelta(days=since_days)
        
        # Process press releases
        press_release_url = ir_config.get("press_release_index_url")
        if press_release_url:
            print(f"[IR] Fetching press releases from {press_release_url}")
            try:
                response = self.session.get(press_release_url, timeout=30)
                response.raise_for_status()
                
                include_patterns = ir_config.get("link_include_patterns")
                exclude_patterns = ir_config.get("link_exclude_patterns")
                
                links = self._extract_links_from_page(
                    response.text,
                    press_release_url,
                    include_patterns,
                    exclude_patterns
                )
                
                # Sort by date (most recent first), limit
                links.sort(key=lambda x: x.get("date") or "", reverse=True)
                count = 0
                for link in links[:limit]:
                    if count >= limit:
                        break
                    
                    # Check date if available
                    if link.get("date"):
                        try:
                            link_date = datetime.strptime(link["date"], "%Y-%m-%d")
                            if link_date < cutoff_date:
                                continue
                        except Exception:
                            pass
                    
                    doc = self._fetch_and_extract_page(link["url"], "PRESS_RELEASE")
                    if doc:
                        doc.ticker = ticker
                        doc.company_name = company.get("company_name")
                        documents.append(doc)
                        count += 1
            except Exception as e:
                print(f"[IR] ERROR: Failed to fetch press releases: {e}")
        
        # Process shareholder letters
        shareholder_letter_url = ir_config.get("shareholder_letter_index_url")
        if shareholder_letter_url:
            print(f"[IR] Fetching shareholder letters from {shareholder_letter_url}")
            try:
                response = self.session.get(shareholder_letter_url, timeout=30)
                response.raise_for_status()
                
                include_patterns = ir_config.get("link_include_patterns")
                exclude_patterns = ir_config.get("link_exclude_patterns")
                
                links = self._extract_links_from_page(
                    response.text,
                    shareholder_letter_url,
                    include_patterns,
                    exclude_patterns
                )
                
                links.sort(key=lambda x: x.get("date") or "", reverse=True)
                count = 0
                for link in links[:limit]:
                    if count >= limit:
                        break
                    
                    if link.get("date"):
                        try:
                            link_date = datetime.strptime(link["date"], "%Y-%m-%d")
                            if link_date < cutoff_date:
                                continue
                        except Exception:
                            pass
                    
                    doc = self._fetch_and_extract_page(link["url"], "SHAREHOLDER_LETTER")
                    if doc:
                        doc.ticker = ticker
                        doc.company_name = company.get("company_name")
                        documents.append(doc)
                        count += 1
            except Exception as e:
                print(f"[IR] ERROR: Failed to fetch shareholder letters: {e}")
        
        print(f"[IR] Fetched {len(documents)} documents for {ticker}")
        return documents
