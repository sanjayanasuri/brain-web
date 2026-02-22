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
from services_ingestion_kernel import ingest_artifact
from models_ingestion_kernel import ArtifactInput, IngestionActions, IngestionPolicy

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
            artifact_input = ArtifactInput(
                artifact_type="webpage",
                source_url=ingest["url"],
                title=ingest.get("title"),
                domain=ingest.get("domain", "General"),
                text=ingest.get("text", ""),
                selection_text=ingest.get("selection_text"),
                anchor=ingest.get("anchor"),
                trail_id=ingest.get("trail_id") or ev.trail_id,
                metadata={
                    **(ingest.get("metadata") or {}),
                    "capture_mode": ingest.get("capture_mode", "reader"),
                    "note": ingest.get("note"),
                    "tags": ingest.get("tags"),
                },
                actions=IngestionActions(
                    run_lecture_extraction=True,
                    run_chunk_and_claims=True,
                    embed_claims=True,
                    create_lecture_node=True,
                    create_artifact_node=True,
                ),
                policy=IngestionPolicy(local_only=True)
            )
            
            result = ingest_artifact(
                session=session, 
                payload=artifact_input,
                graph_id=ev.graph_id,
                branch_id=ev.branch_id
            )
            out_status = result.status

            # Mark applied even if ingestion SKIPPED, because the event was processed.
            session.run(
                """
                MATCH (e:Event {event_id:$event_id})
                SET e.applied = true, e.applied_at = datetime(), e.result = $result
                """,
                event_id=ev.event_id,
                result=out_status,
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
