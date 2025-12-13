from fastapi import APIRouter, Depends
from models import AIChatRequest, AIChatResponse, SemanticSearchRequest, SemanticSearchResponse
from db_neo4j import get_neo4j_session
from services_search import semantic_search_nodes

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/chat", response_model=AIChatResponse)
def ai_chat(payload: AIChatRequest):
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
def semantic_search(payload: SemanticSearchRequest, session=Depends(get_neo4j_session)):
    """
    Performs semantic search over the knowledge graph.
    Returns the most relevant nodes based on the query.
    """
    results = semantic_search_nodes(payload.message, session, payload.limit)
    return SemanticSearchResponse(
        nodes=[r["node"] for r in results],
        scores=[r["score"] for r in results]
    )
