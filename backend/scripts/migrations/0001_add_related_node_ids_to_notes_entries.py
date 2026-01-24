#!/usr/bin/env python3
"""
Migration: Add related_node_ids column to notes_entries table.

This migration adds:
- related_node_ids TEXT[] column with default empty array
- GIN index on related_node_ids for efficient array queries

Usage:
    python scripts/migrations/0001_add_related_node_ids_to_notes_entries.py
"""
import sys
from pathlib import Path

# Add backend to path
backend_dir = Path(__file__).parent.parent.parent
sys.path.insert(0, str(backend_dir))

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    PSYCOPG2_AVAILABLE = True
except ImportError:
    print("ERROR: psycopg2-binary is required for this migration")
    sys.exit(1)

from config import POSTGRES_CONNECTION_STRING


def run_migration():
    """Run the migration to add related_node_ids column and index."""
    if not POSTGRES_CONNECTION_STRING:
        print("ERROR: POSTGRES_CONNECTION_STRING not configured")
        sys.exit(1)
    
    conn = psycopg2.connect(POSTGRES_CONNECTION_STRING)
    try:
        with conn.cursor() as cur:
            print("Adding related_node_ids column to notes_entries...")
            cur.execute("""
                ALTER TABLE notes_entries 
                ADD COLUMN IF NOT EXISTS related_node_ids TEXT[] DEFAULT '{}'::text[];
            """)
            
            print("Creating GIN index on related_node_ids...")
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_notes_entries_related_node_ids_gin 
                ON notes_entries USING GIN (related_node_ids);
            """)
            
            conn.commit()
            print("✓ Migration completed successfully")
    except Exception as e:
        conn.rollback()
        print(f"ERROR: Migration failed: {e}")
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    run_migration()
