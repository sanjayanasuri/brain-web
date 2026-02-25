"""
Utility functions for timestamp conversions.
Consolidates duplicate timestamp conversion patterns across the codebase.
"""
from datetime import datetime


def utcnow_ms() -> int:
    """
    Get current UTC timestamp in milliseconds.
    
    Replaces: int(datetime.utcnow().timestamp() * 1000)
    
    Returns:
        Current timestamp in milliseconds since epoch
    """
    return int(datetime.utcnow().timestamp() * 1000)


def utcnow_iso() -> str:
    """
    Get current UTC timestamp as ISO format string.
    
    Returns:
        ISO format timestamp string (e.g., "2024-01-01T12:00:00.000000Z")
    """
    return datetime.utcnow().isoformat() + "Z"
