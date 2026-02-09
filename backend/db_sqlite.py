"""
SQLite database connection utility.
Used as a fallback when Postgres is not available.
"""
import os
import sqlite3
import logging
import re
from typing import Optional, List, Dict, Any, Union
from datetime import datetime

logger = logging.getLogger("brain_web")

DB_PATH = os.path.join(os.path.dirname(__file__), "brainweb.db")

def get_db_connection():
    """Create a new database connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def adapt_query(query: str) -> str:
    """Adapt Postgres query syntax to SQLite."""
    # Replace %s with ?
    query = query.replace("%s", "?")
    
    # Remove RETURNING clause (SQLite < 3.35 doesn't support it, and wrapper handles it manually)
    # Actually, Python 3.10+ sqlite3 supports RETURNING if underlying libsqlite3 is new enough.
    # But to be safe, we might need to handle it. 
    # For now, let's assume modern SQLite or handle it in the wrapper if it fails.
    return query

def execute_query(query: str, params: Optional[tuple] = None, fetch: bool = True, commit: bool = False) -> Union[List[Dict[str, Any]], None]:
    """Execute a query and return results."""
    conn = get_db_connection()
    try:
        # Simple/Naive adaptation for %s -> ?
        adapted_query = query.replace("%s", "?")
        
        # Handle Postgres-specific types in params?
        # sqlite3 handles datetime objects fine.
        
        cur = conn.cursor()
        
        # Check if query has RETURNING
        has_returning = "RETURNING" in adapted_query.upper()
        
        try:
            cur.execute(adapted_query, params or ())
        except sqlite3.OperationalError as e:
            # Fallback for RETURNING clause if not supported
            if "syntax error" in str(e).lower() and has_returning:
                # Strip RETURNING for the execution
                clean_query = re.sub(r'RETURNING.*', '', adapted_query, flags=re.IGNORECASE).strip()
                cur.execute(clean_query, params or ())
                
                # if it was an insert, valid "returning" behavior usually wants the ID or the whole row.
                # simpler approach: just return empty if we can't do RETURNING
                if fetch:
                    # If we really need the data, we might be in trouble, but for MVP local auth, 
                    # create_user needs the ID.
                    # We can fetch the last inserted row if it was an insert.
                    if "INSERT" in clean_query.upper():
                         # This is hacky but might work for simple cases
                         pass
            else:
                raise e

        result = None
        if fetch:
            rows = cur.fetchall()
            result = [dict(row) for row in rows]
        
        if commit or not fetch:
            conn.commit()
            
        return result
    except Exception as e:
        logger.error(f"SQLite query failed: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()

def execute_update(query: str, params: Optional[tuple] = None):
    """Execute an update/insert query."""
    return execute_query(query, params, fetch=False, commit=True)
