"""API endpoints for session events and context."""
from fastapi import APIRouter, Depends, Query, HTTPException
from typing import List, Optional
from datetime import datetime

from db_neo4j import get_neo4j_session
from auth import require_auth
from events.schema import EventEnvelope
from events.store import get_event_store
from projectors.session_context import SessionContextProjector, SessionContext

router = APIRouter(prefix="/api/sessions", tags=["sessions-events"])

# Global projector instance (uses read model store)
_projector = SessionContextProjector(use_read_model=True)


@router.get("/{session_id}/events", response_model=List[EventEnvelope])
def list_session_events(
    session_id: str,
    after_ts: Optional[datetime] = Query(None, description="Filter events after this timestamp"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum number of events to return"),
    auth: dict = Depends(require_auth),
):
    """
    List events for a session.
    
    Returns events ordered by occurred_at ascending.
    """
    try:
        store = get_event_store()
        events = store.list_events(session_id, after_ts=after_ts, limit=limit)
        return events
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list events: {str(e)}")


@router.get("/{session_id}/context", response_model=SessionContext)
def get_session_context(
    session_id: str,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """
    Get derived session context from events.
    
    This loads context from read model store if available, otherwise
    projects it from events. Context is automatically updated in background
    when events are emitted.
    """
    try:
        # Try to load from read model, fall back to projection
        context = _projector.get_context(session_id, neo4j_session=session)
        if not context:
            # No events exist yet
            from datetime import datetime
            from projectors.session_context import SessionContext
            context = SessionContext(
                session_id=session_id,
                last_updated=datetime.utcnow()
            )
        return context
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get session context: {str(e)}")

