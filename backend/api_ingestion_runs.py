"""
API endpoints for ingestion run tracking.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from typing import List, Optional, Dict, Any
from neo4j import Session
from pydantic import BaseModel

from db_neo4j import get_neo4j_session
from models import IngestionRun
from services_ingestion_runs import (
    get_ingestion_run,
    list_ingestion_runs,
    get_ingestion_run_changes,
    undo_ingestion_run,
    restore_ingestion_run,
)

router = APIRouter(prefix="/ingestion", tags=["ingestion"])


@router.get("/runs", response_model=List[IngestionRun])
def list_runs(
    limit: int = Query(20, ge=1, le=100, description="Maximum number of runs to return"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    session: Session = Depends(get_neo4j_session),
):
    """
    List ingestion runs for the current graph, ordered by started_at DESC.
    
    Returns:
        List of IngestionRun objects
    """
    try:
        return list_ingestion_runs(session=session, limit=limit, offset=offset)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list ingestion runs: {str(e)}"
        )


@router.get("/runs/{run_id}", response_model=IngestionRun)
def get_run(
    run_id: str,
    session: Session = Depends(get_neo4j_session),
):
    """
    Get a specific ingestion run by ID.
    
    Args:
        run_id: Ingestion run ID
    
    Returns:
        IngestionRun object
    """
    try:
        run = get_ingestion_run(session=session, run_id=run_id)
        if not run:
            raise HTTPException(status_code=404, detail=f"Ingestion run {run_id} not found")
        return run
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get ingestion run: {str(e)}"
        )


@router.get("/runs/{run_id}/changes")
def get_run_changes(
    run_id: str,
    session: Session = Depends(get_neo4j_session),
):
    """
    Get a change manifest for an ingestion run.
    
    Returns concepts created/updated, resources created, and relationships proposed by this run.
    
    Args:
        run_id: Ingestion run ID
    
    Returns:
        Dict with run info and lists of changes
    """
    try:
        return get_ingestion_run_changes(session=session, run_id=run_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get run changes: {str(e)}"
        )


class UndoRequest(BaseModel):
    mode: str = "SAFE"  # "SAFE" | "RELATIONSHIPS_ONLY"


@router.post("/runs/{run_id}/undo")
def undo_run(
    run_id: str,
    request: UndoRequest = Body(...),
    session: Session = Depends(get_neo4j_session),
):
    """
    Undo an ingestion run by archiving its outputs.
    
    Args:
        run_id: Ingestion run ID
        request: UndoRequest with mode ("SAFE" | "RELATIONSHIPS_ONLY")
    
    Returns:
        Dict with archived counts and skipped items
    """
    try:
        if request.mode not in ["SAFE", "RELATIONSHIPS_ONLY"]:
            raise HTTPException(
                status_code=400,
                detail="mode must be 'SAFE' or 'RELATIONSHIPS_ONLY'"
            )
        return undo_ingestion_run(
            session=session,
            run_id=run_id,
            mode=request.mode,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to undo ingestion run: {str(e)}"
        )


@router.post("/runs/{run_id}/restore")
def restore_run(
    run_id: str,
    session: Session = Depends(get_neo4j_session),
):
    """
    Restore archived items from an ingestion run.
    
    Args:
        run_id: Ingestion run ID
    
    Returns:
        Dict with restored counts and skipped items
    """
    try:
        return restore_ingestion_run(
            session=session,
            run_id=run_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to restore ingestion run: {str(e)}"
        )

