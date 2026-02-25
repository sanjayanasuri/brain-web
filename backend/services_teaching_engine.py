"""Teaching engine helpers for confusion-to-mastery and socratic tutoring."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Dict, Tuple
from uuid import uuid4

from db_postgres import execute_update

CONFUSION_PATTERNS = [
    r"\bi\s+don'?t\s+get\b",
    r"\bi\s*'?m\s+confused\b",
    r"\bwtf\b",
    r"\bdon'?t\s+understand\b",
    r"\bthis\s+makes\s+no\s+sense\b",
]

RESOLUTION_PATTERNS = [
    r"\bgot it\b",
    r"\bmakes sense\b",
    r"\bunderstand now\b",
    r"\bthat helped\b",
]


def detect_confusion(text: str) -> bool:
    t = (text or "").lower()
    return any(re.search(p, t) for p in CONFUSION_PATTERNS)


def detect_resolution(text: str) -> bool:
    t = (text or "").lower()
    return any(re.search(p, t) for p in RESOLUTION_PATTERNS)


def build_intervention_fields(user_text: str, assistant_answer: str) -> Dict[str, str]:
    # Lightweight heuristic generation. Could later call LLM teacher model.
    simplified = "I’ll break this into one core idea, one intuition, and one example."
    prerequisite = "Likely missing prerequisite: the definition-level intuition behind the key term in this question."
    practice = "In one sentence, explain the core concept in plain language and give one concrete example."
    if assistant_answer:
        simplified = assistant_answer[:280]
    return {
        "simplified_explanation": simplified,
        "prerequisite_gap": prerequisite,
        "practice_question": practice,
    }


def create_learning_intervention(*, user_id: str, tenant_id: str, chat_id: str, source: str, trigger_text: str, assistant_answer: str, metadata: Dict | None = None) -> str:
    iid = f"li_{uuid4().hex[:12]}"
    f = build_intervention_fields(trigger_text, assistant_answer)
    execute_update(
        """
        INSERT INTO learning_interventions (
          id, user_id, tenant_id, chat_id, source, trigger_text,
          simplified_explanation, prerequisite_gap, practice_question,
          status, metadata, created_at, updated_at
        )
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'open',%s::jsonb,NOW(),NOW())
        """,
        (
            iid,
            str(user_id),
            str(tenant_id),
            chat_id,
            source,
            trigger_text,
            f["simplified_explanation"],
            f["prerequisite_gap"],
            f["practice_question"],
            json.dumps(metadata or {}),
        ),
    )
    return iid


def maybe_mark_recent_interventions_resolved(*, user_id: str, tenant_id: str, chat_id: str, text: str) -> int:
    if not detect_resolution(text):
        return 0
    execute_update(
        """
        UPDATE learning_interventions
        SET status='resolved', updated_at=NOW(), metadata = COALESCE(metadata,'{}'::jsonb) || '{"resolved_by":"user_signal"}'::jsonb
        WHERE user_id=%s AND tenant_id=%s AND chat_id=%s AND status='open'
          AND created_at >= NOW() - INTERVAL '7 days'
        """,
        (str(user_id), str(tenant_id), chat_id),
    )
    return 1
