"""API endpoints for Learning Notes Digest."""
from fastapi import APIRouter, Depends, HTTPException, Request
from typing import List

from auth import require_auth
from models_notes_digest import NotesDigest, NotesUpdateRequest, NotesUpdateResponse, NotesHistoryEntry
from services_notes_digest import get_or_create_digest, update_notes_digest, get_notes_history

router = APIRouter(prefix="/chats", tags=["notes-digest"])


@router.get("/{chat_id}/notes", response_model=NotesDigest)
def get_notes_digest(chat_id: str, auth: dict = Depends(require_auth)):
    try:
        return get_or_create_digest(chat_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load notes: {str(e)}")


@router.post("/{chat_id}/notes/update", response_model=NotesUpdateResponse)
def update_notes_digest_endpoint(
    chat_id: str,
    payload: NotesUpdateRequest,
    request: Request,
    auth: dict = Depends(require_auth),
):
    try:
        digest, added, refined, status = update_notes_digest(
            chat_id=chat_id,
            trigger_source=payload.trigger_source or "manual",
            branch_id=payload.branch_id,
        )
        return NotesUpdateResponse(
            status=status,
            entries_added=added,
            entries_refined=refined,
            digest=digest,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update notes: {str(e)}")


@router.get("/{chat_id}/notes/history", response_model=List[NotesHistoryEntry])
def get_notes_history_endpoint(chat_id: str, auth: dict = Depends(require_auth)):
    try:
        return get_notes_history(chat_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load notes history: {str(e)}")
