"""SQLite implementation of event store (dev fallback)."""
import sqlite3
import json
from typing import List, Optional
from datetime import datetime
from pathlib import Path

from ..schema import EventEnvelope, ObjectRef
from .base import EventStore


class SQLiteEventStore(EventStore):
    """SQLite-backed event store (dev only)."""
    
    def __init__(self, db_path: str = "events.db"):
        """
        Initialize SQLite event store.
        
        Args:
            db_path: Path to SQLite database file
        """
        self.db_path = Path(db_path)
        self._init_db()
    
    def _get_connection(self):
        """Get database connection."""
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        return conn
    
    def _init_db(self):
        """Initialize database schema."""
        conn = self._get_connection()
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS events (
                    event_id TEXT PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    actor_id TEXT,
                    occurred_at TEXT NOT NULL,
                    version INTEGER NOT NULL DEFAULT 1,
                    idempotency_key TEXT UNIQUE,
                    correlation_id TEXT,
                    trace_id TEXT,
                    object_ref_type TEXT,
                    object_ref_id TEXT,
                    payload TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                )
            """)
            
            # Indexes for efficient queries
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_session_occurred
                ON events(session_id, occurred_at)
            """)
            
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_idempotency_key
                ON events(idempotency_key)
            """)
            
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_correlation_id
                ON events(correlation_id)
            """)
            
            conn.commit()
        finally:
            conn.close()
    
    def append(self, event: EventEnvelope) -> None:
        """Append event to SQLite with idempotency check."""
        conn = self._get_connection()
        try:
            # Check idempotency if key is provided
            if event.idempotency_key:
                cursor = conn.execute(
                    "SELECT event_id FROM events WHERE idempotency_key = ?",
                    (event.idempotency_key,)
                )
                if cursor.fetchone():
                    # Event already exists, skip
                    return
            
            # Insert event
            # Handle both enum and string event_type (due to use_enum_values=True in Pydantic config)
            event_type_str = event.event_type.value if hasattr(event.event_type, 'value') else str(event.event_type)
            conn.execute("""
                INSERT OR IGNORE INTO events (
                    event_id, event_type, session_id, actor_id, occurred_at,
                    version, idempotency_key, correlation_id, trace_id,
                    object_ref_type, object_ref_id, payload
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                event.event_id,
                event_type_str,
                event.session_id,
                event.actor_id,
                event.occurred_at.isoformat(),
                event.version,
                event.idempotency_key,
                event.correlation_id,
                event.trace_id,
                event.object_ref.type if event.object_ref else None,
                event.object_ref.id if event.object_ref else None,
                json.dumps(event.payload),
            ))
            conn.commit()
        except sqlite3.IntegrityError as e:
            # Event ID already exists (shouldn't happen with proper idempotency keys)
            raise ValueError(f"Event already exists: {e}")
        finally:
            conn.close()
    
    def list_events(
        self,
        session_id: str,
        after_ts: Optional[datetime] = None,
        limit: int = 100
    ) -> List[EventEnvelope]:
        """List events for a session."""
        conn = self._get_connection()
        try:
            query = """
                SELECT * FROM events
                WHERE session_id = ?
            """
            params = [session_id]
            
            if after_ts:
                query += " AND occurred_at > ?"
                params.append(after_ts.isoformat())
            
            query += " ORDER BY occurred_at ASC LIMIT ?"
            params.append(limit)
            
            cursor = conn.execute(query, params)
            rows = cursor.fetchall()
            return [self._row_to_event(row) for row in rows]
        finally:
            conn.close()
    
    def replay(self, session_id: str) -> List[EventEnvelope]:
        """Replay all events for a session."""
        return self.list_events(session_id, limit=10000)
    
    def _row_to_event(self, row: sqlite3.Row) -> EventEnvelope:
        """Convert database row to EventEnvelope."""
        object_ref = None
        if row["object_ref_type"] and row["object_ref_id"]:
            object_ref = ObjectRef(
                type=row["object_ref_type"],
                id=row["object_ref_id"]
            )
        
        return EventEnvelope(
            event_id=row["event_id"],
            event_type=row["event_type"],
            session_id=row["session_id"],
            actor_id=row["actor_id"],
            occurred_at=datetime.fromisoformat(row["occurred_at"].replace("Z", "+00:00")),
            version=row["version"],
            idempotency_key=row["idempotency_key"],
            correlation_id=row["correlation_id"],
            trace_id=row["trace_id"],
            object_ref=object_ref,
            payload=json.loads(row["payload"]),
        )

