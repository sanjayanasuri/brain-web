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
from services_voice_transcripts import list_voice_learning_signals, list_voice_transcript_chunks
from services_voice_style_profile import get_voice_style_profile_snapshot

router = APIRouter(prefix="/voice-agent", tags=["voice-agent"])

def get_orchestrator(request: Request):
    user_id = getattr(request.state, "user_id", None)
    tenant_id = getattr(request.state, "tenant_id", None)
    if not user_id or not tenant_id:
        raise HTTPException(status_code=401, detail="Authentication required for voice sessions.")
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
            metadata=payload.metadata,
            companion_session_id=payload.companion_session_id
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


@router.get("/style-profile")
async def get_voice_style_profile(request: Request):
    """
    Return the learned per-account voice style profile (pause/question/humor + VAD prefs).
    """
    user_id = getattr(request.state, "user_id", None) or "demo"
    tenant_id = getattr(request.state, "tenant_id", None) or "demo"
    try:
        return get_voice_style_profile_snapshot(user_id=user_id, tenant_id=tenant_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch voice style profile: {str(e)}")

@router.post("/interaction/context")
async def get_interaction_context(
    graph_id: str,
    branch_id: str,
    transcript: str,
    request: Request,
    session_id: Optional[str] = Query(None),
    is_scribe_mode: bool = Query(False),
    client_start_ms: Optional[int] = Query(None, description="Client epoch ms when user started speaking"),
    client_end_ms: Optional[int] = Query(None, description="Client epoch ms when user ended speaking"),
    orchestrator: VoiceAgentOrchestrator = Depends(get_orchestrator)
):
    """Get context for a voice interaction (GraphRAG + Supermemory + Commands + Fog Clearing + Continuity)."""
    result = await orchestrator.get_interaction_context(
        graph_id,
        branch_id,
        transcript,
        is_scribe_mode,
        session_id,
        client_start_ms=client_start_ms,
        client_end_ms=client_end_ms,
    )
    
    return {
        "agent_response": result["agent_response"],
        "should_speak": result.get("should_speak", True),
        "speech_rate": result.get("speech_rate", 1.0),
        "learning_signals": result.get("learning_signals", []),
        "policy": result.get("policy", {}),
        "user_transcript_chunk": result.get("user_transcript_chunk"),
        "assistant_transcript_chunk": result.get("assistant_transcript_chunk"),
        "is_eureka": result.get("is_eureka", False),
        "is_fog_clearing": result.get("is_fog_clearing", False),
        "fog_node_id": result.get("fog_node_id"),
        "actions": result.get("actions", []),
        "action_summaries": result.get("action_summaries", [])
    }


@router.get("/session/{session_id}/transcript")
async def get_voice_session_transcript(session_id: str, request: Request):
    """List transcript chunks for a voice session (as artifacts + anchors)."""
    user_id = getattr(request.state, "user_id", None) or "demo"
    try:
        chunks = list_voice_transcript_chunks(voice_session_id=session_id, user_id=user_id)
        return {"session_id": session_id, "chunks": chunks}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch transcript: {str(e)}")


@router.get("/session/{session_id}/signals")
async def get_voice_session_signals(session_id: str, request: Request):
    """List extracted learning signals for a voice session."""
    user_id = getattr(request.state, "user_id", None) or "demo"
    try:
        signals = list_voice_learning_signals(voice_session_id=session_id, user_id=user_id)
        return {"session_id": session_id, "signals": signals}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch signals: {str(e)}")
