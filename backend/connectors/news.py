"""
News connector with pluggable provider interface.
"""
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class NewsProvider(ABC):
    """Base class for news providers."""
    
    @abstractmethod
    def fetch_articles(
        self,
        ticker: str,
        since_ts: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Fetch news articles for a ticker.
        
        Args:
            ticker: Stock ticker symbol
            since_ts: Optional Unix timestamp to fetch articles since
        
        Returns:
            List of article dicts with:
            - external_id: str (unique identifier)
            - url: str
            - title: str
            - published_at: int (Unix timestamp)
            - text: Optional[str] (article body if available)
        """
        pass


class PlaceholderNewsProvider(NewsProvider):
    """
    Placeholder news provider that can be swapped with real providers later.
    For now, returns empty list or can be configured to use a simple endpoint.
    """
    
    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None):
        """
        Initialize placeholder provider.
        
        Args:
            api_key: Optional API key for future use
            base_url: Optional base URL for future use
        """
        self.api_key = api_key
        self.base_url = base_url or "https://api.example.com/news"  # Placeholder
    
    def fetch_articles(
        self,
        ticker: str,
        since_ts: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Placeholder implementation.
        Returns empty list for now.
        
        Future implementations could:
        - Use GDELT API
        - Use NewsAPI
        - Use Alpha Vantage News
        - Use custom news aggregator
        """
        logger.info(f"PlaceholderNewsProvider: fetch_articles({ticker}, since_ts={since_ts}) - returning empty list")
        return []


class GDELTLikeProvider(NewsProvider):
    """
    GDELT-like provider (placeholder for future implementation).
    GDELT provides global news data but requires significant setup.
    This is a placeholder that can be implemented later.
    """
    
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key
    
    def fetch_articles(
        self,
        ticker: str,
        since_ts: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Placeholder for GDELT-like implementation.
        
        Future implementation would:
        1. Query GDELT API or BigQuery for news articles
        2. Filter by ticker/company name
        3. Filter by date if since_ts provided
        4. Return structured article data
        """
        logger.info(f"GDELTLikeProvider: fetch_articles({ticker}, since_ts={since_ts}) - not yet implemented")
        return []


# Default provider instance
_default_provider: Optional[NewsProvider] = None


def get_default_provider() -> NewsProvider:
    """Get the default news provider."""
    global _default_provider
    if _default_provider is None:
        _default_provider = PlaceholderNewsProvider()
    return _default_provider


def set_default_provider(provider: NewsProvider) -> None:
    """Set the default news provider."""
    global _default_provider
    _default_provider = provider


def fetch_articles(
    ticker: str,
    since_ts: Optional[int] = None,
    provider: Optional[NewsProvider] = None
) -> List[Dict[str, Any]]:
    """
    Fetch news articles for a ticker using the specified or default provider.
    
    Args:
        ticker: Stock ticker symbol
        since_ts: Optional Unix timestamp
        provider: Optional provider instance (uses default if not provided)
    
    Returns:
        List of article dicts
    """
    if provider is None:
        provider = get_default_provider()
    
    return provider.fetch_articles(ticker, since_ts)
