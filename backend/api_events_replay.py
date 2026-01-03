"""
API endpoint for replaying offline mirror events.

This endpoint handles batch replay of events from the browser extension's
offline mirror, ensuring idempotency via Event nodes with applied markers.
"""
from fastapi import APIRouter, Depends
from neo4j import Session

from db_neo4j import get_neo4j_session
from services_branch_explorer import ensure_graph_scoping_initialized

from models_events import EventsReplayRequest, EventsReplayResponse, ReplayResult
from services_web_ingestion import ingest_web_payload

router = APIRouter(prefix="/events", tags=["events"])


@router.post("/replay", response_model=EventsReplayResponse)
def replay_events(req: EventsReplayRequest, session: Session = Depends(get_neo4j_session)):
    """
    Apply an offline mirror batch.
    Idempotent per event_id via (:Event {event_id}) uniqueness + applied marker.
    """
    ensure_graph_scoping_initialized(session)

    results = []

    for ev in req.events:
        try:
            # Ensure Event exists; mark if new
            row = session.run(
                """
                MERGE (e:Event {event_id: $event_id})
                ON CREATE SET
                  e.device_id = $device_id,
                  e.seq = $seq,
                  e.created_at = $created_at,
                  e.type = $type,
                  e.graph_id = $graph_id,
                  e.branch_id = $branch_id,
                  e.trail_id = $trail_id,
                  e.applied = false
                RETURN e.applied AS applied
                """,
                event_id=ev.event_id,
                device_id=ev.device_id,
                seq=ev.seq,
                created_at=ev.created_at,
                type=ev.type,
                graph_id=ev.graph_id,
                branch_id=ev.branch_id,
                trail_id=ev.trail_id,
            ).single()

            if row and row["applied"] is True:
                results.append(ReplayResult(event_id=ev.event_id, status="duplicate"))
                continue

            if ev.type != "artifact.ingested":
                results.append(ReplayResult(event_id=ev.event_id, status="error", detail=f"Unsupported type: {ev.type}"))
                continue

            ingest = (ev.payload or {}).get("ingest")
            if not ingest:
                results.append(ReplayResult(event_id=ev.event_id, status="error", detail="Missing payload.ingest"))
                continue

            # Apply side effects through the SAME code path as /web/ingest
            out = ingest_web_payload(
                session=session,
                url=ingest["url"],
                title=ingest.get("title"),
                capture_mode=ingest.get("capture_mode", "reader"),
                text=ingest.get("text", ""),
                selection_text=ingest.get("selection_text"),
                anchor=ingest.get("anchor"),
                domain=ingest.get("domain", "General"),
                tags=ingest.get("tags") or [],
                note=ingest.get("note"),
                metadata=ingest.get("metadata") or {},
                trail_id=ingest.get("trail_id") or ev.trail_id,
                graph_id_override=ev.graph_id,
                branch_id_override=ev.branch_id,
            )

            # Mark applied even if ingestion SKIPPED, because the event was processed.
            session.run(
                """
                MATCH (e:Event {event_id:$event_id})
                SET e.applied = true, e.applied_at = datetime(), e.result = $result
                """,
                event_id=ev.event_id,
                result=out.get("status"),
            )

            results.append(ReplayResult(event_id=ev.event_id, status="applied"))

        except Exception as e:
            msg = str(e)
            # If uniqueness constraint triggered by race, treat as duplicate
            if "ConstraintValidationFailed" in msg or "already exists" in msg:
                results.append(ReplayResult(event_id=ev.event_id, status="duplicate"))
            else:
                results.append(ReplayResult(event_id=ev.event_id, status="error", detail=msg[:300]))

    return EventsReplayResponse(results=results)
