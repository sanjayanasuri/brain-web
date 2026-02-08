from fastapi import APIRouter, Depends, BackgroundTasks
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
from fastapi.responses import StreamingResponse
from openai import OpenAI
from config import OPENAI_API_KEY
import json
import logging

logger = logging.getLogger("brain_web")

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


    return StreamingResponse(generate_stream(), media_type="text/event-stream")


@router.post("/chat/stream")
async def chat_stream_endpoint(
    payload: AIChatRequest,
    background_tasks: BackgroundTasks,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """
    Streaming AI chat endpoint using Server-Sent Events (SSE).
    """
    # Trigger notes digest update in background
    if payload.chat_id:
        try:
            from services_notes_digest import update_notes_digest
            background_tasks.add_task(
                update_notes_digest,
                chat_id=payload.chat_id,
                trigger_source="chat_message"
            )
        except Exception as e:
            logger.error(f"Failed to queue notes digest update: {e}")

    async def generate_stream():
        try:
            if not OPENAI_API_KEY:
                error_msg = {"type": "error", "content": "OpenAI API Key not missing"}
                yield f"data: {json.dumps(error_msg)}\n\n"
                return

            client = OpenAI(api_key=OPENAI_API_KEY)
            
            # Simple prompt for now - in future, retrieve context here using graphrag
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "You are a helpful assistant for Brain Web."},
                    {"role": "user", "content": payload.message}
                ],
                stream=True
            )
            
            for chunk in response:
                content = chunk.choices[0].delta.content
                if content:
                    data = {"type": "chunk", "content": content}
                    yield f"data: {json.dumps(data)}\n\n"
            
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            
        except Exception as e:
            logger.error(f"Streaming error: {e}")
            error_data = {"type": "error", "content": str(e)}
            yield f"data: {json.dumps(error_data)}\n\n"

    return StreamingResponse(generate_stream(), media_type="text/event-stream")


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


class AssessmentRequest(BaseModel):
    action: str  # "probe", "evaluate", "contextual_probe"
    concept_name: Optional[str] = None
    concept_id: Optional[str] = None
    current_mastery: Optional[int] = 0
    graph_id: str
    # specific to evaluate
    question: Optional[str] = None
    user_answer: Optional[str] = None
    # specific to probe
    history: Optional[List[dict]] = []
    # specific to contextual_probe
    text_selection: Optional[str] = None
    context: Optional[str] = None

class AssessmentResponse(BaseModel):
    mastery_score: int
    feedback: str
    next_question: Optional[str] = None
    concepts_discussed: List[str] = []

@router.post("/assess", response_model=AssessmentResponse)
def assess_endpoint(
    payload: AssessmentRequest,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """
    Assessment Agent Endpoint.
    - action="probe": Generate a probing question.
    - action="evaluate": Grade answer and update mastery.
    - action="contextual_probe": Socratic questioning based on highlighted text.
    """
    from agents.assessment import AssessmentAgent
    from services_graph import update_concept_mastery, get_concept_mastery
    
    agent = AssessmentAgent()
    
    if payload.action == "probe":
        if not payload.concept_name:
            raise ValueError("concept_name required for probe")
        
        # Fetch real mastery if not explicitly provided (or trusted)
        real_mastery = get_concept_mastery(session, payload.graph_id, payload.concept_name)
            
        question = agent.generate_probe(
            payload.concept_name, 
            real_mastery, 
            payload.history or []
        )
        return AssessmentResponse(
            mastery_score=real_mastery,
            feedback="",
            next_question=question
        )
        
    elif payload.action == "contextual_probe":
        if not payload.text_selection:
            raise ValueError("text_selection required for contextual_probe")
        
        # We try to use the selection as a proxy for concept name lookup
        # Ideally we'd use entity extraction, but for now exact match or 0
        real_mastery = get_concept_mastery(session, payload.graph_id, payload.text_selection)
            
        question = agent.contextual_probe(
            payload.text_selection,
            payload.context or "",
            real_mastery
        )
        return AssessmentResponse(
            mastery_score=real_mastery,
            feedback="",
            next_question=question
        )
        
    elif payload.action == "evaluate":
        if not payload.concept_name:
             # Try to infer concept name if missing? For now require it or default.
             # In a real flow, evaluate comes after probe, so we should know the concept.
             pass

        if not payload.question or not payload.user_answer:
            raise ValueError("question and user_answer required for evaluation")
            
        result = agent.evaluate_response(
            payload.concept_name or "Unknown Concept",
            payload.question,
            payload.user_answer,
            payload.current_mastery or 0
        )
        
        # Persist new mastery
        if payload.concept_id:
            update_concept_mastery(
                session, 
                payload.graph_id, 
                payload.concept_id, 
                result.mastery_score
            )
        
        return AssessmentResponse(
            mastery_score=result.mastery_score,
            feedback=result.feedback,
            next_question=result.next_question,
            concepts_discussed=result.concepts_discussed
        )
    
    else:
        raise ValueError(f"Unknown action: {payload.action}")
