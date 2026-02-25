"""Indexing health metrics for notes/OCR/transcripts/evidence."""
from __future__ import annotations

from typing import Dict, Any

from db_postgres import execute_query


def get_indexing_health(user_id: str, tenant_id: str) -> Dict[str, Any]:
    # OCR + note-image ingestion
    ocr_rows = execute_query(
        """
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE COALESCE(status,'') IN ('processed','indexed','completed'))::int AS success,
          AVG(NULLIF((metadata->>'ocr_confidence')::float, 0)) AS avg_conf
        FROM capture_inbox
        WHERE user_id=%s AND tenant_id=%s AND source IN ('note','file')
          AND created_at >= NOW() - INTERVAL '7 days'
        """,
        (str(user_id), str(tenant_id)),
    ) or []

    transcript_rows = execute_query(
        """
        SELECT COUNT(*)::int AS chunks
        FROM voice_transcript_chunks
        WHERE user_id=%s AND tenant_id=%s
          AND created_at >= NOW() - INTERVAL '24 hours'
        """,
        (str(user_id), str(tenant_id)),
    ) or []

    citation_rows = execute_query(
        """
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE anchor_json IS NOT NULL AND anchor_json <> '')::int AS with_citations
        FROM voice_transcript_chunks
        WHERE user_id=%s AND tenant_id=%s
          AND created_at >= NOW() - INTERVAL '24 hours'
        """,
        (str(user_id), str(tenant_id)),
    ) or []

    ocr = ocr_rows[0] if ocr_rows else {"total": 0, "success": 0, "avg_conf": None}
    transcripts = transcript_rows[0] if transcript_rows else {"chunks": 0}
    c = citation_rows[0] if citation_rows else {"total": 0, "with_citations": 0}

    total = int(c.get("total") or 0)
    with_citations = int(c.get("with_citations") or 0)
    citation_rate = (with_citations / total) if total > 0 else None

    return {
        "ocr": {
            "total_7d": int(ocr.get("total") or 0),
            "success_7d": int(ocr.get("success") or 0),
            "avg_confidence_7d": float(ocr.get("avg_conf")) if ocr.get("avg_conf") is not None else None,
        },
        "transcripts": {
            "chunks_24h": int(transcripts.get("chunks") or 0),
        },
        "evidence": {
            "responses_24h": total,
            "with_citations_24h": with_citations,
            "citation_rate_24h": citation_rate,
        },
    }
