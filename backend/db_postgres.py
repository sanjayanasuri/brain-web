"""
Postgres database connection utility.
Used for study sessions, usage tracking, and event synchronization.
"""
import os
import logging
import time
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

def init_postgres_db():
    """Initialize all PostgreSQL tables if they don't exist."""
    statements = [
        # Users Table
        """
        CREATE TABLE IF NOT EXISTS users (
            user_id UUID PRIMARY KEY,
            tenant_id UUID NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            full_name VARCHAR(255),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            is_active BOOLEAN DEFAULT TRUE,
            is_admin BOOLEAN DEFAULT FALSE
        );
        """,
        "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);",
        "CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);",
        
        # Study Sessions Table
        """
        CREATE TABLE IF NOT EXISTS study_sessions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id VARCHAR(255) NOT NULL,
            tenant_id VARCHAR(255) NOT NULL,
            graph_id VARCHAR(255),
            branch_id VARCHAR(255),
            topic_id TEXT,
            selection_id TEXT,
            intent VARCHAR(50) NOT NULL,
            current_mode VARCHAR(20) NOT NULL DEFAULT 'explain',
            mode_inertia FLOAT DEFAULT 0.5,
            started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ended_at TIMESTAMPTZ,
            metadata JSONB DEFAULT '{}'::jsonb
        );
        """,
        
        # Voice Sessions Table
        """
        CREATE TABLE IF NOT EXISTS voice_sessions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id VARCHAR(255) NOT NULL,
            tenant_id VARCHAR(255) NOT NULL,
            graph_id VARCHAR(255) NOT NULL,
            branch_id VARCHAR(255) NOT NULL,
            started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ended_at TIMESTAMPTZ,
            metadata JSONB DEFAULT '{}'::jsonb,
            total_duration_seconds INTEGER DEFAULT 0,
            token_usage_estimate INTEGER DEFAULT 0
        );
        """,
        
        # Usage Logs Table (Required for voice sessions)
        """
        CREATE TABLE IF NOT EXISTS usage_logs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id VARCHAR(255) NOT NULL,
            tenant_id VARCHAR(255) NOT NULL,
            action_type VARCHAR(50) NOT NULL,
            quantity FLOAT NOT NULL,
            timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            metadata JSONB DEFAULT '{}'::jsonb
        );
        """,
        "CREATE INDEX IF NOT EXISTS idx_usage_logs_user ON usage_logs(user_id, timestamp DESC);",
        
        # Memory Sync Events Table
        """
        CREATE TABLE IF NOT EXISTS memory_sync_events (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id VARCHAR(255) NOT NULL,
            source VARCHAR(50) NOT NULL,
            memory_id VARCHAR(255),
            content_preview TEXT NOT NULL,
            timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            status VARCHAR(20) DEFAULT 'synced'
        );
        """,
        
        # Chat Messages Table
        """
        CREATE TABLE IF NOT EXISTS chat_messages (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            chat_id TEXT NOT NULL,
            user_id VARCHAR(255) NOT NULL,
            tenant_id VARCHAR(255) NOT NULL,
            role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
            content TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            metadata JSONB DEFAULT '{}'::jsonb
        );
        """,
        "CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON chat_messages(chat_id, created_at ASC);"
    ]
    
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            # First, ensure pgcrypto is available for gen_random_uuid() if not already
            try:
                cur.execute("CREATE EXTENSION IF NOT EXISTS \"pgcrypto\";")
            except Exception:
                logger.warning("Could not create pgcrypto extension. gen_random_uuid() might fail if not already available.")
            
            for stmt in statements:
                if stmt.strip():
                    cur.execute(stmt)
            conn.commit()
            logger.info("Postgres database initialized successfully with study, voice, and usage tables.")
    except Exception as e:
        logger.error(f"Failed to initialize Postgres database: {e}")
        conn.rollback()
    finally:
        conn.close()
