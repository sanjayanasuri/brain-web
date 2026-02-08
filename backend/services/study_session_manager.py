# backend/services/study_session_manager.py
"""
Study session manager service.
Handles session lifecycle, task generation, and attempt submission.
"""

import uuid
from datetime import datetime
from typing import Optional, Dict, Any, List
import random

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    from psycopg2.pool import ThreadedConnectionPool
    PSYCOPG2_AVAILABLE = True
except ImportError:
    PSYCOPG2_AVAILABLE = False
    class ThreadedConnectionPool:
        def __init__(self, *args, **kwargs):
            pass
        def getconn(self):
            raise ImportError("psycopg2 not installed")
        def putconn(self, conn):
            pass
    RealDictCursor = None

from config import POSTGRES_CONNECTION_STRING
from models.study import (
    StudySession, TaskSpec, EvaluationResult,
    StartSessionRequest, StartSessionResponse,
    NextTaskResponse, AttemptResponse, SessionSummary
)
from services.context_builder import build_context_from_selection
from services.task_generator import generate_task, get_task_types
from services.evaluator import evaluate_attempt
from services.orchestrator import (
    select_next_task, calculate_new_inertia, should_switch_mode, get_recommended_mode
)
from neo4j import Session as Neo4jSession


_pool: Optional[ThreadedConnectionPool] = None


def _get_pool() -> ThreadedConnectionPool:
    """Get Postgres connection pool."""
    if not PSYCOPG2_AVAILABLE:
        raise ImportError("psycopg2-binary is required for study sessions")
    global _pool
    if _pool is None:
        _pool = ThreadedConnectionPool(1, 10, POSTGRES_CONNECTION_STRING)
    return _pool


def start_session(
    user_id: str,
    tenant_id: str,
    graph_id: Optional[str],
    branch_id: Optional[str],
    intent: str,
    topic_id: Optional[str] = None,
    selection_id: Optional[str] = None,
    current_mode: str = "explain",
    neo4j_session: Optional[Neo4jSession] = None
) -> StartSessionResponse:
    """
    Start a new study session.
    
    Args:
        user_id: User ID
        tenant_id: Tenant ID
        graph_id: Graph ID
        branch_id: Branch ID
        intent: Session intent ('clarify', 'practice', 'review')
        topic_id: Optional concept node_id to study
        selection_id: Optional quote_id to start from
        current_mode: Starting mode ('explain', 'typing', 'voice')
        neo4j_session: Neo4j session for context building
    
    Returns:
        StartSessionResponse with session_id and initial task
    """
    
    # Create session in database
    session_id = str(uuid.uuid4())
    started_at = datetime.utcnow().isoformat()
    
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO study_sessions (
                    id, user_id, tenant_id, graph_id, branch_id,
                    topic_id, selection_id, intent, current_mode,
                    mode_inertia, started_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                session_id, user_id, tenant_id, graph_id, branch_id,
                topic_id, selection_id, intent, current_mode,
                0.5,  # Initial inertia
                started_at
            ))
            conn.commit()
    finally:
        pool.putconn(conn)
    
    # Generate initial task
    try:
        print(f"[StudySession] Generating initial task for session {session_id}")
        initial_task = _generate_next_task(
            session_id=session_id,
            user_id=user_id,
            tenant_id=tenant_id,
            topic_id=topic_id,
            selection_id=selection_id,
            current_mode=current_mode,
            mode_inertia=0.5,
            neo4j_session=neo4j_session
        )
    except Exception as e:
        print(f"[StudySession] Error generating initial task: {e}")
        import traceback
        traceback.print_exc()
        raise
    
    # Build mode state
    mode_state = {
        "current_mode": current_mode,
        "inertia": 0.5,
        "threshold": 0.35
    }
    
    return StartSessionResponse(
        session_id=session_id,
        initial_task=initial_task,
        mode_state=mode_state
    )


def get_next_task(
    session_id: str,
    current_mode: Optional[str] = None,
    neo4j_session: Optional[Neo4jSession] = None
) -> NextTaskResponse:
    """
    Get the next task for a session.
    
    Args:
        session_id: Session UUID
        current_mode: Optional updated mode
        neo4j_session: Neo4j session for context building
    
    Returns:
        NextTaskResponse with task spec and mode state
    """
    
    # Get session from database
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT * FROM study_sessions WHERE id = %s
            """, (session_id,))
            session_row = cur.fetchone()
            
            if not session_row:
                raise ValueError(f"Session not found: {session_id}")
            
            # Update mode if provided
            if current_mode:
                cur.execute("""
                    UPDATE study_sessions
                    SET current_mode = %s
                    WHERE id = %s
                """, (current_mode, session_id))
                conn.commit()
                session_row["current_mode"] = current_mode
    finally:
        pool.putconn(conn)
    
    # Generate next task
    task_spec = _generate_next_task(
        session_id=session_id,
        user_id=session_row["user_id"],
        tenant_id=session_row["tenant_id"],
        topic_id=session_row.get("topic_id"),
        selection_id=session_row.get("selection_id"),
        current_mode=current_mode or session_row["current_mode"],
        mode_inertia=session_row["mode_inertia"],
        neo4j_session=neo4j_session
    )
    
    # Build mode state
    mode_state = {
        "current_mode": session_row["current_mode"],
        "inertia": session_row["mode_inertia"],
        "threshold": 0.35
    }
    
    return NextTaskResponse(
        task_spec=task_spec,
        mode_state=mode_state
    )


def submit_attempt(
    task_id: str,
    response_text: str,
    self_confidence: Optional[float] = None
) -> AttemptResponse:
    """
    Submit and evaluate a task attempt.
    
    Args:
        task_id: Task UUID
        response_text: User's response
        self_confidence: Optional self-assessment (0-1)
    
    Returns:
        AttemptResponse with evaluation and suggestions
    """
    
    try:
        # Get task from database
        pool = _get_pool()
        conn = pool.getconn()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT * FROM study_tasks WHERE id = %s
                """, (task_id,))
                task_row = cur.fetchone()
                
                if not task_row:
                    raise ValueError(f"Task not found: {task_id}")
                
                # Reconstruct TaskSpec
                from models.study import ContextPack
                import json
                
                task_spec = TaskSpec(
                    task_id=task_row["id"],
                    task_type=task_row["task_type"],
                    prompt=task_row["prompt"],
                    rubric_json=task_row["rubric_json"],
                    context_pack=ContextPack(**task_row["context_pack_json"]),
                    compatible_modes=task_row["compatible_modes"],
                    disruption_cost=task_row["disruption_cost"]
                )
                
                # Get session info for user context
                session_id = task_row["session_id"]
                cur.execute("""
                    SELECT user_id, tenant_id, current_mode, mode_inertia
                    FROM study_sessions
                    WHERE id = %s
                """, (session_id,))
                
                session_row = cur.fetchone()
                if not session_row:
                    raise ValueError(f"Session not found: {session_id}")
                
                user_id = session_row["user_id"]
                tenant_id = session_row["tenant_id"]
                
                # Evaluate attempt with user context for concept tracking
                evaluation = evaluate_attempt(
                    task_spec, 
                    response_text,
                    user_id=user_id,
                    tenant_id=tenant_id
                )
                
                # Save attempt
                attempt_id = str(uuid.uuid4())
                cur.execute("""
                    INSERT INTO study_attempts (
                        id, task_id, response_text, score_json,
                        composite_score, feedback_text, gap_concepts
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (
                    attempt_id, task_id, response_text,
                    json.dumps(evaluation.score_json),
                    evaluation.composite_score,
                    evaluation.feedback_text,
                    json.dumps(evaluation.gap_concepts)
                ))
                
                # Calculate new inertia using orchestrator
                mode_switched = False  # We don't switch mode on attempt submission
                new_inertia = calculate_new_inertia(
                    current_inertia=session_row["mode_inertia"],
                    task_score=evaluation.composite_score,
                    mode_switched=mode_switched
                )
                
                # Update session inertia
                cur.execute("""
                    UPDATE study_sessions
                    SET mode_inertia = %s
                    WHERE id = %s
                    RETURNING mode_inertia, current_mode
                """, (new_inertia, session_id))
                
                session_update = cur.fetchone()
                
                # Update user performance cache
                _update_user_performance(
                    user_id=session_row["user_id"],
                    tenant_id=session_row["tenant_id"],
                    task_type=task_row["task_type"],
                    new_score=evaluation.composite_score
                )
                
                conn.commit()
        finally:
            pool.putconn(conn)
            
    except Exception as e:
        print(f"[Study] Warning: Failed to submit attempt to DB: {e}. Returning mock response.")
        # Mock evaluation for fallback
        from models.study import EvaluationResult
        import traceback
        traceback.print_exc()
        
        evaluation = EvaluationResult(
            score_json={"accuracy": 1.0, "completeness": 1.0, "relevance": 1.0},
            composite_score=1.0,
            feedback_text="Excellent work! (System is in offline/fallback mode)",
            gap_concepts=[]
        )
        # Mock session update 
        session_update = {"mode_inertia": 0.5, "current_mode": "explain"}
        # Mock inertia delta
        new_inertia = 0.5
        pass
    
    # Build suggested next task
    suggested_next = None
    if evaluation.composite_score >= 0.7:
        # Suggest escalation
        suggested_next = {
            "task_type": "explain_back",
            "reason": "You've shown understanding; try teaching it!"
        }
    elif evaluation.gap_concepts:
        suggested_next = {
            "task_type": "clarify",
            "reason": "Let's clarify some concepts first."
        }
    
    # Build mode state
    inertia_delta = new_inertia - session_row["mode_inertia"]
    mode_state = {
        "current_mode": session_update["current_mode"],
        "inertia": session_update["mode_inertia"],
        "threshold": 0.35,
        "inertia_delta": inertia_delta
    }
    
    return AttemptResponse(
        evaluation=evaluation,
        suggested_next=suggested_next,
        mode_state=mode_state
    )


def end_session(session_id: str) -> SessionSummary:
    """
    End a study session and return summary.
    
    Args:
        session_id: Session UUID
    
    Returns:
        SessionSummary with stats
    """
    
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Mark session as ended
            ended_at = datetime.utcnow().isoformat()
            cur.execute("""
                UPDATE study_sessions
                SET ended_at = %s
                WHERE id = %s
                RETURNING started_at
            """, (ended_at, session_id))
            
            session_row = cur.fetchone()
            if not session_row:
                raise ValueError(f"Session not found: {session_id}")
            
            # Get session stats
            cur.execute("""
                SELECT
                    COUNT(DISTINCT st.id) as tasks_completed,
                    AVG(sa.composite_score) as avg_score
                FROM study_tasks st
                LEFT JOIN study_attempts sa ON sa.task_id = st.id
                WHERE st.session_id = %s
            """, (session_id,))
            
            stats = cur.fetchone()
            
            # Calculate duration
            started = datetime.fromisoformat(session_row["started_at"])
            ended = datetime.fromisoformat(ended_at)
            duration_seconds = int((ended - started).total_seconds())
            
            conn.commit()
    finally:
        pool.putconn(conn)
    
    return SessionSummary(
        session_id=session_id,
        tasks_completed=stats["tasks_completed"] or 0,
        avg_score=float(stats["avg_score"] or 0.0),
        duration_seconds=duration_seconds,
        concepts_covered=[]  # TODO: Extract from tasks
    )


def _generate_next_task(
    session_id: str,
    user_id: str,
    tenant_id: str,
    topic_id: Optional[str],
    selection_id: Optional[str],
    current_mode: str,
    mode_inertia: float,
    neo4j_session: Optional[Neo4jSession]
) -> TaskSpec:
    """
    Generate the next task for a session.
    Phase 3: Intelligent orchestrator-based task selection.
    """
    
    # Get task history for this session
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT task_type FROM study_tasks
                WHERE session_id = %s
                ORDER BY created_at DESC
                LIMIT 5
            """, (session_id,))
            
            recent_tasks = [row["task_type"] for row in cur.fetchall()]
    finally:
        pool.putconn(conn)
    
    # Get user performance from cache
    user_performance = _get_user_performance(user_id, tenant_id)
    
    # Use orchestrator to select next task
    next_task_type = select_next_task(
        session_id=session_id,
        user_performance=user_performance,
        current_mode=current_mode,
        mode_inertia=mode_inertia,
        recent_tasks=recent_tasks,
        threshold=0.7
    )
    
    # Build context pack
    from models.study import ContextPack
    context_pack = ContextPack(excerpts=[], concepts=[])
    
    if selection_id and neo4j_session:
        from services.context_builder import build_context_from_selection
        context_pack = build_context_from_selection(
            session=neo4j_session,
            selection_id=selection_id,
            radius=2,
            include_related=True,
            user_id=user_id,
            tenant_id=tenant_id
        )
    
    # Calculate adaptive difficulty for this task type (Phase 4)
    difficulty = 0.5  # Default intermediate
    try:
        from services.difficulty_engine import calculate_difficulty_level
        difficulty = calculate_difficulty_level(user_id, tenant_id, next_task_type)
    except (ImportError, Exception) as e:
        # Fallback to default if difficulty engine unavailable
        pass
    
    # Generate task with adaptive difficulty
    task_spec = generate_task(
        session_id=session_id,
        task_type=next_task_type,
        context_pack=context_pack,
        difficulty=difficulty,  # NEW: Adaptive difficulty
        term="the key term",  # TODO: Extract from context
        concept="this concept"  # TODO: Extract from topic_id
    )
    
    # Save task to database
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            import json
            cur.execute("""
                INSERT INTO study_tasks (
                    id, session_id, task_type, prompt, rubric_json,
                    context_pack_json, compatible_modes, disruption_cost
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                task_spec.task_id, session_id, task_spec.task_type,
                task_spec.prompt, json.dumps(task_spec.rubric_json),
                json.dumps(task_spec.context_pack.model_dump()),
                json.dumps(task_spec.compatible_modes),
                task_spec.disruption_cost
            ))
            conn.commit()
    finally:
        pool.putconn(conn)
    
    return task_spec


def _get_user_performance(user_id: str, tenant_id: str) -> Dict[str, float]:
    """
    Get user's average performance by task type from cache.
    
    Args:
        user_id: User ID
        tenant_id: Tenant ID
    
    Returns:
        Dict of {task_type: avg_score}
    """
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT task_type, avg_score
                FROM user_performance_cache
                WHERE user_id = %s AND tenant_id = %s
            """, (user_id, tenant_id))
            
            rows = cur.fetchall()
            
            # Convert to dict
            performance = {row["task_type"]: row["avg_score"] for row in rows}
            
            # Fill in defaults for missing task types
            for task_type in get_task_types():
                if task_type not in performance:
                    performance[task_type] = 0.5  # Default for new users
            
            return performance
    finally:
        pool.putconn(conn)


def _update_user_performance(
    user_id: str,
    tenant_id: str,
    task_type: str,
    new_score: float
):
    """
    Update user performance cache with new attempt score.
    
    Args:
        user_id: User ID
        tenant_id: Tenant ID
        task_type: Task type
        new_score: Composite score from attempt
    """
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            # Upsert into cache
            cur.execute("""
                INSERT INTO user_performance_cache (
                    user_id, tenant_id, task_type, avg_score, attempt_count, last_updated
                )
                VALUES (%s, %s, %s, %s, 1, NOW())
                ON CONFLICT (user_id, tenant_id, task_type)
                DO UPDATE SET
                    avg_score = (
                        user_performance_cache.avg_score * user_performance_cache.attempt_count + %s
                    ) / (user_performance_cache.attempt_count + 1),
                    attempt_count = user_performance_cache.attempt_count + 1,
                    last_updated = NOW()
            """, (user_id, tenant_id, task_type, new_score, new_score))
            
            conn.commit()
    finally:
        pool.putconn(conn)
