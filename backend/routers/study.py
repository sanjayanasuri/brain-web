# backend/routers/study.py
"""
API router for adaptive learning orchestration system.
Phase 1: Context building and clarification endpoints.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from neo4j import Session

from db_neo4j import get_neo4j_session
from models.study import (
    ContextRequest, ContextPack, ClarifyRequest, ClarifyResponse,
    StartSessionRequest, StartSessionResponse, NextTaskResponse,
    AttemptRequest, AttemptResponse, SessionSummary
)
from services.context_builder import build_context_from_selection


router = APIRouter(prefix="/study", tags=["study"])


@router.post("/context/from-selection", response_model=ContextPack)
def get_context_from_selection(
    req: ContextRequest,
    request: Request,
    session: Session = Depends(get_neo4j_session),
):
    """
    Build context pack from a selection (quote or artifact).
    
    Returns grounded excerpts sorted by relevance, plus related concepts.
    """
    try:
        # Get user context from request state (set by auth middleware)
        user_id = getattr(request.state, "user_id", "unknown")
        tenant_id = getattr(request.state, "tenant_id", "default")
        
        context_pack = build_context_from_selection(
            session=session,
            selection_id=req.selection_id,
            radius=req.radius,
            include_related=req.include_related,
            user_id=user_id,
            tenant_id=tenant_id,
        )
        
        return context_pack
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to build context: {str(e)}"
        )


@router.post("/clarify", response_model=ClarifyResponse)
def clarify_selection(
    req: ClarifyRequest,
    request: Request,
    session: Session = Depends(get_neo4j_session),
):
    """
    Clarify a selection by generating a grounded explanation.
    
    Phase 1: Uses OpenAI to generate explanation from context.
    """
    try:
        # Get user context
        user_id = getattr(request.state, "user_id", "unknown")
        tenant_id = getattr(request.state, "tenant_id", "default")
        
        # Build context pack
        context_pack = build_context_from_selection(
            session=session,
            selection_id=req.selection_id,
            radius=req.radius,
            include_related=req.include_related,
            user_id=user_id,
            tenant_id=tenant_id,
        )
        
        if not context_pack.excerpts:
            raise HTTPException(
                status_code=404,
                detail=f"Selection not found: {req.selection_id}"
            )
        
        # Generate clarification using LLM
        import os
        import openai
        
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise HTTPException(
                status_code=500,
                detail="OpenAI API key not configured"
            )
        
        # Build prompt from context
        primary_excerpt = context_pack.excerpts[0]
        context_text = "\n\n".join([
            f"[{e.source_type.upper()}] {e.content[:200]}..."
            for e in context_pack.excerpts[:5]  # Top 5 most relevant
        ])
        
        prompt = f"""You are a helpful teacher. A student has selected this text and wants clarification:

SELECTED TEXT:
{primary_excerpt.content}

CONTEXT:
{context_text}

Provide a brief, grounded explanation (2-4 sentences) that clarifies the selected text using the provided context. Be concise and cite the context where relevant."""
        
        # Call OpenAI
        client = openai.OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model=os.getenv("STUDY_MODEL", "gpt-4o-mini"),
            messages=[
                {"role": "system", "content": "You are a helpful teacher providing concise, grounded explanations."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=300,
        )
        
        explanation = response.choices[0].message.content or "Unable to generate explanation."
        
        # Extract citation IDs (simple heuristic for Phase 1)
        citations = [e.excerpt_id for e in context_pack.excerpts[:3]]
        
        return ClarifyResponse(
            explanation=explanation.strip(),
            context_pack=context_pack,
            citations=citations,
        )
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to clarify selection: {str(e)}"
        )


# ---------- Phase 2: Session Management Endpoints ----------

@router.post("/session/start", response_model=StartSessionResponse)
def start_study_session(
    req: StartSessionRequest,
    request: Request,
    session: Session = Depends(get_neo4j_session),
):
    """
    Start a new guided study session.
    
    Phase 2: Creates session and generates first task.
    """
    try:
        from models.study import StartSessionResponse
        from services.study_session_manager import start_session
        
        # Get user context
        user_id = getattr(request.state, "user_id", "unknown")
        tenant_id = getattr(request.state, "tenant_id", "default")
        graph_id = getattr(request.state, "graph_id", None)
        branch_id = getattr(request.state, "branch_id", None)
        
        response = start_session(
            user_id=user_id,
            tenant_id=tenant_id,
            graph_id=graph_id,
            branch_id=branch_id,
            intent=req.intent,
            topic_id=req.topic_id,
            selection_id=req.selection_id,
            current_mode=req.current_mode,
            neo4j_session=session
        )
        
        return response
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to start session: {str(e)}"
        )


@router.post("/session/{session_id}/next", response_model=NextTaskResponse)
def get_next_task(
    session_id: str,
    current_mode: str = None,
    session: Session = Depends(get_neo4j_session),
):
    """
    Get the next task for a session.
    
    Phase 2: Generates next task based on session history.
    """
    try:
        from models.study import NextTaskResponse
        from services.study_session_manager import get_next_task as get_task
        
        response = get_task(
            session_id=session_id,
            current_mode=current_mode,
            neo4j_session=session
        )
        
        return response
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get next task: {str(e)}"
        )


@router.post("/task/{task_id}/attempt", response_model=AttemptResponse)
def submit_task_attempt(
    task_id: str,
    req: AttemptRequest,
):
    """
    Submit and evaluate a task attempt.
    
    Phase 2: Evaluates response and provides feedback.
    """
    try:
        from models.study import AttemptRequest, AttemptResponse
        from services.study_session_manager import submit_attempt
        
        response = submit_attempt(
            task_id=task_id,
            response_text=req.response_text,
            self_confidence=req.self_confidence
        )
        
        return response
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to submit attempt: {str(e)}"
        )


@router.post("/session/{session_id}/end", response_model=SessionSummary)
def end_study_session(
    session_id: str,
):
    """
    End a study session and return summary.
    
    Phase 2: Marks session as complete and returns stats.
    """
    try:
        from models.study import SessionSummary
        from services.study_session_manager import end_session
        
        summary = end_session(session_id=session_id)
        
        return summary
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to end session: {str(e)}"
        )


@router.get("/session/{session_id}")
def get_session_state(
    session_id: str,
):
    """
    Get current session state.
    
    Phase 2: Returns session info and task history.
    """
    try:
        from services.study_session_manager import _get_pool
        from psycopg2.extras import RealDictCursor
        
        pool = _get_pool()
        conn = pool.getconn()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Get session
                cur.execute("""
                    SELECT * FROM study_sessions WHERE id = %s
                """, (session_id,))
                session_row = cur.fetchone()
                
                if not session_row:
                    raise HTTPException(status_code=404, detail="Session not found")
                
                # Get tasks
                cur.execute("""
                    SELECT id, task_type, created_at
                    FROM study_tasks
                    WHERE session_id = %s
                    ORDER BY created_at DESC
                    LIMIT 10
                """, (session_id,))
                tasks = cur.fetchall()
                
                return {
                    "session": dict(session_row),
                    "tasks": [dict(t) for t in tasks]
                }
        finally:
            pool.putconn(conn)
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get session state: {str(e)}"
        )
