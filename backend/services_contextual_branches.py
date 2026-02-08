"""Service layer for contextual branching operations."""
import json
import hashlib
from typing import Optional, List, Dict, Any
from datetime import datetime

try:
    import psycopg2
    from psycopg2 import errors as pg_errors
    from psycopg2.extras import RealDictCursor
    from psycopg2.pool import ThreadedConnectionPool
    PSYCOPG2_AVAILABLE = True
except ImportError:
    PSYCOPG2_AVAILABLE = False
    # Create mock classes for when psycopg2 is not available
    class ThreadedConnectionPool:
        def __init__(self, *args, **kwargs):
            pass
        def getconn(self):
            raise ImportError("psycopg2 not installed")
        def putconn(self, conn):
            pass
    RealDictCursor = None

from config import POSTGRES_CONNECTION_STRING
from models_contextual_branches import (
    AnchorSpan,
    BranchThread,
    BranchMessage,
    BridgingHint,
    BridgingHintSet,
    BranchCreateRequest,
    BranchMessageRequest,
)
try:
    from services_logging import log_event
except ImportError:
    # Fallback if services_logging doesn't exist
    def log_event(event_type: str, data: dict):
        print(f"[Event] {event_type}: {data}")


# Connection pool for PostgreSQL
_pool: Optional[ThreadedConnectionPool] = None


def _get_pool():
    """Get or create connection pool."""
    global _pool
    if not PSYCOPG2_AVAILABLE:
        raise ImportError("psycopg2-binary is required for contextual branching. Install with: pip install psycopg2-binary")
    if _pool is None:
        try:
            _pool = ThreadedConnectionPool(1, 10, POSTGRES_CONNECTION_STRING)
        except Exception as e:
            # Catch connection errors and provide helpful message
            error_msg = str(e)
            if "role" in error_msg.lower() and "does not exist" in error_msg.lower():
                raise ConnectionError(
                    "PostgreSQL database role not found. Please create the 'brainweb' role or update POSTGRES_USER in your config. "
                    "Contextual branching requires PostgreSQL to be set up. "
                    f"Original error: {error_msg}"
                ) from e
            elif "could not connect" in error_msg.lower() or "connection refused" in error_msg.lower():
                raise ConnectionError(
                    "Cannot connect to PostgreSQL. Please ensure PostgreSQL is running and accessible. "
                    f"Original error: {error_msg}"
                ) from e
            else:
                raise ConnectionError(f"Failed to connect to PostgreSQL: {error_msg}") from e
    return _pool


# Track if DB has been initialized
_db_initialized = False

def _init_db():
    """Initialize database schema for contextual branches."""
    global _db_initialized
    if not PSYCOPG2_AVAILABLE:
        return
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            # Create parent_message_versions table (for versioning)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS parent_message_versions (
                    message_id TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    content TEXT NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    PRIMARY KEY (message_id, version)
                );
            """)
            
            # Create branches table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS contextual_branches (
                    id TEXT PRIMARY KEY,
                    parent_message_id TEXT NOT NULL,
                    parent_message_version INTEGER NOT NULL DEFAULT 1,
                    start_offset INTEGER NOT NULL,
                    end_offset INTEGER NOT NULL,
                    selected_text TEXT NOT NULL,
                    selected_text_hash TEXT NOT NULL,
                    anchor_kind TEXT NOT NULL DEFAULT 'text_span',
                    anchor_json TEXT,
                    anchor_snippet_data_url TEXT,
                    chat_id TEXT,
                    is_archived BOOLEAN DEFAULT FALSE,
                    archived_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );
            """)
            cur.execute("""
                ALTER TABLE contextual_branches
                ADD COLUMN IF NOT EXISTS chat_id TEXT;
            """)
            cur.execute("""
                ALTER TABLE contextual_branches
                ADD COLUMN IF NOT EXISTS anchor_kind TEXT NOT NULL DEFAULT 'text_span';
            """)
            cur.execute("""
                ALTER TABLE contextual_branches
                ADD COLUMN IF NOT EXISTS anchor_json TEXT;
            """)
            cur.execute("""
                ALTER TABLE contextual_branches
                ADD COLUMN IF NOT EXISTS anchor_snippet_data_url TEXT;
            """)
            
            # Create branch_messages table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS branch_messages (
                    id TEXT PRIMARY KEY,
                    branch_id TEXT NOT NULL REFERENCES contextual_branches(id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                    content TEXT NOT NULL,
                    timestamp TIMESTAMPTZ DEFAULT NOW(),
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
            """)
            
            # Create bridging_hints table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS bridging_hints (
                    id TEXT PRIMARY KEY,
                    branch_id TEXT NOT NULL REFERENCES contextual_branches(id) ON DELETE CASCADE,
                    hint_text TEXT NOT NULL,
                    target_offset INTEGER NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
            """)
            
            # Create indexes
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_branches_parent_message 
                ON contextual_branches (parent_message_id);
            """)
            
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_branches_chat_id
                ON contextual_branches (chat_id);
            """)
            
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_branches_text_hash 
                ON contextual_branches (selected_text_hash, parent_message_id);
            """)
            
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_branch_messages_branch_id 
                ON branch_messages (branch_id, timestamp);
            """)
            
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_bridging_hints_branch_id 
                ON bridging_hints (branch_id);
            """)
            
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_parent_message_versions_message_id 
                ON parent_message_versions (message_id, version DESC);
            """)
            
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_branches_archived 
                ON contextual_branches (is_archived, updated_at DESC);
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_branches_anchor_kind
                ON contextual_branches (anchor_kind);
            """)
            
            conn.commit()
            _db_initialized = True
            print("[Contextual Branches] Database schema initialized successfully")
    except Exception as e:
        # Log but don't fail if DB initialization fails (e.g., in test environments)
        print(f"[Contextual Branches] Database initialization skipped: {e}")
        _db_initialized = False
    finally:
        pool.putconn(conn)


def _ensure_db_initialized():
    """Ensure database is initialized, retry if needed."""
    global _db_initialized
    if not PSYCOPG2_AVAILABLE:
        return
    if not _db_initialized:
        try:
            _init_db()
        except Exception as e:
            # If initialization fails, we'll try again on next call
            pass


# Initialize on import (only if psycopg2 is available)
if PSYCOPG2_AVAILABLE:
    try:
        _init_db()
    except Exception as e:
        # Don't fail on import if DB is not available (e.g., in test environments)
        print(f"[Contextual Branches] Database initialization deferred: {e}")


def store_parent_message_version(message_id: str, content: str, version: Optional[int] = None) -> int:
    """Store or update parent message content with versioning. Returns the version number."""
    if not PSYCOPG2_AVAILABLE:
        raise ImportError("psycopg2-binary is required for contextual branching")
    
    _ensure_db_initialized()
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            if version is None:
                # Get latest version
                cur.execute("""
                    SELECT MAX(version) FROM parent_message_versions WHERE message_id = %s
                """, (message_id,))
                result = cur.fetchone()
                version = (result[0] or 0) + 1
            else:
                # Check if version exists
                cur.execute("""
                    SELECT 1 FROM parent_message_versions WHERE message_id = %s AND version = %s
                """, (message_id, version))
                if cur.fetchone():
                    # Update existing version
                    cur.execute("""
                        UPDATE parent_message_versions 
                        SET content = %s, created_at = NOW()
                        WHERE message_id = %s AND version = %s
                    """, (content, message_id, version))
                    conn.commit()
                    return version
            
            # Insert new version
            cur.execute("""
                INSERT INTO parent_message_versions (message_id, version, content, created_at)
                VALUES (%s, %s, %s, NOW())
            """, (message_id, version, content))
            conn.commit()
            return version
    except pg_errors.UndefinedTable:
        # Tables don't exist yet, initialize and retry
        global _db_initialized
        _db_initialized = False
        _init_db()
        # Retry the operation
        with conn.cursor() as cur:
            if version is None:
                cur.execute("""
                    SELECT MAX(version) FROM parent_message_versions WHERE message_id = %s
                """, (message_id,))
                result = cur.fetchone()
                version = (result[0] or 0) + 1
            cur.execute("""
                INSERT INTO parent_message_versions (message_id, version, content, created_at)
                VALUES (%s, %s, %s, NOW())
            """, (message_id, version, content))
            conn.commit()
            return version
    finally:
        pool.putconn(conn)


def get_parent_message_content(message_id: str, version: Optional[int] = None) -> Optional[str]:
    """Get parent message content from database. Returns latest version if version not specified."""
    if not PSYCOPG2_AVAILABLE:
        return None
    
    _ensure_db_initialized()
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            if version is None:
                # Get latest version
                cur.execute("""
                    SELECT content FROM parent_message_versions
                    WHERE message_id = %s
                    ORDER BY version DESC
                    LIMIT 1
                """, (message_id,))
            else:
                # Get specific version
                cur.execute("""
                    SELECT content FROM parent_message_versions
                    WHERE message_id = %s AND version = %s
                """, (message_id, version))
            
            result = cur.fetchone()
            return result[0] if result else None
    except pg_errors.UndefinedTable:
        # Tables don't exist yet, initialize and retry
        global _db_initialized
        _db_initialized = False
        _init_db()
        # Retry the query
        with conn.cursor() as cur:
            if version is None:
                cur.execute("""
                    SELECT content FROM parent_message_versions
                    WHERE message_id = %s
                    ORDER BY version DESC
                    LIMIT 1
                """, (message_id,))
            else:
                cur.execute("""
                    SELECT content FROM parent_message_versions
                    WHERE message_id = %s AND version = %s
                """, (message_id, version))
            result = cur.fetchone()
            return result[0] if result else None
    finally:
        pool.putconn(conn)


def create_branch(request: BranchCreateRequest, user_id: str) -> BranchThread:
    """Create a new contextual branch from a text span."""
    import uuid
    
    if not PSYCOPG2_AVAILABLE:
        raise ImportError("psycopg2-binary is required for contextual branching")
    
    _ensure_db_initialized()
    
    # Store parent message content with versioning
    parent_version = store_parent_message_version(
        request.parent_message_id,
        request.parent_message_content
    )
    
    # Compute text hash for idempotency
    text_hash = hashlib.sha256(request.selected_text.encode('utf-8')).hexdigest()
    
    # Check for existing branch with same hash and parent (idempotency)
    existing = get_branch_by_hash(request.parent_message_id, text_hash)
    if existing:
        return existing
    
    branch_id = f"branch-{uuid.uuid4().hex[:12]}"
    now = datetime.utcnow()
    
    anchor = AnchorSpan.create(
        start_offset=request.start_offset,
        end_offset=request.end_offset,
        selected_text=request.selected_text,
        parent_message_id=request.parent_message_id
    )
    
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO contextual_branches 
                (id, parent_message_id, parent_message_version, start_offset, end_offset, selected_text, selected_text_hash, chat_id, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                branch_id,
                request.parent_message_id,
                parent_version,
                request.start_offset,
                request.end_offset,
                request.selected_text,
                text_hash,
                request.chat_id,
                now,
                now
            ))
            conn.commit()
    except pg_errors.UndefinedTable:
        # Tables don't exist yet, initialize and retry
        global _db_initialized
        _db_initialized = False
        _init_db()
        # Retry the insert
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO contextual_branches 
                (id, parent_message_id, parent_message_version, start_offset, end_offset, selected_text, selected_text_hash, chat_id, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                branch_id,
                request.parent_message_id,
                parent_version,
                request.start_offset,
                request.end_offset,
                request.selected_text,
                text_hash,
                request.chat_id,
                now,
                now
            ))
            conn.commit()
    finally:
        pool.putconn(conn)
    
    log_event("branch_created", {
        "branch_id": branch_id,
        "parent_message_id": request.parent_message_id,
        "parent_message_version": parent_version,
        "user_id": user_id,
        "chat_id": request.chat_id,
    })
    
    return BranchThread(
        id=branch_id,
        anchor=anchor,
        anchor_kind="text_span",
        anchor_ref=None,
        anchor_snippet_data_url=None,
        messages=[],
        bridging_hints=None,
        created_at=now,
        updated_at=now,
        parent_message_id=request.parent_message_id,
        parent_message_version=parent_version,
        is_archived=False,
        archived_at=None,
        chat_id=request.chat_id,
    )


def create_anchor_branch(
    *,
    anchor_ref: Dict[str, Any],
    snippet_image_data_url: Optional[str],
    context: Optional[str],
    chat_id: Optional[str],
    user_id: str,
) -> BranchThread:
    """
    Create a new contextual branch from a non-text anchor (e.g., bbox lasso).

    This is additive: the existing text-span branch model remains unchanged.
    We store:
      - anchor_kind='anchor_ref'
      - anchor_json: serialized AnchorRef (unified_primitives)
      - optional snippet_image_data_url for vision grounding

    Idempotency is enforced by (parent_message_id, selected_text_hash) using:
      parent_message_id := stable key for the anchor's artifact
      selected_text_hash := sha256(anchor_id)
    """
    import uuid

    if not PSYCOPG2_AVAILABLE:
        raise ImportError("psycopg2-binary is required for contextual branching")

    _ensure_db_initialized()

    # Validate anchor_ref minimally
    artifact = anchor_ref.get("artifact") or {}
    selector = anchor_ref.get("selector") or {}
    anchor_id = anchor_ref.get("anchor_id")
    if not anchor_id:
        raise ValueError("anchor_ref.anchor_id is required")
    if not isinstance(artifact, dict) or not artifact.get("id"):
        raise ValueError("anchor_ref.artifact.id is required")
    if not isinstance(selector, dict) or not selector.get("kind"):
        raise ValueError("anchor_ref.selector.kind is required")

    # Stable parent key groups branches by the anchored artifact
    parent_message_id = f"anchor:{artifact.get('namespace')}:{artifact.get('type')}:{artifact.get('id')}"

    # Store context (optional) as "parent message content" for reuse in prompts
    parent_version = store_parent_message_version(parent_message_id, context or "")

    # Idempotency hash
    text_hash = hashlib.sha256(anchor_id.encode("utf-8")).hexdigest()
    existing = get_branch_by_hash(parent_message_id, text_hash)
    if existing:
        return existing

    branch_id = f"branch-{uuid.uuid4().hex[:12]}"
    now = datetime.utcnow()

    # Keep legacy AnchorSpan populated for backward-compatible clients.
    # This is a dummy span; the real anchor is in branch.anchor_ref.
    preview = anchor_ref.get("preview") or "Selected region"
    anchor = AnchorSpan.create(
        start_offset=0,
        end_offset=1,
        selected_text=str(preview),
        parent_message_id=parent_message_id,
    )

    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO contextual_branches
                (id, parent_message_id, parent_message_version, start_offset, end_offset, selected_text, selected_text_hash, chat_id, anchor_kind, anchor_json, anchor_snippet_data_url, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    branch_id,
                    parent_message_id,
                    parent_version,
                    0,
                    1,
                    str(preview),
                    text_hash,
                    chat_id,
                    "anchor_ref",
                    json.dumps(anchor_ref),
                    snippet_image_data_url,
                    now,
                    now,
                ),
            )
            conn.commit()
    except pg_errors.UndefinedTable:
        global _db_initialized
        _db_initialized = False
        _init_db()
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO contextual_branches
                (id, parent_message_id, parent_message_version, start_offset, end_offset, selected_text, selected_text_hash, chat_id, anchor_kind, anchor_json, anchor_snippet_data_url, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    branch_id,
                    parent_message_id,
                    parent_version,
                    0,
                    1,
                    str(preview),
                    text_hash,
                    chat_id,
                    "anchor_ref",
                    json.dumps(anchor_ref),
                    snippet_image_data_url,
                    now,
                    now,
                ),
            )
            conn.commit()
    finally:
        pool.putconn(conn)

    log_event(
        "branch_created",
        {
            "branch_id": branch_id,
            "parent_message_id": parent_message_id,
            "parent_message_version": parent_version,
            "user_id": user_id,
            "chat_id": chat_id,
            "anchor_kind": "anchor_ref",
            "anchor_id": anchor_id,
            "selector_kind": selector.get("kind"),
        },
    )

    return BranchThread(
        id=branch_id,
        anchor=anchor,
        anchor_kind="anchor_ref",
        anchor_ref=anchor_ref,
        anchor_snippet_data_url=snippet_image_data_url,
        messages=[],
        bridging_hints=None,
        created_at=now,
        updated_at=now,
        parent_message_id=parent_message_id,
        parent_message_version=parent_version,
        is_archived=False,
        archived_at=None,
        chat_id=chat_id,
    )


def get_branch_by_hash(parent_message_id: str, text_hash: str) -> Optional[BranchThread]:
    """Get existing branch by parent message and text hash (idempotency check)."""
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT * FROM contextual_branches
                WHERE parent_message_id = %s AND selected_text_hash = %s
                ORDER BY created_at DESC
                LIMIT 1
            """, (parent_message_id, text_hash))
            
            row = cur.fetchone()
            if not row:
                return None
            
            return _row_to_branch(row)
    finally:
        pool.putconn(conn)


def get_branch(branch_id: str) -> Optional[BranchThread]:
    """Get branch by ID with all messages."""
    if not PSYCOPG2_AVAILABLE:
        return None
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Get branch
            cur.execute("""
                SELECT * FROM contextual_branches WHERE id = %s
            """, (branch_id,))
            
            row = cur.fetchone()
            if not row:
                return None
            
            branch = _row_to_branch(row)
            
            # Get messages
            cur.execute("""
                SELECT * FROM branch_messages
                WHERE branch_id = %s
                ORDER BY timestamp ASC
            """, (branch_id,))
            
            messages = []
            for msg_row in cur.fetchall():
                messages.append(BranchMessage(
                    id=msg_row['id'],
                    branch_id=branch_id,
                    role=msg_row['role'],
                    content=msg_row['content'],
                    timestamp=msg_row['timestamp'],
                    created_at=msg_row.get('created_at')
                ))
            
            branch.messages = messages
            
            # Get bridging hints
            cur.execute("""
                SELECT * FROM bridging_hints
                WHERE branch_id = %s
                ORDER BY target_offset ASC
            """, (branch_id,))
            
            hints = []
            for hint_row in cur.fetchall():
                hints.append(BridgingHint(
                    id=hint_row['id'],
                    branch_id=branch_id,
                    hint_text=hint_row['hint_text'],
                    target_offset=hint_row['target_offset'],
                    created_at=hint_row['created_at']
                ))
            
            if hints:
                branch.bridging_hints = BridgingHintSet(
                    branch_id=branch_id,
                    hints=hints,
                    created_at=hints[0].created_at
                )
            
            return branch
    finally:
        pool.putconn(conn)


def _row_to_branch(row: Dict[str, Any]) -> BranchThread:
    """Convert database row to BranchThread."""
    anchor = AnchorSpan(
        start_offset=row['start_offset'],
        end_offset=row['end_offset'],
        selected_text=row['selected_text'],
        selected_text_hash=row['selected_text_hash'],
        parent_message_id=row['parent_message_id']
    )
    
    anchor_kind = row.get("anchor_kind") or "text_span"
    anchor_ref = None
    if row.get("anchor_json"):
        try:
            anchor_ref = json.loads(row["anchor_json"]) if isinstance(row["anchor_json"], str) else row["anchor_json"]
        except Exception:
            anchor_ref = None

    return BranchThread(
        id=row['id'],
        anchor=anchor,
        anchor_kind=anchor_kind,
        anchor_ref=anchor_ref,
        anchor_snippet_data_url=row.get("anchor_snippet_data_url"),
        messages=[],
        bridging_hints=None,
        created_at=row['created_at'],
        updated_at=row['updated_at'],
        parent_message_id=row['parent_message_id'],
        parent_message_version=row.get('parent_message_version', 1),
        is_archived=row.get('is_archived', False),
        archived_at=row.get('archived_at'),
        chat_id=row.get('chat_id'),
    )


def add_branch_message(branch_id: str, role: str, content: str, user_id: str) -> BranchMessage:
    """Add a message to a branch."""
    import uuid
    
    if not PSYCOPG2_AVAILABLE:
        raise ImportError("psycopg2-binary is required for contextual branching")
    
    message_id = f"msg-{uuid.uuid4().hex[:12]}"
    now = datetime.utcnow()
    
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO branch_messages (id, branch_id, role, content, timestamp, created_at)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (message_id, branch_id, role, content, now, now))
            
            # Update branch updated_at
            cur.execute("""
                UPDATE contextual_branches
                SET updated_at = %s
                WHERE id = %s
            """, (now, branch_id))
            
            conn.commit()
        
        log_event("branch_message_sent", {
            "branch_id": branch_id,
            "message_id": message_id,
            "role": role,
            "user_id": user_id,
        })
        
        return BranchMessage(
            id=message_id,
            branch_id=branch_id,
            role=role,
            content=content,
            timestamp=now,
            created_at=now
        )
    finally:
        pool.putconn(conn)


def get_message_branches(parent_message_id: str, include_archived: bool = False) -> List[BranchThread]:
    """Get all branches for a parent message."""
    if not PSYCOPG2_AVAILABLE:
        return []
    _ensure_db_initialized()
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if include_archived:
                cur.execute("""
                    SELECT * FROM contextual_branches
                    WHERE parent_message_id = %s
                    ORDER BY created_at ASC
                """, (parent_message_id,))
            else:
                cur.execute("""
                    SELECT * FROM contextual_branches
                    WHERE parent_message_id = %s AND (is_archived = FALSE OR is_archived IS NULL)
                    ORDER BY created_at ASC
                """, (parent_message_id,))
            
            branches = []
            for row in cur.fetchall():
                branch = _row_to_branch(row)
                branches.append(branch)
            
            return branches
    except pg_errors.UndefinedTable:
        # Tables don't exist yet, initialize and retry
        global _db_initialized
        _db_initialized = False
        _init_db()
        # Retry the query
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if include_archived:
                cur.execute("""
                    SELECT * FROM contextual_branches
                    WHERE parent_message_id = %s
                    ORDER BY created_at ASC
                """, (parent_message_id,))
            else:
                cur.execute("""
                    SELECT * FROM contextual_branches
                    WHERE parent_message_id = %s AND (is_archived = FALSE OR is_archived IS NULL)
                    ORDER BY created_at ASC
                """, (parent_message_id,))
            
            branches = []
            for row in cur.fetchall():
                branch = _row_to_branch(row)
                branches.append(branch)
            
            return branches
    finally:
        pool.putconn(conn)


def archive_branch(branch_id: str, user_id: str) -> bool:
    """Archive a branch (soft delete)."""
    if not PSYCOPG2_AVAILABLE:
        raise ImportError("psycopg2-binary is required for contextual branching")
    
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE contextual_branches
                SET is_archived = TRUE, archived_at = NOW(), updated_at = NOW()
                WHERE id = %s
            """, (branch_id,))
            
            if cur.rowcount == 0:
                return False
            
            conn.commit()
            
            log_event("branch_archived", {
                "branch_id": branch_id,
                "user_id": user_id,
            })
            
            return True
    finally:
        pool.putconn(conn)


def delete_branch(branch_id: str, user_id: str) -> bool:
    """Permanently delete a branch and all its messages/hints."""
    if not PSYCOPG2_AVAILABLE:
        raise ImportError("psycopg2-binary is required for contextual branching")
    
    pool = _get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            # Delete branch (CASCADE will delete messages and hints)
            cur.execute("""
                DELETE FROM contextual_branches WHERE id = %s
            """, (branch_id,))
            
            if cur.rowcount == 0:
                return False
            
            conn.commit()
            
            log_event("branch_deleted", {
                "branch_id": branch_id,
                "user_id": user_id,
            })
            
            return True
    finally:
        pool.putconn(conn)


def save_bridging_hints(branch_id: str, hints: List[Dict[str, Any]], user_id: str) -> BridgingHintSet:
    """Save bridging hints for a branch."""
    import uuid
    
    if not PSYCOPG2_AVAILABLE:
        raise ImportError("psycopg2-binary is required for contextual branching")
    
    pool = _get_pool()
    conn = pool.getconn()
    try:
        chat_id: Optional[str] = None
        with conn.cursor() as cur:
            # Delete existing hints
            cur.execute("DELETE FROM bridging_hints WHERE branch_id = %s", (branch_id,))

            cur.execute("""
                SELECT chat_id
                FROM contextual_branches
                WHERE id = %s
            """, (branch_id,))
            row = cur.fetchone()
            if row:
                chat_id = row[0]
            
            # Insert new hints
            now = datetime.utcnow()
            hint_objects = []
            
            for hint_data in hints:
                hint_id = f"hint-{uuid.uuid4().hex[:12]}"
                cur.execute("""
                    INSERT INTO bridging_hints (id, branch_id, hint_text, target_offset, created_at)
                    VALUES (%s, %s, %s, %s, %s)
                """, (
                    hint_id,
                    branch_id,
                    hint_data['hint_text'],
                    hint_data['target_offset'],
                    now
                ))
                
                hint_objects.append(BridgingHint(
                    id=hint_id,
                    branch_id=branch_id,
                    hint_text=hint_data['hint_text'],
                    target_offset=hint_data['target_offset'],
                    created_at=now
                ))
            
            conn.commit()
        
        log_event("hints_generated", {
            "branch_id": branch_id,
            "hint_count": len(hint_objects),
            "user_id": user_id,
        })

        if chat_id:
            try:
                from services_lecture_links import resolve_links_for_bridging_hints
                resolve_links_for_bridging_hints(chat_id, [hint.id for hint in hint_objects])
            except Exception as e:
                log_event("lecture_link_failed", {
                    "chat_id": chat_id,
                    "source_type": "bridging_hint",
                    "error": str(e),
                })
        
        return BridgingHintSet(
            branch_id=branch_id,
            hints=hint_objects,
            created_at=now
        )
    finally:
        pool.putconn(conn)
