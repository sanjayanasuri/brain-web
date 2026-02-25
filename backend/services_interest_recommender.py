"""Interest profile + content suggestion service.

Builds an interest profile from conversation memory events + promoted memories,
then generates lightweight content suggestions.
"""
from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime, timezone
from typing import Dict, List, Tuple

from db_postgres import execute_query, execute_update

STOPWORDS = {
    "about", "after", "again", "also", "been", "being", "brain", "build", "built", "code", "could", "does", "doing", "from", "have", "just", "like", "more", "most", "need", "really", "should", "that", "them", "then", "this", "trying", "want", "with", "would", "your",
}


def _tokens(text: str) -> List[str]:
    words = re.findall(r"[a-zA-Z][a-zA-Z0-9_\-]{2,}", (text or "").lower())
    out: List[str] = []
    for w in words:
        if w in STOPWORDS:
            continue
        if len(w) < 3:
            continue
        out.append(w)
    return out


def _top_keywords(rows: List[Dict], limit: int = 12) -> List[Tuple[str, int]]:
    c = Counter()
    for r in rows:
        c.update(_tokens((r.get("content") or "") + " " + (r.get("user_text") or "")))
    return c.most_common(limit)


def build_interest_profile(*, user_id: str, tenant_id: str) -> Dict:
    promoted = execute_query(
        """
        SELECT content, score, tier
        FROM memory_promotions
        WHERE user_id=%s AND tenant_id=%s AND status='promoted'
        ORDER BY score DESC, last_seen_at DESC
        LIMIT 80
        """,
        (user_id, tenant_id),
    ) or []

    recent = execute_query(
        """
        SELECT user_text, assistant_text, created_at
        FROM conversation_memory_events
        WHERE user_id=%s AND tenant_id=%s
        ORDER BY created_at DESC
        LIMIT 120
        """,
        (user_id, tenant_id),
    ) or []

    merged = []
    for p in promoted:
        merged.append({"content": p.get("content", "")})
    for r in recent:
        merged.append({"user_text": r.get("user_text", "")})

    top = _top_keywords(merged, limit=15)
    profile = {
        "keywords": [{"term": t, "weight": int(w)} for t, w in top],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    execute_update(
        """
        INSERT INTO interest_profiles (user_id, tenant_id, profile_json, updated_at)
        VALUES (%s, %s, %s::jsonb, NOW())
        ON CONFLICT (user_id, tenant_id)
        DO UPDATE SET profile_json=EXCLUDED.profile_json, updated_at=NOW()
        """,
        (user_id, tenant_id, json.dumps(profile)),
    )
    return profile


def generate_content_suggestions(*, user_id: str, tenant_id: str, limit: int = 5) -> List[Dict]:
    row = execute_query(
        "SELECT profile_json FROM interest_profiles WHERE user_id=%s AND tenant_id=%s LIMIT 1",
        (user_id, tenant_id),
    )
    if not row:
        profile = build_interest_profile(user_id=user_id, tenant_id=tenant_id)
    else:
        profile = row[0].get("profile_json") or {}

    keywords = [k.get("term") for k in (profile.get("keywords") or []) if k.get("term")]
    picks = keywords[: max(1, limit)]

    suggestions: List[Dict] = []
    for i, term in enumerate(picks):
        s = {
            "kind": "topic_suggestion",
            "title": f"Explore: {term}",
            "reason": f"Shows up repeatedly in your recent conversations and promoted memory.",
            "query": term,
            "score": max(0.4, 1.0 - i * 0.1),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        suggestions.append(s)
        execute_update(
            """
            INSERT INTO content_suggestions (id, user_id, tenant_id, kind, title, reason, query, score, metadata)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (id) DO NOTHING
            """,
            (
                f"cs_{abs(hash(user_id + tenant_id + term)) % 10**12}",
                user_id,
                tenant_id,
                s["kind"],
                s["title"],
                s["reason"],
                s["query"],
                s["score"],
                json.dumps({"source": "interest_recommender"}),
            ),
        )

    return suggestions


def get_recent_suggestions(*, user_id: str, tenant_id: str, limit: int = 10) -> List[Dict]:
    rows = execute_query(
        """
        SELECT id, kind, title, reason, query, score, created_at
        FROM content_suggestions
        WHERE user_id=%s AND tenant_id=%s AND dismissed=FALSE
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (user_id, tenant_id, limit),
    ) or []
    return rows


def record_suggestion_event(*, suggestion_id: str, user_id: str, tenant_id: str, event_type: str, metadata: Dict | None = None) -> None:
    execute_update(
        """
        INSERT INTO content_suggestion_events (id, suggestion_id, user_id, tenant_id, event_type, metadata)
        VALUES (%s, %s, %s, %s, %s, %s::jsonb)
        """,
        (
            f"cse_{abs(hash(suggestion_id + user_id + event_type + str(__import__('time').time_ns()))) % 10**15}",
            suggestion_id,
            user_id,
            tenant_id,
            event_type,
            json.dumps(metadata or {}),
        ),
    )


def dismiss_suggestion(*, suggestion_id: str, user_id: str, tenant_id: str) -> None:
    execute_update(
        """
        UPDATE content_suggestions
        SET dismissed=TRUE
        WHERE id=%s AND user_id=%s AND tenant_id=%s
        """,
        (suggestion_id, user_id, tenant_id),
    )
    record_suggestion_event(
        suggestion_id=suggestion_id,
        user_id=user_id,
        tenant_id=tenant_id,
        event_type="dismissed",
        metadata={},
    )
