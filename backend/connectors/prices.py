"""
Price data connector with pluggable provider interface.
"""
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class PriceProvider(ABC):
    """Base class for price data providers."""
    
    @abstractmethod
    def fetch_price_data(
        self,
        ticker: str,
        since_ts: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Fetch price data for a ticker.
        
        Args:
            ticker: Stock ticker symbol
            since_ts: Optional Unix timestamp to fetch data since
        
        Returns:
            List of price point dicts with:
            - external_id: str (unique identifier, e.g., "NVDA_2024-01-15")
            - date: str (YYYY-MM-DD)
            - timestamp: int (Unix timestamp)
            - open: float
            - high: float
            - low: float
            - close: float
            - volume: int
        """
        pass


class PlaceholderPriceProvider(PriceProvider):
    """
    Placeholder price provider that can be swapped with real providers later.
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
        self.base_url = base_url or "https://api.example.com/prices"  # Placeholder
    
    def fetch_price_data(
        self,
        ticker: str,
        since_ts: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Placeholder implementation.
        Returns empty list for now.
        
        Future implementations could:
        - Use Alpha Vantage API
        - Use Yahoo Finance API
        - Use IEX Cloud
        - Use Polygon.io
        - Use custom price data endpoint
        """
        logger.info(f"PlaceholderPriceProvider: fetch_price_data({ticker}, since_ts={since_ts}) - returning empty list")
        return []


# Default provider instance
_default_provider: Optional[PriceProvider] = None


def get_default_provider() -> PriceProvider:
    """Get the default price provider."""
    global _default_provider
    if _default_provider is None:
        _default_provider = PlaceholderPriceProvider()
    return _default_provider


def set_default_provider(provider: PriceProvider) -> None:
    """Set the default price provider."""
    global _default_provider
    _default_provider = provider


def fetch_price_data(
    ticker: str,
    since_ts: Optional[int] = None,
    provider: Optional[PriceProvider] = None
) -> List[Dict[str, Any]]:
    """
    Fetch price data for a ticker using the specified or default provider.
    
    Args:
        ticker: Stock ticker symbol
        since_ts: Optional Unix timestamp
        provider: Optional provider instance (uses default if not provided)
    
    Returns:
        List of price point dicts
    """
    if provider is None:
        provider = get_default_provider()
    
    return provider.fetch_price_data(ticker, since_ts)
