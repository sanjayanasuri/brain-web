"""
Base interfaces for vertical-specific retrieval.
"""
from dataclasses import dataclass
from typing import Dict, Any, Optional, Literal, List

VerticalName = Literal["general", "finance"]


@dataclass
class RetrievalRequest:
    """Request for vertical-specific context retrieval."""
    graph_id: str
    branch_id: str
    query: str
    vertical: VerticalName = "general"
    lens: Optional[str] = None
    recency_days: Optional[int] = None
    evidence_strictness: Literal["high", "medium", "low"] = "medium"
    include_proposed_edges: bool = True
    max_communities: int = 5
    max_claims_per_community: int = 20
    max_concepts: int = 50


@dataclass
class RetrievalResult:
    """Result from vertical-specific context retrieval."""
    mode: str
    vertical: str
    lens: str
    context_text: str
    meta: Dict[str, Any]
