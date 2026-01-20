from __future__ import annotations

import datetime
import hashlib
import json
from typing import Any, Dict, Optional

from neo4j import Session


def _now_iso() -> str:
    return datetime.datetime.utcnow().replace(tzinfo=datetime.timezone.utc).isoformat()


def _hash(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8", errors="ignore")).hexdigest()


def capture_selection_into_graph(
    *,
    session: Session,
    graph_id: str,
    branch_id: str,
    page_url: str,
    page_title: Optional[str],
    frame_url: Optional[str] = None,
    selected_text: str,
    context_before: Optional[str] = None,
    context_after: Optional[str] = None,
    anchor: Optional[Dict[str, Any]] = None,
    attach_concept_id: Optional[str] = None,
    session_id: Optional[str] = None,
) -> Dict[str, str]:
    selected_text = (selected_text or "").strip()

    before = (context_before or "").strip()
    after = (context_after or "").strip()

    # Offline-friendly excerpt
    excerpt = "\n".join([x for x in [before, selected_text, after] if x]).strip()

    content_hash = _hash(f"{page_url}\n{page_title or ''}\n{excerpt}")
    artifact_id = f"A{content_hash[:10].upper()}"
    quote_id = f"Q{_hash(selected_text)[:10].upper()}"

    anchor_json = json.dumps(anchor) if anchor else None
    meta_json = json.dumps(
        {
            "frame_url": frame_url,
            "captured_at": _now_iso(),
        }
    )

    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})

    MERGE (a:Artifact {graph_id: $graph_id, url: $url, content_hash: $content_hash})
    ON CREATE SET
      a.artifact_id = $artifact_id,
      a.branch_id = $branch_id,
      a.artifact_type = "webpage",
      a.title = $title,
      a.captured_at = $captured_at_ms,
      a.text = $text,
      a.metadata_json = $meta_json,
      a.created_at = $now
    ON MATCH SET
      a.artifact_id = COALESCE(a.artifact_id, $artifact_id),
      a.updated_at = $now
    MERGE (a)-[:BELONGS_TO]->(g)

    MERGE (q:Quote {graph_id: $graph_id, quote_id: $quote_id})
    ON CREATE SET
      q.text = $quote_text,
      q.page_url = $url,
      q.page_title = $title,
      q.anchor_json = $anchor_json,
      q.created_at = $now,
      q.on_branches = [$branch_id]
    ON MATCH SET
      q.last_seen_at = $now,
      q.anchor_json = COALESCE(q.anchor_json, $anchor_json),
      q.on_branches = CASE
        WHEN q.on_branches IS NULL THEN [$branch_id]
        WHEN $branch_id IN q.on_branches THEN q.on_branches
        ELSE q.on_branches + $branch_id
      END

    MERGE (q)-[:BELONGS_TO]->(g)
    MERGE (q)-[:FROM_ARTIFACT {graph_id: $graph_id}]->(a)

    WITH g, a, q

    OPTIONAL MATCH (c:Concept {graph_id: $graph_id, node_id: $attach_concept_id})-[:BELONGS_TO]->(g)
    FOREACH (_ IN CASE WHEN c IS NULL THEN [] ELSE [1] END |
      MERGE (c)-[r:MENTIONS_QUOTE {graph_id: $graph_id}]->(q)
      SET r.on_branches = CASE
        WHEN r.on_branches IS NULL THEN [$branch_id]
        WHEN $branch_id IN r.on_branches THEN r.on_branches
        ELSE r.on_branches + $branch_id
      END
    )

    RETURN a.artifact_id AS artifact_id, q.quote_id AS quote_id
    """

    rec = session.run(
        query,
        graph_id=graph_id,
        branch_id=branch_id,
        artifact_id=artifact_id,
        quote_id=quote_id,
        url=page_url,
        title=page_title,
        content_hash=content_hash,
        text=excerpt,
        quote_text=selected_text,
        anchor_json=anchor_json,
        meta_json=meta_json,
        now=_now_iso(),
        captured_at_ms=int(datetime.datetime.utcnow().timestamp() * 1000),
        attach_concept_id=attach_concept_id,
    ).single()

    if not rec:
        raise ValueError("Failed to capture selection")
    
    # Emit event for source capture
    try:
        from events.emitter import emit_event
        from events.schema import EventType, ObjectRef
        from projectors.session_context import SessionContextProjector
        
        # Use provided session_id or fallback
        event_session_id = session_id or getattr(session, '_session_id', None) or "unknown"
        
        # Emit event
        emit_event(
            event_type=EventType.SOURCE_CAPTURED,
            session_id=event_session_id,
            object_ref=ObjectRef(type="artifact", id=rec["artifact_id"]),
            payload={
                "artifact_id": rec["artifact_id"],
                "quote_id": rec["quote_id"],
                "page_url": page_url,
                "page_title": page_title,
                "selected_text_length": len(selected_text),
            },
        )
        
        # Projection is now handled asynchronously via background task queue
        # No need to update synchronously here
    except Exception:
        pass  # Don't fail on event emission

    return {"artifact_id": rec["artifact_id"], "quote_id": rec["quote_id"]}

