"""
API endpoints for reviewing proposed relationships.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional
from neo4j import Session

from db_neo4j import get_neo4j_session
from models import (
    RelationshipReviewListResponse,
    RelationshipReviewItem,
    RelationshipAcceptRequest,
    RelationshipRejectRequest,
    RelationshipEditRequest,
    RelationshipReviewActionResponse,
    MergeCandidateListResponse,
    MergeCandidateItem,
    MergeCandidateAcceptRequest,
    MergeCandidateRejectRequest,
    MergeExecuteRequest,
    MergeExecuteResponse,
)
from services_graph import (
    get_proposed_relationships,
    accept_relationships,
    reject_relationships,
    edit_relationship,
    list_merge_candidates,
    set_merge_candidate_status,
)
from services_entity_resolution import merge_concepts
from services_logging import log_relationship_review, log_entity_merge
from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context

router = APIRouter(prefix="/review", tags=["review"])


@router.get("/relationships", response_model=RelationshipReviewListResponse)
def list_proposed_relationships(
    graph_id: str = Query(..., description="Graph ID (required)"),
    status: str = Query("PROPOSED", description="Filter by status (PROPOSED, ACCEPTED, REJECTED)"),
    limit: int = Query(50, ge=1, le=200, description="Maximum number of relationships to return"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    ingestion_run_id: Optional[str] = Query(None, description="Filter by ingestion run ID (optional)"),
    include_archived: bool = Query(False, description="Include archived relationships (default: false)"),
    session: Session = Depends(get_neo4j_session),
):
    """
    List relationships for review.
    
    Returns relationships between Concepts filtered by status.
    Default status is PROPOSED (pending review).
    Optionally filter by ingestion_run_id to see relationships from a specific run.
    Archived relationships are excluded by default.
    """
    try:
        ensure_graph_scoping_initialized(session)
        relationships = get_proposed_relationships(
            session=session,
            graph_id=graph_id,
            status=status,
            limit=limit,
            offset=offset,
            ingestion_run_id=ingestion_run_id,
            include_archived=include_archived,
        )
        return RelationshipReviewListResponse(
            relationships=relationships,
            total=len(relationships),
            graph_id=graph_id,
            status=status,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list relationships: {str(e)}")


@router.post("/relationships/accept", response_model=RelationshipReviewActionResponse)
def accept_relationships_endpoint(
    payload: RelationshipAcceptRequest,
    session: Session = Depends(get_neo4j_session),
):
    """
    Accept one or more proposed relationships.
    
    Sets status to ACCEPTED and records review metadata.
    """
    try:
        ensure_graph_scoping_initialized(session)
        graph_id, branch_id = get_active_graph_context(session)
        
        # Override graph_id from payload if provided, otherwise use active context
        target_graph_id = payload.graph_id or graph_id
        
        # Convert Pydantic models to dicts
        edges_dict = [edge.dict() for edge in payload.edges]
        
        accepted = accept_relationships(
            session=session,
            graph_id=target_graph_id,
            edges=edges_dict,
            reviewed_by=payload.reviewed_by,
        )
        
        # Log each accepted relationship
        for edge in payload.edges:
            log_relationship_review(
                action="accept",
                graph_id=target_graph_id,
                src_node_id=edge.src_node_id,
                dst_node_id=edge.dst_node_id,
                rel_type=edge.rel_type,
                prior_status="PROPOSED",
                reviewer=payload.reviewed_by,
            )
        
        return RelationshipReviewActionResponse(
            status="ok",
            action="accept",
            count=accepted,
            graph_id=target_graph_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to accept relationships: {str(e)}")


@router.post("/relationships/reject", response_model=RelationshipReviewActionResponse)
def reject_relationships_endpoint(
    payload: RelationshipRejectRequest,
    session: Session = Depends(get_neo4j_session),
):
    """
    Reject one or more proposed relationships.
    
    Sets status to REJECTED and records review metadata.
    """
    try:
        ensure_graph_scoping_initialized(session)
        graph_id, branch_id = get_active_graph_context(session)
        
        # Override graph_id from payload if provided, otherwise use active context
        target_graph_id = payload.graph_id or graph_id
        
        # Convert Pydantic models to dicts
        edges_dict = [edge.dict() for edge in payload.edges]
        
        rejected = reject_relationships(
            session=session,
            graph_id=target_graph_id,
            edges=edges_dict,
            reviewed_by=payload.reviewed_by,
        )
        
        # Log each rejected relationship
        for edge in payload.edges:
            log_relationship_review(
                action="reject",
                graph_id=target_graph_id,
                src_node_id=edge.src_node_id,
                dst_node_id=edge.dst_node_id,
                rel_type=edge.rel_type,
                prior_status="PROPOSED",
                reviewer=payload.reviewed_by,
            )
        
        return RelationshipReviewActionResponse(
            status="ok",
            action="reject",
            count=rejected,
            graph_id=target_graph_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reject relationships: {str(e)}")


@router.post("/relationships/edit", response_model=RelationshipReviewActionResponse)
def edit_relationship_endpoint(
    payload: RelationshipEditRequest,
    session: Session = Depends(get_neo4j_session),
):
    """
    Edit a relationship by changing its type.
    
    Marks the old relationship as REJECTED and creates a new one with the new type.
    """
    try:
        ensure_graph_scoping_initialized(session)
        graph_id, branch_id = get_active_graph_context(session)
        
        # Override graph_id from payload if provided, otherwise use active context
        target_graph_id = payload.graph_id or graph_id
        
        edited = edit_relationship(
            session=session,
            graph_id=target_graph_id,
            src_node_id=payload.src_node_id,
            dst_node_id=payload.dst_node_id,
            old_rel_type=payload.old_rel_type,
            new_rel_type=payload.new_rel_type,
            reviewed_by=payload.reviewed_by,
        )
        
        # Log the edit action
        log_relationship_review(
            action="edit",
            graph_id=target_graph_id,
            src_node_id=payload.src_node_id,
            dst_node_id=payload.dst_node_id,
            rel_type=payload.new_rel_type,
            prior_status="PROPOSED",
            reviewer=payload.reviewed_by,
            metadata={
                "old_rel_type": payload.old_rel_type,
                "new_rel_type": payload.new_rel_type,
            },
        )
        
        return RelationshipReviewActionResponse(
            status="ok",
            action="edit",
            count=1 if edited else 0,
            graph_id=target_graph_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to edit relationship: {str(e)}")


# ---------- Entity Merge Review Endpoints ----------

@router.get("/merges", response_model=MergeCandidateListResponse)
def list_merge_candidates_endpoint(
    graph_id: str = Query(..., description="Graph ID (required)"),
    status: str = Query("PROPOSED", description="Filter by status (PROPOSED, ACCEPTED, REJECTED)"),
    limit: int = Query(50, ge=1, le=200, description="Maximum number of candidates to return"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    session: Session = Depends(get_neo4j_session),
):
    """
    List merge candidates for review.
    
    Returns candidates filtered by status.
    Default status is PROPOSED (pending review).
    """
    try:
        ensure_graph_scoping_initialized(session)
        candidates = list_merge_candidates(
            session=session,
            graph_id=graph_id,
            status=status,
            limit=limit,
            offset=offset,
        )
        
        # Convert to Pydantic models
        candidate_items = [
            MergeCandidateItem(**candidate)
            for candidate in candidates
        ]
        
        return MergeCandidateListResponse(
            candidates=candidate_items,
            total=len(candidate_items),
            graph_id=graph_id,
            status=status,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list merge candidates: {str(e)}")


@router.post("/merges/accept", response_model=RelationshipReviewActionResponse)
def accept_merge_candidates_endpoint(
    payload: MergeCandidateAcceptRequest,
    session: Session = Depends(get_neo4j_session),
):
    """
    Accept one or more merge candidates.
    
    Sets status to ACCEPTED and records review metadata.
    Note: This does not execute the merge. Use /merges/execute for that.
    """
    try:
        ensure_graph_scoping_initialized(session)
        
        updated = set_merge_candidate_status(
            session=session,
            graph_id=payload.graph_id,
            candidate_ids=payload.candidate_ids,
            status="ACCEPTED",
            reviewed_by=payload.reviewed_by,
        )
        
        # Log each accepted candidate
        for candidate_id in payload.candidate_ids:
            # Get candidate details for logging
            candidates = list_merge_candidates(
                session=session,
                graph_id=payload.graph_id,
                status="ACCEPTED",
                limit=1000,
                offset=0,
            )
            candidate = next((c for c in candidates if c["candidate_id"] == candidate_id), None)
            if candidate:
                log_entity_merge(
                    action="MERGE_ACCEPTED",
                    graph_id=payload.graph_id,
                    keep_node_id=candidate["src_concept"]["node_id"],
                    merge_node_id=candidate["dst_concept"]["node_id"],
                    reviewer=payload.reviewed_by,
                    metadata={"candidate_id": candidate_id, "score": candidate["score"]},
                )
        
        return RelationshipReviewActionResponse(
            status="ok",
            action="accept",
            count=updated,
            graph_id=payload.graph_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to accept merge candidates: {str(e)}")


@router.post("/merges/reject", response_model=RelationshipReviewActionResponse)
def reject_merge_candidates_endpoint(
    payload: MergeCandidateRejectRequest,
    session: Session = Depends(get_neo4j_session),
):
    """
    Reject one or more merge candidates.
    
    Sets status to REJECTED and records review metadata.
    """
    try:
        ensure_graph_scoping_initialized(session)
        
        updated = set_merge_candidate_status(
            session=session,
            graph_id=payload.graph_id,
            candidate_ids=payload.candidate_ids,
            status="REJECTED",
            reviewed_by=payload.reviewed_by,
        )
        
        return RelationshipReviewActionResponse(
            status="ok",
            action="reject",
            count=updated,
            graph_id=payload.graph_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reject merge candidates: {str(e)}")


@router.post("/merges/execute", response_model=MergeExecuteResponse)
def execute_merge_endpoint(
    payload: MergeExecuteRequest,
    session: Session = Depends(get_neo4j_session),
):
    """
    Execute a merge of two concepts.
    
    This performs the actual merge operation:
    - Redirects all relationships from merge node to keep node
    - Combines properties (description, tags, etc.)
    - Marks merge node as merged
    - Logs the merge action
    
    Note: This is separate from accept/reject so that acceptance can be batched
    and execution can be deliberate.
    """
    try:
        ensure_graph_scoping_initialized(session)
        
        result = merge_concepts(
            session=session,
            graph_id=payload.graph_id,
            keep_node_id=payload.keep_node_id,
            merge_node_id=payload.merge_node_id,
            reviewed_by=payload.reviewed_by,
        )
        
        # Log the merge execution
        log_entity_merge(
            action="MERGE_EXECUTED",
            graph_id=payload.graph_id,
            keep_node_id=payload.keep_node_id,
            merge_node_id=payload.merge_node_id,
            reviewer=payload.reviewed_by,
            metadata=result,
        )
        
        return MergeExecuteResponse(
            status="ok",
            keep_node_id=result["keep_node_id"],
            merge_node_id=result["merge_node_id"],
            relationships_redirected=result["relationships_redirected"],
            relationships_skipped=result["relationships_skipped"],
            relationships_deleted=result["relationships_deleted"],
            graph_id=payload.graph_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to execute merge: {str(e)}")
