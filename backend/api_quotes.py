"""
API endpoints for Quote management and Evidence Graph relationships.
"""
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from neo4j import Session

from db_neo4j import get_neo4j_session
from services_branch_explorer import (
    ensure_graph_scoping_initialized,
    get_active_graph_context,
)
from services_graph import (
    get_concept_by_id,
    get_concept_by_name,
    link_concept_has_quote,
)
from models import Concept

router = APIRouter(prefix="/quotes", tags=["quotes"])


class QuoteAttachRequest(BaseModel):
    """Request to attach a quote to a concept."""
    quote_id: str
    concept_id: Optional[str] = None  # Use concept_id if available
    concept_name: Optional[str] = None  # Use concept_name if concept_id not provided
    graph_id: Optional[str] = None  # Optional: override active graph
    branch_id: Optional[str] = None  # Optional: override active branch
    trail_id: Optional[str] = None  # Phase 4: Optional trail to append steps to


class QuoteAttachResponse(BaseModel):
    """Response from quote attach endpoint."""
    success: bool
    quote_id: str
    concept_id: str
    concept_name: str
    message: str


class QuoteDetachRequest(BaseModel):
    """Request to detach a quote from a concept."""
    quote_id: str
    concept_id: str
    graph_id: Optional[str] = None
    branch_id: Optional[str] = None


class QuoteDetachResponse(BaseModel):
    """Response from quote detach endpoint."""
    success: bool
    message: str


@router.post("/attach", response_model=QuoteAttachResponse)
def attach_quote_to_concept(
    payload: QuoteAttachRequest,
    session: Session = Depends(get_neo4j_session),
):
    """
    Attach a Quote to a Concept, creating (Concept)-[:HAS_QUOTE]->(Quote) relationship.
    
    Args:
        payload: QuoteAttachRequest with quote_id and either concept_id or concept_name
        session: Neo4j session
    
    Returns:
        QuoteAttachResponse with success status and concept details
    """
    ensure_graph_scoping_initialized(session)
    
    # Get graph/branch context
    if payload.graph_id and payload.branch_id:
        graph_id = payload.graph_id
        branch_id = payload.branch_id
    else:
        graph_id, branch_id = get_active_graph_context(session)
    
    # Resolve concept
    concept: Optional[Concept] = None
    if payload.concept_id:
        concept = get_concept_by_id(session, payload.concept_id)
        if not concept:
            raise HTTPException(
                status_code=404,
                detail=f"Concept with node_id '{payload.concept_id}' not found"
            )
    elif payload.concept_name:
        concept = get_concept_by_name(session, payload.concept_name)
        if not concept:
            raise HTTPException(
                status_code=404,
                detail=f"Concept with name '{payload.concept_name}' not found. Phase 2 does not auto-create concepts."
            )
    else:
        raise HTTPException(
            status_code=400,
            detail="Either concept_id or concept_name must be provided"
        )
    
    # Verify quote exists (basic check)
    quote_check_query = """
    MATCH (q:Quote {graph_id: $graph_id, quote_id: $quote_id})
    WHERE $branch_id IN COALESCE(q.on_branches, [])
    RETURN q.quote_id AS quote_id
    LIMIT 1
    """
    result = session.run(quote_check_query, graph_id=graph_id, branch_id=branch_id, quote_id=payload.quote_id)
    if not result.single():
        raise HTTPException(
            status_code=404,
            detail=f"Quote with quote_id '{payload.quote_id}' not found"
        )
    
    # Create relationship
    try:
        link_concept_has_quote(
            session=session,
            graph_id=graph_id,
            branch_id=branch_id,
            concept_id=concept.node_id,
            quote_id=payload.quote_id
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to attach quote to concept: {str(e)}"
        )
    
    # Append to trail if trail_id provided (Phase 4)
    if payload.trail_id:
        try:
            from services_trails import append_step
            append_step(
                session=session,
                graph_id=graph_id,
                branch_id=branch_id,
                trail_id=payload.trail_id,
                kind="concept",
                ref_id=concept.node_id,
                title=concept.name,
            )
            append_step(
                session=session,
                graph_id=graph_id,
                branch_id=branch_id,
                trail_id=payload.trail_id,
                kind="quote",
                ref_id=payload.quote_id,
            )
        except Exception:
            pass  # Don't fail if trail append fails
    
    return QuoteAttachResponse(
        success=True,
        quote_id=payload.quote_id,
        concept_id=concept.node_id,
        concept_name=concept.name,
        message=f"Quote {payload.quote_id} attached to concept {concept.name}"
    )


@router.post("/detach", response_model=QuoteDetachResponse)
def detach_quote_from_concept(
    payload: QuoteDetachRequest,
    session: Session = Depends(get_neo4j_session),
):
    """
    Detach a Quote from a Concept, removing (Concept)-[:HAS_QUOTE]->(Quote) relationship.
    
    Args:
        payload: QuoteDetachRequest with quote_id and concept_id
        session: Neo4j session
    
    Returns:
        QuoteDetachResponse with success status
    """
    ensure_graph_scoping_initialized(session)
    
    # Get graph/branch context
    if payload.graph_id and payload.branch_id:
        graph_id = payload.graph_id
        branch_id = payload.branch_id
    else:
        graph_id, branch_id = get_active_graph_context(session)
    
    # Delete relationship
    query = """
    MATCH (c:Concept {graph_id: $graph_id, node_id: $concept_id})-[r:HAS_QUOTE]->(q:Quote {graph_id: $graph_id, quote_id: $quote_id})
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND $branch_id IN COALESCE(q.on_branches, [])
    DELETE r
    RETURN count(r) AS deleted_count
    """
    result = session.run(
        query,
        graph_id=graph_id,
        branch_id=branch_id,
        concept_id=payload.concept_id,
        quote_id=payload.quote_id
    )
    record = result.single()
    deleted_count = record.data().get("deleted_count", 0) if record else 0
    
    if deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail=f"Relationship between concept {payload.concept_id} and quote {payload.quote_id} not found"
        )
    
    return QuoteDetachResponse(
        success=True,
        message=f"Quote {payload.quote_id} detached from concept {payload.concept_id}"
    )


class QuoteBySourceResponse(BaseModel):
    """Response for quotes by source URL."""
    quotes: List[Dict[str, Any]]


@router.get("/by_source", response_model=QuoteBySourceResponse)
def get_quotes_by_source(
    url: str,
    graph_id: Optional[str] = None,
    branch_id: Optional[str] = None,
    session: Session = Depends(get_neo4j_session),
):
    """
    Get all quotes from a source document by URL.
    
    Returns quotes with their anchors, text, attached concepts, and claim counts.
    """
    ensure_graph_scoping_initialized(session)
    
    if graph_id and branch_id:
        pass  # Use provided
    else:
        graph_id, branch_id = get_active_graph_context(session)
    
    query = """
    MATCH (d:SourceDocument {graph_id: $graph_id})
    WHERE d.url = $url
    MATCH (q:Quote {graph_id: $graph_id})-[r:QUOTED_FROM]->(d)
    WHERE $branch_id IN COALESCE(q.on_branches, [])
    OPTIONAL MATCH (c:Concept {graph_id: $graph_id})-[rel:HAS_QUOTE]->(q)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
    OPTIONAL MATCH (claim:Claim {graph_id: $graph_id})-[ev:EVIDENCED_BY]->(q)
    WHERE $branch_id IN COALESCE(claim.on_branches, [])
    RETURN q.quote_id AS quote_id,
           q.text AS text,
           q.anchor AS anchor,
           q.captured_at AS captured_at,
           collect(DISTINCT {name: c.name, node_id: c.node_id}) AS attached_concepts,
           count(DISTINCT claim) AS claim_count
    """
    
    result = session.run(
        query,
        graph_id=graph_id,
        branch_id=branch_id,
        url=url
    )
    
    quotes = []
    for record in result:
        quotes.append({
            "quote_id": record["quote_id"],
            "text": record["text"],
            "anchor": record["anchor"],
            "captured_at": record.get("captured_at"),
            "attached_concepts": [c for c in record.get("attached_concepts", []) if c],
            "claim_count": record.get("claim_count", 0)
        })
    
    return QuoteBySourceResponse(quotes=quotes)

