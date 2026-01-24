"""Shared test utilities for database queries and digest inspection."""
from typing import Any, Dict, List, Optional

import psycopg2
from psycopg2.extras import RealDictCursor


def db_fetchall(conn_str: str, query: str, params: Optional[tuple] = None) -> List[Dict[str, Any]]:
    """Fetch all rows as dictionaries from Postgres."""
    with psycopg2.connect(conn_str) as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, params or ())
            return cur.fetchall()


def db_fetchone(conn_str: str, query: str, params: Optional[tuple] = None) -> Optional[Dict[str, Any]]:
    """Fetch a single row as a dictionary from Postgres."""
    rows = db_fetchall(conn_str, query, params)
    return rows[0] if rows else None


def flatten_digest_entries(digest_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Flatten digest sections into a list of entries with section titles."""
    entries: List[Dict[str, Any]] = []
    for section in digest_json.get("sections", []):
        title = section.get("title")
        for entry in section.get("entries", []):
            entry_copy = dict(entry)
            entry_copy["section_title"] = title
            entries.append(entry_copy)
    return entries
