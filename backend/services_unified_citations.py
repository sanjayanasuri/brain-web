"""
Phase C: Unified citations adapters.

This module converts existing retrieval payloads (claims/chunks/quotes) into
AnchorRef-based citations without requiring schema migrations.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from unified_primitives import (
    AnchorRef,
    ArtifactRef,
    TextOffsetsSelector,
    TimeRangeSelector,
)


def _truncate_preview(text: str, max_len: int = 260) -> str:
    value = (text or "").strip().replace("\n", " ")
    if len(value) <= max_len:
        return value
    return value[: max_len - 1].rstrip() + "…"


def _as_list(value: Any) -> List[Any]:
    if not value:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _format_ms(ms: Optional[int]) -> Optional[str]:
    if ms is None:
        return None
    try:
        total_seconds = max(0, int(ms) // 1000)
    except Exception:
        return None
    minutes = total_seconds // 60
    seconds = total_seconds % 60
    return f"{minutes}:{seconds:02d}"


def build_retrieval_citations(
    *,
    context: Dict[str, Any],
    graph_id: Optional[str],
    branch_id: Optional[str],
    limit: int = 12,
) -> List[Dict[str, Any]]:
    """
    Build AnchorRef-based citations for `/ai/retrieve`.

    The current retrieval system already returns "chunks" (SourceChunk rows) and
    sometimes quote-like dicts. We adapt those into a stable, cross-modal
    contract so the UI can render an evidence tray and later open branches
    anchored to exact spans.

    Returns:
        List of dict items:
        {
          kind: "source_chunk" | "quote" | "claim",
          anchor: AnchorRef (json),
          url?: str,
          title?: str,
          ...
        }
    """
    citations: List[Dict[str, Any]] = []
    seen_anchor_ids: set[str] = set()

    # --- Voice transcript chunks (cross-modal continuity) ---
    voice_chunks = _as_list(context.get("voice_transcript_chunks"))
    for chunk in voice_chunks:
        if not isinstance(chunk, dict):
            continue

        chunk_id = chunk.get("chunk_id") or chunk.get("id")
        if not chunk_id:
            continue

        role = chunk.get("role") or ""
        start_ms = chunk.get("start_ms")
        end_ms = chunk.get("end_ms")

        anchor_json = chunk.get("anchor")
        if isinstance(anchor_json, dict) and anchor_json.get("anchor_id"):
            anchor = anchor_json
            anchor_id = anchor_json.get("anchor_id")
        else:
            selector = TimeRangeSelector(
                start_ms=max(0, int(start_ms or 0)),
                end_ms=max(1, int(end_ms or (int(start_ms or 0) + 1))),
            )
            anchor_obj = AnchorRef.create(
                artifact=ArtifactRef(
                    namespace="postgres",
                    type="voice_transcript_chunk",
                    id=str(chunk_id),
                    graph_id=graph_id,
                    branch_id=branch_id,
                ),
                selector=selector,
                preview=_truncate_preview(chunk.get("content") or ""),
            )
            anchor = anchor_obj.model_dump(mode="json")
            anchor_id = anchor.get("anchor_id")

        if not anchor_id or anchor_id in seen_anchor_ids:
            continue
        seen_anchor_ids.add(anchor_id)

        when = _format_ms(start_ms)
        if role and when:
            title = f"Voice ({role}) @ {when}"
        elif role:
            title = f"Voice ({role})"
        elif when:
            title = f"Voice @ {when}"
        else:
            title = "Voice"

        citations.append(
            {
                "kind": "voice_transcript_chunk",
                "anchor": anchor,
                "title": title,
                "voice_session_id": chunk.get("voice_session_id"),
                "chunk_id": str(chunk_id),
                "role": role or None,
                "start_ms": start_ms,
                "end_ms": end_ms,
            }
        )
        if len(citations) >= limit:
            return citations

    # --- Source chunks (preferred; most "source aware") ---
    chunks = _as_list(context.get("chunks"))
    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue

        chunk_id = chunk.get("chunk_id")
        if not chunk_id:
            continue

        text = chunk.get("text") or ""
        selector = TextOffsetsSelector(start_offset=0, end_offset=max(1, len(text)))
        anchor = AnchorRef.create(
            artifact=ArtifactRef(
                namespace="neo4j",
                type="source_chunk",
                id=str(chunk_id),
                graph_id=graph_id,
                branch_id=branch_id,
            ),
            selector=selector,
            preview=_truncate_preview(text),
        )

        if anchor.anchor_id in seen_anchor_ids:
            continue
        seen_anchor_ids.add(anchor.anchor_id)

        citations.append(
            {
                "kind": "source_chunk",
                "anchor": anchor.model_dump(mode="json"),
                "chunk_id": str(chunk_id),
                "chunk_index": chunk.get("chunk_index"),
                "source_id": chunk.get("source_id"),
                "doc_id": chunk.get("doc_id"),
                "url": chunk.get("url"),
                "source_type": chunk.get("source_type"),
                "published_at": chunk.get("published_at"),
            }
        )
        if len(citations) >= limit:
            return citations

    # --- Quotes (focus context / quote lists) ---
    quote_candidates: List[Any] = []
    focus_context = context.get("focus_context") or {}
    if isinstance(focus_context, dict):
        quote_candidates.extend(_as_list(focus_context.get("quotes")))
    quote_candidates.extend(_as_list(context.get("quotes")))

    for quote in quote_candidates:
        if not isinstance(quote, dict):
            continue
        quote_id = quote.get("quote_id")
        text = quote.get("text") or ""
        if not quote_id or not text:
            continue

        selector = TextOffsetsSelector(start_offset=0, end_offset=max(1, len(text)))
        anchor = AnchorRef.create(
            artifact=ArtifactRef(
                namespace="neo4j",
                type="quote",
                id=str(quote_id),
                graph_id=graph_id,
                branch_id=branch_id,
            ),
            selector=selector,
            preview=_truncate_preview(text),
        )

        if anchor.anchor_id in seen_anchor_ids:
            continue
        seen_anchor_ids.add(anchor.anchor_id)

        citations.append(
            {
                "kind": "quote",
                "anchor": anchor.model_dump(mode="json"),
                "quote_id": str(quote_id),
                "url": quote.get("source_url"),
                "title": quote.get("source_title"),
            }
        )
        if len(citations) >= limit:
            return citations

    return citations
