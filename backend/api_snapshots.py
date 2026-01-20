from fastapi import APIRouter, Depends, HTTPException, Request

from db_neo4j import get_neo4j_session
from models import SnapshotCreateRequest, SnapshotListResponse, SnapshotRestoreResponse
from services_snapshots import create_snapshot, list_snapshots, restore_snapshot
from auth import require_auth

router = APIRouter(prefix="/snapshots", tags=["snapshots"])


@router.post("/", response_model=dict)
def create_snapshot_endpoint(
    payload: SnapshotCreateRequest,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    try:
        return create_snapshot(
            session,
            name=payload.name,
            focused_node_id=payload.focused_node_id,
            layout=payload.layout,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/", response_model=SnapshotListResponse)
def list_snapshots_endpoint(
    request: Request,
    limit: int = 50,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    try:
        return {"snapshots": list_snapshots(session, limit=limit)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{snapshot_id}/restore", response_model=SnapshotRestoreResponse)
def restore_snapshot_endpoint(
    snapshot_id: str,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    try:
        return restore_snapshot(session, snapshot_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
