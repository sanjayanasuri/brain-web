"""
API endpoints for Trails: Session paths and visual reasoning layer.

Phase 4: Lightweight navigation layer on top of the knowledge graph.
"""
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from neo4j import Session

from db_neo4j import get_neo4j_session
from services_branch_explorer import (
    ensure_graph_scoping_initialized,
    get_active_graph_context,
)
from services_trails import (
    create_trail,
    append_step,
    get_trail,
    archive_trail,
    resume_trail,
    trail_to_subgraph,
)

router = APIRouter(prefix="/trails", tags=["trails"])


class CreateTrailRequest(BaseModel):
    """Request to create a trail."""
    title: str
    graph_id: Optional[str] = None
    branch_id: Optional[str] = None
    pinned: bool = False


class CreateTrailResponse(BaseModel):
    """Response from trail creation."""
    trail_id: str
    title: str
    status: str


class AppendStepRequest(BaseModel):
    """Request to append a step to a trail."""
    kind: str = Field(..., description="'page'|'quote'|'concept'|'claim'|'search'")
    ref_id: str = Field(..., description="URL, quote_id, concept_id, claim_id, or query string")
    title: Optional[str] = None
    note: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None
    graph_id: Optional[str] = None
    branch_id: Optional[str] = None


class AppendStepResponse(BaseModel):
    """Response from step append."""
    step_id: str
    index: int


class TrailStep(BaseModel):
    """A trail step."""
    step_id: str
    index: int
    kind: str
    ref_id: str
    title: Optional[str] = None
    note: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None
    created_at: Optional[int] = None


class GetTrailResponse(BaseModel):
    """Response from get trail."""
    trail_id: str
    title: str
    status: str
    pinned: bool
    created_at: int
    updated_at: int
    steps: List[TrailStep]


class ResumeTrailResponse(BaseModel):
    """Response from resume trail."""
    trail_id: str
    status: str
    last_step_id: Optional[str] = None
    last_step_index: Optional[int] = None
    last_step_kind: Optional[str] = None
    last_step_ref_id: Optional[str] = None


class TrailToSubgraphRequest(BaseModel):
    """Request to convert trail to subgraph."""
    graph_id: Optional[str] = None
    branch_id: Optional[str] = None
    max_nodes: int = Field(50, ge=1, le=200)
    max_edges: int = Field(100, ge=1, le=500)


class SubgraphNode(BaseModel):
    """A subgraph node."""
    id: str
    label: str
    name: Optional[str] = None
    description: Optional[str] = None
    domain: Optional[str] = None
    text: Optional[str] = None
    quote_id: Optional[str] = None
    claim_id: Optional[str] = None
    confidence: Optional[float] = None


class SubgraphEdge(BaseModel):
    """A subgraph edge."""
    source_id: str
    target_id: str
    relationship_type: str
    confidence: Optional[float] = None
    justification: Optional[str] = None


class TrailToSubgraphResponse(BaseModel):
    """Response from trail to subgraph."""
    nodes: List[SubgraphNode]
    edges: List[SubgraphEdge]
    included_step_ids: List[str]


@router.post("/create", response_model=CreateTrailResponse)
def create_trail_endpoint(
    payload: CreateTrailRequest,
    session: Session = Depends(get_neo4j_session),
):
    """Create a new trail."""
    ensure_graph_scoping_initialized(session)
    
    if payload.graph_id and payload.branch_id:
        graph_id = payload.graph_id
        branch_id = payload.branch_id
    else:
        graph_id, branch_id = get_active_graph_context(session)
    
    result = create_trail(
        session=session,
        graph_id=graph_id,
        branch_id=branch_id,
        title=payload.title,
        pinned=payload.pinned
    )
    
    return CreateTrailResponse(
        trail_id=result["trail_id"],
        title=result["title"],
        status=result["status"]
    )


@router.post("/{trail_id}/append", response_model=AppendStepResponse)
def append_step_endpoint(
    trail_id: str,
    payload: AppendStepRequest,
    session: Session = Depends(get_neo4j_session),
):
    """Append a step to a trail."""
    ensure_graph_scoping_initialized(session)
    
    if payload.graph_id and payload.branch_id:
        graph_id = payload.graph_id
        branch_id = payload.branch_id
    else:
        graph_id, branch_id = get_active_graph_context(session)
    
    # Validate kind
    valid_kinds = ["page", "quote", "concept", "claim", "search"]
    if payload.kind not in valid_kinds:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid kind: {payload.kind}. Must be one of {valid_kinds}"
        )
    
    result = append_step(
        session=session,
        graph_id=graph_id,
        branch_id=branch_id,
        trail_id=trail_id,
        kind=payload.kind,
        ref_id=payload.ref_id,
        title=payload.title,
        note=payload.note,
        meta=payload.meta
    )
    
    return AppendStepResponse(
        step_id=result["step_id"],
        index=result["index"]
    )


@router.get("/{trail_id}", response_model=GetTrailResponse)
def get_trail_endpoint(
    trail_id: str,
    graph_id: Optional[str] = None,
    branch_id: Optional[str] = None,
    session: Session = Depends(get_neo4j_session),
):
    """Get a trail with all its steps."""
    ensure_graph_scoping_initialized(session)
    
    if graph_id and branch_id:
        pass  # Use provided
    else:
        graph_id, branch_id = get_active_graph_context(session)
    
    result = get_trail(
        session=session,
        graph_id=graph_id,
        branch_id=branch_id,
        trail_id=trail_id
    )
    
    if not result:
        raise HTTPException(status_code=404, detail=f"Trail {trail_id} not found")
    
    return GetTrailResponse(
        trail_id=result["trail_id"],
        title=result["title"],
        status=result["status"],
        pinned=result.get("pinned", False),
        created_at=result["created_at"],
        updated_at=result["updated_at"],
        steps=[TrailStep(**s) for s in result["steps"]]
    )


@router.post("/{trail_id}/archive")
def archive_trail_endpoint(
    trail_id: str,
    graph_id: Optional[str] = None,
    branch_id: Optional[str] = None,
    session: Session = Depends(get_neo4j_session),
):
    """Archive a trail."""
    ensure_graph_scoping_initialized(session)
    
    if graph_id and branch_id:
        pass
    else:
        graph_id, branch_id = get_active_graph_context(session)
    
    result = archive_trail(
        session=session,
        graph_id=graph_id,
        branch_id=branch_id,
        trail_id=trail_id
    )
    
    return result


@router.post("/{trail_id}/resume", response_model=ResumeTrailResponse)
def resume_trail_endpoint(
    trail_id: str,
    graph_id: Optional[str] = None,
    branch_id: Optional[str] = None,
    session: Session = Depends(get_neo4j_session),
):
    """Resume a trail (set active and return last step)."""
    ensure_graph_scoping_initialized(session)
    
    if graph_id and branch_id:
        pass
    else:
        graph_id, branch_id = get_active_graph_context(session)
    
    result = resume_trail(
        session=session,
        graph_id=graph_id,
        branch_id=branch_id,
        trail_id=trail_id
    )
    
    return ResumeTrailResponse(
        trail_id=result["trail_id"],
        status=result["status"],
        last_step_id=result.get("last_step_id"),
        last_step_index=result.get("last_step_index"),
        last_step_kind=result.get("last_step_kind"),
        last_step_ref_id=result.get("last_step_ref_id")
    )


@router.post("/{trail_id}/to_subgraph", response_model=TrailToSubgraphResponse)
def trail_to_subgraph_endpoint(
    trail_id: str,
    payload: TrailToSubgraphRequest,
    session: Session = Depends(get_neo4j_session),
):
    """Convert a trail to a subgraph (nodes and edges)."""
    ensure_graph_scoping_initialized(session)
    
    if payload.graph_id and payload.branch_id:
        graph_id = payload.graph_id
        branch_id = payload.branch_id
    else:
        graph_id, branch_id = get_active_graph_context(session)
    
    result = trail_to_subgraph(
        session=session,
        graph_id=graph_id,
        branch_id=branch_id,
        trail_id=trail_id,
        max_nodes=payload.max_nodes,
        max_edges=payload.max_edges
    )
    
    return TrailToSubgraphResponse(
        nodes=[SubgraphNode(**n) for n in result["nodes"]],
        edges=[SubgraphEdge(**e) for e in result["edges"]],
        included_step_ids=result["included_step_ids"]
    )


class TrailSummary(BaseModel):
    """Summary of a trail for listing."""
    trail_id: str
    title: str
    status: str
    pinned: bool
    created_at: int
    updated_at: int
    step_count: int


class ListTrailsResponse(BaseModel):
    """Response from list trails endpoint."""
    trails: List[TrailSummary]


@router.get("", response_model=ListTrailsResponse)
def list_trails_endpoint(
    status: Optional[str] = Query(None, description="Filter by status (e.g., 'active')"),
    limit: int = Query(10, ge=1, le=100, description="Maximum number of trails to return"),
    graph_id: Optional[str] = None,
    branch_id: Optional[str] = None,
    session: Session = Depends(get_neo4j_session),
):
    """List trails, optionally filtered by status."""
    ensure_graph_scoping_initialized(session)
    
    if graph_id and branch_id:
        pass  # Use provided
    else:
        graph_id, branch_id = get_active_graph_context(session)
    
    query = """
    MATCH (t:Trail {graph_id: $graph_id})
    WHERE $branch_id IN COALESCE(t.on_branches, [])
    """
    
    if status:
        query += " AND t.status = $status"
    
    query += """
    OPTIONAL MATCH (t)-[:HAS_STEP]->(s:TrailStep {graph_id: $graph_id})
    WHERE $branch_id IN COALESCE(s.on_branches, [])
    RETURN t.trail_id AS trail_id,
           t.title AS title,
           t.status AS status,
           t.pinned AS pinned,
           t.created_at AS created_at,
           t.updated_at AS updated_at,
           count(DISTINCT s) AS step_count
    ORDER BY t.updated_at DESC
    LIMIT $limit
    """
    
    params = {
        "graph_id": graph_id,
        "branch_id": branch_id,
        "limit": limit
    }
    if status:
        params["status"] = status
    
    result = session.run(query, **params)
    
    trails = []
    for record in result:
        trails.append(TrailSummary(
            trail_id=record["trail_id"],
            title=record["title"],
            status=record["status"],
            pinned=record.get("pinned", False),
            created_at=record["created_at"],
            updated_at=record["updated_at"],
            step_count=record.get("step_count", 0)
        ))
    
    return ListTrailsResponse(trails=trails)

