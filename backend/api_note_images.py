"""API endpoints for ingesting whiteboard/photo note images (Phase D)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from neo4j import Session

from auth import require_auth
from db_neo4j import get_neo4j_session
from models_note_images import NoteImageIngestRequest, NoteImageIngestResponse
from services_note_images import ingest_note_image


router = APIRouter(prefix="/note-images", tags=["note-images"])


@router.post("/ingest", response_model=NoteImageIngestResponse)
def ingest_note_image_endpoint(
    payload: NoteImageIngestRequest,
    req: Request,
    auth: dict = Depends(require_auth),
    session: Session = Depends(get_neo4j_session),
):
    tenant_id = auth.get("tenant_id") or getattr(req.state, "tenant_id", None)
    try:
        return ingest_note_image(session=session, payload=payload, tenant_id=tenant_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to ingest note image: {str(e)}")

