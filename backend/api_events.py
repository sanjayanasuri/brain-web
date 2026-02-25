from fastapi import APIRouter, Request, Depends, Query
from pydantic import BaseModel, Field
from typing import Any, Dict, Optional, List, Literal
import os
import time
import uuid
import hashlib
from datetime import datetime, timedelta

import boto3

import json
import uuid
from db_neo4j import get_neo4j_session
from neo4j import Session
import logging


logger = logging.getLogger("brain_web")

router = APIRouter(prefix="/events", tags=["events"])
sessions_router = APIRouter(prefix="/sessions", tags=["sessions"])


class ProductEvent(BaseModel):
    name: str = Field(..., description="Event name, e.g. page_view, feature_used")
    properties: Dict[str, Any] = Field(default_factory=dict)
    ts_ms: Optional[int] = Field(default=None, description="Client timestamp (ms). Server will fill if omitted.")


def _get_ddb_table():
    table_name = os.getenv("EVENTS_DDB_TABLE", "").strip()
    if not table_name:
        return None
    region = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "us-east-1"
    ddb = boto3.resource("dynamodb", region_name=region)
    return ddb.Table(table_name)


@router.post("")
def ingest_event(payload: ProductEvent, request: Request):
    """
    Anonymous product analytics event ingestion.
    - No PII by design (session_id is a random cookie)
    - Stores to DynamoDB if configured; otherwise logs to CloudWatch only
    """
    session_id = getattr(request.state, "session_id", None) or request.cookies.get("bw_session_id") or "unknown"
    request_id = getattr(request.state, "request_id", None)
    tenant_id = getattr(request.state, "tenant_id", None)
    ip = getattr(request.state, "client_ip", None)

    ts_ms = payload.ts_ms or int(time.time() * 1000)

    event_record = {
        "pk": f"tenant#{tenant_id or 'unknown'}",
        "sk": f"ts#{ts_ms}#{request_id or ''}",
        "ts_ms": ts_ms,
        "name": payload.name,
        "properties": payload.properties,
        "session_id": session_id,
        "request_id": request_id,
        "ip": ip,
    }

    table = _get_ddb_table()
    if table is not None:
        table.put_item(Item=event_record)
        stored = True
    else:
        stored = False

    logger.info(
        json.dumps(
            {
                "event": "product_event",
                "stored": stored,
                "name": payload.name,
                "session_id": session_id,
                "request_id": request_id,
                "tenant_id": tenant_id,
            },
            separators=(",", ":"),
            ensure_ascii=False
        )
    )

    return {"status": "ok", "stored": stored}


# Activity Event Log (for multi-device activity tracking)
class ActivityEventCreate(BaseModel):
    type: Literal[
        'CONCEPT_VIEWED',
        'RESOURCE_OPENED',
        'EVIDENCE_FETCHED',
        'ANSWER_CREATED',
        'GRAPH_SWITCHED',
        'PINNED',
        'PATH_STARTED',
        'PATH_STEP_VIEWED',
        'PATH_EXITED',
        'DIGEST_OPENED',
        'REVIEW_OPENED',
        'VOICE_SESSION',
        'INGESTION_STARTED',
        'INGESTION_COMPLETED',
        'CANVAS_CAPTURED',
        'QUIZ_STARTED',
        'QUIZ_COMPLETED',
        'MASTERY_UPDATED',
        'CONCEPT_CURATED',
        'BRANCH_CREATED',
        'PROFILE_UPDATED',
        'LENS_CHANGED'
    ]
    graph_id: Optional[str] = None
    concept_id: Optional[str] = None
    resource_id: Optional[str] = None
    answer_id: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None


class ActivityEvent(BaseModel):
    id: str
    user_id: str
    graph_id: Optional[str] = None
    concept_id: Optional[str] = None
    resource_id: Optional[str] = None
    answer_id: Optional[str] = None
    type: str
    payload: Optional[Dict[str, Any]] = None
    created_at: str


@router.post("/activity", status_code=201)
def create_activity_event(
    payload: ActivityEventCreate,
    request: Request,
    session: Session = Depends(get_neo4j_session)
):
    """
    Create an activity event. Fast, non-blocking. Failures are ignored.
    """
    try:
        user_id = getattr(request.state, "user_id", None)
        if not user_id:
            # Activity events are user-scoped; reject unauthenticated writes
            from fastapi import HTTPException
            raise HTTPException(status_code=401, detail="Authentication required to log activity.")
        
        # Generate event ID
        event_id = str(uuid.uuid4())
        created_at = datetime.utcnow().isoformat() + "Z"
        
        # Store in Neo4j
        query = """
        CREATE (e:ActivityEvent {
            id: $id,
            user_id: $user_id,
            graph_id: $graph_id,
            concept_id: $concept_id,
            resource_id: $resource_id,
            answer_id: $answer_id,
            type: $type,
            payload: $payload,
            created_at: $created_at
        })
        RETURN e.id as id, e.created_at as created_at
        """
        
        params = {
            "id": event_id,
            "user_id": user_id,
            "graph_id": payload.graph_id,
            "concept_id": payload.concept_id,
            "resource_id": payload.resource_id,
            "answer_id": payload.answer_id,
            "type": payload.type,
            "payload": payload.payload or {},
            "created_at": created_at,
        }
        
        result = session.run(query, params)
        record = result.single()
        
        if record:
            return {
                "id": record["id"],
                "created_at": record["created_at"],
            }
        else:
            return {"id": event_id, "created_at": created_at}
            
    except Exception as e:
        # Swallow errors - never block UX
        logger.debug(f"Failed to create activity event: {e}")
        # Return a minimal response so frontend doesn't break
        return {
            "id": str(uuid.uuid4()),
            "created_at": datetime.utcnow().isoformat() + "Z",
        }


@router.get("/activity/recent")
def get_recent_activity_events(
    limit: int = Query(50, ge=1, le=100),
    graph_id: Optional[str] = Query(None),
    concept_id: Optional[str] = Query(None),
    request: Request = None,
    session: Session = Depends(get_neo4j_session)
) -> List[ActivityEvent]:
    """
    Get recent activity events, sorted by created_at desc.
    """
    try:
        # Unauthenticated callers get an empty list — never expose other users' data
        user_id = getattr(request.state, "user_id", None)
        if not user_id:
            return []
        
        # Build query with optional filters
        query = """
        MATCH (e:ActivityEvent)
        WHERE e.user_id = $user_id
        """
        params = {"user_id": user_id, "limit": limit}
        
        if graph_id:
            query += " AND e.graph_id = $graph_id"
            params["graph_id"] = graph_id
            
        if concept_id:
            query += " AND e.concept_id = $concept_id"
            params["concept_id"] = concept_id
        
        query += """
        RETURN e.id as id, e.user_id as user_id, e.graph_id as graph_id,
               e.concept_id as concept_id, e.resource_id as resource_id,
               e.answer_id as answer_id, e.type as type, e.payload as payload,
               e.created_at as created_at
        ORDER BY e.created_at DESC
        LIMIT $limit
        """
        
        result = session.run(query, params)
        events = []
        
        for record in result:
            events.append(ActivityEvent(
                id=record["id"],
                user_id=record["user_id"],
                graph_id=record.get("graph_id"),
                concept_id=record.get("concept_id"),
                resource_id=record.get("resource_id"),
                answer_id=record.get("answer_id"),
                type=record["type"],
                payload=record.get("payload"),
                created_at=record["created_at"],
            ))
        
        return events
        
    except Exception as e:
        logger.error(f"Failed to fetch recent activity events: {e}")
        return []


# Session grouping models
class TopConcept(BaseModel):
    concept_id: str
    concept_name: Optional[str] = None


class PathHighlight(BaseModel):
    path_id: str
    title: Optional[str] = None


class AnswerHighlight(BaseModel):
    answer_id: str


class EvidenceHighlight(BaseModel):
    resource_id: str
    resource_title: Optional[str] = None
    concept_id: Optional[str] = None


class SessionHighlights(BaseModel):
    concepts: List[TopConcept] = []
    paths: List[PathHighlight] = []
    answers: List[AnswerHighlight] = []
    evidence: List[EvidenceHighlight] = []


class SessionCounts(BaseModel):
    concepts_viewed: int = 0
    resources_opened: int = 0
    evidence_fetched: int = 0
    answers_created: int = 0


class SessionSummary(BaseModel):
    session_id: str
    start_at: str
    end_at: str
    graph_id: Optional[str] = None
    summary: str
    last_concept_id: Optional[str] = None
    last_concept_name: Optional[str] = None
    top_concepts: List[TopConcept] = []
    counts: SessionCounts
    highlights: Optional[SessionHighlights] = None


def _group_events_into_sessions(events: List[ActivityEvent], gap_minutes: int = 30) -> List[List[ActivityEvent]]:
    """
    Group events into sessions based on time gaps.
    A session is a contiguous window of activity with no gap > gap_minutes.
    """
    if not events:
        return []
    
    # Sort events by created_at (oldest first for grouping)
    sorted_events = sorted(events, key=lambda e: e.created_at)
    
    sessions: List[List[ActivityEvent]] = []
    current_session: List[ActivityEvent] = [sorted_events[0]]
    
    gap_seconds = gap_minutes * 60
    
    for i in range(1, len(sorted_events)):
        prev_event = sorted_events[i - 1]
        curr_event = sorted_events[i]
        
        # Parse timestamps
        try:
            prev_time = datetime.fromisoformat(prev_event.created_at.replace('Z', '+00:00'))
            curr_time = datetime.fromisoformat(curr_event.created_at.replace('Z', '+00:00'))
            gap = (curr_time - prev_time).total_seconds()
            
            if gap > gap_seconds:
                # Start a new session
                sessions.append(current_session)
                current_session = [curr_event]
            else:
                # Continue current session
                current_session.append(curr_event)
        except Exception as e:
            logger.debug(f"Failed to parse event timestamp: {e}")
            # On error, continue current session
            current_session.append(curr_event)
    
    # Add the last session
    if current_session:
        sessions.append(current_session)
    
    return sessions


def _compute_session_summary(session_events: List[ActivityEvent]) -> SessionSummary:
    """
    Compute session summary from a list of events.
    """
    if not session_events:
        raise ValueError("Session must have at least one event")
    
    # Sort by created_at to get first and last
    sorted_events = sorted(session_events, key=lambda e: e.created_at)
    first_event = sorted_events[0]
    last_event = sorted_events[-1]
    
    # Generate session_id from first and last event IDs
    session_id_str = f"{first_event.id}_{last_event.id}"
    session_id = hashlib.md5(session_id_str.encode()).hexdigest()[:16]
    
    start_at = first_event.created_at
    end_at = last_event.created_at
    
    # Count events by type
    counts = SessionCounts()
    concept_counts: Dict[str, int] = {}  # concept_id -> count
    concept_names: Dict[str, str] = {}  # concept_id -> name
    graph_ids: Dict[str, int] = {}  # graph_id -> count
    last_concept_id: Optional[str] = None
    last_concept_name: Optional[str] = None
    
    # Process events in chronological order to find last concept
    for event in sorted_events:
        if event.type == 'CONCEPT_VIEWED':
            counts.concepts_viewed += 1
            if event.concept_id:
                concept_counts[event.concept_id] = concept_counts.get(event.concept_id, 0) + 1
                if event.payload and 'concept_name' in event.payload:
                    concept_names[event.concept_id] = event.payload['concept_name']
                last_concept_id = event.concept_id
                last_concept_name = concept_names.get(event.concept_id)
        elif event.type == 'RESOURCE_OPENED':
            counts.resources_opened += 1
            if event.concept_id:
                concept_counts[event.concept_id] = concept_counts.get(event.concept_id, 0) + 1
                if event.payload and 'concept_name' in event.payload:
                    concept_names[event.concept_id] = event.payload['concept_name']
                last_concept_id = event.concept_id
                last_concept_name = concept_names.get(event.concept_id)
        elif event.type == 'EVIDENCE_FETCHED':
            counts.evidence_fetched += 1
            if event.concept_id:
                concept_counts[event.concept_id] = concept_counts.get(event.concept_id, 0) + 1
                if event.payload and 'concept_name' in event.payload:
                    concept_names[event.concept_id] = event.payload['concept_name']
        elif event.type == 'ANSWER_CREATED':
            counts.answers_created += 1
        elif event.type == 'VOICE_SESSION':
            # Consider voice sessions as a special count or just grouping
            pass
        
        # Track graph_id frequency
        if event.graph_id:
            graph_ids[event.graph_id] = graph_ids.get(event.graph_id, 0) + 1
    
    # Get most frequent graph_id (or most recent if tied)
    graph_id = None
    if graph_ids:
        # Get most frequent, or if tied, prefer the one from most recent event
        max_count = max(graph_ids.values())
        candidates = [gid for gid, count in graph_ids.items() if count == max_count]
        # Prefer graph_id from last event if it's a candidate
        if last_event.graph_id and last_event.graph_id in candidates:
            graph_id = last_event.graph_id
        else:
            graph_id = candidates[0] if candidates else None
    
    # Get top 3 concepts by frequency
    top_concept_items = sorted(concept_counts.items(), key=lambda x: x[1], reverse=True)[:3]
    top_concepts = [
        TopConcept(
            concept_id=concept_id,
            concept_name=concept_names.get(concept_id)
        )
        for concept_id, _ in top_concept_items
    ]
    
    # Extract highlights: paths, answers, and evidence
    paths: List[PathHighlight] = []
    answers: List[AnswerHighlight] = []
    evidence: List[EvidenceHighlight] = []
    last_path_id: Optional[str] = None
    last_path_title: Optional[str] = None
    last_answer_id: Optional[str] = None
    
    # Process events to find paths, answers, and evidence (most recent first)
    for event in reversed(sorted_events):
        if event.type == 'PATH_STARTED' and event.payload:
            path_id = event.payload.get('path_id')
            path_title = event.payload.get('path_title')
            if path_id and not any(p.path_id == path_id for p in paths):
                paths.append(PathHighlight(path_id=path_id, title=path_title))
                if not last_path_id:
                    last_path_id = path_id
                    last_path_title = path_title
        elif event.type == 'PATH_STEP_VIEWED' and event.payload:
            path_id = event.payload.get('path_id')
            path_title = event.payload.get('path_title')
            if path_id and not any(p.path_id == path_id for p in paths):
                paths.append(PathHighlight(path_id=path_id, title=path_title))
                if not last_path_id:
                    last_path_id = path_id
                    last_path_title = path_title
        elif event.type == 'ANSWER_CREATED' and event.answer_id:
            if not any(a.answer_id == event.answer_id for a in answers):
                answers.append(AnswerHighlight(answer_id=event.answer_id))
                if not last_answer_id:
                    last_answer_id = event.answer_id
        elif event.type == 'RESOURCE_OPENED' and event.resource_id:
            # Add evidence highlight if not already present
            if not any(e.resource_id == event.resource_id for e in evidence):
                resource_title = None
                if event.payload and 'resource_title' in event.payload:
                    resource_title = event.payload.get('resource_title')
                evidence.append(EvidenceHighlight(
                    resource_id=event.resource_id,
                    resource_title=resource_title,
                    concept_id=event.concept_id
                ))
    
    # Build highlights (limit to most recent/relevant)
    highlights = SessionHighlights(
        concepts=top_concepts[:3],  # Top 3 concepts
        paths=paths[:2],  # Up to 2 paths
        answers=answers[:2],  # Up to 2 answers
        evidence=evidence[:3],  # Up to 3 evidence items
    )
    
    # Generate summary string (heuristic-based, prefer path title if exists)
    summary = "Exploration session"
    if last_path_title:
        summary = f"Path: {last_path_title}"
    elif len(top_concepts) >= 2:
        # Build concept chain from last 2-3 concepts
        concept_chain = " → ".join([c.concept_name or c.concept_id for c in top_concepts[:3] if c.concept_name])
        if concept_chain:
            summary = f"Explored: {concept_chain}"
    elif last_concept_name:
        summary = f"Viewed: {last_concept_name}"
    elif counts.answers_created > 0:
        summary = f"Asked {counts.answers_created} question{'s' if counts.answers_created != 1 else ''}"
    
    # Final check for special session types
    for event in reversed(sorted_events):
        special = _get_special_summary(event.type, event.payload or {})
        if special:
            summary = special
            break
    
    return SessionSummary(
        session_id=session_id,
        start_at=start_at,
        end_at=end_at,
        graph_id=graph_id,
        summary=summary,
        last_concept_id=last_concept_id,
        last_concept_name=last_concept_name,
        top_concepts=top_concepts,
        counts=counts,
        highlights=highlights,
    )

def _get_special_summary(event_type: str, payload: Dict[str, Any]) -> Optional[str]:
    """Return a specialized summary for specific event types."""
    if event_type == 'VOICE_SESSION':
        if payload.get('title'): return f"Voice: {payload.get('title')}"
        if payload.get('transcript_summary'): return f"Voice: {payload.get('transcript_summary')}"
        return "Voice Session"
    if event_type == 'INGESTION_STARTED':
        return f"Starting Ingestion: {payload.get('title', 'Unknown Source')}"
    if event_type == 'INGESTION_COMPLETED':
        return f"Ingested: {payload.get('title', 'Unknown Source')}"
    if event_type == 'QUIZ_COMPLETED':
        return f"Finished Quiz: {payload.get('topics', 'General')}"
    if event_type == 'MASTERY_UPDATED':
        return f"Mastery {payload.get('direction', 'up')}: {payload.get('concept_name')}"
    if event_type == 'CONCEPT_CURATED':
        return f"Curated: {payload.get('concept_name')}"
    if event_type == 'RELATIONSHIP_REVIEWED':
        return f"Reviewed Relationship: {payload.get('predicate')}"
    if event_type == 'CONCEPTS_MERGED':
        return f"Merged: {payload.get('name')}"
    if event_type == 'CONCEPT_PINNED':
        return f"Pinned: {payload.get('concept_name')}"
    if event_type == 'CANVAS_CAPTURED':
        return f"Captured Canvas: {payload.get('title', 'Untitled')}"
    if event_type == 'PROFILE_UPDATED':
        return "Updated Tutor Persona"
    if event_type == 'LENS_CHANGED':
        return f"Switched Lens: {payload.get('lens_name')}"
    if event_type == 'BRANCH_CREATED':
        return f"Created Branch: {payload.get('branch_name', 'Untitled')}"
    return None


@sessions_router.get("/recent")
def get_recent_sessions(
    limit: int = Query(10, ge=1, le=50),
    request: Request = None,
    session: Session = Depends(get_neo4j_session)
) -> List[SessionSummary]:
    """
    Get recent sessions grouped from activity events.
    Sessions are contiguous windows of activity with no gap > 30 minutes.
    """
    try:
        # Get user_id (demo-safe)
        user_id = getattr(request.state, "user_id", None) or "demo"
        
        # Fetch recent events (up to 200 for grouping)
        query = """
        MATCH (e:ActivityEvent)
        WHERE e.user_id = $user_id
        RETURN e.id as id, e.user_id as user_id, e.graph_id as graph_id,
               e.concept_id as concept_id, e.resource_id as resource_id,
               e.answer_id as answer_id, e.type as type, e.payload as payload,
               e.created_at as created_at
        ORDER BY e.created_at DESC
        LIMIT $limit
        """
        
        params = {"user_id": user_id, "limit": 200}
        result = session.run(query, params)
        
        events: List[ActivityEvent] = []
        for record in result:
            events.append(ActivityEvent(
                id=record["id"],
                user_id=record["user_id"],
                graph_id=record.get("graph_id"),
                concept_id=record.get("concept_id"),
                resource_id=record.get("resource_id"),
                answer_id=record.get("answer_id"),
                type=record["type"],
                payload=record.get("payload"),
                created_at=record["created_at"],
            ))
        
        # Group events into sessions
        session_groups = _group_events_into_sessions(events, gap_minutes=30)
        
        # Compute summaries for each session
        summaries: List[SessionSummary] = []
        for session_group in session_groups:
            try:
                summary = _compute_session_summary(session_group)
                summaries.append(summary)
            except Exception as e:
                logger.debug(f"Failed to compute session summary: {e}")
                continue
        
        # Return most recent sessions first (reverse chronological by end_at)
        summaries.sort(key=lambda s: s.end_at, reverse=True)
        
        return summaries[:limit]
        
    except Exception as e:
        logger.error(f"Failed to fetch recent sessions: {e}")
        return []


@sessions_router.post("/start")
def start_session(
    request: Request,
    db_session: Session = Depends(get_neo4j_session)
) -> Dict[str, Any]:
    """
    Start a new research/browsing session.
    Returns session_id for tracking artifacts and activity.
    """
    try:
        user_id = getattr(request.state, "user_id", None)
        if not user_id:
            from fastapi import HTTPException
            raise HTTPException(status_code=401, detail="Authentication required to start a session.")
        
        # Generate session ID
        session_id = str(uuid.uuid4())
        started_at = datetime.utcnow().isoformat() + "Z"
        
        # Store session in Neo4j
        query = """
        CREATE (s:ResearchSession {
            session_id: $session_id,
            user_id: $user_id,
            started_at: $started_at,
            status: 'ACTIVE'
        })
        RETURN s.session_id AS session_id, s.started_at AS started_at
        """
        
        result = db_session.run(
            query,
            session_id=session_id,
            user_id=user_id,
            started_at=started_at
        )
        record = result.single()
        
        if record:
            return {
                "session_id": record["session_id"],
                "started_at": record["started_at"]
            }
        else:
            return {
                "session_id": session_id,
                "started_at": started_at
            }
    except Exception as e:
        logger.error(f"Failed to start session: {e}")
        # Return a session_id anyway so extension doesn't break
        return {
            "session_id": str(uuid.uuid4()),
            "started_at": datetime.utcnow().isoformat() + "Z"
        }


@sessions_router.post("/stop")
def stop_session(
    session_id: str = Query(..., description="Session ID to stop"),
    request: Request = None,
    db_session: Session = Depends(get_neo4j_session)
) -> Dict[str, Any]:
    """
    Stop an active research/browsing session.
    """
    try:
        user_id = getattr(request.state, "user_id", None)
        if not user_id:
            from fastapi import HTTPException
            raise HTTPException(status_code=401, detail="Authentication required to stop a session.")
        
        stopped_at = datetime.utcnow().isoformat() + "Z"
        
        query = """
        MATCH (s:ResearchSession {session_id: $session_id, user_id: $user_id})
        WHERE s.status = 'ACTIVE'
        SET s.status = 'ENDED',
            s.stopped_at = $stopped_at
        RETURN s.session_id AS session_id, s.stopped_at AS stopped_at
        """
        
        result = db_session.run(
            query,
            session_id=session_id,
            user_id=user_id,
            stopped_at=stopped_at
        )
        record = result.single()
        
        if record:
            return {
                "session_id": record["session_id"],
                "stopped_at": record["stopped_at"]
            }
        else:
            return {
                "session_id": session_id,
                "stopped_at": stopped_at,
                "note": "Session not found or already ended"
            }
    except Exception as e:
        logger.error(f"Failed to stop session: {e}")
        return {
            "session_id": session_id,
            "stopped_at": datetime.utcnow().isoformat() + "Z",
            "error": str(e)
        }


