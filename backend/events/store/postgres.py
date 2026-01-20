"""PostgreSQL + TimescaleDB implementation of event store."""
import json
from typing import List, Optional
from datetime import datetime
import psycopg2
from psycopg2.extras import execute_values, RealDictCursor
from psycopg2.pool import ThreadedConnectionPool

from ..schema import EventEnvelope, ObjectRef
from .base import EventStore
from config import POSTGRES_CONNECTION_STRING


class PostgresEventStore(EventStore):
    """PostgreSQL + TimescaleDB-backed event store."""
    
    def __init__(self, connection_string: Optional[str] = None):
        """
        Initialize PostgreSQL event store.
        
        Args:
            connection_string: PostgreSQL connection string (defaults to config)
        """
        self.connection_string = connection_string or POSTGRES_CONNECTION_STRING
        self._init_db()
    
    def _get_connection(self):
        """Get database connection."""
        return psycopg2.connect(self.connection_string)
    
    def _init_db(self):
        """Initialize database schema with TimescaleDB hypertable."""
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                # Create events table
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS events (
                        event_id TEXT PRIMARY KEY,
                        session_id TEXT NOT NULL,
                        event_type TEXT NOT NULL,
                        actor_id TEXT,
                        occurred_at TIMESTAMPTZ NOT NULL,
                        version INTEGER DEFAULT 1,
                        correlation_id TEXT,
                        trace_id TEXT,
                        idempotency_key TEXT UNIQUE,
                        object_ref_type TEXT,
                        object_ref_id TEXT,
                        payload JSONB NOT NULL,
                        created_at TIMESTAMPTZ DEFAULT NOW()
                    );
                """)
                
                # Create indexes
                cur.execute("""
                    CREATE INDEX IF NOT EXISTS idx_events_session_occurred 
                    ON events (session_id, occurred_at);
                """)
                
                cur.execute("""
                    CREATE INDEX IF NOT EXISTS idx_events_idempotency 
                    ON events (idempotency_key) WHERE idempotency_key IS NOT NULL;
                """)
                
                cur.execute("""
                    CREATE INDEX IF NOT EXISTS idx_events_object_ref 
                    ON events (object_ref_type, object_ref_id) 
                    WHERE object_ref_type IS NOT NULL;
                """)
                
                # Create TimescaleDB hypertable (if extension is available)
                try:
                    cur.execute("""
                        SELECT create_hypertable('events', 'occurred_at', 
                                                 if_not_exists => TRUE);
                    """)
                    print("[PostgresEventStore] TimescaleDB hypertable created")
                except psycopg2.Error as e:
                    # TimescaleDB extension might not be available
                    if "extension" in str(e).lower() or "does not exist" in str(e).lower():
                        print("[PostgresEventStore] TimescaleDB extension not available, using regular table")
                    else:
                        raise
                
                conn.commit()
        finally:
            conn.close()
    
    def append(self, event: EventEnvelope) -> None:
        """Append event to PostgreSQL with idempotency check."""
        conn = self._get_connection()
        try:
            with conn.cursor() as cur:
                # Check idempotency if key is provided
                if event.idempotency_key:
                    cur.execute("""
                        SELECT event_id FROM events 
                        WHERE idempotency_key = %s
                    """, (event.idempotency_key,))
                    if cur.fetchone():
                        # Event already exists, skip
                        return
                
                # Insert event
                cur.execute("""
                    INSERT INTO events (
                        event_id, session_id, event_type, actor_id,
                        occurred_at, version, correlation_id, trace_id,
                        idempotency_key, object_ref_type, object_ref_id, payload
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (event_id) DO NOTHING
                """, (
                    event.event_id,
                    event.session_id,
                    event.event_type.value,
                    event.actor_id,
                    event.occurred_at,
                    event.version,
                    event.correlation_id,
                    event.trace_id,
                    event.idempotency_key,
                    event.object_ref.type if event.object_ref else None,
                    event.object_ref.id if event.object_ref else None,
                    json.dumps(event.payload)
                ))
                conn.commit()
        except psycopg2.IntegrityError as e:
            # Idempotency key conflict or event_id conflict
            if "idempotency_key" in str(e) or "event_id" in str(e):
                # Event already exists, skip
                return
            raise
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
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                query = """
                    SELECT * FROM events
                    WHERE session_id = %s
                """
                params = [session_id]
                
                if after_ts:
                    query += " AND occurred_at > %s"
                    params.append(after_ts)
                
                query += " ORDER BY occurred_at ASC LIMIT %s"
                params.append(limit)
                
                cur.execute(query, params)
                rows = cur.fetchall()
                
                return [self._row_to_event(dict(row)) for row in rows]
        finally:
            conn.close()
    
    def replay(self, session_id: str) -> List[EventEnvelope]:
        """Replay all events for a session."""
        return self.list_events(session_id, limit=10000)
    
    def _row_to_event(self, row: dict) -> EventEnvelope:
        """Convert database row to EventEnvelope."""
        object_ref = None
        if row.get("object_ref_type") and row.get("object_ref_id"):
            object_ref = ObjectRef(
                type=row["object_ref_type"],
                id=row["object_ref_id"]
            )
        
        return EventEnvelope(
            event_id=row["event_id"],
            event_type=row["event_type"],
            session_id=row["session_id"],
            actor_id=row.get("actor_id"),
            occurred_at=row["occurred_at"],
            version=row.get("version", 1),
            idempotency_key=row.get("idempotency_key"),
            correlation_id=row.get("correlation_id"),
            trace_id=row.get("trace_id"),
            object_ref=object_ref,
            payload=json.loads(row["payload"]) if isinstance(row["payload"], str) else row["payload"],
        )
