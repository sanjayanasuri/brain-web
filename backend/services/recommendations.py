# backend/services/recommendations.py
"""
Recommendation engine for Phase 4.
Generates personalized study suggestions based on performance.
"""

from typing import List, Dict, Optional
import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2.pool import ThreadedConnectionPool
import uuid

from config import POSTGRES_CONNECTION_STRING


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


def generate_recommendations(
    user_id: str,
    tenant_id: str
) -> List[Dict]:
    """
    Generate personalized study recommendations.
    
    Returns:
        List of recommendation dicts with type, priority, message, action, params
    """
    recommendations = []
    
    # 1. Identify weak task types
    weak_tasks = _get_weak_task_types(user_id, tenant_id, threshold=0.6)
    if weak_tasks:
        task = weak_tasks[0]
        recommendations.append({
            'type': 'task_focus',
            'priority': 'high',
            'message': f"Practice {task['task_type'].replace('_', ' ')} - your average is {task['score']:.0%}",
            'action': 'start_session',
            'params': {'focus_task': task['task_type']}
        })
    
    # 2. Identify gap concepts
    gap_concepts = _get_gap_concepts(user_id, tenant_id, limit=3)
    if gap_concepts:
        concept_names = [c['concept'] for c in gap_concepts]
        recommendations.append({
            'type': 'concept_review',
            'priority': 'medium',
            'message': f"Review concepts: {', '.join(concept_names[:2])}",
            'action': 'review_concepts',
            'params': {'concepts': concept_names}
        })
    
    # 3. Check session completion rate
    completion_rate = _get_completion_rate(user_id, tenant_id)
    if completion_rate < 0.7 and completion_rate > 0:
        recommendations.append({
            'type': 'session_length',
            'priority': 'low',
            'message': "Try shorter sessions (3-4 tasks) for better focus",
            'action': None,
            'params': None
        })
    
    # 4. Check for improvement opportunities
    velocity = _get_learning_velocity(user_id, tenant_id)
    if velocity and velocity['trend'] == 'declining':
        recommendations.append({
            'type': 'motivation',
            'priority': 'medium',
            'message': "Take a break or try a different task type to refresh",
            'action': None,
            'params': None
        })
    
    # 5. Celebrate successes
    if velocity and velocity['trend'] == 'improving':
        recommendations.append({
            'type': 'celebration',
            'priority': 'low',
            'message': f"Great progress! You've improved {velocity['weekly_improvement']:.0%} recently 🎉",
            'action': None,
            'params': None
        })
    
    return recommendations


def save_recommendations(
    user_id: str,
    tenant_id: str,
    recommendations: List[Dict]
):
    """
    Save recommendations to database.
    
    Args:
        user_id: User ID
        tenant_id: Tenant ID
        recommendations: List of recommendation dicts
    """
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            for rec in recommendations:
                import json
                cur.execute("""
                    INSERT INTO recommendations (
                        id, user_id, tenant_id, type, priority,
                        message, action, params
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    str(uuid.uuid4()),
                    user_id,
                    tenant_id,
                    rec['type'],
                    rec['priority'],
                    rec['message'],
                    rec.get('action'),
                    json.dumps(rec.get('params')) if rec.get('params') else None
                ))
            
            conn.commit()
    finally:
        pool.putconn(conn)


def get_active_recommendations(
    user_id: str,
    tenant_id: str,
    limit: int = 5
) -> List[Dict]:
    """
    Get active (non-dismissed) recommendations.
    
    Returns:
        List of recommendation dicts
    """
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT 
                    id, type, priority, message, action, params, created_at
                FROM recommendations
                WHERE user_id = %s AND tenant_id = %s
                AND dismissed = FALSE
                ORDER BY 
                    CASE priority
                        WHEN 'high' THEN 1
                        WHEN 'medium' THEN 2
                        WHEN 'low' THEN 3
                    END,
                    created_at DESC
                LIMIT %s
            """, (user_id, tenant_id, limit))
            
            rows = cur.fetchall()
            
            return [{
                'id': str(row['id']),
                'type': row['type'],
                'priority': row['priority'],
                'message': row['message'],
                'action': row['action'],
                'params': row['params'],
                'created_at': row['created_at'].isoformat()
            } for row in rows]
    finally:
        pool.putconn(conn)


def dismiss_recommendation(
    recommendation_id: str,
    user_id: str,
    tenant_id: str
):
    """
    Dismiss a recommendation.
    
    Args:
        recommendation_id: Recommendation UUID
        user_id: User ID (for security check)
        tenant_id: Tenant ID (for security check)
    """
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE recommendations
                SET dismissed = TRUE
                WHERE id = %s AND user_id = %s AND tenant_id = %s
            """, (recommendation_id, user_id, tenant_id))
            
            conn.commit()
    finally:
        pool.putconn(conn)


# Helper functions

def _get_weak_task_types(
    user_id: str,
    tenant_id: str,
    threshold: float = 0.6
) -> List[Dict]:
    """Get task types where user is struggling."""
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT task_type, avg_score
                FROM user_performance_cache
                WHERE user_id = %s AND tenant_id = %s
                AND avg_score < %s
                AND attempt_count >= 3
                ORDER BY avg_score ASC
                LIMIT 3
            """, (user_id, tenant_id, threshold))
            
            return [{
                'task_type': row['task_type'],
                'score': row['avg_score']
            } for row in cur.fetchall()]
    finally:
        pool.putconn(conn)


def _get_gap_concepts(
    user_id: str,
    tenant_id: str,
    limit: int = 3
) -> List[Dict]:
    """Get concepts user needs to review."""
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT concept_name, mastery_score
                FROM concept_mastery
                WHERE user_id = %s AND tenant_id = %s
                AND mastery_score < 0.6
                AND exposure_count >= 2
                ORDER BY mastery_score ASC
                LIMIT %s
            """, (user_id, tenant_id, limit))
            
            return [{
                'concept': row['concept_name'],
                'score': row['mastery_score']
            } for row in cur.fetchall()]
    finally:
        pool.putconn(conn)


def _get_completion_rate(user_id: str, tenant_id: str) -> float:
    """Get session completion rate."""
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT 
                    COUNT(*) as total,
                    COUNT(ended_at) as completed
                FROM study_sessions
                WHERE user_id = %s AND tenant_id = %s
            """, (user_id, tenant_id))
            
            row = cur.fetchone()
            
            if row['total'] == 0:
                return 0.0
            
            return row['completed'] / row['total']
    finally:
        pool.putconn(conn)


def _get_learning_velocity(user_id: str, tenant_id: str) -> Optional[Dict]:
    """Get learning velocity (improvement trend)."""
    from services.analytics import get_learning_velocity
    try:
        return get_learning_velocity(user_id, tenant_id)
    except:
        return None
