"""
API endpoints for voice interaction (Mode A: Capture, Mode B: Commands).

Voice must not be treated as "just transcription."
- Mode A (Voice Capture): Passive transcription for learning state updates
- Mode B (Voice Command): Active control for system orchestration
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
import logging

from db_neo4j import get_neo4j_session
from models import (
    Signal, SignalType, SignalCreate,
    Task, TaskType, TaskCreate,
    VoiceCaptureSignal, VoiceCommandSignal,
)
from services_signals import create_signal, create_task
from services_branch_explorer import get_active_graph_context

logger = logging.getLogger("brain_web")

router = APIRouter(prefix="/voice", tags=["voice"])


@router.post("/capture", response_model=Signal)
def voice_capture_endpoint(
    payload: VoiceCaptureSignal,
    document_id: Optional[str] = None,
    block_id: Optional[str] = None,
    concept_id: Optional[str] = None,
    session_id: Optional[str] = None,
    session=Depends(get_neo4j_session),
):
    """
    Mode A: Voice Capture (Passive)
    
    Used when the user is thinking or taking notes.
    Examples:
    - "This part about Bayes feels unclear"
    - "This depends on conditional probability"
    - "I think this assumption matters later"
    
    Behavior:
    - Transcribe
    - Attach transcript to the current Block or Concept
    - Classify as reflection / confusion / explanation
    - Update confidence or uncertainty on linked concepts
    - Do NOT interrupt or respond unless asked
    
    This updates learning state, not conversation.
    """
    try:
        # Use provided IDs or fall back to payload
        final_document_id = document_id or payload.document_id
        final_block_id = block_id or payload.block_id
        final_concept_id = concept_id or payload.concept_id
        
        # Create signal payload
        classification = (payload.classification or "").strip().lower() if payload.classification else None
        if not classification:
            # Lightweight heuristic classification (keeps capture usable even if the client doesn't classify).
            lower = (payload.transcript or "").lower()
            if "unclear" in lower or "confus" in lower or "don't understand" in lower or "do not understand" in lower:
                classification = "confusion"
            elif "think" in lower or "feel" in lower or "seems" in lower:
                classification = "reflection"
            else:
                classification = "explanation"

        signal_payload = {
            "transcript": payload.transcript,
            "classification": classification,
        }
        
        # Create signal
        signal_create = SignalCreate(
            signal_type=SignalType.VOICE_CAPTURE,
            document_id=final_document_id,
            block_id=final_block_id,
            concept_id=final_concept_id,
            payload=signal_payload,
            session_id=session_id,
        )
        
        signal = create_signal(session, signal_create)
        
        # Update learning state for linked concept (best-effort).
        #
        # We keep this lightweight and deterministic:
        # - "confusion" nudges mastery down
        # - "reflection" nudges mastery up slightly
        # - "explanation" nudges mastery up more
        if final_concept_id:
            try:
                classification = str(classification or "").strip().lower()
                delta = 0
                if classification == "confusion":
                    delta = -5
                elif classification == "reflection":
                    delta = 2
                elif classification == "explanation":
                    delta = 5

                if delta != 0:
                    rec = session.run(
                        """
                        MATCH (c:Concept {graph_id: $graph_id, node_id: $concept_id})
                        RETURN COALESCE(c.mastery_level, 0) AS mastery_level
                        LIMIT 1
                        """,
                        graph_id=signal.graph_id,
                        concept_id=final_concept_id,
                    ).single()
                    if rec is not None:
                        current = int(rec.get("mastery_level") or 0)
                        updated = max(0, min(100, current + delta))
                        from services_graph import update_concept_mastery

                        update_concept_mastery(
                            session=session,
                            graph_id=signal.graph_id,
                            node_id=final_concept_id,
                            mastery_level=updated,
                        )
            except Exception as e:
                logger.warning(f"Failed to update concept mastery from voice capture: {e}")
        
        logger.info(f"Voice capture signal created: {signal.signal_id}")
        return signal
        
    except Exception as e:
        logger.error(f"Failed to process voice capture: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to process voice capture: {str(e)}")


@router.post("/command", response_model=dict)
def voice_command_endpoint(
    payload: VoiceCommandSignal,
    document_id: Optional[str] = None,
    block_id: Optional[str] = None,
    concept_id: Optional[str] = None,
    session_id: Optional[str] = None,
    session=Depends(get_neo4j_session),
):
    """
    Mode B: Voice Command (Active Control)
    
    Used to direct the system while the user works.
    Examples:
    - "Hey, work on generating answers to the next few problems while I take notes"
    - "Summarize what I just highlighted"
    - "What do I need to know to solve the next homework question?"
    - "Explain this using only what I've already written"
    - "Pause answers until I'm done dictating"
    
    Behavior:
    - Parse intent
    - Queue background tasks (retrieval, draft answers, gap analysis)
    - Respect mode switching (do not interrupt note-taking)
    - Return results when explicitly requested or when the user pauses
    
    Voice commands are orchestration, not chat.
    """
    try:
        # Use provided IDs or fall back to payload
        final_document_id = document_id or payload.document_id
        final_block_id = block_id or payload.block_id
        final_concept_id = concept_id or payload.concept_id
        
        # Map intent to task type
        intent_to_task_type = {
            "generate_answers": TaskType.GENERATE_ANSWERS,
            "summarize": TaskType.SUMMARIZE,
            "explain": TaskType.EXPLAIN,
            "gap_analysis": TaskType.GAP_ANALYSIS,
            "retrieve_context": TaskType.RETRIEVE_CONTEXT,
            "extract_concepts": TaskType.EXTRACT_CONCEPTS,
        }
        
        task_type = intent_to_task_type.get(payload.intent)
        if not task_type:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown intent: {payload.intent}. Supported: {list(intent_to_task_type.keys())}"
            )
        
        # Create voice command signal first
        signal_payload = {
            "transcript": payload.transcript,
            "intent": payload.intent,
            "params": payload.params or {},
        }
        
        signal_create = SignalCreate(
            signal_type=SignalType.VOICE_COMMAND,
            document_id=final_document_id,
            block_id=final_block_id,
            concept_id=final_concept_id,
            payload=signal_payload,
            session_id=session_id,
        )
        
        signal = create_signal(session, signal_create)
        
        # Create background task
        task_create = TaskCreate(
            task_type=task_type,
            document_id=final_document_id,
            block_id=final_block_id,
            concept_id=final_concept_id,
            params=payload.params or {},
            created_by_signal_id=signal.signal_id,
            session_id=session_id,
        )
        
        task = create_task(session, task_create)
        
        # Enqueue task for background processing
        from services_task_queue import enqueue_task
        enqueue_task(task.task_id)
        
        logger.info(f"Voice command processed: {signal.signal_id} -> task {task.task_id}")
        
        return {
            "status": "queued",
            "signal_id": signal.signal_id,
            "task_id": task.task_id,
            "task_type": task.task_type.value,
            "message": f"Task queued: {payload.intent}",
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to process voice command: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to process voice command: {str(e)}")
