# backend/jobs/daily_rollup.py
"""
Daily rollup job for Phase 4 analytics.
Aggregates performance metrics and generates recommendations.
Run this daily via cron or scheduler.
"""

import os
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import date, timedelta
import json

from config import POSTGRES_CONNECTION_STRING
from services.recommendations import generate_recommendations, save_recommendations


def run_daily_rollup():
    """
    Aggregate daily performance metrics for all active users.
    Should be run once per day (e.g., midnight UTC).
    """
    
    conn_str = os.getenv('POSTGRES_CONNECTION_STRING', POSTGRES_CONNECTION_STRING)
    if not conn_str:
        print("❌ Error: POSTGRES_CONNECTION_STRING not set")
        return False
    
    try:
        conn = psycopg2.connect(conn_str)
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        yesterday = date.today() - timedelta(days=1)
        
        print(f"Running daily rollup for {yesterday}...")
        
        # Get all users who had activity yesterday
        cur.execute("""
            SELECT DISTINCT s.user_id, s.tenant_id
            FROM study_sessions s
            WHERE DATE(s.started_at) = %s
        """, (yesterday,))
        
        users = cur.fetchall()
        
        print(f"Found {len(users)} active users")
        
        for user in users:
            user_id = user['user_id']
            tenant_id = user['tenant_id']
            
            print(f"  Processing user {user_id}...")
            
            # Calculate daily stats
            stats = calculate_daily_stats(cur, user_id, tenant_id, yesterday)
            
            if stats:
                # Insert into performance_history
                insert_performance_history(cur, user_id, tenant_id, yesterday, stats)
                
                # Generate and save recommendations
                try:
                    recs = generate_recommendations(user_id, tenant_id)
                    if recs:
                        save_recommendations(user_id, tenant_id, recs)
                        print(f"    Generated {len(recs)} recommendations")
                except Exception as e:
                    print(f"    Warning: Failed to generate recommendations: {e}")
        
        conn.commit()
        print(f"✓ Daily rollup complete for {yesterday}")
        return True
        
    except Exception as e:
        print(f"❌ Error during rollup: {e}")
        return False
    finally:
        if 'cur' in locals():
            cur.close()
        if 'conn' in locals():
            conn.close()


def calculate_daily_stats(cur, user_id: str, tenant_id: str, target_date: date) -> dict:
    """
    Calculate daily performance statistics for a user.
    
    Returns:
        Dict with avg_score, task_count, session_count, mode_distribution
    """
    
    # Get all attempts for the day
    cur.execute("""
        SELECT 
            a.composite_score,
            t.task_type,
            s.current_mode
        FROM study_attempts a
        JOIN study_tasks t ON a.task_id = t.id
        JOIN study_sessions s ON t.session_id = s.id
        WHERE s.user_id = %s AND s.tenant_id = %s
        AND DATE(a.created_at) = %s
    """, (user_id, tenant_id, target_date))
    
    attempts = cur.fetchall()
    
    if not attempts:
        return None
    
    # Calculate average score
    avg_score = sum(a['composite_score'] for a in attempts) / len(attempts)
    
    # Count tasks
    task_count = len(attempts)
    
    # Count sessions
    cur.execute("""
        SELECT COUNT(DISTINCT id) as session_count
        FROM study_sessions
        WHERE user_id = %s AND tenant_id = %s
        AND DATE(started_at) = %s
    """, (user_id, tenant_id, target_date))
    
    session_count = cur.fetchone()['session_count']
    
    # Mode distribution
    mode_dist = {}
    for attempt in attempts:
        mode = attempt['current_mode']
        mode_dist[mode] = mode_dist.get(mode, 0) + 1
    
    return {
        'avg_score': avg_score,
        'task_count': task_count,
        'session_count': session_count,
        'mode_distribution': mode_dist
    }


def insert_performance_history(
    cur,
    user_id: str,
    tenant_id: str,
    target_date: date,
    stats: dict
):
    """Insert daily performance record."""
    
    cur.execute("""
        INSERT INTO performance_history (
            user_id, tenant_id, date,
            avg_score, task_count, session_count, mode_distribution
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (user_id, tenant_id, date)
        DO UPDATE SET
            avg_score = EXCLUDED.avg_score,
            task_count = EXCLUDED.task_count,
            session_count = EXCLUDED.session_count,
            mode_distribution = EXCLUDED.mode_distribution
    """, (
        user_id,
        tenant_id,
        target_date,
        stats['avg_score'],
        stats['task_count'],
        stats['session_count'],
        json.dumps(stats['mode_distribution'])
    ))


if __name__ == '__main__':
    success = run_daily_rollup()
    exit(0 if success else 1)
