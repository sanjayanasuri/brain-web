"""
Memory Promotion Engine

Promotes extracted conversation items from short-term signals into:
- active memory (recent, high-signal)
- long-term memory (stable interests/preferences/goals)
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
from typing import Dict, List, Optional

from db_postgres import execute_query, execute_update
from config import (
    MEMORY_ACTIVE_THRESHOLD,
    MEMORY_LONGTERM_THRESHOLD,
    MEMORY_PROMOTION_MIN_CONFIDENCE,
)

_schema_initialized = False


@dataclass
class MemorySignal:
    user_id: str
    tenant_id: str
    source: str
    memory_type: str
    content: str
    confidence: float = 0.5
    explicit: bool = False
    metadata: Optional[Dict] = None


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fingerprint(text: str) -> str:
    norm = " ".join((text or "").strip().lower().split())
    return sha256(norm.encode("utf-8")).hexdigest()[:24]


def _ensure_schema() -> None:
    global _schema_initialized
    if _schema_initialized:
        return

    execute_update(
        """
        CREATE TABLE IF NOT EXISTS memory_promotions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          source TEXT NOT NULL,
          memory_type TEXT NOT NULL,
          content TEXT NOT NULL,
          confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
          seen_count INTEGER NOT NULL DEFAULT 1,
          explicit_count INTEGER NOT NULL DEFAULT 0,
          score DOUBLE PRECISION NOT NULL DEFAULT 0,
          tier TEXT NOT NULL DEFAULT 'short' CHECK (tier IN ('short','active','long_term')),
          status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','promoted')),
          first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          UNIQUE (user_id, tenant_id, fingerprint)
        );
        """
    )
    execute_update("CREATE INDEX IF NOT EXISTS idx_memory_promotions_user_tier ON memory_promotions(user_id, tenant_id, tier, last_seen_at DESC);")
    _schema_initialized = True


def _score_candidate(confidence: float, seen_count: int, explicit_count: int) -> float:
    c = max(0.0, min(1.0, float(confidence or 0.0)))
    repetition = min(0.25, 0.05 * max(0, seen_count - 1))
    explicit_bonus = min(0.2, 0.1 * explicit_count)
    return max(0.0, min(1.0, c * 0.7 + repetition + explicit_bonus))


def promote_memory_signal(signal: MemorySignal) -> Optional[Dict]:
    _ensure_schema()
    if not signal.content or len(signal.content.strip()) < 3:
        return None
    if float(signal.confidence or 0.0) < MEMORY_PROMOTION_MIN_CONFIDENCE:
        return None

    fp = _fingerprint(signal.content)
    row = execute_query(
        """
        SELECT id, confidence, seen_count, explicit_count
        FROM memory_promotions
        WHERE user_id=%s AND tenant_id=%s AND fingerprint=%s
        LIMIT 1
        """,
        (signal.user_id, signal.tenant_id, fp),
    )

    explicit_add = 1 if signal.explicit else 0
    if row:
        prev = row[0]
        seen_count = int(prev.get("seen_count") or 0) + 1
        explicit_count = int(prev.get("explicit_count") or 0) + explicit_add
        confidence = max(float(prev.get("confidence") or 0.0), float(signal.confidence or 0.0))
        score = _score_candidate(confidence, seen_count, explicit_count)
    else:
        seen_count = 1
        explicit_count = explicit_add
        confidence = float(signal.confidence or 0.0)
        score = _score_candidate(confidence, seen_count, explicit_count)

    tier = "short"
    status = "candidate"
    if score >= MEMORY_LONGTERM_THRESHOLD:
        tier, status = "long_term", "promoted"
    elif score >= MEMORY_ACTIVE_THRESHOLD:
        tier, status = "active", "promoted"

    execute_update(
        """
        INSERT INTO memory_promotions
          (id, user_id, tenant_id, fingerprint, source, memory_type, content, confidence,
           seen_count, explicit_count, score, tier, status, first_seen_at, last_seen_at, metadata)
        VALUES
          (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW(), %s::jsonb)
        ON CONFLICT (user_id, tenant_id, fingerprint)
        DO UPDATE SET
          source = EXCLUDED.source,
          memory_type = EXCLUDED.memory_type,
          content = EXCLUDED.content,
          confidence = GREATEST(memory_promotions.confidence, EXCLUDED.confidence),
          seen_count = memory_promotions.seen_count + 1,
          explicit_count = memory_promotions.explicit_count + EXCLUDED.explicit_count,
          score = EXCLUDED.score,
          tier = EXCLUDED.tier,
          status = EXCLUDED.status,
          last_seen_at = NOW(),
          metadata = COALESCE(memory_promotions.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb)
        """,
        (
            f"mem_{fp}", signal.user_id, signal.tenant_id, fp,
            signal.source, signal.memory_type, signal.content, confidence,
            seen_count, explicit_count, score, tier, status,
            __import__("json").dumps(signal.metadata or {}),
        ),
    )

    return {
        "fingerprint": fp,
        "score": score,
        "tier": tier,
        "status": status,
    }


def get_promoted_memories_for_prompt(*, user_id: str, tenant_id: str, limit: int = 8) -> List[Dict]:
    _ensure_schema()
    rows = execute_query(
        """
        SELECT memory_type, content, score, tier, last_seen_at
        FROM memory_promotions
        WHERE user_id=%s AND tenant_id=%s AND status='promoted'
        ORDER BY
          CASE tier WHEN 'long_term' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
          score DESC,
          last_seen_at DESC
        LIMIT %s
        """,
        (user_id, tenant_id, limit),
    )
    return rows or []
