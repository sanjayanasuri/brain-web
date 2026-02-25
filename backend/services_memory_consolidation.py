"""Background memory consolidation service.

Builds stable user_profile_facts from promoted memories and recent conversation events.
Also writes optional markdown snapshots for debugging/transparency.
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from hashlib import sha256
from typing import Dict, List, Tuple

from db_postgres import execute_query, execute_update


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fact_id(user_id: str, tenant_id: str, fact_type: str, fact_value: str) -> str:
    raw = f"{user_id}|{tenant_id}|{fact_type}|{fact_value.strip().lower()}"
    return "upf_" + sha256(raw.encode("utf-8")).hexdigest()[:24]


def _classify_fact_type(text: str) -> str:
    t = (text or "").lower()
    if any(k in t for k in ["i prefer", "prefer ", "call me", "talk to me", "tone", "concise", "detailed"]):
        return "preference"
    if any(k in t for k in ["i am", "i'm", "my name", "i study", "i work", "i'm a"]):
        return "identity"
    if any(k in t for k in ["i care about", "goal", "trying to", "want to", "need to"]):
        return "goal"
    if any(k in t for k in ["deadline", "exam", "friday", "tomorrow", "schedule", "remind"]):
        return "logistics"
    return "interest"


def consolidate_user_memory(*, user_id: str, tenant_id: str, limit: int = 80) -> int:
    rows = execute_query(
        """
        SELECT content, score, tier
        FROM memory_promotions
        WHERE user_id=%s AND tenant_id=%s
          AND status='promoted'
          AND score >= 0.72
        ORDER BY score DESC, last_seen_at DESC
        LIMIT %s
        """,
        (user_id, tenant_id, limit),
    ) or []

    upserts = 0
    for r in rows:
      content = str(r.get("content") or "").strip()
      if len(content) < 8:
          continue
      fact_type = _classify_fact_type(content)
      confidence = float(r.get("score") or 0.5)
      fid = _fact_id(user_id, tenant_id, fact_type, content)
      execute_update(
          """
          INSERT INTO user_profile_facts
            (id, user_id, tenant_id, fact_type, fact_value, confidence, source, active, metadata, created_at, updated_at)
          VALUES
            (%s, %s, %s, %s, %s, %s, 'memory_consolidation', TRUE, '{}'::jsonb, NOW(), NOW())
          ON CONFLICT (user_id, tenant_id, fact_type, fact_value)
          DO UPDATE SET
            confidence=GREATEST(user_profile_facts.confidence, EXCLUDED.confidence),
            active=TRUE,
            updated_at=NOW()
          """,
          (fid, user_id, tenant_id, fact_type, content, confidence),
      )
      upserts += 1

    return upserts


def list_profile_facts(*, user_id: str, tenant_id: str, limit: int = 40) -> List[Dict]:
    return execute_query(
        """
        SELECT id, fact_type, fact_value, confidence, updated_at
        FROM user_profile_facts
        WHERE user_id=%s AND tenant_id=%s AND active=TRUE
        ORDER BY confidence DESC, updated_at DESC
        LIMIT %s
        """,
        (user_id, tenant_id, limit),
    ) or []


def export_memory_snapshots(*, user_id: str, tenant_id: str, out_dir: str) -> Dict[str, str]:
    os.makedirs(out_dir, exist_ok=True)
    facts = list_profile_facts(user_id=user_id, tenant_id=tenant_id, limit=40)
    promoted = execute_query(
        """
        SELECT memory_type, content, score, tier, last_seen_at
        FROM memory_promotions
        WHERE user_id=%s AND tenant_id=%s AND status='promoted'
        ORDER BY score DESC, last_seen_at DESC
        LIMIT 60
        """,
        (user_id, tenant_id),
    ) or []
    events = execute_query(
        """
        SELECT source, user_text, assistant_text, created_at
        FROM conversation_memory_events
        WHERE user_id=%s AND tenant_id=%s
        ORDER BY created_at DESC
        LIMIT 25
        """,
        (user_id, tenant_id),
    ) or []

    soul_path = os.path.join(out_dir, "SOUL_snapshot.md")
    user_path = os.path.join(out_dir, "USER_snapshot.md")
    memory_path = os.path.join(out_dir, "MEMORY_snapshot.md")

    with open(soul_path, "w") as f:
        f.write("# SOUL Snapshot\n\nGenerated from assistant profile settings.\n")

    with open(user_path, "w") as f:
        f.write("# USER Snapshot\n\n")
        for row in facts:
            f.write(f"- [{row.get('fact_type')}] {row.get('fact_value')} (conf {float(row.get('confidence') or 0):.2f})\n")

    with open(memory_path, "w") as f:
        f.write("# MEMORY Snapshot\n\n## Promoted Memories\n")
        for m in promoted:
            f.write(f"- [{m.get('tier')}] {m.get('content')} (score {float(m.get('score') or 0):.2f})\n")
        f.write("\n## Recent Events\n")
        for e in events:
            txt = (e.get('user_text') or '').replace("\n", " ")
            if txt:
                f.write(f"- ({e.get('source')}) {txt[:160]}\n")

    return {"soul": soul_path, "user": user_path, "memory": memory_path}
