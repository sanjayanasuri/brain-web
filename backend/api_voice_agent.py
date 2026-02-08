"""
API endpoints for the Conversational Voice Agent.
"""
from fastapi import APIRouter, Depends, Request, HTTPException, Query
from typing import Dict, Any, List, Optional
from datetime import datetime

from models import VoiceSession, VoiceSessionCreate, UsageLog, MemorySyncEvent
from services_voice_agent import VoiceAgentOrchestrator
from services_supermemory import get_sync_history
from services_usage_tracker import get_daily_usage

router = APIRouter(prefix="/voice-agent", tags=["voice-agent"])

def get_orchestrator(request: Request):
    user_id = getattr(request.state, "user_id", None) or "demo"
    tenant_id = getattr(request.state, "tenant_id", None) or "demo"
    return VoiceAgentOrchestrator(user_id, tenant_id)

@router.post("/session/start")
async def start_voice_session(
    payload: VoiceSessionCreate,
    request: Request,
    orchestrator: VoiceAgentOrchestrator = Depends(get_orchestrator)
):
    """Start a new voice session."""
    try:
        session_data = await orchestrator.start_session(
            graph_id=payload.graph_id,
            branch_id=payload.branch_id,
            metadata=payload.metadata
        )
        return session_data
    except Exception as e:
        raise HTTPException(status_code=403, detail=str(e))

@router.post("/session/stop/{session_id}")
async def stop_voice_session(
    session_id: str,
    duration_seconds: int,
    tokens_used: int,
    orchestrator: VoiceAgentOrchestrator = Depends(get_orchestrator)
):
    """Stop an active voice session."""
    await orchestrator.stop_session(session_id, duration_seconds, tokens_used)
    return {"status": "ok"}

@router.get("/memories")
async def get_memories(
    request: Request,
    limit: int = Query(20, ge=1, le=100)
):
    """Fetch recent memory sync events."""
    user_id = getattr(request.state, "user_id", None) or "demo"
    history = get_sync_history(user_id, limit)
    return {"history": history}

@router.get("/usage")
async def get_voice_usage(request: Request):
    """Fetch daily voice usage statistics."""
    user_id = getattr(request.state, "user_id", None) or "demo"
    usage_seconds = get_daily_usage(user_id, "voice_session")
    return {
        "daily_usage_minutes": usage_seconds / 60,
        "daily_limit_minutes": 60 # Default limit
    }

@router.post("/interaction/context")
async def get_interaction_context(
    graph_id: str,
    branch_id: str,
    transcript: str,
    request: Request,
    session_id: Optional[str] = Query(None),
    is_scribe_mode: bool = Query(False),
    orchestrator: VoiceAgentOrchestrator = Depends(get_orchestrator)
):
    """Get context for a voice interaction (GraphRAG + Supermemory + Commands + Fog Clearing + Continuity)."""
    result = await orchestrator.get_interaction_context(graph_id, branch_id, transcript, is_scribe_mode, session_id)
    
    return {
        "agent_response": result["agent_response"],
        "is_eureka": result.get("is_eureka", False),
        "is_fog_clearing": result.get("is_fog_clearing", False),
        "fog_node_id": result.get("fog_node_id"),
        "actions": result.get("actions", []),
        "action_summaries": result.get("action_summaries", [])
    }
