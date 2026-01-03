"""
API endpoints for webpage ingestion.

This module handles ingestion of webpages from the browser extension.
It creates SourceDocument artifacts, chunks text, and extracts claims.
"""
from typing import Dict, Any, Optional, List
from fastapi import APIRouter, Depends, HTTPException, Request
from neo4j import Session
from pydantic import BaseModel

from db_neo4j import get_neo4j_session
from services_web_ingestion import ingest_web_payload

router = APIRouter(prefix="/web", tags=["web"])




class WebIngestRequest(BaseModel):
    """Request to ingest a webpage via the extension."""
    url: str
    title: Optional[str] = None
    capture_mode: str = "reader"  # "selection" | "reader" | "full"
    text: str  # extracted body text from extension
    selection_text: Optional[str] = None
    anchor: Optional[Dict[str, Any]] = None  # Text-quote anchor for selections
    domain: Optional[str] = "General"
    tags: List[str] = []
    note: Optional[str] = None
    metadata: Dict[str, Any] = {}
    trail_id: Optional[str] = None  # Phase 4: Optional trail to append steps to


class WebIngestResponse(BaseModel):
    """Response from web ingestion endpoint."""
    status: str  # "INGESTED" | "SKIPPED" | "FAILED"
    artifact_id: str  # doc_id from SourceDocument
    quote_id: Optional[str] = None  # quote_id if Quote was created
    run_id: Optional[str] = None
    chunks_created: int = 0
    claims_created: int = 0
    errors: List[str] = []


def _check_local_only(request: Request) -> None:
    """Check if request is from localhost, raise 403 if not."""
    client_host = request.client.host if request.client else None
    if not client_host:
        raise HTTPException(status_code=403, detail="Cannot determine client host")
    
    # Allow localhost variants
    allowed_hosts = ["127.0.0.1", "::1", "localhost"]
    if client_host not in allowed_hosts and not client_host.startswith("127."):
        raise HTTPException(
            status_code=403,
            detail=f"Web ingestion endpoint is only accessible from localhost. Client: {client_host}"
        )


@router.post("/ingest", response_model=WebIngestResponse)
def ingest_web(
    payload: WebIngestRequest,
    request: Request,
    session: Session = Depends(get_neo4j_session),
):
    """
    Ingest a webpage from the browser extension.
    
    This endpoint:
    1. Validates local-only access
    2. Delegates to shared ingestion service
    
    Args:
        payload: WebIngestRequest with webpage details
        request: FastAPI request (for local-only check)
        session: Neo4j session (dependency)
    
    Returns:
        WebIngestResponse with status, artifact_id, run_id, and counts
    """
    # Step 1: Local-only guard
    try:
        _check_local_only(request)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=403, detail=f"Access check failed: {str(e)}")
    
    # Step 2: Delegate to shared ingestion service
    out = ingest_web_payload(
        session=session,
        url=payload.url,
        title=payload.title,
        capture_mode=payload.capture_mode,
        text=payload.text,
        selection_text=payload.selection_text,
        anchor=payload.anchor,
        domain=payload.domain,
        tags=payload.tags,
        note=payload.note,
        metadata=payload.metadata,
        trail_id=payload.trail_id,
    )
    
    return WebIngestResponse(
        status=out["status"],
        artifact_id=out["artifact_id"],
        quote_id=out.get("quote_id"),
        run_id=out.get("run_id"),
        chunks_created=out.get("chunks_created", 0),
        claims_created=out.get("claims_created", 0),
        errors=out.get("errors", []),
    )
