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


def _require_study_identity(request: Request) -> tuple[str, str]:
    user_id = getattr(request.state, "user_id", None)
    tenant_id = getattr(request.state, "tenant_id", None)
    if not user_id or not tenant_id:
        raise HTTPException(status_code=401, detail="Authentication with tenant context is required")
    return str(user_id), str(tenant_id)


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
        user_id, tenant_id = _require_study_identity(request)
        
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
        user_id, tenant_id = _require_study_identity(request)
        
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
        from services_model_router import model_router, TASK_CHAT_FAST
        if not model_router.client:
            raise HTTPException(status_code=500, detail="OpenAI client not configured")

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

        explanation = model_router.completion(
            task_type=TASK_CHAT_FAST,
            messages=[
                {"role": "system", "content": "You are a helpful teacher providing concise, grounded explanations."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=300,
        ) or "Unable to generate explanation."
        
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
        user_id, tenant_id = _require_study_identity(request)
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
    request: Request,
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
        user_id, tenant_id = _require_study_identity(request)
        
        response = get_task(
            session_id=session_id,
            current_mode=current_mode,
            neo4j_session=session,
            user_id=user_id,
            tenant_id=tenant_id,
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
    request: Request,
):
    """
    Submit and evaluate a task attempt.
    
    Phase 2: Evaluates response and provides feedback.
    """
    try:
        from models.study import AttemptRequest, AttemptResponse
        from services.study_session_manager import submit_attempt
        user_id, tenant_id = _require_study_identity(request)
        
        response = submit_attempt(
            task_id=task_id,
            response_text=req.response_text,
            self_confidence=req.self_confidence,
            user_id=user_id,
            tenant_id=tenant_id,
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
    request: Request,
):
    """
    End a study session and return summary.
    
    Phase 2: Marks session as complete and returns stats.
    """
    try:
        from models.study import SessionSummary
        from services.study_session_manager import end_session
        user_id, tenant_id = _require_study_identity(request)
        
        summary = end_session(session_id=session_id, user_id=user_id, tenant_id=tenant_id)
        
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
    request: Request,
):
    """
    Get current session state.
    
    Phase 2: Returns session info and task history.
    """
    try:
        from services.study_session_manager import _get_pool
        from psycopg2.extras import RealDictCursor
        from db_postgres import apply_rls_session_settings
        user_id, tenant_id = _require_study_identity(request)
        
        pool = _get_pool()
        conn = pool.getconn()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                apply_rls_session_settings(cur, user_id=user_id, tenant_id=tenant_id)
                # Get session
                cur.execute("""
                    SELECT * FROM study_sessions WHERE id = %s AND user_id = %s AND tenant_id = %s
                """, (session_id, user_id, tenant_id))
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
