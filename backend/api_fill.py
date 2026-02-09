"""API endpoints for the /fill command router (Phase E)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from neo4j import Session

from auth import require_auth
from db_neo4j import get_neo4j_session
from models_fill import FillRequest, FillResponse
from services_fill import run_fill


router = APIRouter(prefix="/fill", tags=["fill"])


@router.post("", response_model=FillResponse)
def run_fill_endpoint(
    payload: FillRequest,
    req: Request,
    auth: dict = Depends(require_auth),
    session: Session = Depends(get_neo4j_session),
):
    tenant_id = auth.get("tenant_id") or getattr(req.state, "tenant_id", None)
    try:
        return run_fill(
            session=session,
            command=payload.command,
            graph_id=payload.graph_id,
            branch_id=payload.branch_id,
            limit=payload.limit,
            tenant_id=tenant_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to run /fill: {str(e)}")

