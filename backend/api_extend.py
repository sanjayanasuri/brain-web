"""
API endpoint for Extend system: Controlled Reasoning & Graph Expansion.

Phase 3: Provides three modes:
- Mode A: Suggest Connections (NO WRITES)
- Mode B: Generate Claims (WRITE, evidence-backed only)
- Mode C: Controlled Concept Expansion (WRITE, capped)
"""
from typing import List, Optional, Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from neo4j import Session

from db_neo4j import get_neo4j_session
from services_branch_explorer import (
    ensure_graph_scoping_initialized,
    get_active_graph_context,
)
from services_extend import (
    suggest_connections,
    generate_claims_from_quotes,
    controlled_expansion,
)

router = APIRouter(prefix="/extend", tags=["extend"])


class ExtendRequest(BaseModel):
    """Request for Extend operation."""
    mode: Literal["suggest_connections", "generate_claims", "controlled_expansion"]
    source_type: Literal["concept", "quote"]
    source_id: str = Field(..., description="Concept node_id or Quote quote_id")
    graph_id: Optional[str] = None
    branch_id: Optional[str] = None
    max_new_nodes: Optional[int] = Field(None, ge=1, le=5, description="Required for controlled_expansion mode")
    context: Optional[str] = Field(None, description="Optional user intent/context")
    # For generate_claims mode
    quote_ids: Optional[List[str]] = Field(None, description="Quote IDs for generate_claims mode")
    concept_id: Optional[str] = Field(None, description="Optional concept_id for generate_claims mode")
    trail_id: Optional[str] = None  # Phase 4: Optional trail to append steps to


class ConnectionSuggestion(BaseModel):
    """A suggested relationship connection."""
    source_concept_id: Optional[str] = None
    source_quote_id: Optional[str] = None
    target_concept_id: str
    target_concept_name: str
    relationship_type: str
    justification: str
    confidence: float
    evidence_quote_ids: List[str] = []


class CreatedClaim(BaseModel):
    """A created claim."""
    claim_id: str
    text: str
    confidence: float
    quote_id: str
    concept_ids: List[str]


class CreatedConcept(BaseModel):
    """A created concept."""
    node_id: str
    name: str
    description: Optional[str] = None


class CreatedRelationship(BaseModel):
    """A created relationship."""
    source_id: str
    target_id: str
    relationship_type: str
    justification: str
    confidence: float


class ExtendResponse(BaseModel):
    """Response from Extend operation."""
    mode: str
    status: str
    suggestions: List[ConnectionSuggestion] = []
    created_nodes: List[CreatedConcept] = []
    created_claims: List[CreatedClaim] = []
    created_relationships: List[CreatedRelationship] = []
    errors: List[str] = []


@router.post("", response_model=ExtendResponse)
def extend(
    payload: ExtendRequest,
    session: Session = Depends(get_neo4j_session),
):
    """
    Extend system: Controlled Reasoning & Graph Expansion.
    
    Three modes:
    1. suggest_connections: Returns relationship suggestions (NO WRITES)
    2. generate_claims: Creates claims from quotes (WRITE, evidence-backed)
    3. controlled_expansion: Creates new concepts (WRITE, capped)
    
    Args:
        payload: ExtendRequest with mode and source information
        session: Neo4j session
    
    Returns:
        ExtendResponse with results based on mode
    """
    ensure_graph_scoping_initialized(session)
    
    # Get graph/branch context
    if payload.graph_id and payload.branch_id:
        graph_id = payload.graph_id
        branch_id = payload.branch_id
    else:
        graph_id, branch_id = get_active_graph_context(session)
    
    # Validate mode-specific requirements
    if payload.mode == "controlled_expansion":
        if payload.max_new_nodes is None:
            raise HTTPException(
                status_code=400,
                detail="max_new_nodes is required for controlled_expansion mode"
            )
        if payload.source_type != "concept":
            raise HTTPException(
                status_code=400,
                detail="controlled_expansion requires source_type='concept'"
            )
    
    if payload.mode == "generate_claims":
        if payload.source_type != "quote" and not payload.quote_ids:
            raise HTTPException(
                status_code=400,
                detail="generate_claims requires quote_ids or source_type='quote'"
            )
    
    # Execute based on mode
    if payload.mode == "suggest_connections":
        suggestions = suggest_connections(
            session=session,
            graph_id=graph_id,
            branch_id=branch_id,
            source_type=payload.source_type,
            source_id=payload.source_id,
            context=payload.context
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
                    kind="search",
                    ref_id=f"extend:suggest_connections:{payload.source_id}",
                    title=f"Suggest connections from {payload.source_type}",
                    meta={"mode": "suggest_connections", "source_type": payload.source_type, "source_id": payload.source_id}
                )
            except Exception:
                pass  # Don't fail if trail append fails
        
        return ExtendResponse(
            mode="suggest_connections",
            status="ok",
            suggestions=[
                ConnectionSuggestion(**s) for s in suggestions
            ],
            errors=[]
        )
    
    elif payload.mode == "generate_claims":
        # Determine quote IDs
        quote_ids = payload.quote_ids or []
        if payload.source_type == "quote":
            quote_ids = [payload.source_id] + quote_ids
        
        if not quote_ids:
            raise HTTPException(
                status_code=400,
                detail="No quote IDs provided for generate_claims mode"
            )
        
        created_claims, errors = generate_claims_from_quotes(
            session=session,
            graph_id=graph_id,
            branch_id=branch_id,
            quote_ids=quote_ids,
            concept_id=payload.concept_id
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
                    kind="search",
                    ref_id=f"extend:generate_claims:{','.join(quote_ids[:3])}",
                    title=f"Generate claims from {len(quote_ids)} quotes",
                    meta={"mode": "generate_claims", "quote_ids": quote_ids, "claims_created": len(created_claims)}
                )
                # Append steps for created claims
                for claim in created_claims:
                    append_step(
                        session=session,
                        graph_id=graph_id,
                        branch_id=branch_id,
                        trail_id=payload.trail_id,
                        kind="claim",
                        ref_id=claim["claim_id"],
                        title=claim["text"][:100] if len(claim["text"]) > 100 else claim["text"],
                    )
            except Exception:
                pass  # Don't fail if trail append fails
        
        return ExtendResponse(
            mode="generate_claims",
            status="ok" if created_claims else "error",
            created_claims=[
                CreatedClaim(**c) for c in created_claims
            ],
            errors=errors
        )
    
    elif payload.mode == "controlled_expansion":
        created_concepts, created_relationships, errors = controlled_expansion(
            session=session,
            graph_id=graph_id,
            branch_id=branch_id,
            concept_id=payload.source_id,
            max_new_nodes=payload.max_new_nodes,
            context=payload.context
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
                    kind="search",
                    ref_id=f"extend:controlled_expansion:{payload.source_id}",
                    title=f"Expand concept (created {len(created_concepts)} concepts)",
                    meta={"mode": "controlled_expansion", "source_id": payload.source_id, "concepts_created": len(created_concepts)}
                )
                # Append steps for created concepts
                for concept in created_concepts:
                    append_step(
                        session=session,
                        graph_id=graph_id,
                        branch_id=branch_id,
                        trail_id=payload.trail_id,
                        kind="concept",
                        ref_id=concept["node_id"],
                        title=concept["name"],
                    )
            except Exception:
                pass  # Don't fail if trail append fails
        
        return ExtendResponse(
            mode="controlled_expansion",
            status="ok" if created_concepts else "error",
            created_nodes=[
                CreatedConcept(**c) for c in created_concepts
            ],
            created_relationships=[
                CreatedRelationship(**r) for r in created_relationships
            ],
            errors=errors
        )
    
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown mode: {payload.mode}"
        )

