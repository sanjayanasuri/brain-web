"""
Base connector interface and document model for finance data ingestion.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional, Dict, Any, List
from datetime import datetime


@dataclass
class SourceDocument:
    """
    Standardized document model for finance ingestion.
    All connectors output this format.
    """
    source_type: str  # "SEC_EDGAR" | "IR" | "NEWS_RSS"
    doc_type: str  # "10K" | "10Q" | "8K" | "PRESS_RELEASE" | "SHAREHOLDER_LETTER" | "NEWS"
    ticker: str
    company_name: Optional[str] = None
    title: str = ""
    published_at: Optional[str] = None  # ISO format datetime string
    url: str = ""
    external_id: str = ""  # Deterministic ID for idempotency
    raw_text: str = ""  # Main extracted text
    metadata: Optional[Dict[str, Any]] = None  # Additional metadata (CIK, accession, etc.)


class BaseConnector(ABC):
    """
    Abstract base class for finance data connectors.
    All connectors must implement the fetch method.
    """
    
    @property
    @abstractmethod
    def name(self) -> str:
        """Return the connector name (e.g., 'edgar', 'ir', 'news')."""
        pass
    
    @abstractmethod
    def fetch(
        self,
        ticker: str,
        company: Dict[str, Any],
        since_days: int,
        limit: int
    ) -> List[SourceDocument]:
        """
        Fetch documents for a given company.
        
        Args:
            ticker: Company ticker symbol (e.g., "NVDA")
            company: Company config dict with connector-specific settings
            since_days: Number of days to look back
            limit: Maximum number of documents to fetch
        
        Returns:
            List of SourceDocument objects
        """
        pass
