# AI chat, semantic search, GraphRAG, and intent-based retrieval models.
from typing import Optional, List, Dict, Any

from pydantic import BaseModel
from enum import Enum

from .concept import Concept


class AIChatRequest(BaseModel):
    message: str
    chat_id: Optional[str] = None
    context: Optional[dict] = None
    chatHistory: Optional[List[Dict[str, Any]]] = None
    chat_history: Optional[List[Dict[str, Any]]] = None


class AIChatResponse(BaseModel):
    reply: str


class SemanticSearchRequest(BaseModel):
    message: str
    limit: int = 5


class SemanticSearchResponse(BaseModel):
    nodes: List[Concept]
    scores: List[float]


class SemanticSearchCommunitiesRequest(BaseModel):
    message: str
    limit: int = 5
    graph_id: str
    branch_id: str


class CommunitySearchResult(BaseModel):
    community_id: str
    name: str
    score: float
    summary: Optional[str] = None


class SemanticSearchCommunitiesResponse(BaseModel):
    communities: List[CommunitySearchResult]


class GraphRAGContextRequest(BaseModel):
    message: str
    graph_id: str
    branch_id: str
    recency_days: Optional[int] = None
    evidence_strictness: Optional[str] = "medium"
    include_proposed_edges: Optional[bool] = True


class GraphRAGContextResponse(BaseModel):
    context_text: str
    debug: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None
    citations: Optional[List[Dict[str, Any]]] = None


class Intent(str, Enum):
    DEFINITION_OVERVIEW = "DEFINITION_OVERVIEW"
    TIMELINE = "TIMELINE"
    CAUSAL_CHAIN = "CAUSAL_CHAIN"
    COMPARE = "COMPARE"
    WHO_NETWORK = "WHO_NETWORK"
    EVIDENCE_CHECK = "EVIDENCE_CHECK"
    EXPLORE_NEXT = "EXPLORE_NEXT"
    WHAT_CHANGED = "WHAT_CHANGED"
    SELF_KNOWLEDGE = "SELF_KNOWLEDGE"


class RetrievalTraceStep(BaseModel):
    step: str
    params: Dict[str, Any] = {}
    counts: Dict[str, Any] = {}


class RetrievalResult(BaseModel):
    intent: str
    trace: List[RetrievalTraceStep]
    context: Dict[str, Any]
    citations: Optional[List[Dict[str, Any]]] = None
    plan_version: str = "intent_plans_v1"


class IntentResult(BaseModel):
    intent: str
    confidence: float
    reasoning: str


class RetrievalRequest(BaseModel):
    message: str
    mode: str = "graphrag"
    limit: int = 5
    intent: Optional[str] = None
    graph_id: Optional[str] = None
    branch_id: Optional[str] = None
    detail_level: str = "summary"
    limit_claims: Optional[int] = None
    limit_entities: Optional[int] = None
    limit_sources: Optional[int] = None
    trail_id: Optional[str] = None
    focus_concept_id: Optional[str] = None
    focus_quote_id: Optional[str] = None
    focus_page_url: Optional[str] = None
