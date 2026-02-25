# backend/services/analytics.py
"""
Performance analytics service for Phase 4.
Tracks trends, concept mastery, learning velocity, and weak areas.
"""

from typing import Dict, List, Optional, Tuple
from datetime import datetime, timedelta, date
import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2.pool import ThreadedConnectionPool

from config import POSTGRES_CONNECTION_STRING
import uuid
from db_neo4j import neo4j_session


_pool: Optional[ThreadedConnectionPool] = None


def _get_pool() -> ThreadedConnectionPool:
    """Get Postgres connection pool."""
    global _pool
    if _pool is None:
        _pool = ThreadedConnectionPool(
            minconn=1,
            maxconn=10,
            dsn=POSTGRES_CONNECTION_STRING
        )
    return _pool


def get_user_trends(
    user_id: str,
    tenant_id: str,
    days: int = 30
) -> List[Dict]:
    """
    Get performance trends over time.
    
    Returns:
        List of daily performance records with avg_score, task_count, etc.
    """
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT 
                    date,
                    avg_score,
                    task_count,
                    session_count,
                    mode_distribution
                FROM performance_history
                WHERE user_id = %s AND tenant_id = %s
                AND date >= CURRENT_DATE - INTERVAL '%s days'
                ORDER BY date ASC
            """, (user_id, tenant_id, days))
            
            rows = cur.fetchall()
            
            # Calculate 7-day moving average
            trends = []
            for i, row in enumerate(rows):
                # Get last 7 days for moving average
                start_idx = max(0, i - 6)
                window = rows[start_idx:i+1]
                moving_avg = sum(r['avg_score'] for r in window) / len(window)
                
                trends.append({
                    'date': row['date'].isoformat(),
                    'avg_score': row['avg_score'],
                    'task_count': row['task_count'],
                    'session_count': row['session_count'],
                    'mode_distribution': row['mode_distribution'],
                    'moving_avg': moving_avg
                })
            
            return trends
    finally:
        pool.putconn(conn)


def get_concept_mastery(
    user_id: str,
    tenant_id: str,
    limit: Optional[int] = None
) -> List[Dict]:
    """
    Get concept mastery levels.
    
    Returns:
        List of concepts with mastery scores, sorted by score descending.
    """
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            query = """
                SELECT 
                    concept_name,
                    mastery_score,
                    exposure_count,
                    success_count,
                    last_seen
                FROM concept_mastery
                WHERE user_id = %s AND tenant_id = %s
                ORDER BY mastery_score DESC
            """
            
            if limit:
                query += f" LIMIT {limit}"
            
            cur.execute(query, (user_id, tenant_id))
            
            rows = cur.fetchall()
            
            return [{
                'concept_name': row['concept_name'],
                'mastery_score': row['mastery_score'],
                'exposure_count': row['exposure_count'],
                'success_count': row['success_count'],
                'success_rate': row['success_count'] / row['exposure_count'] if row['exposure_count'] > 0 else 0,
                'last_seen': row['last_seen'].isoformat() if row['last_seen'] else None
            } for row in rows]
    finally:
        pool.putconn(conn)


def get_learning_velocity(
    user_id: str,
    tenant_id: str
) -> Dict:
    """
    Calculate rate of improvement.
    
    Returns:
        Dict with weekly improvement rate and trend direction.
    """
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Get last 4 weeks of data
            cur.execute("""
                SELECT 
                    date,
                    avg_score
                FROM performance_history
                WHERE user_id = %s AND tenant_id = %s
                AND date >= CURRENT_DATE - INTERVAL '28 days'
                ORDER BY date ASC
            """, (user_id, tenant_id))
            
            rows = cur.fetchall()
            
            if len(rows) < 7:
                return {
                    'weekly_improvement': 0.0,
                    'trend': 'insufficient_data',
                    'current_avg': 0.5,
                    'previous_avg': 0.5
                }
            
            # Split into two halves
            mid = len(rows) // 2
            first_half = rows[:mid]
            second_half = rows[mid:]
            
            first_avg = sum(r['avg_score'] for r in first_half) / len(first_half)
            second_avg = sum(r['avg_score'] for r in second_half) / len(second_half)
            
            improvement = second_avg - first_avg
            
            return {
                'weekly_improvement': improvement,
                'trend': 'improving' if improvement > 0.05 else 'declining' if improvement < -0.05 else 'stable',
                'current_avg': second_avg,
                'previous_avg': first_avg
            }
    finally:
        pool.putconn(conn)


def identify_weak_areas(
    user_id: str,
    tenant_id: str,
    threshold: float = 0.6
) -> Dict:
    """
    Find concepts and task types user struggles with.
    
    Returns:
        Dict with weak_concepts and weak_task_types.
    """
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Weak concepts (mastery < threshold)
            cur.execute("""
                SELECT concept_name, mastery_score
                FROM concept_mastery
                WHERE user_id = %s AND tenant_id = %s
                AND mastery_score < %s
                AND exposure_count >= 2
                ORDER BY mastery_score ASC
                LIMIT 5
            """, (user_id, tenant_id, threshold))
            
            weak_concepts = [{
                'concept': row['concept_name'],
                'score': row['mastery_score']
            } for row in cur.fetchall()]
            
            # Weak task types (avg < threshold)
            cur.execute("""
                SELECT task_type, avg_score
                FROM user_performance_cache
                WHERE user_id = %s AND tenant_id = %s
                AND avg_score < %s
                AND attempt_count >= 3
                ORDER BY avg_score ASC
                LIMIT 3
            """, (user_id, tenant_id, threshold))
            
            weak_task_types = [{
                'task_type': row['task_type'],
                'score': row['avg_score']
            } for row in cur.fetchall()]
            
            return {
                'weak_concepts': weak_concepts,
                'weak_task_types': weak_task_types
            }
    finally:
        pool.putconn(conn)


def get_session_stats(
    user_id: str,
    tenant_id: str
) -> Dict:
    """
    Get aggregate session statistics.
    
    Returns:
        Dict with total sessions, avg duration, completion rate, etc.
    """
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Total sessions
            cur.execute("""
                SELECT COUNT(*) as total_sessions
                FROM study_sessions
                WHERE user_id = %s AND tenant_id = %s
            """, (user_id, tenant_id))
            
            total_sessions = cur.fetchone()['total_sessions']
            
            # Completed sessions (ended_at is not null)
            cur.execute("""
                SELECT COUNT(*) as completed_sessions
                FROM study_sessions
                WHERE user_id = %s AND tenant_id = %s
                AND ended_at IS NOT NULL
            """, (user_id, tenant_id))
            
            completed_sessions = cur.fetchone()['completed_sessions']
            
            # Total tasks completed
            cur.execute("""
                SELECT COUNT(*) as total_tasks
                FROM study_attempts
                WHERE task_id IN (
                    SELECT id FROM study_tasks
                    WHERE session_id IN (
                        SELECT id FROM study_sessions
                        WHERE user_id = %s AND tenant_id = %s
                    )
                )
            """, (user_id, tenant_id))
            
            total_tasks = cur.fetchone()['total_tasks']
            
            # Average score
            cur.execute("""
                SELECT AVG(composite_score) as avg_score
                FROM study_attempts
                WHERE task_id IN (
                    SELECT id FROM study_tasks
                    WHERE session_id IN (
                        SELECT id FROM study_sessions
                        WHERE user_id = %s AND tenant_id = %s
                    )
                )
            """, (user_id, tenant_id))
            
            avg_score_row = cur.fetchone()
            avg_score = avg_score_row['avg_score'] if avg_score_row['avg_score'] else 0.5
            
            return {
                'total_sessions': total_sessions,
                'completed_sessions': completed_sessions,
                'completion_rate': completed_sessions / total_sessions if total_sessions > 0 else 0,
                'total_tasks': total_tasks,
                'avg_tasks_per_session': total_tasks / total_sessions if total_sessions > 0 else 0,
                'avg_score': float(avg_score)
            }
    finally:
        pool.putconn(conn)


def update_concept_mastery(
    user_id: str,
    tenant_id: str,
    concept_name: str,
    success: bool
):
    """
    Update concept mastery after an attempt.
    
    Args:
        user_id: User ID
        tenant_id: Tenant ID
        concept_name: Concept name
        success: Whether attempt was successful (score >= 0.7)
    """
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            # Upsert concept mastery
            cur.execute("""
                INSERT INTO concept_mastery (
                    user_id, tenant_id, concept_name,
                    mastery_score, exposure_count, success_count, last_seen
                )
                VALUES (%s, %s, %s, %s, 1, %s, NOW())
                ON CONFLICT (user_id, tenant_id, concept_name)
                DO UPDATE SET
                    exposure_count = concept_mastery.exposure_count + 1,
                    success_count = concept_mastery.success_count + %s,
                    mastery_score = (
                        concept_mastery.mastery_score * 0.8 + %s * 0.2
                    ),
                    last_seen = NOW(),
                    updated_at = NOW()
            """, (
                user_id, tenant_id, concept_name,
                1.0 if success else 0.3,  # Initial score
                1 if success else 0,      # Success count increment
                1 if success else 0,      # For update
                1.0 if success else 0.0   # For weighted average
            ))
            
            conn.commit()
            
            # Emit ActivityEvent for Mastery Update
            try:
                with neo4j_session() as neo_sess:
                    event_id = str(uuid.uuid4())
                    now = datetime.utcnow().isoformat() + "Z"
                    
                    # Try to get active graph_id if possible, otherwise None
                    # Note: Since this is service-level, we don't have the GraphSpace node easily.
                    # We'll leave graph_id as None or fetch it if crucial.
                    
                    neo_sess.run(
                        """
                        CREATE (e:ActivityEvent {
                            id: $id,
                            user_id: $user_id,
                            graph_id: $graph_id,
                            type: 'MASTERY_UPDATED',
                            payload: $payload,
                            created_at: $created_at
                        })
                        """,
                        id=event_id,
                        user_id=user_id,
                        graph_id=None, # TBD if we can get this easily
                        payload={
                            "concept_name": concept_name,
                            "direction": "up" if success else "down"
                        },
                        created_at=now
                    )
            except Exception as e:
                # Don't fail the mastery update if event emission fails
                pass
    finally:
        pool.putconn(conn)
