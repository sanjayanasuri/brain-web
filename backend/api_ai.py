from fastapi import APIRouter, Depends
from pydantic import BaseModel
import hashlib
from models import (
    AIChatRequest, AIChatResponse,
    SemanticSearchRequest, SemanticSearchResponse,
    SemanticSearchCommunitiesRequest, SemanticSearchCommunitiesResponse,
    GraphRAGContextRequest, GraphRAGContextResponse,
)
from db_neo4j import get_neo4j_session
from services_search import semantic_search_nodes
from services_graphrag import semantic_search_communities, retrieve_graphrag_context, retrieve_context
from services_graph import get_evidence_subgraph
from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context
from verticals.base import RetrievalRequest
from cache_utils import get_cached, set_cached
from typing import List, Optional
from auth import require_auth

router = APIRouter(prefix="/ai", tags=["ai"])


class EvidenceSubgraphRequest(BaseModel):
    graph_id: str
    claim_ids: List[str]
    limit_nodes: int = 10
    limit_edges: int = 15


@router.post("/chat", response_model=AIChatResponse)
def ai_chat(payload: AIChatRequest, auth: dict = Depends(require_auth)):
    """
    Stub endpoint for AI chat.

    Later, this will:
      - Call LLM with tools for graph operations
      - Execute operations
      - Return summary + maybe diff
    """
    # For now, just echo back
    return AIChatResponse(reply=f"You said: {payload.message}")


@router.post("/semantic-search", response_model=SemanticSearchResponse)
def semantic_search(
    payload: SemanticSearchRequest,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """
    Performs semantic search over the knowledge graph.
    Returns the most relevant nodes based on the query.
    """
    results = semantic_search_nodes(payload.message, session, payload.limit)
    return SemanticSearchResponse(
        nodes=[r["node"] for r in results],
        scores=[r["score"] for r in results]
    )


@router.post("/semantic-search-communities", response_model=SemanticSearchCommunitiesResponse)
def semantic_search_communities_endpoint(
    payload: SemanticSearchCommunitiesRequest,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """
    Performs semantic search over communities using summary embeddings.
    Returns the most relevant communities based on the query.
    """
    results = semantic_search_communities(
        session=session,
        graph_id=payload.graph_id,
        branch_id=payload.branch_id,
        query=payload.message,
        limit=payload.limit
    )
    
    from models import CommunitySearchResult
    communities = [
        CommunitySearchResult(
            community_id=r["community_id"],
            name=r["name"],
            score=r["score"],
            summary=r.get("summary")
        )
        for r in results
    ]
    
    return SemanticSearchCommunitiesResponse(communities=communities)


@router.post("/graphrag-context", response_model=GraphRAGContextResponse)
def graphrag_context_endpoint(
    payload: GraphRAGContextRequest,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """
    Retrieves GraphRAG context: communities -> claims -> evidence subgraph.
    Returns formatted context text and debug information.
    
    Supports vertical-specific retrieval (e.g., finance) with lens routing.
    Cached for 5 minutes to improve performance for repeated queries.
    """
    # Build cache key from query parameters
    # Use a hash of the message to keep cache keys reasonable length
    message_hash = hashlib.md5(payload.message.encode()).hexdigest()[:8]
    cache_key = (
        "graphrag_context",
        payload.graph_id or "",
        payload.branch_id or "",
        message_hash,
        payload.vertical or "general",
        payload.lens or "",
        payload.recency_days or 0,
        payload.evidence_strictness or "medium",
        payload.include_proposed_edges if payload.include_proposed_edges is not None else True,
    )
    
    # Try cache first (5 minute TTL for expensive GraphRAG operations)
    cached_result = get_cached(*cache_key, ttl_seconds=300)
    if cached_result is not None:
        return GraphRAGContextResponse(**cached_result)
    
    # Build RetrievalRequest
    req = RetrievalRequest(
        graph_id=payload.graph_id,
        branch_id=payload.branch_id,
        query=payload.message,
        vertical=payload.vertical or "general",
        lens=payload.lens,
        recency_days=payload.recency_days,
        evidence_strictness=payload.evidence_strictness or "medium",
        include_proposed_edges=payload.include_proposed_edges if payload.include_proposed_edges is not None else True,
    )
    
    # Route to vertical-specific retrieval or fallback to classic
    if req.vertical == "finance":
        result = retrieve_context(req, session)
        response = GraphRAGContextResponse(
            context_text=result.context_text,
            debug={
                "communities": len(result.meta.get("communities", [])),
                "claims": result.meta.get("claim_counts", {}).get("after_strictness", 0),
                "concepts": result.meta.get("concepts", 0),
                "edges": result.meta.get("edges", 0),
            },
            meta=result.meta
        )
    else:
        # Backwards compatibility: use existing retrieve_graphrag_context
        context = retrieve_graphrag_context(
            session=session,
            graph_id=payload.graph_id,
            branch_id=payload.branch_id,
            question=payload.message,
            evidence_strictness=payload.evidence_strictness or "medium",
        )
        
        # Build debug info
        debug = {
            "communities": len(context["communities"]),
            "claims": len(context["claims"]),
            "concepts": len(context["concepts"]),
            "edges": len(context["edges"]),
            "has_evidence": context.get("has_evidence", True),
        }
        
        response = GraphRAGContextResponse(
            context_text=context["context_text"],
            debug=debug
        )
    
    # Cache the result
    set_cached(cache_key[0], response.dict(), *cache_key[1:], ttl_seconds=300)
    return response


@router.post("/evidence-subgraph")
def evidence_subgraph_endpoint(
    payload: EvidenceSubgraphRequest,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """
    Get evidence subgraph for given claim IDs.
    Returns concepts and edges that support the claims.
    
    Args:
        payload: EvidenceSubgraphRequest with graph_id, claim_ids, and limits
    """
    ensure_graph_scoping_initialized(session)
    _, branch_id = get_active_graph_context(session)
    
    subgraph = get_evidence_subgraph(
        session=session,
        graph_id=payload.graph_id,
        claim_ids=payload.claim_ids,
        max_concepts=payload.limit_nodes,
        include_proposed="auto"
    )
    
    # Apply edge limit
    edges = subgraph.get("edges", [])[:payload.limit_edges]
    
    return {
        "concepts": subgraph.get("concepts", [])[:payload.limit_nodes],
        "edges": edges,
    }
