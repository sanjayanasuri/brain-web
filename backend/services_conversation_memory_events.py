"""Canonical conversation memory event pipeline.

Unifies voice/chat/fact signals into one event stream for downstream memory promotion.
"""
from __future__ import annotations

import json
from hashlib import sha256
from typing import Any, Dict, List, Optional

from db_postgres import execute_query, execute_update
from services_memory_promotion import MemorySignal, promote_memory_signal


def _event_id(user_id: str, tenant_id: str, session_id: str, turn_index: int, content: str) -> str:
    base = f"{user_id}|{tenant_id}|{session_id}|{turn_index}|{content.strip()}"
    return "cme_" + sha256(base.encode("utf-8")).hexdigest()[:24]


def record_conversation_turn(
    *,
    user_id: str,
    tenant_id: str,
    session_id: str,
    graph_id: Optional[str],
    branch_id: Optional[str],
    source: str,
    user_text: str,
    assistant_text: str,
    metadata: Optional[Dict[str, Any]] = None,
) -> str:
    """Store one canonical turn event and trigger promotion candidates."""

    row = execute_query(
        "SELECT COALESCE(MAX(turn_index), 0) AS max_turn FROM conversation_memory_events WHERE user_id=%s AND tenant_id=%s AND session_id=%s",
        (user_id, tenant_id, session_id),
    )
    turn_index = int((row or [{}])[0].get("max_turn") or 0) + 1
    eid = _event_id(user_id, tenant_id, session_id, turn_index, user_text + "\n" + assistant_text)

    execute_update(
        """
        INSERT INTO conversation_memory_events
          (id, user_id, tenant_id, session_id, graph_id, branch_id, source, turn_index, user_text, assistant_text, metadata)
        VALUES
          (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
        ON CONFLICT (id) DO NOTHING
        """,
        (
            eid,
            user_id,
            tenant_id,
            session_id,
            graph_id,
            branch_id,
            source,
            turn_index,
            user_text,
            assistant_text,
            json.dumps(metadata or {}),
        ),
    )

    # Promotion candidates
    if user_text and len(user_text.strip()) >= 8:
        promote_memory_signal(
            MemorySignal(
                user_id=user_id,
                tenant_id=tenant_id,
                source="conversation_event",
                memory_type="recent_interest",
                content=user_text.strip(),
                confidence=0.62,
                explicit=("remember" in user_text.lower() or "i care about" in user_text.lower() or "i want" in user_text.lower()),
                metadata={"session_id": session_id, "event_id": eid},
            )
        )

    return eid


def get_recent_conversation_memory_events(*, user_id: str, tenant_id: str, limit: int = 8) -> List[Dict[str, Any]]:
    rows = execute_query(
        """
        SELECT source, user_text, assistant_text, created_at
        FROM conversation_memory_events
        WHERE user_id=%s AND tenant_id=%s
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (user_id, tenant_id, limit),
    )
    return rows or []
