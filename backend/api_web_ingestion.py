"""
API endpoints for webpage ingestion.

This module handles ingestion of webpages from the browser extension.
It creates SourceDocument artifacts, chunks text, and extracts claims.
"""
from typing import Dict, Any, Optional, List
from fastapi import APIRouter, Depends, HTTPException, Request
from neo4j import Session
from pydantic import BaseModel
from typing import List

from db_neo4j import get_neo4j_session
from services_web_ingestion import ingest_web_payload
from auth import require_auth
from config import ENABLE_EXTENSION_DEV

router = APIRouter(prefix="/web", tags=["web"])

# CORS allowlist for extension ingestion
# In production, this should be configured via environment variables
EXTENSION_ORIGINS = [
    "chrome-extension://*",  # Chrome extensions
    "moz-extension://*",     # Firefox extensions
    "safari-extension://*",  # Safari extensions
]




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


def _check_extension_origin(request: Request) -> None:
    """
    Check if request origin is allowed for extension ingestion.
    
    Allows:
    - Localhost (for development)
    - Extension origins (chrome-extension://, etc.)
    - Origins configured in CORS allowlist
    
    Raises:
        HTTPException(403) if origin is not allowed
    """
    origin = request.headers.get("Origin")
    referer = request.headers.get("Referer")
    
    # In dev mode, allow localhost
    if ENABLE_EXTENSION_DEV:
        if origin and ("localhost" in origin or "127.0.0.1" in origin):
            return
        if referer and ("localhost" in referer or "127.0.0.1" in referer):
            return
    
    # Check extension origins
    if origin:
        for allowed_pattern in EXTENSION_ORIGINS:
            if allowed_pattern.replace("*", "") in origin:
                return
    
    # If no origin/referer, allow (for direct API calls with auth token)
    if not origin and not referer:
        return
    
    # Otherwise, reject
    raise HTTPException(
        status_code=403,
        detail=f"Web ingestion endpoint requires authentication and allowed origin. Origin: {origin}"
    )


@router.post("/ingest", response_model=WebIngestResponse)
def ingest_web(
    payload: WebIngestRequest,
    request: Request,
    auth: dict = Depends(require_auth),
    session: Session = Depends(get_neo4j_session),
):
    """
    Ingest a webpage from the browser extension.
    
    This endpoint:
    1. Requires authentication (Bearer token)
    2. Validates extension origin (CORS allowlist)
    3. Delegates to shared ingestion service
    
    Args:
        payload: WebIngestRequest with webpage details
        request: FastAPI request (for origin check)
        auth: Authentication context (dependency)
        session: Neo4j session (dependency)
    
    Returns:
        WebIngestResponse with status, artifact_id, run_id, and counts
    """
    # Step 1: Check extension origin (CORS allowlist)
    try:
        _check_extension_origin(request)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=403, detail=f"Origin check failed: {str(e)}")
    
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
