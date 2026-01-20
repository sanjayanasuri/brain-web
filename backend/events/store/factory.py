"""Factory for creating event store instances."""
import os
from typing import Optional

from .base import EventStore
from .dynamodb import DynamoDBEventStore
from .sqlite import SQLiteEventStore
# Lazy import PostgresEventStore to avoid requiring psycopg2 if not using Postgres


def get_event_store() -> EventStore:
    """
    Get the appropriate event store based on environment configuration.
    
    Priority:
    1. DynamoDB if EVENTS_DDB_TABLE is set
    2. PostgreSQL if EVENTS_POSTGRES is set to "true"
    3. SQLite (dev fallback)
    
    Returns:
        EventStore instance
    """
    ddb_table = os.getenv("EVENTS_DDB_TABLE", "").strip()
    
    if ddb_table:
        return DynamoDBEventStore(table_name=ddb_table)
    
    use_postgres = os.getenv("EVENTS_POSTGRES", "false").lower() in ("true", "1", "yes")
    if use_postgres:
        try:
            # Lazy import to avoid requiring psycopg2 if not using Postgres
            from .postgres import PostgresEventStore
            return PostgresEventStore()
        except ImportError as e:
            print(f"WARNING: psycopg2 not available, cannot use PostgreSQL event store: {e}")
            print("Falling back to SQLite...")
        except Exception as e:
            print(f"WARNING: Failed to initialize PostgreSQL event store: {e}")
            print("Falling back to SQLite...")
    
    # Fall back to SQLite for dev
    db_path = os.getenv("EVENTS_SQLITE_PATH", "events.db")
    return SQLiteEventStore(db_path=db_path)

