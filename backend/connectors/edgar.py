"""
SEC EDGAR connector for fetching public company filings.
"""
import json
import os
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Any, Optional
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin

from connectors.base import BaseConnector, SourceDocument
from config import SEC_USER_AGENT


class EdgarConnector(BaseConnector):
    """
    Connector for SEC EDGAR filings (10-K, 10-Q, 8-K).
    """
    
    SEC_BASE_URL = "https://www.sec.gov"
    COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
    CACHE_DIR = Path(__file__).parent.parent / "cache"
    COMPANY_TICKERS_CACHE = CACHE_DIR / "company_tickers.json"
    
    # Forms we're interested in
    TARGET_FORMS = ["10-K", "10-Q", "8-K"]
    
    def __init__(self):
        """Initialize EDGAR connector with session and caching."""
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": SEC_USER_AGENT or "BrainWeb/1.0 contact@example.com",
            "Accept-Encoding": "gzip, deflate",
            "Host": "www.sec.gov"
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
        
        # Ensure cache directory exists
        self.CACHE_DIR.mkdir(exist_ok=True)
    
    @property
    def name(self) -> str:
        return "edgar"
    
    def _get_company_tickers(self) -> Dict[str, Dict[str, Any]]:
        """
        Get company tickers mapping from SEC (cached locally).
        Returns dict mapping ticker -> {cik_str, title, ...}
        """
        # Check cache first (refresh daily)
        if self.COMPANY_TICKERS_CACHE.exists():
            cache_age = time.time() - self.COMPANY_TICKERS_CACHE.stat().st_mtime
            if cache_age < 86400:  # 24 hours
                try:
                    with open(self.COMPANY_TICKERS_CACHE, "r") as f:
                        data = json.load(f)
                        # Convert to ticker-keyed dict
                        ticker_map = {}
                        for entry in data.get("data", []):
                            ticker = entry[0].upper()
                            cik_str = str(entry[1]).zfill(10)  # Pad to 10 digits
                            title = entry[2]
                            ticker_map[ticker] = {
                                "cik_str": cik_str,
                                "title": title
                            }
                        return ticker_map
                except Exception as e:
                    print(f"[EDGAR] Warning: Failed to load cached tickers: {e}")
        
        # Fetch fresh data
        try:
            print(f"[EDGAR] Fetching company tickers from SEC...")
            response = self.session.get(self.COMPANY_TICKERS_URL, timeout=30)
            response.raise_for_status()
            data = response.json()
            
            # Save to cache
            with open(self.COMPANY_TICKERS_CACHE, "w") as f:
                json.dump(data, f)
            
            # Convert to ticker-keyed dict
            ticker_map = {}
            for entry in data.get("data", []):
                ticker = entry[0].upper()
                cik_str = str(entry[1]).zfill(10)
                title = entry[2]
                ticker_map[ticker] = {
                    "cik_str": cik_str,
                    "title": title
                }
            
            print(f"[EDGAR] Loaded {len(ticker_map)} company tickers")
            return ticker_map
        except Exception as e:
            print(f"[EDGAR] ERROR: Failed to fetch company tickers: {e}")
            # Try to return cached data even if stale
            if self.COMPANY_TICKERS_CACHE.exists():
                try:
                    with open(self.COMPANY_TICKERS_CACHE, "r") as f:
                        data = json.load(f)
                        ticker_map = {}
                        for entry in data.get("data", []):
                            ticker = entry[0].upper()
                            cik_str = str(entry[1]).zfill(10)
                            title = entry[2]
                            ticker_map[ticker] = {"cik_str": cik_str, "title": title}
                        return ticker_map
                except Exception:
                    pass
            return {}
    
    def _ticker_to_cik(self, ticker: str) -> Optional[str]:
        """Convert ticker to CIK string (10-digit padded)."""
        ticker_map = self._get_company_tickers()
        ticker_upper = ticker.upper()
        if ticker_upper in ticker_map:
            return ticker_map[ticker_upper]["cik_str"]
        return None
    
    def _fetch_submissions(self, cik: str) -> Optional[Dict[str, Any]]:
        """
        Fetch company submissions from SEC.
        Returns submissions JSON or None.
        Uses the SEC submissions API endpoint.
        """
        # SEC submissions endpoint format: /submissions/CIK{cik}.json
        # CIK must be zero-padded to 10 digits
        cik_padded = cik.zfill(10)
        submissions_json_url = f"{self.SEC_BASE_URL}/submissions/CIK{cik_padded}.json"
        
        try:
            response = self.session.get(submissions_json_url, timeout=30)
            response.raise_for_status()
            # Respect rate limiting (SEC recommends max 10 requests per second)
            time.sleep(0.1)
            return response.json()
        except Exception as e:
            print(f"[EDGAR] ERROR: Failed to fetch submissions for CIK {cik}: {e}")
            return None
    
    def _extract_text_from_filing(self, filing_url: str) -> str:
        """
        Extract text from a filing HTML page.
        Returns cleaned text content.
        """
        try:
            response = self.session.get(filing_url, timeout=30)
            response.raise_for_status()
            time.sleep(0.1)  # Rate limiting
            
            soup = BeautifulSoup(response.content, "html.parser")
            
            # Remove script and style elements
            for script in soup(["script", "style"]):
                script.decompose()
            
            # Try to find main content
            # SEC filings often have <table> structures
            text_parts = []
            
            # Look for common SEC filing structures
            content_divs = soup.find_all(["div", "table", "p"])
            for elem in content_divs:
                text = elem.get_text(separator=" ", strip=True)
                if len(text) > 100:  # Only include substantial text
                    text_parts.append(text)
            
            # Fallback: get all text
            if not text_parts:
                text_parts.append(soup.get_text(separator=" ", strip=True))
            
            # Join and clean
            full_text = " ".join(text_parts)
            # Remove excessive whitespace
            import re
            full_text = re.sub(r'\s+', ' ', full_text)
            
            return full_text[:500000]  # Limit to 500k chars
        except Exception as e:
            print(f"[EDGAR] ERROR: Failed to extract text from {filing_url}: {e}")
            return ""
    
    def _get_filing_document_url(self, accession_number: str, primary_document: str) -> str:
        """
        Build URL to the actual filing document.
        Format: https://www.sec.gov/Archives/edgar/data/{CIK}/{accession_no_dashes}/{primary_document}
        """
        # Remove dashes from accession number
        accession_clean = accession_number.replace("-", "")
        # Extract CIK from accession (first 10 digits)
        cik = accession_clean[:10]
        return f"{self.SEC_BASE_URL}/Archives/edgar/data/{cik}/{accession_clean}/{primary_document}"
    
    def fetch(
        self,
        ticker: str,
        company: Dict[str, Any],
        since_days: int,
        limit: int
    ) -> List[SourceDocument]:
        """
        Fetch EDGAR filings for a company.
        """
        documents = []
        
        # Get CIK from ticker
        cik = company.get("cik")
        if not cik:
            cik = self._ticker_to_cik(ticker)
        
        if not cik:
            print(f"[EDGAR] ERROR: Could not find CIK for ticker {ticker}")
            return documents
        
        print(f"[EDGAR] Fetching filings for {ticker} (CIK: {cik})")
        
        # Fetch submissions
        submissions = self._fetch_submissions(cik)
        if not submissions:
            return documents
        
        # Get recent filings
        filings = submissions.get("filings", {}).get("recent", {})
        if not filings:
            return documents
        
        # Get form types, filing dates, accession numbers
        form_types = filings.get("form", [])
        filing_dates = filings.get("filingDate", [])
        accession_numbers = filings.get("accessionNumber", [])
        primary_documents = filings.get("primaryDocument", [])
        
        # Calculate cutoff date
        cutoff_date = datetime.now() - timedelta(days=since_days)
        
        # Process filings
        count = 0
        for i in range(len(form_types)):
            if count >= limit:
                break
            
            form_type = form_types[i]
            if form_type not in self.TARGET_FORMS:
                continue
            
            filing_date_str = filing_dates[i] if i < len(filing_dates) else None
            if filing_date_str:
                try:
                    filing_date = datetime.strptime(filing_date_str, "%Y-%m-%d")
                    if filing_date < cutoff_date:
                        continue
                except Exception:
                    pass
            
            accession = accession_numbers[i] if i < len(accession_numbers) else None
            if not accession:
                continue
            
            # Get primary document (fallback to index.html if not available)
            primary_doc = primary_documents[i] if i < len(primary_documents) and primary_documents[i] else "index.html"
            
            # Build filing URL
            filing_url = self._get_filing_document_url(accession, primary_doc)
            
            # Extract text
            print(f"[EDGAR] Extracting text from {form_type} filing: {accession}")
            text = self._extract_text_from_filing(filing_url)
            
            if not text or len(text) < 500:
                print(f"[EDGAR] Warning: Filing {accession} has insufficient text, skipping")
                continue
            
            # Create SourceDocument
            doc = SourceDocument(
                source_type="SEC_EDGAR",
                doc_type=form_type,
                ticker=ticker,
                company_name=company.get("company_name"),
                title=f"{form_type} - {filing_date_str or 'Unknown Date'}",
                published_at=filing_date_str,
                url=filing_url,
                external_id=f"SEC:{cik}:{accession}:{primary_doc}",
                raw_text=text,
                metadata={
                    "cik": cik,
                    "accession": accession,
                    "filing_date": filing_date_str,
                    "primary_document": primary_doc
                }
            )
            documents.append(doc)
            count += 1
        
        print(f"[EDGAR] Fetched {len(documents)} documents for {ticker}")
        return documents
