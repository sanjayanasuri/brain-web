"""
Services for managing unified 'Companion Sessions' that span across modalities (Chat, Voice, Whiteboard).
"""
import uuid
import time
from typing import Optional, Dict, Any
from pydantic import BaseModel

# In-memory store for now (migrate to Postgres later)
# Map: companion_session_id -> { created_at, user_id, active_voice_session_id, active_thread_id }
_COMPANION_SESSIONS = {}

class CompanionSession(BaseModel):
    session_id: str
    user_id: str
    created_at: float
    active_voice_session_id: Optional[str] = None
    active_thread_id: Optional[str] = None
    metadata: Dict[str, Any] = {}

def get_or_create_session(user_id: str, client_session_id: Optional[str] = None) -> CompanionSession:
    """
    Get an existing session by ID or create a new one.
    If client_session_id is provided and exists, return it.
    Otherwise create a new one.
    """
    if client_session_id and client_session_id in _COMPANION_SESSIONS:
        return _COMPANION_SESSIONS[client_session_id]
    
    # Create new
    session_id = client_session_id or str(uuid.uuid4())
    session = CompanionSession(
        session_id=session_id,
        user_id=user_id,
        created_at=time.time()
    )
    _COMPANION_SESSIONS[session_id] = session
    return session

def update_session_context(session_id: str, voice_session_id: Optional[str] = None, thread_id: Optional[str] = None):
    """
    Update the active pointers for a session.
    """
    if session_id not in _COMPANION_SESSIONS:
        return # Or raise?
    
    session = _COMPANION_SESSIONS[session_id]
    if voice_session_id:
        session.active_voice_session_id = voice_session_id
    if thread_id:
        session.active_thread_id = thread_id
    
    _COMPANION_SESSIONS[session_id] = session
