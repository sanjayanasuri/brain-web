# backend/services/difficulty_engine.py
"""
Adaptive difficulty engine for Phase 4.
Adjusts task complexity based on user performance.
"""

from typing import Dict, Optional
import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2.pool import ThreadedConnectionPool

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


def calculate_difficulty_level(
    user_id: str,
    tenant_id: str,
    task_type: str
) -> float:
    """
    Calculate appropriate difficulty for user on task type.
    
    Logic:
    - If avg_score > 0.8 for 3+ attempts: increase difficulty
    - If avg_score < 0.5 for 3+ attempts: decrease difficulty
    - If new task type: start at intermediate (0.5)
    
    Returns:
        Difficulty level (0-1): 0=beginner, 0.5=intermediate, 1=expert
    """
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Get current difficulty level
            cur.execute("""
                SELECT difficulty_level
                FROM user_difficulty_levels
                WHERE user_id = %s AND tenant_id = %s AND task_type = %s
            """, (user_id, tenant_id, task_type))
            
            row = cur.fetchone()
            current_difficulty = row['difficulty_level'] if row else 0.5
            
            # Get performance on this task type
            cur.execute("""
                SELECT avg_score, attempt_count
                FROM user_performance_cache
                WHERE user_id = %s AND tenant_id = %s AND task_type = %s
            """, (user_id, tenant_id, task_type))
            
            perf_row = cur.fetchone()
            
            if not perf_row or perf_row['attempt_count'] < 3:
                # Not enough data, use default
                return current_difficulty
            
            avg_score = perf_row['avg_score']
            
            # Adjust difficulty based on performance
            if avg_score >= 0.8:
                # Performing well, increase difficulty
                new_difficulty = min(1.0, current_difficulty + 0.1)
            elif avg_score >= 0.6:
                # Doing okay, maintain difficulty
                new_difficulty = current_difficulty
            else:
                # Struggling, decrease difficulty
                new_difficulty = max(0.0, current_difficulty - 0.1)
            
            # Update difficulty level
            cur.execute("""
                INSERT INTO user_difficulty_levels (
                    user_id, tenant_id, task_type, difficulty_level
                )
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (user_id, tenant_id, task_type)
                DO UPDATE SET
                    difficulty_level = %s,
                    last_updated = NOW()
            """, (user_id, tenant_id, task_type, new_difficulty, new_difficulty))
            
            conn.commit()
            
            return new_difficulty
    finally:
        pool.putconn(conn)


def get_difficulty_label(difficulty: float) -> str:
    """
    Get human-readable difficulty label.
    
    Args:
        difficulty: Difficulty level (0-1)
    
    Returns:
        Label: 'beginner', 'intermediate', 'advanced', or 'expert'
    """
    if difficulty < 0.3:
        return 'beginner'
    elif difficulty < 0.6:
        return 'intermediate'
    elif difficulty < 0.85:
        return 'advanced'
    else:
        return 'expert'


# Difficulty-specific task templates
DIFFICULTY_TEMPLATES = {
    'clarify': {
        'beginner': "In simple terms, what is {term}? (1-2 sentences)",
        'intermediate': "Explain {term} in your own words.",
        'advanced': "Explain {term} and describe how it relates to {concept}.",
        'expert': "Provide a comprehensive explanation of {term}, including its relationship to {concept} and practical applications."
    },
    'explain_back': {
        'beginner': "Tell me what you learned about {concept}.",
        'intermediate': "Explain {concept} in detail, including at least one example.",
        'advanced': "Teach me {concept} as if I'm a beginner. Include examples and explain why it's important.",
        'expert': "Provide an in-depth explanation of {concept}, covering theory, applications, and edge cases."
    },
    'define_example': {
        'beginner': "Define {term} and give one simple example.",
        'intermediate': "Define {term} and provide two real-world examples.",
        'advanced': "Define {term}, provide multiple examples, and explain when to use it versus alternatives.",
        'expert': "Define {term} comprehensively, provide diverse examples, and analyze trade-offs in different scenarios."
    },
    'compare_contrast': {
        'beginner': "What's the main difference between {term1} and {term2}?",
        'intermediate': "Compare and contrast {term1} and {term2}.",
        'advanced': "Compare {term1} and {term2}, explaining when to use each.",
        'expert': "Provide a detailed comparison of {term1} and {term2}, including use cases, trade-offs, and best practices."
    },
    'apply_concept': {
        'beginner': "Give one example of how {concept} is used.",
        'intermediate': "Describe a scenario where you would use {concept}.",
        'advanced': "Design a solution using {concept} and explain your approach.",
        'expert': "Design a comprehensive system using {concept}, justify your choices, and discuss potential challenges."
    }
}


def get_difficulty_template(
    task_type: str,
    difficulty: float,
    context: Dict
) -> str:
    """
    Get task prompt template for given difficulty level.
    
    Args:
        task_type: Type of task
        difficulty: Difficulty level (0-1)
        context: Context dict with term, concept, etc.
    
    Returns:
        Formatted task prompt
    """
    if task_type not in DIFFICULTY_TEMPLATES:
        # Fallback to intermediate template
        return f"Explain {context.get('term', 'this concept')} in your own words."
    
    level = get_difficulty_label(difficulty)
    template = DIFFICULTY_TEMPLATES[task_type][level]
    
    # Fill in placeholders
    prompt = template.format(
        term=context.get('term', 'this concept'),
        concept=context.get('concept', 'the topic'),
        term1=context.get('term1', 'concept A'),
        term2=context.get('term2', 'concept B')
    )
    
    return prompt
