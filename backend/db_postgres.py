"""
Postgres database connection utility.
Used for study sessions, usage tracking, and event synchronization.
"""
import atexit
import logging
import threading
from contextvars import ContextVar, Token
from typing import Optional, Tuple

import psycopg2
import psycopg2.pool
from psycopg2.extensions import register_adapter
from psycopg2.extras import RealDictCursor, Json

from config import POSTGRES_CONNECTION_STRING

# Register adapter to handle dicts as JSON automatically
register_adapter(dict, Json)

logger = logging.getLogger("brain_web")

# ---------------------------------------------------------------------------
# Connection pool — shared across all threads / requests
# ---------------------------------------------------------------------------
# min=2 keeps two connections warm; max=20 handles burst concurrency without
# hammering Postgres with new TCP connections on every request.
_pool: Optional[psycopg2.pool.ThreadedConnectionPool] = None
_pool_lock = threading.Lock()
_POOL_MIN = 2
_POOL_MAX = 20

_REQUEST_DB_USER_ID: ContextVar[Optional[str]] = ContextVar("bw_request_db_user_id", default=None)
_REQUEST_DB_TENANT_ID: ContextVar[Optional[str]] = ContextVar("bw_request_db_tenant_id", default=None)


def set_request_db_identity(user_id: Optional[str], tenant_id: Optional[str]) -> Tuple[Token, Token]:
    """Set request-scoped DB identity used for RLS session settings."""
    user_token = _REQUEST_DB_USER_ID.set(str(user_id).strip() if user_id else None)
    tenant_token = _REQUEST_DB_TENANT_ID.set(str(tenant_id).strip() if tenant_id else None)
    return user_token, tenant_token


def reset_request_db_identity(tokens: Tuple[Token, Token]) -> None:
    """Reset request-scoped DB identity."""
    user_token, tenant_token = tokens
    _REQUEST_DB_USER_ID.reset(user_token)
    _REQUEST_DB_TENANT_ID.reset(tenant_token)


def get_request_db_identity() -> Tuple[Optional[str], Optional[str]]:
    """Get request-scoped (user_id, tenant_id) for DB operations."""
    return _REQUEST_DB_USER_ID.get(), _REQUEST_DB_TENANT_ID.get()


def apply_rls_session_settings(cur, *, user_id: Optional[str] = None, tenant_id: Optional[str] = None) -> None:
    """
    Apply per-transaction session settings consumed by RLS policies.
    Uses set_config(..., true) so the values are transaction-local.
    """
    req_user_id, req_tenant_id = get_request_db_identity()
    resolved_user_id = str(user_id).strip() if user_id else (str(req_user_id).strip() if req_user_id else None)
    resolved_tenant_id = str(tenant_id).strip() if tenant_id else (str(req_tenant_id).strip() if req_tenant_id else None)

    if resolved_tenant_id:
        cur.execute("SELECT set_config('app.tenant_id', %s, true)", (resolved_tenant_id,))
    if resolved_user_id:
        cur.execute("SELECT set_config('app.user_id', %s, true)", (resolved_user_id,))


def _get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    """Return the singleton connection pool, creating it lazily on first call."""
    global _pool
    if _pool is not None:
        return _pool
    with _pool_lock:
        if _pool is None:
            _pool = psycopg2.pool.ThreadedConnectionPool(
                _POOL_MIN,
                _POOL_MAX,
                POSTGRES_CONNECTION_STRING,
            )
            # Close the pool cleanly when the process exits
            atexit.register(_pool.closeall)
            logger.info(f"[db_postgres] Connection pool created (min={_POOL_MIN}, max={_POOL_MAX})")
    return _pool


def get_db_connection():
    """
    Borrow a connection from the pool.

    IMPORTANT: You MUST call `pool.putconn(conn)` (or use execute_query /
    execute_update helpers) when you're done — borrowed connections are not
    auto-returned until you return them explicitly.
    """
    pool = _get_pool()
    try:
        return pool.getconn()
    except psycopg2.pool.PoolError as e:
        logger.error(f"[db_postgres] Pool exhausted — all {_POOL_MAX} connections in use: {e}")
        raise


def return_db_connection(conn, error: bool = False) -> None:
    """Return a borrowed connection to the pool."""
    pool = _get_pool()
    try:
        pool.putconn(conn, close=error)
    except Exception:
        pass


def get_db_cursor(conn):
    """Get a cursor that returns rows as dictionaries."""
    return conn.cursor(cursor_factory=RealDictCursor)


def execute_query(
    query: str,
    params: Optional[tuple] = None,
    fetch: bool = True,
    commit: bool = False,
):
    """Execute a query and return results. Borrows + auto-returns a pooled connection."""
    conn = get_db_connection()
    error = False
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            apply_rls_session_settings(cur)
            cur.execute(query, params)
            result = cur.fetchall() if fetch else None
            if commit or not fetch:
                conn.commit()
            return result
    except Exception as e:
        error = True
        logger.error(f"[db_postgres] Query failed: {e}")
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        return_db_connection(conn, error=error)


def execute_update(query: str, params: Optional[tuple] = None):
    """Execute an update/insert query."""
    return execute_query(query, params, fetch=False)


# ---------------------------------------------------------------------------
# Schema initialisation — run once at startup via main.py lifespan
# ---------------------------------------------------------------------------

def init_postgres_db():
    """Initialize all PostgreSQL tables if they don't exist."""
    statements = [
        # Users Table
        """
        CREATE TABLE IF NOT EXISTS users (
            user_id UUID PRIMARY KEY,
            tenant_id TEXT NOT NULL,
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
        # Personal API key (for clipper/mobile ingest) — stored hashed; plaintext never persisted.
        "ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS personal_api_key_hash TEXT;",
        "ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS personal_api_key_prefix TEXT;",
        "ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS personal_api_key_created_at TIMESTAMPTZ;",
        "ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS personal_api_key_last_used_at TIMESTAMPTZ;",
        "ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS personal_api_key_revoked_at TIMESTAMPTZ;",
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_personal_api_key_hash_unique
        ON users(personal_api_key_hash)
        WHERE personal_api_key_hash IS NOT NULL;
        """,
        """
        CREATE TABLE IF NOT EXISTS tenants (
            tenant_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            metadata JSONB DEFAULT '{}'::jsonb
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS tenant_memberships (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (tenant_id, user_id)
        );
        """,
        "CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user ON tenant_memberships(user_id);",

        # Study Sessions Table
        """
        CREATE TABLE IF NOT EXISTS study_sessions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id VARCHAR(255) NOT NULL,
            tenant_id TEXT NOT NULL,
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
        "CREATE INDEX IF NOT EXISTS idx_study_sessions_user ON study_sessions(user_id, started_at DESC);",
        "CREATE INDEX IF NOT EXISTS idx_study_sessions_tenant ON study_sessions(tenant_id, started_at DESC);",

        # Study Tasks Table
        """
        CREATE TABLE IF NOT EXISTS study_tasks (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            session_id UUID REFERENCES study_sessions(id) ON DELETE CASCADE,
            task_type VARCHAR(50) NOT NULL,
            prompt TEXT NOT NULL,
            rubric_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            context_pack_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            compatible_modes JSONB NOT NULL DEFAULT '[]'::jsonb,
            disruption_cost FLOAT DEFAULT 0.3,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """,
        "CREATE INDEX IF NOT EXISTS idx_study_tasks_session ON study_tasks(session_id, created_at);",

        # Study Attempts Table
        """
        CREATE TABLE IF NOT EXISTS study_attempts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            task_id UUID REFERENCES study_tasks(id) ON DELETE CASCADE,
            response_text TEXT NOT NULL,
            score_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            composite_score FLOAT NOT NULL DEFAULT 0.0,
            feedback_text TEXT,
            gap_concepts JSONB DEFAULT '[]'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """,
        "CREATE INDEX IF NOT EXISTS idx_study_attempts_task ON study_attempts(task_id, created_at);",

        # Voice Sessions Table
        """
        CREATE TABLE IF NOT EXISTS voice_sessions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id VARCHAR(255) NOT NULL,
            tenant_id TEXT NOT NULL,
            graph_id VARCHAR(255) NOT NULL,
            branch_id VARCHAR(255) NOT NULL,
            started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ended_at TIMESTAMPTZ,
            metadata JSONB DEFAULT '{}'::jsonb,
            total_duration_seconds INTEGER DEFAULT 0,
            token_usage_estimate INTEGER DEFAULT 0
        );
        """,
        "CREATE INDEX IF NOT EXISTS idx_voice_sessions_user ON voice_sessions(user_id, started_at DESC);",

        # Voice Transcript Chunks Table
        """
        CREATE TABLE IF NOT EXISTS voice_transcript_chunks (
            id TEXT PRIMARY KEY,
            voice_session_id TEXT NOT NULL,
            user_id VARCHAR(255) NOT NULL,
            tenant_id TEXT NOT NULL,
            graph_id VARCHAR(255) NOT NULL,
            branch_id VARCHAR(255) NOT NULL,
            role VARCHAR(32) NOT NULL,
            content TEXT NOT NULL,
            start_ms INTEGER,
            end_ms INTEGER,
            anchor_id TEXT,
            anchor_json TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """,
        "CREATE INDEX IF NOT EXISTS idx_voice_transcript_chunks_session ON voice_transcript_chunks(voice_session_id, start_ms, created_at);",
        "CREATE INDEX IF NOT EXISTS idx_voice_transcript_chunks_user_graph ON voice_transcript_chunks(user_id, graph_id, branch_id, created_at DESC);",

        # Voice Learning Signals Table
        """
        CREATE TABLE IF NOT EXISTS voice_learning_signals (
            id TEXT PRIMARY KEY,
            voice_session_id TEXT NOT NULL,
            chunk_id TEXT,
            user_id VARCHAR(255) NOT NULL,
            tenant_id TEXT NOT NULL,
            graph_id VARCHAR(255) NOT NULL,
            branch_id VARCHAR(255) NOT NULL,
            kind VARCHAR(64) NOT NULL,
            payload_json TEXT NOT NULL DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """,
        "CREATE INDEX IF NOT EXISTS idx_voice_learning_signals_session ON voice_learning_signals(voice_session_id, created_at DESC);",
        "CREATE INDEX IF NOT EXISTS idx_voice_learning_signals_kind ON voice_learning_signals(kind);",

        # Usage Logs Table
        """
        CREATE TABLE IF NOT EXISTS usage_logs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id VARCHAR(255) NOT NULL,
            tenant_id TEXT NOT NULL,
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
            tenant_id TEXT,
            source VARCHAR(50) NOT NULL,
            memory_id VARCHAR(255),
            content_preview TEXT NOT NULL,
            timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            status VARCHAR(20) DEFAULT 'synced'
        );
        """,
        "CREATE INDEX IF NOT EXISTS idx_memory_sync_user ON memory_sync_events(user_id, timestamp DESC);",
        "CREATE INDEX IF NOT EXISTS idx_memory_sync_tenant ON memory_sync_events(tenant_id, timestamp DESC);",

        # Chat Messages Table
        """
        CREATE TABLE IF NOT EXISTS chat_messages (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            chat_id TEXT NOT NULL,
            user_id VARCHAR(255) NOT NULL,
            tenant_id TEXT NOT NULL,
            role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
            content TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            metadata JSONB DEFAULT '{}'::jsonb
        );
        """,
        "CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON chat_messages(chat_id, created_at ASC);",

        # Canonical conversation memory events
        """
        CREATE TABLE IF NOT EXISTS conversation_memory_events (
            id TEXT PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            tenant_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            graph_id VARCHAR(255),
            branch_id VARCHAR(255),
            source VARCHAR(32) NOT NULL,
            turn_index INTEGER NOT NULL,
            user_text TEXT NOT NULL,
            assistant_text TEXT,
            metadata JSONB DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """,
        "CREATE INDEX IF NOT EXISTS idx_conversation_memory_events_user ON conversation_memory_events(user_id, tenant_id, created_at DESC);",

        # Interest profiles and suggestion history
        """
        CREATE TABLE IF NOT EXISTS interest_profiles (
            user_id VARCHAR(255) NOT NULL,
            tenant_id TEXT NOT NULL,
            profile_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, tenant_id)
        );
        """,
        """
        CREATE TABLE IF NOT EXISTS content_suggestions (
            id TEXT PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            tenant_id TEXT NOT NULL,
            kind VARCHAR(64) NOT NULL,
            title TEXT NOT NULL,
            reason TEXT,
            query TEXT,
            score DOUBLE PRECISION NOT NULL DEFAULT 0,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """,
        "CREATE INDEX IF NOT EXISTS idx_content_suggestions_user_created ON content_suggestions(user_id, tenant_id, created_at DESC);",

        # -------------------------------------------------------------------
        # Unified Content Pipeline (ContentItem + Analysis + Transcript + Thoughts)
        # -------------------------------------------------------------------
        """
        CREATE TABLE IF NOT EXISTS content_items (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
            type TEXT NOT NULL CHECK (type IN ('article', 'social_post', 'social_comment', 'snippet', 'transcript')),
            source_url TEXT,
            source_platform TEXT,
            title TEXT,
            raw_text TEXT,
            raw_html TEXT,
            raw_media_url TEXT,
            extracted_text TEXT,
            status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'extracted', 'extracted_partial', 'analyzed', 'failed')),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """,
        "CREATE INDEX IF NOT EXISTS idx_content_items_user_created_at ON content_items(user_id, created_at DESC);",
        "CREATE INDEX IF NOT EXISTS idx_content_items_user_status ON content_items(user_id, status);",

        """
        CREATE TABLE IF NOT EXISTS content_analyses (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            content_item_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
            model TEXT NOT NULL,
            summary_short TEXT,
            summary_long TEXT,
            key_points JSONB NOT NULL DEFAULT '[]'::jsonb,
            entities JSONB NOT NULL DEFAULT '[]'::jsonb,
            topics JSONB NOT NULL DEFAULT '[]'::jsonb,
            questions JSONB NOT NULL DEFAULT '[]'::jsonb,
            action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
            analysis_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """,
        "CREATE INDEX IF NOT EXISTS idx_content_analyses_item_created_at ON content_analyses(content_item_id, created_at DESC);",

        """
        CREATE TABLE IF NOT EXISTS transcript_chunks (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            content_item_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
            chunk_index INTEGER NOT NULL,
            speaker TEXT NOT NULL CHECK (speaker IN ('user', 'assistant')),
            text TEXT NOT NULL,
            start_ms INTEGER,
            end_ms INTEGER,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (content_item_id, chunk_index)
        );
        """,
        "CREATE INDEX IF NOT EXISTS idx_transcript_chunks_item_chunk_index ON transcript_chunks(content_item_id, chunk_index);",

        """
        CREATE TABLE IF NOT EXISTS thoughts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
            text TEXT NOT NULL,
            type TEXT NOT NULL CHECK (type IN ('question', 'decision', 'insight')),
            source_content_item_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
            source_chunk_id UUID REFERENCES transcript_chunks(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """,
        "CREATE INDEX IF NOT EXISTS idx_thoughts_user_created_at ON thoughts(user_id, created_at DESC);",
        "CREATE INDEX IF NOT EXISTS idx_thoughts_source_content_item_id ON thoughts(source_content_item_id);",
        "CREATE INDEX IF NOT EXISTS idx_thoughts_source_chunk_id ON thoughts(source_chunk_id);",

        # --- tenant_id type standardization (legacy mixed UUID/VARCHAR -> TEXT) ---
        "ALTER TABLE IF EXISTS users ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;",
        "ALTER TABLE IF EXISTS study_sessions ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;",
        "ALTER TABLE IF EXISTS voice_sessions ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;",
        "ALTER TABLE IF EXISTS voice_transcript_chunks ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;",
        "ALTER TABLE IF EXISTS voice_learning_signals ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;",
        "ALTER TABLE IF EXISTS usage_logs ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;",
        "ALTER TABLE IF EXISTS chat_messages ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;",
        "ALTER TABLE IF EXISTS memory_sync_events ALTER COLUMN tenant_id TYPE TEXT USING tenant_id::text;",
        "DROP POLICY IF EXISTS users_tenant_isolation ON users;",
        "ALTER TABLE IF EXISTS users DISABLE ROW LEVEL SECURITY;",
        # --- RLS enable ---
        "ALTER TABLE IF EXISTS tenants ENABLE ROW LEVEL SECURITY;",
        "ALTER TABLE IF EXISTS tenant_memberships ENABLE ROW LEVEL SECURITY;",
        "ALTER TABLE IF EXISTS study_sessions ENABLE ROW LEVEL SECURITY;",
        "ALTER TABLE IF EXISTS voice_sessions ENABLE ROW LEVEL SECURITY;",
        "ALTER TABLE IF EXISTS voice_transcript_chunks ENABLE ROW LEVEL SECURITY;",
        "ALTER TABLE IF EXISTS voice_learning_signals ENABLE ROW LEVEL SECURITY;",
        "ALTER TABLE IF EXISTS usage_logs ENABLE ROW LEVEL SECURITY;",
        "ALTER TABLE IF EXISTS chat_messages ENABLE ROW LEVEL SECURITY;",
        "ALTER TABLE IF EXISTS memory_sync_events ENABLE ROW LEVEL SECURITY;",
        "ALTER TABLE IF EXISTS content_items ENABLE ROW LEVEL SECURITY;",
        "ALTER TABLE IF EXISTS content_analyses ENABLE ROW LEVEL SECURITY;",
        "ALTER TABLE IF EXISTS transcript_chunks ENABLE ROW LEVEL SECURITY;",
        "ALTER TABLE IF EXISTS thoughts ENABLE ROW LEVEL SECURITY;",
        # --- RLS policies (tenant scoped) ---
        "DROP POLICY IF EXISTS tenants_tenant_isolation ON tenants;",
        """
        CREATE POLICY tenants_tenant_isolation ON tenants
        USING (tenant_id = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
        """,
        "DROP POLICY IF EXISTS tenant_memberships_tenant_isolation ON tenant_memberships;",
        """
        CREATE POLICY tenant_memberships_tenant_isolation ON tenant_memberships
        USING (tenant_id = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
        """,
        "DROP POLICY IF EXISTS study_sessions_tenant_isolation ON study_sessions;",
        """
        CREATE POLICY study_sessions_tenant_isolation ON study_sessions
        USING (tenant_id = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
        """,
        "DROP POLICY IF EXISTS voice_sessions_tenant_isolation ON voice_sessions;",
        """
        CREATE POLICY voice_sessions_tenant_isolation ON voice_sessions
        USING (tenant_id = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
        """,
        "DROP POLICY IF EXISTS voice_transcript_chunks_tenant_isolation ON voice_transcript_chunks;",
        """
        CREATE POLICY voice_transcript_chunks_tenant_isolation ON voice_transcript_chunks
        USING (tenant_id = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
        """,
        "DROP POLICY IF EXISTS voice_learning_signals_tenant_isolation ON voice_learning_signals;",
        """
        CREATE POLICY voice_learning_signals_tenant_isolation ON voice_learning_signals
        USING (tenant_id = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
        """,
        "DROP POLICY IF EXISTS usage_logs_tenant_isolation ON usage_logs;",
        """
        CREATE POLICY usage_logs_tenant_isolation ON usage_logs
        USING (tenant_id = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
        """,
        "DROP POLICY IF EXISTS chat_messages_tenant_isolation ON chat_messages;",
        """
        CREATE POLICY chat_messages_tenant_isolation ON chat_messages
        USING (tenant_id = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
        """,
        "DROP POLICY IF EXISTS memory_sync_events_tenant_isolation ON memory_sync_events;",
        """
        CREATE POLICY memory_sync_events_tenant_isolation ON memory_sync_events
        USING (tenant_id = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
        """,

        # --- RLS policies (user scoped; unified content pipeline) ---
        "DROP POLICY IF EXISTS content_items_user_isolation ON content_items;",
        """
        CREATE POLICY content_items_user_isolation ON content_items
        USING (user_id::text = current_setting('app.user_id', true))
        WITH CHECK (user_id::text = current_setting('app.user_id', true));
        """,

        "DROP POLICY IF EXISTS content_analyses_user_isolation ON content_analyses;",
        """
        CREATE POLICY content_analyses_user_isolation ON content_analyses
        USING (
            EXISTS (
                SELECT 1
                FROM content_items ci
                WHERE ci.id = content_analyses.content_item_id
                  AND ci.user_id::text = current_setting('app.user_id', true)
            )
        )
        WITH CHECK (
            EXISTS (
                SELECT 1
                FROM content_items ci
                WHERE ci.id = content_analyses.content_item_id
                  AND ci.user_id::text = current_setting('app.user_id', true)
            )
        );
        """,

        "DROP POLICY IF EXISTS transcript_chunks_user_isolation ON transcript_chunks;",
        """
        CREATE POLICY transcript_chunks_user_isolation ON transcript_chunks
        USING (
            EXISTS (
                SELECT 1
                FROM content_items ci
                WHERE ci.id = transcript_chunks.content_item_id
                  AND ci.user_id::text = current_setting('app.user_id', true)
            )
        )
        WITH CHECK (
            EXISTS (
                SELECT 1
                FROM content_items ci
                WHERE ci.id = transcript_chunks.content_item_id
                  AND ci.user_id::text = current_setting('app.user_id', true)
            )
        );
        """,

        "DROP POLICY IF EXISTS thoughts_user_isolation ON thoughts;",
        """
        CREATE POLICY thoughts_user_isolation ON thoughts
        USING (user_id::text = current_setting('app.user_id', true))
        WITH CHECK (user_id::text = current_setting('app.user_id', true));
        """,
    ]

    # Use a raw direct connection for schema init (pool may not exist yet)
    import psycopg2 as _pg
    conn = _pg.connect(POSTGRES_CONNECTION_STRING)
    try:
        with conn.cursor() as cur:
            try:
                cur.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto";')
            except Exception:
                logger.warning("[db_postgres] Could not create pgcrypto extension — gen_random_uuid() may fail if unavailable.")
            for stmt in statements:
                if stmt.strip():
                    cur.execute(stmt)
        conn.commit()
        logger.info("[db_postgres] Schema initialised — all tables and indexes verified.")
    except Exception as e:
        logger.error(f"[db_postgres] Schema init failed: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()
