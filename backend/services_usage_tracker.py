"""
Service for tracking usage and enforcing per-user daily limits.
All limits are configured via environment variables so they can be tuned
in production without a code deploy.
"""
import logging
import os
from datetime import datetime
from typing import Dict, Any, Optional

from db_postgres import execute_update, execute_query

logger = logging.getLogger("brain_web")

# ---------------------------------------------------------------------------
# Quota configuration — override via env vars in production
# ---------------------------------------------------------------------------
# Daily voice limit in minutes (default 60). Set DAILY_VOICE_MINUTES=0 to disable.
DAILY_VOICE_MINUTES = int(os.getenv("DAILY_VOICE_MINUTES", "60"))

# Daily chat token limit (default 100 000). Set DAILY_CHAT_TOKENS=0 to disable.
DAILY_CHAT_TOKENS = int(os.getenv("DAILY_CHAT_TOKENS", "100000"))


def log_usage(
    user_id: str,
    tenant_id: str,
    action_type: str,
    quantity: float,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    """
    Log a usage event.
    action_type: 'voice_session' (quantity in seconds), 'chat_tokens' (count)
    """
    query = """
    INSERT INTO usage_logs (user_id, tenant_id, action_type, quantity, timestamp, metadata)
    VALUES (%s, %s, %s, %s, %s, %s)
    """
    params = (user_id, tenant_id, action_type, quantity, datetime.utcnow(), metadata or {})
    try:
        execute_update(query, params)
    except Exception as e:
        logger.error(f"[usage_tracker] Failed to log usage: {e}")


def get_daily_usage(user_id: str, action_type: str) -> float:
    """Get total usage for the current UTC day."""
    start_of_day = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    query = """
    SELECT COALESCE(SUM(quantity), 0) AS total
    FROM usage_logs
    WHERE user_id = %s AND action_type = %s AND timestamp >= %s
    """
    result = execute_query(query, (user_id, action_type, start_of_day))
    if result:
        return float(result[0]["total"] or 0.0)
    return 0.0


def check_limit(user_id: str, action_type: str) -> bool:
    """
    Return True if the user is within their daily quota for action_type.
    Limits are disabled (always return True) when set to 0.
    """
    usage = get_daily_usage(user_id, action_type)

    if action_type == "voice_session":
        if DAILY_VOICE_MINUTES == 0:
            return True  # unlimited
        return (usage / 60) < DAILY_VOICE_MINUTES

    if action_type == "chat_tokens":
        if DAILY_CHAT_TOKENS == 0:
            return True  # unlimited
        return usage < DAILY_CHAT_TOKENS

    return True  # unknown action types are not rate-limited
