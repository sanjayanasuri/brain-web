"""
Voice transcript persistence as cross-modal artifacts.

Additive only: does not change existing voice-agent flows, but provides
an indexed store for transcript chunks that can be cited via AnchorRef.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from hashlib import sha256
from typing import Any, Dict, List, Literal, Optional

from db_postgres import execute_query, execute_update
from unified_primitives import AnchorRef, ArtifactRef, TimeRangeSelector

logger = logging.getLogger("brain_web")

VoiceRole = Literal["user", "assistant"]

_schema_initialized = False


def _utc_ms(dt: datetime) -> int:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def _safe_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _ensure_schema() -> None:
    global _schema_initialized
    if _schema_initialized:
        return

    # NOTE: Use TEXT IDs so we can use deterministic, non-UUID ids (artifact-first).
    execute_update(
        """
        CREATE TABLE IF NOT EXISTS voice_transcript_chunks (
          id TEXT PRIMARY KEY,
          voice_session_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          graph_id TEXT NOT NULL,
          branch_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          start_ms INTEGER,
          end_ms INTEGER,
          anchor_id TEXT,
          anchor_json TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    execute_update(
        """
        CREATE INDEX IF NOT EXISTS idx_voice_transcript_chunks_session
        ON voice_transcript_chunks(voice_session_id, start_ms, created_at);
        """
    )
    execute_update(
        """
        CREATE INDEX IF NOT EXISTS idx_voice_transcript_chunks_user_graph_branch_created
        ON voice_transcript_chunks(user_id, graph_id, branch_id, created_at DESC);
        """
    )
    execute_update(
        """
        CREATE TABLE IF NOT EXISTS voice_learning_signals (
          id TEXT PRIMARY KEY,
          voice_session_id TEXT NOT NULL,
          chunk_id TEXT,
          user_id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          graph_id TEXT NOT NULL,
          branch_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          payload_json TEXT NOT NULL DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    execute_update(
        """
        CREATE INDEX IF NOT EXISTS idx_voice_learning_signals_session
        ON voice_learning_signals(voice_session_id, created_at DESC);
        """
    )
    execute_update(
        """
        CREATE INDEX IF NOT EXISTS idx_voice_learning_signals_kind
        ON voice_learning_signals(kind);
        """
    )

    _schema_initialized = True


def get_voice_session_started_at_ms(*, voice_session_id: str, user_id: str) -> Optional[int]:
    """
    Fetch voice session started_at in epoch ms (UTC).
    Returns None if the session cannot be found.
    """
    rows = execute_query(
        """
        SELECT started_at
        FROM voice_sessions
        WHERE id = %s AND user_id = %s
        LIMIT 1
        """,
        (voice_session_id, user_id),
    )
    if not rows:
        return None
    started_at = rows[0].get("started_at")
    if not started_at:
        return None
    return _utc_ms(started_at)


def compute_voice_chunk_id(
    *,
    voice_session_id: str,
    role: VoiceRole,
    start_ms: int,
    end_ms: int,
    content: str,
) -> str:
    key = f"{voice_session_id}|{role}|{start_ms}|{end_ms}|{content.strip()}"
    digest = sha256(key.encode("utf-8")).hexdigest()[:16].upper()
    return f"VTC_{digest}"


def record_voice_transcript_chunk(
    *,
    voice_session_id: str,
    user_id: str,
    tenant_id: str,
    graph_id: str,
    branch_id: str,
    role: VoiceRole,
    content: str,
    start_ms: int,
    end_ms: int,
) -> Dict[str, Any]:
    """
    Record a transcript chunk and return its ArtifactRef + AnchorRef.

    start_ms/end_ms are offsets in ms (typically relative to voice session start).
    """
    _ensure_schema()

    if not content or not content.strip():
        raise ValueError("content must be non-empty")
    if end_ms <= start_ms:
        end_ms = start_ms + 1

    chunk_id = compute_voice_chunk_id(
        voice_session_id=voice_session_id,
        role=role,
        start_ms=int(start_ms),
        end_ms=int(end_ms),
        content=content,
    )

    artifact = ArtifactRef(
        namespace="postgres",
        type="voice_transcript_chunk",
        id=chunk_id,
        graph_id=graph_id,
        branch_id=branch_id,
    )
    selector = TimeRangeSelector(start_ms=int(start_ms), end_ms=int(end_ms))
    preview = content.strip().replace("\n", " ")
    if len(preview) > 120:
        preview = preview[:120] + "…"

    anchor = AnchorRef.create(artifact=artifact, selector=selector, preview=preview)
    anchor_json = anchor.model_dump(mode="json")

    execute_update(
        """
        INSERT INTO voice_transcript_chunks
          (id, voice_session_id, user_id, tenant_id, graph_id, branch_id, role, content, start_ms, end_ms, anchor_id, anchor_json)
        VALUES
          (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO NOTHING
        """,
        (
            chunk_id,
            voice_session_id,
            user_id,
            tenant_id,
            graph_id,
            branch_id,
            role,
            content,
            int(start_ms),
            int(end_ms),
            anchor.anchor_id,
            _safe_json(anchor_json),
        ),
    )

    return {
        "chunk_id": chunk_id,
        "artifact": artifact.model_dump(mode="json"),
        "anchor": anchor_json,
    }


def list_voice_transcript_chunks(
    *,
    voice_session_id: str,
    user_id: str,
    limit: int = 500,
) -> List[Dict[str, Any]]:
    """List transcript chunks for a voice session."""
    _ensure_schema()

    rows = execute_query(
        """
        SELECT id, role, content, start_ms, end_ms, anchor_id, anchor_json, created_at, graph_id, branch_id, tenant_id
        FROM voice_transcript_chunks
        WHERE voice_session_id = %s AND user_id = %s
        ORDER BY start_ms ASC NULLS LAST, created_at ASC
        LIMIT %s
        """,
        (voice_session_id, user_id, limit),
    )

    items: List[Dict[str, Any]] = []
    for row in rows or []:
        anchor_ref = None
        if row.get("anchor_json"):
            try:
                anchor_ref = json.loads(row["anchor_json"])
            except Exception:
                anchor_ref = None

        artifact = ArtifactRef(
            namespace="postgres",
            type="voice_transcript_chunk",
            id=row["id"],
            graph_id=row.get("graph_id"),
            branch_id=row.get("branch_id"),
        )

        items.append(
            {
                "chunk_id": row["id"],
                "role": row.get("role"),
                "content": row.get("content"),
                "start_ms": row.get("start_ms"),
                "end_ms": row.get("end_ms"),
                "created_at": row.get("created_at").isoformat() if row.get("created_at") else None,
                "artifact": artifact.model_dump(mode="json"),
                "anchor": anchor_ref,
            }
        )

    return items


def record_voice_learning_signals(
    *,
    voice_session_id: str,
    chunk_id: Optional[str],
    user_id: str,
    tenant_id: str,
    graph_id: str,
    branch_id: str,
    signals: List[Dict[str, Any]],
) -> None:
    """Persist extracted learning signals (idempotent by deterministic id)."""
    _ensure_schema()
    if not signals:
        return

    for signal in signals:
        kind = str(signal.get("kind") or "").strip()
        if not kind:
            continue
        payload_json = {k: v for k, v in signal.items() if k != "kind"}
        key = f"{voice_session_id}|{chunk_id or ''}|{kind}|{_safe_json(payload_json)}"
        sid = f"VLS_{sha256(key.encode('utf-8')).hexdigest()[:16].upper()}"

        execute_update(
            """
            INSERT INTO voice_learning_signals
              (id, voice_session_id, chunk_id, user_id, tenant_id, graph_id, branch_id, kind, payload_json)
            VALUES
              (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (
                sid,
                voice_session_id,
                chunk_id,
                user_id,
                tenant_id,
                graph_id,
                branch_id,
                kind,
                _safe_json(payload_json),
            ),
        )


def list_voice_learning_signals(
    *,
    voice_session_id: str,
    user_id: str,
    limit: int = 200,
) -> List[Dict[str, Any]]:
    _ensure_schema()
    rows = execute_query(
        """
        SELECT id, chunk_id, kind, payload_json, created_at
        FROM voice_learning_signals
        WHERE voice_session_id = %s AND user_id = %s
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (voice_session_id, user_id, limit),
    )
    out: List[Dict[str, Any]] = []
    for row in rows or []:
        payload = {}
        if row.get("payload_json"):
            try:
                payload = json.loads(row["payload_json"])
            except Exception:
                payload = {}
        out.append(
            {
                "id": row.get("id"),
                "chunk_id": row.get("chunk_id"),
                "kind": row.get("kind"),
                "payload": payload,
                "created_at": row.get("created_at").isoformat() if row.get("created_at") else None,
            }
        )
    return out


_TERM_RE = re.compile(r"[a-zA-Z0-9]{3,}")
_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "been",
    "being",
    "but",
    "by",
    "can",
    "could",
    "did",
    "do",
    "does",
    "dont",
    "for",
    "from",
    "how",
    "i",
    "if",
    "in",
    "into",
    "is",
    "it",
    "let",
    "me",
    "my",
    "of",
    "on",
    "or",
    "our",
    "please",
    "so",
    "that",
    "the",
    "their",
    "then",
    "this",
    "to",
    "us",
    "was",
    "we",
    "were",
    "what",
    "when",
    "where",
    "which",
    "who",
    "why",
    "with",
    "you",
    "your",
}


def _extract_search_terms(query: str, max_terms: int = 4) -> List[str]:
    terms: List[str] = []
    for m in _TERM_RE.finditer((query or "").lower()):
        t = m.group(0)
        if len(t) <= 3:
            continue
        if t in _STOPWORDS:
            continue
        if t not in terms:
            terms.append(t)
        if len(terms) >= max_terms:
            break
    return terms


def _excerpt(text: str, max_len: int = 520) -> str:
    value = (text or "").strip().replace("\n", " ")
    if len(value) <= max_len:
        return value
    return value[: max_len - 1].rstrip() + "…"


def search_voice_transcript_chunks(
    *,
    user_id: str,
    graph_id: str,
    branch_id: str,
    query: str,
    limit: int = 6,
) -> List[Dict[str, Any]]:
    """
    Best-effort lexical search over stored voice transcript chunks.

    Returns small, prompt-safe excerpts plus AnchorRef data for citations.
    """
    _ensure_schema()

    q = (query or "").strip()
    if not q:
        return []

    terms = _extract_search_terms(q, max_terms=4)
    patterns = [f"%{t}%" for t in terms] if terms else [f"%{q}%"]
    term_where = " OR ".join(["content ILIKE %s"] * len(patterns))

    rows = execute_query(
        f"""
        SELECT id, voice_session_id, role, content, start_ms, end_ms, anchor_json, created_at
        FROM voice_transcript_chunks
        WHERE user_id = %s
          AND graph_id = %s
          AND branch_id = %s
          AND ({term_where})
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (user_id, graph_id, branch_id, *patterns, max(1, min(int(limit), 20))),
    )

    items: List[Dict[str, Any]] = []
    for row in rows or []:
        anchor_ref = None
        if row.get("anchor_json"):
            try:
                anchor_ref = json.loads(row["anchor_json"])
            except Exception:
                anchor_ref = None

        content = row.get("content") or ""
        items.append(
            {
                "chunk_id": row.get("id"),
                "voice_session_id": row.get("voice_session_id"),
                "role": row.get("role"),
                "content": _excerpt(content),
                "start_ms": row.get("start_ms"),
                "end_ms": row.get("end_ms"),
                "created_at": row.get("created_at").isoformat() if row.get("created_at") else None,
                "anchor": anchor_ref,
            }
        )

    return items
