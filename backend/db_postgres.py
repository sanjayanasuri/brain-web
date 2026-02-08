"""
Postgres database connection utility.
Used for study sessions, usage tracking, and event synchronization.
"""
import os
import logging
from typing import Optional, Generator
import psycopg2
from psycopg2.extensions import register_adapter
from psycopg2.extras import RealDictCursor, Json
from config import POSTGRES_CONNECTION_STRING

# Register adapter to handle dicts as JSON automatically
register_adapter(dict, Json)

logger = logging.getLogger("brain_web")

# Connection pool would be better in production, using simple connections for now
def get_db_connection():
    """Create a new database connection."""
    try:
        conn = psycopg2.connect(POSTGRES_CONNECTION_STRING)
        return conn
    except Exception as e:
        logger.error(f"Failed to connect to Postgres: {e}")
        raise

def get_db_cursor(conn):
    """Get a cursor that returns rows as dictionaries."""
    return conn.cursor(cursor_factory=RealDictCursor)

def execute_query(query: str, params: Optional[tuple] = None, fetch: bool = True, commit: bool = False):
    """Execute a query and return results."""
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, params)
            if fetch:
                result = cur.fetchall()
            else:
                result = None
            
            if commit or not fetch:
                conn.commit()
                
            return result
    except Exception as e:
        logger.error(f"Postgres query failed: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()

def execute_update(query: str, params: Optional[tuple] = None):
    """Execute an update/insert query."""
    return execute_query(query, params, fetch=False)
