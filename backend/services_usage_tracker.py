"""
Service for tracking usage and enforcing limits.
Similar to how ChatGPT tracks token/message usage.
"""
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, Optional

from db_postgres import execute_update, execute_query

logger = logging.getLogger("brain_web")

# Default quotas (placeholder)
DEFAULT_DAILY_VOICE_MINUTES = 60
DEFAULT_DAILY_CHAT_TOKENS = 100000

def log_usage(user_id: str, tenant_id: str, action_type: str, quantity: float, metadata: Optional[Dict[str, Any]] = None):
    """
    Log a usage event.
    action_type: 'voice_session' (seconds), 'chat_tokens' (count)
    """
    query = """
    INSERT INTO usage_logs (user_id, tenant_id, action_type, quantity, timestamp, metadata)
    VALUES (%s, %s, %s, %s, %s, %s)
    """
    params = (
        user_id,
        tenant_id,
        action_type,
        quantity,
        datetime.utcnow(),
        metadata or {}
    )
    try:
        execute_update(query, params)
    except Exception as e:
        logger.error(f"Failed to log usage: {e}")

def get_daily_usage(user_id: str, action_type: str) -> float:
    """
    Get total usage for the current UTC day.
    """
    start_of_day = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    query = """
    SELECT SUM(quantity) as total
    FROM usage_logs
    WHERE user_id = %s AND action_type = %s AND timestamp >= %s
    """
    result = execute_query(query, (user_id, action_type, start_of_day))
    if result and result[0]['total']:
        return float(result[0]['total'])
    return 0.0

def check_limit(user_id: str, action_type: str) -> bool:
    """
    Check if a user has exceeded their daily limit.
    """
    usage = get_daily_usage(user_id, action_type)
    
    if action_type == 'voice_session':
        # usage is in seconds, limit in minutes
        return (usage / 60) < DEFAULT_DAILY_VOICE_MINUTES
    elif action_type == 'chat_tokens':
        return usage < DEFAULT_DAILY_CHAT_TOKENS
        
    return True
