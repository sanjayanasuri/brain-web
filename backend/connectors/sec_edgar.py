"""
SEC EDGAR connector for fetching company filings.
"""
import requests
import time
from typing import List, Dict, Any, Optional
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

# SEC EDGAR API base URL
SEC_EDGAR_BASE = "https://data.sec.gov"
SEC_EDGAR_SUBMISSIONS = f"{SEC_EDGAR_BASE}/submissions"

# Rate limiting: SEC requires max 10 requests per second
# We'll be conservative and use 0.2s between requests (5 req/s)
RATE_LIMIT_DELAY = 0.2
_last_request_time = 0


def _rate_limit():
    """Enforce rate limiting for SEC API."""
    global _last_request_time
    elapsed = time.time() - _last_request_time
    if elapsed < RATE_LIMIT_DELAY:
        time.sleep(RATE_LIMIT_DELAY - elapsed)
    _last_request_time = time.time()


def _get_headers() -> Dict[str, str]:
    """Get headers for SEC API requests (user-agent required)."""
    return {
        "User-Agent": "BrainWeb Finance Connector contact@example.com",
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate"
    }


def _get_cik_from_ticker(ticker: str) -> Optional[str]:
    """
    Get CIK (Central Index Key) from ticker symbol.
    Uses SEC company tickers JSON endpoint.
    
    Args:
        ticker: Stock ticker symbol (e.g., "NVDA")
    
    Returns:
        CIK as string (10 digits, zero-padded) or None
    """
    _rate_limit()
    
    try:
        # SEC provides a tickers JSON file
        url = f"{SEC_EDGAR_BASE}/files/company_tickers.json"
        response = requests.get(url, headers=_get_headers(), timeout=10)
        response.raise_for_status()
        
        data = response.json()
        # Format: {"0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."}, ...}
        for entry in data.values():
            if entry.get("ticker", "").upper() == ticker.upper():
                cik = str(entry.get("cik_str", ""))
                # Pad to 10 digits
                return cik.zfill(10)
        
        logger.warning(f"Ticker {ticker} not found in SEC company tickers")
        return None
    except Exception as e:
        logger.error(f"Failed to get CIK for ticker {ticker}: {e}")
        return None


def fetch_company_filings(
    ticker: str,
    form_types: Optional[List[str]] = None,
    limit: int = 50
) -> List[Dict[str, Any]]:
    """
    Fetch company filings from SEC EDGAR.
    
    Args:
        ticker: Stock ticker symbol (e.g., "NVDA")
        form_types: Optional list of form types to filter (e.g., ["10-Q", "10-K", "8-K"])
        limit: Maximum number of filings to return
    
    Returns:
        List of filing dicts with:
        - external_id: str (accession number)
        - url: str (full URL to filing)
        - type: str (form type, e.g., "10-Q")
        - published_at: int (Unix timestamp)
        - title: str (filing title)
    """
    if form_types is None:
        form_types = ["10-Q", "10-K", "8-K"]
    
    cik = _get_cik_from_ticker(ticker)
    if not cik:
        logger.error(f"Could not resolve CIK for ticker {ticker}")
        return []
    
    _rate_limit()
    
    try:
        # Get company submissions
        url = f"{SEC_EDGAR_SUBMISSIONS}/CIK{cik}.json"
        response = requests.get(url, headers=_get_headers(), timeout=10)
        response.raise_for_status()
        
        data = response.json()
        filings = []
        
        # Parse submissions format
        # Structure: {"cik": "...", "name": "...", "tickers": [...], "filings": {"recent": {...}, "files": [...]}}
        recent = data.get("filings", {}).get("recent", {})
        form_list = recent.get("form", [])
        filing_date_list = recent.get("filingDate", [])
        accession_list = recent.get("accessionNumber", [])
        report_date_list = recent.get("reportDate", [])
        
        for i, form_type in enumerate(form_list):
            if form_type in form_types:
                if i >= len(accession_list) or i >= len(filing_date_list):
                    continue
                
                accession = accession_list[i].replace("-", "")
                filing_date = filing_date_list[i]
                report_date = report_date_list[i] if i < len(report_date_list) else filing_date
                
                # Parse date to timestamp
                try:
                    dt = datetime.strptime(filing_date, "%Y-%m-%d")
                    published_at = int(dt.timestamp())
                except Exception:
                    published_at = None
                
                # Build filing URL
                # Format: https://www.sec.gov/Archives/edgar/data/{CIK}/{accession_no}/{accession_no}.txt
                filing_url = f"https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/{accession}.txt"
                
                filings.append({
                    "external_id": accession,
                    "url": filing_url,
                    "type": form_type,
                    "published_at": published_at,
                    "title": f"{form_type} - {report_date}",
                    "filing_date": filing_date,
                    "report_date": report_date
                })
                
                if len(filings) >= limit:
                    break
        
        logger.info(f"Fetched {len(filings)} filings for {ticker} (CIK: {cik})")
        return filings
        
    except Exception as e:
        logger.error(f"Failed to fetch filings for ticker {ticker}: {e}")
        return []


def fetch_filing_text(url: str) -> Optional[str]:
    """
    Fetch raw text from a SEC filing URL.
    
    Args:
        url: URL to the filing (typically .txt file)
    
    Returns:
        Raw text content or None on error
    """
    _rate_limit()
    
    try:
        response = requests.get(url, headers=_get_headers(), timeout=30)
        response.raise_for_status()
        
        # SEC filings are typically plain text or HTML
        # For now, return as-is (can add HTML stripping later if needed)
        text = response.text
        
        # Basic cleanup: remove excessive whitespace
        # Note: Full HTML parsing/stripping can be added later
        lines = text.split('\n')
        cleaned_lines = [line.strip() for line in lines if line.strip()]
        cleaned_text = '\n'.join(cleaned_lines)
        
        logger.info(f"Fetched filing text from {url} ({len(cleaned_text)} chars)")
        return cleaned_text
        
    except Exception as e:
        logger.error(f"Failed to fetch filing text from {url}: {e}")
        return None


def fetch_xbrl(url: str) -> Optional[Dict[str, Any]]:
    """
    Placeholder for XBRL structured data extraction.
    This would parse XBRL/XML to extract structured financial numbers.
    
    Args:
        url: URL to XBRL filing
    
    Returns:
        Placeholder: None for now (to be implemented later)
    """
    # TODO: Implement XBRL parsing
    # This would involve:
    # 1. Fetching XBRL instance document
    # 2. Parsing XML/XBRL structure
    # 3. Extracting financial facts (revenue, earnings, etc.)
    # 4. Returning structured dict
    logger.warning("XBRL parsing not yet implemented")
    return None
