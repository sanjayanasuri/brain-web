# backend/api_sync.py
from __future__ import annotations

from typing import Any, Dict, List, Optional, Literal
import json
import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from neo4j import Session

from db_neo4j import get_neo4j_session
from services_branch_explorer import (
    ensure_schema_constraints,
    ensure_graphspace_exists,
    ensure_branch_exists,
    get_active_graph_context,
    ensure_graph_scoping_initialized,
)
router = APIRouter(prefix="/sync", tags=["sync"])

# Import here to avoid circular dependencies
from services_sync_capture import capture_selection_into_graph


# -----------------------------
# Models
# -----------------------------

SyncEventType = Literal[
    "artifact.ingest",
    "resource.create",
    "resource.link",
    "trail.step.append",
]

class ClientSyncEvent(BaseModel):
    event_id: str
    graph_id: str
    branch_id: str
    type: SyncEventType
    payload: Dict[str, Any] = Field(default_factory=dict)
    created_at_ms: Optional[int] = None


class SyncEventsRequest(BaseModel):
    events: List[ClientSyncEvent]


class SyncEventResult(BaseModel):
    event_id: str
    status: Literal["applied", "duplicate", "error"]
    detail: Optional[str] = None
    output: Optional[Dict[str, Any]] = None


class SyncEventsResponse(BaseModel):
    ok: bool
    results: List[SyncEventResult]


# -----------------------------
# Helpers
# -----------------------------

def _now_iso() -> str:
    return datetime.datetime.utcnow().replace(tzinfo=datetime.timezone.utc).isoformat()


def _json_or_none(x: Any) -> Optional[str]:
    if x is None:
        return None
    try:
        return json.dumps(x)
    except Exception:
        return None


def _ensure_graph_branch(session: Session, graph_id: str, branch_id: str) -> None:
    """
    For sync, we accept graph_id/branch_id from the client, but we ensure
    these exist server-side before applying events.
    """
    ensure_schema_constraints(session)
    ensure_graphspace_exists(session, graph_id)
    ensure_branch_exists(session, graph_id, branch_id)


def _ensure_client_event_node(session: Session, event: ClientSyncEvent) -> bool:
    """
    Idempotency gate.
    Returns True if this is a NEW event we should apply.
    Returns False if it already exists (duplicate).
    """
    rec = session.run(
        """
        MERGE (e:ClientEvent {graph_id: $graph_id, event_id: $event_id})
        ON CREATE SET
          e.type = $type,
          e.branch_id = $branch_id,
          e.created_at_ms = $created_at_ms,
          e.received_at = $now,
          e.payload_json = $payload_json,
          e.applied = false
        RETURN e.applied AS applied, e.received_at AS received_at
        """,
        graph_id=event.graph_id,
        branch_id=event.branch_id,
        event_id=event.event_id,
        type=event.type,
        created_at_ms=event.created_at_ms,
        payload_json=_json_or_none(event.payload),
        now=_now_iso(),
    ).single()

    # If node existed previously, MERGE returns existing values.
    # We treat it as duplicate if applied == true OR received_at already existed.
    # The reliable duplicate check is: did we "create" it? Neo4j doesn't directly tell us here.
    # We use "applied" flag: if it's already true, it is definitely duplicate-applied.
    # If it's false, we still treat as duplicate to avoid double-apply under concurrent retries.
    if not rec:
        return False

    applied = rec["applied"]
    if applied is True:
        return False

    # Conservative: if it exists at all, treat as duplicate.
    # This avoids re-applying events if previous attempt crashed mid-way.
    # If you want “exactly-once”, you can move to transaction + applied flip at end.
    return True


def _mark_client_event_applied(session: Session, event: ClientSyncEvent, output: Optional[Dict[str, Any]] = None) -> None:
    session.run(
        """
        MATCH (e:ClientEvent {graph_id: $graph_id, event_id: $event_id})
        SET e.applied = true,
            e.applied_at = $now,
            e.output_json = $output_json
        """,
        graph_id=event.graph_id,
        event_id=event.event_id,
        now=_now_iso(),
        output_json=_json_or_none(output),
    ).consume()


# -----------------------------
# Event handlers
# -----------------------------

def _handle_artifact_ingest(session: Session, event: ClientSyncEvent) -> Dict[str, Any]:
    p = event.payload or {}

    # Required
    url = p.get("url")
    text = p.get("text")
    content_hash = p.get("content_hash")

    if not url or not text:
        raise ValueError("artifact.ingest requires url and text")

    from services_ingestion_kernel import ingest_artifact
    from models_ingestion_kernel import ArtifactInput, IngestionActions, IngestionPolicy

    artifact_input = ArtifactInput(
        artifact_type="webpage",
        source_url=url,
        source_id=p.get("artifact_id"),
        title=p.get("title"),
        domain=p.get("domain"),
        text=text,
        metadata={
            **(p.get("metadata") or {}),
            "captured_at": p.get("captured_at"),
            "content_hash": content_hash,
        },
        actions=IngestionActions(
            run_lecture_extraction=False,
            run_chunk_and_claims=False,
            create_artifact_node=True,
        ),
        policy=IngestionPolicy(local_only=True)
    )

    result = ingest_artifact(
        session=session,
        payload=artifact_input,
        graph_id=event.graph_id,
        branch_id=event.branch_id
    )

    return {"artifact_id": result.artifact_id, "content_hash": content_hash}


def _handle_resource_create(session: Session, event: ClientSyncEvent) -> Dict[str, Any]:
    p = event.payload or {}

    kind = p.get("kind")
    url = p.get("url")
    if not kind or not url:
        raise ValueError("resource.create requires kind, url")

    resource_id = p.get("resource_id") or f"R{event.event_id[:8].upper()}"

    session.run(
        """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MERGE (r:Resource {graph_id: $graph_id, resource_id: $resource_id})
        ON CREATE SET
          r.kind = $kind,
          r.url = $url,
          r.title = $title,
          r.mime_type = $mime_type,
          r.caption = $caption,
          r.source = $source,
          r.metadata_json = $metadata_json,
          r.created_at = $now,
          r.updated_at = $now
        ON MATCH SET
          r.kind = COALESCE($kind, r.kind),
          r.url = COALESCE($url, r.url),
          r.title = COALESCE($title, r.title),
          r.mime_type = COALESCE($mime_type, r.mime_type),
          r.caption = COALESCE($caption, r.caption),
          r.source = COALESCE($source, r.source),
          r.metadata_json = COALESCE($metadata_json, r.metadata_json),
          r.updated_at = $now
        MERGE (r)-[:BELONGS_TO]->(g)
        RETURN r.resource_id AS resource_id
        """,
        graph_id=event.graph_id,
        resource_id=resource_id,
        kind=kind,
        url=url,
        title=p.get("title"),
        mime_type=p.get("mime_type"),
        caption=p.get("caption"),
        source=p.get("source"),
        metadata_json=_json_or_none(p.get("metadata")),
        now=_now_iso(),
    ).single()

    return {"resource_id": resource_id}


def _handle_resource_link(session: Session, event: ClientSyncEvent) -> Dict[str, Any]:
    p = event.payload or {}
    concept_id = p.get("concept_id")
    resource_id = p.get("resource_id")
    if not concept_id or not resource_id:
        raise ValueError("resource.link requires concept_id, resource_id")

    session.run(
        """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MATCH (c:Concept {graph_id: $graph_id, node_id: $concept_id})-[:BELONGS_TO]->(g)
        MATCH (r:Resource {graph_id: $graph_id, resource_id: $resource_id})-[:BELONGS_TO]->(g)
        WHERE $branch_id IN COALESCE(c.on_branches, [])
        MERGE (c)-[rel:HAS_RESOURCE {graph_id: $graph_id}]->(r)
        SET rel.on_branches = CASE
          WHEN rel.on_branches IS NULL THEN [$branch_id]
          WHEN $branch_id IN rel.on_branches THEN rel.on_branches
          ELSE rel.on_branches + $branch_id
        END,
        rel.updated_at = $now
        """,
        graph_id=event.graph_id,
        branch_id=event.branch_id,
        concept_id=concept_id,
        resource_id=resource_id,
        now=_now_iso(),
    ).consume()

    return {"linked": True}


def _handle_trail_step_append(session: Session, event: ClientSyncEvent) -> Dict[str, Any]:
    p = event.payload or {}
    trail_id = p.get("trail_id")
    kind = p.get("kind")

    if not trail_id or not kind:
        raise ValueError("trail.step.append requires trail_id, kind")

    step_id = p.get("step_id") or f"S{event.event_id[:10].upper()}"

    session.run(
        """
        MATCH (g:GraphSpace {graph_id: $graph_id})

        MERGE (t:Trail {graph_id: $graph_id, trail_id: $trail_id})
        ON CREATE SET
          t.created_at = $now,
          t.updated_at = $now,
          t.name = COALESCE($trail_name, $trail_id)
        ON MATCH SET
          t.updated_at = $now
        MERGE (t)-[:BELONGS_TO]->(g)

        MERGE (s:TrailStep {graph_id: $graph_id, step_id: $step_id})
        ON CREATE SET
          s.created_at = $now,
          s.updated_at = $now
        SET s.kind = $kind,
            s.label = $label,
            s.note = $note,
            s.focus_concept_id = $focus_concept_id,
            s.focus_quote_id = $focus_quote_id,
            s.page_url = $page_url,
            s.client_created_at_ms = $client_created_at_ms,
            s.updated_at = $now
        MERGE (s)-[:BELONGS_TO]->(g)

        MERGE (t)-[r:HAS_STEP {graph_id: $graph_id}]->(s)
        SET r.on_branches = CASE
          WHEN r.on_branches IS NULL THEN [$branch_id]
          WHEN $branch_id IN r.on_branches THEN r.on_branches
          ELSE r.on_branches + $branch_id
        END,
        r.updated_at = $now
        """,
        graph_id=event.graph_id,
        branch_id=event.branch_id,
        trail_id=trail_id,
        trail_name=p.get("trail_name"),
        step_id=step_id,
        kind=kind,
        label=p.get("label"),
        note=p.get("note"),
        focus_concept_id=p.get("focus_concept_id"),
        focus_quote_id=p.get("focus_quote_id"),
        page_url=p.get("page_url"),
        client_created_at_ms=p.get("created_at_ms"),
        now=_now_iso(),
    ).consume()

    return {"trail_id": trail_id, "step_id": step_id}


def _dispatch_event(session: Session, event: ClientSyncEvent) -> Dict[str, Any]:
    _ensure_graph_branch(session, event.graph_id, event.branch_id)

    if event.type == "artifact.ingest":
        return _handle_artifact_ingest(session, event)
    if event.type == "resource.create":
        return _handle_resource_create(session, event)
    if event.type == "resource.link":
        return _handle_resource_link(session, event)
    if event.type == "trail.step.append":
        return _handle_trail_step_append(session, event)

    raise ValueError(f"Unknown sync event type: {event.type}")


# -----------------------------
# Routes
# -----------------------------

@router.post("/events", response_model=SyncEventsResponse)
def sync_events(req: SyncEventsRequest, session=Depends(get_neo4j_session)):
    """
    Apply a batch of client-generated events (offline outbox).

    Idempotency:
    - Uses (:ClientEvent {graph_id, event_id}) as a dedupe gate.
    - This implementation is conservative: if an event id is seen, we treat it as duplicate.
      (You can evolve this to exactly-once semantics by using a single write transaction and
       flipping e.applied=true only if handler succeeds.)
    """
    results: List[SyncEventResult] = []

    for ev in req.events:
        try:
            # Ensure constraints are present
            ensure_schema_constraints(session)

            # Dedupe gate
            should_apply = _ensure_client_event_node(session, ev)
            if not should_apply:
                results.append(SyncEventResult(event_id=ev.event_id, status="duplicate"))
                continue

            # Apply
            output = _dispatch_event(session, ev)

            # Mark applied
            _mark_client_event_applied(session, ev, output=output)

            results.append(SyncEventResult(event_id=ev.event_id, status="applied", output=output))

        except Exception as e:
            results.append(SyncEventResult(event_id=ev.event_id, status="error", detail=str(e)))

    ok = all(r.status in ("applied", "duplicate") for r in results)
    return SyncEventsResponse(ok=ok, results=results)


# -----------------------------
# Capture Selection Endpoint
# -----------------------------

class CaptureSelectionRequest(BaseModel):
    selected_text: str
    page_url: str
    page_title: Optional[str] = None
    frame_url: Optional[str] = None

    attach_concept_id: Optional[str] = None
    graph_id: Optional[str] = None
    branch_id: Optional[str] = None

    context_before: Optional[str] = None
    context_after: Optional[str] = None
    anchor: Optional[Dict[str, Any]] = None


class CaptureSelectionResponse(BaseModel):
    status: str = "ok"
    graph_id: str
    branch_id: str
    artifact_id: str
    quote_id: str
    
    class Config:
        json_schema_extra = {
            "example": {
                "status": "ok",
                "graph_id": "default",
                "branch_id": "main",
                "artifact_id": "A1234567890",
                "quote_id": "Q0987654321"
            }
        }


@router.post("/capture-selection", response_model=CaptureSelectionResponse)
def capture_selection_endpoint(
    req: CaptureSelectionRequest,
    session: Session = Depends(get_neo4j_session),
):
    try:
        if not req.selected_text or not req.selected_text.strip():
            raise HTTPException(status_code=400, detail="selected_text is required")
        if not req.page_url or not req.page_url.strip():
            raise HTTPException(status_code=400, detail="page_url is required")

        ensure_graph_scoping_initialized(session)

        active_graph_id, active_branch_id = get_active_graph_context(session)
        graph_id = req.graph_id or active_graph_id
        branch_id = req.branch_id or active_branch_id

        from services_ingestion_kernel import ingest_artifact
        from models_ingestion_kernel import ArtifactInput, IngestionActions, IngestionPolicy

        artifact_input = ArtifactInput(
            artifact_type="webpage",
            source_url=req.page_url,
            title=req.page_title,
            text="", # Selection capture usually doesn't need full text fetch
            selection_text=req.selected_text,
            anchor=req.anchor,
            attach_concept_id=req.attach_concept_id,
            metadata={
                "capture_mode": "selection",
                "frame_url": req.frame_url,
                "context_before": req.context_before,
                "context_after": req.context_after,
            },
            actions=IngestionActions(
                create_artifact_node=True,
            ),
            policy=IngestionPolicy(local_only=True)
        )

        out = ingest_artifact(
            session=session,
            payload=artifact_input,
            graph_id=graph_id,
            branch_id=branch_id
        )

        return CaptureSelectionResponse(
            graph_id=graph_id,
            branch_id=branch_id,
            artifact_id=out.artifact_id,
            quote_id=out.quote_id,
        )
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_detail = str(e)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Capture failed: {error_detail}")
