"""
Service layer for Signal abstraction (Learning State Engine).

Signals represent observations of user learning behavior.
They update graph state but never directly trigger teaching.
"""
from typing import List, Optional, Dict, Any
from uuid import uuid4
from datetime import datetime
import json

from neo4j import Session

from models import (
    Signal, SignalType, SignalCreate, SignalListResponse,
    Task, TaskType, TaskStatus, TaskCreate, TaskListResponse
)
from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context


def _map_signal(record: dict) -> Signal:
    """Map Neo4j record to Signal model."""
    return Signal(
        signal_id=record["signal_id"],
        signal_type=SignalType(record["signal_type"]),
        timestamp=record["timestamp"],
        graph_id=record["graph_id"],
        branch_id=record["branch_id"],
        document_id=record.get("document_id"),
        block_id=record.get("block_id"),
        concept_id=record.get("concept_id"),
        payload=json.loads(record.get("payload", "{}")) if isinstance(record.get("payload"), str) else (record.get("payload") or {}),
        session_id=record.get("session_id"),
        user_id=record.get("user_id"),
        created_at=record.get("created_at"),
    )


def create_signal(session: Session, payload: SignalCreate, user_id: Optional[str] = None) -> Signal:
    """
    Create a new signal in the graph.
    
    Signals are stored as nodes with relationships to Documents, Blocks, and Concepts.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    signal_id = f"SIG_{uuid4().hex[:10]}"
    timestamp = int(datetime.utcnow().timestamp() * 1000)  # milliseconds
    payload_json = json.dumps(payload.payload) if payload.payload else "{}"
    
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MERGE (s:Signal {signal_id: $signal_id})
    ON CREATE SET
        s.signal_type = $signal_type,
        s.timestamp = $timestamp,
        s.graph_id = $graph_id,
        s.branch_id = $branch_id,
        s.document_id = $document_id,
        s.block_id = $block_id,
        s.concept_id = $concept_id,
        s.payload = $payload,
        s.session_id = $session_id,
        s.user_id = $user_id,
        s.on_branches = [$branch_id],
        s.created_at = datetime()
    ON MATCH SET
        s.payload = $payload,
        s.updated_at = datetime(),
        s.on_branches = CASE
            WHEN s.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN s.on_branches THEN s.on_branches
            ELSE s.on_branches + $branch_id
        END
    MERGE (s)-[:BELONGS_TO]->(g)
    
    // Link to document if provided
    OPTIONAL MATCH (d WHERE (d:Lecture OR d:Artifact OR d:SourceDocument) AND 
                            (d.lecture_id = $document_id OR d.artifact_id = $document_id OR d.doc_id = $document_id))
    FOREACH (x IN CASE WHEN d IS NOT NULL THEN [1] ELSE [] END |
        MERGE (s)-[:OBSERVES_DOCUMENT]->(d)
    )
    
    // Link to block if provided
    OPTIONAL MATCH (b:LectureBlock {block_id: $block_id, graph_id: $graph_id})
    FOREACH (x IN CASE WHEN b IS NOT NULL THEN [1] ELSE [] END |
        MERGE (s)-[:OBSERVES_BLOCK]->(b)
    )
    
    // Link to concept if provided
    OPTIONAL MATCH (c:Concept {node_id: $concept_id, graph_id: $graph_id})
    FOREACH (x IN CASE WHEN c IS NOT NULL THEN [1] ELSE [] END |
        MERGE (s)-[:OBSERVES_CONCEPT]->(c)
    )
    
    RETURN s.signal_id AS signal_id,
           s.signal_type AS signal_type,
           s.timestamp AS timestamp,
           s.graph_id AS graph_id,
           s.branch_id AS branch_id,
           s.document_id AS document_id,
           s.block_id AS block_id,
           s.concept_id AS concept_id,
           s.payload AS payload,
           s.session_id AS session_id,
           s.user_id AS user_id,
           s.created_at AS created_at
    """
    
    result = session.run(
        query,
        signal_id=signal_id,
        signal_type=payload.signal_type.value,
        timestamp=timestamp,
        graph_id=graph_id,
        branch_id=branch_id,
        document_id=payload.document_id,
        block_id=payload.block_id,
        concept_id=payload.concept_id,
        payload=payload_json,
        session_id=payload.session_id,
        user_id=user_id,
    )
    
    record = result.single()
    if not record:
        raise ValueError(f"Failed to create signal {signal_id}")
    
    return _map_signal(record.data())


def list_signals(
    session: Session,
    signal_type: Optional[SignalType] = None,
    document_id: Optional[str] = None,
    block_id: Optional[str] = None,
    concept_id: Optional[str] = None,
    limit: int = 100,
    offset: int = 0
) -> SignalListResponse:
    """
    List signals with optional filters.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    conditions = ["s.graph_id = $graph_id", "$branch_id IN COALESCE(s.on_branches, [])"]
    params = {"graph_id": graph_id, "branch_id": branch_id, "limit": limit, "offset": offset}
    
    if signal_type:
        conditions.append("s.signal_type = $signal_type")
        params["signal_type"] = signal_type.value
    
    if document_id:
        conditions.append("s.document_id = $document_id")
        params["document_id"] = document_id
    
    if block_id:
        conditions.append("s.block_id = $block_id")
        params["block_id"] = block_id
    
    if concept_id:
        conditions.append("s.concept_id = $concept_id")
        params["concept_id"] = concept_id
    
    where_clause = " AND ".join(conditions)
    
    query = f"""
    MATCH (s:Signal)
    WHERE {where_clause}
    RETURN s.signal_id AS signal_id,
           s.signal_type AS signal_type,
           s.timestamp AS timestamp,
           s.graph_id AS graph_id,
           s.branch_id AS branch_id,
           s.document_id AS document_id,
           s.block_id AS block_id,
           s.concept_id AS concept_id,
           s.payload AS payload,
           s.session_id AS session_id,
           s.user_id AS user_id,
           s.created_at AS created_at
    ORDER BY s.timestamp DESC
    SKIP $offset
    LIMIT $limit
    """
    
    result = session.run(query, **params)
    signals = [_map_signal(record.data()) for record in result]
    
    # Get total count
    count_query = f"""
    MATCH (s:Signal)
    WHERE {where_clause}
    RETURN count(s) AS total
    """
    count_result = session.run(count_query, **{k: v for k, v in params.items() if k not in ["limit", "offset"]})
    total = count_result.single()["total"] if count_result.single() else 0
    
    return SignalListResponse(signals=signals, total=total)


def get_signals_for_concept(session: Session, concept_id: str, limit: int = 50) -> List[Signal]:
    """Get all signals related to a concept."""
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    query = """
    MATCH (c:Concept {node_id: $concept_id, graph_id: $graph_id})-[:BELONGS_TO]->(g:GraphSpace {graph_id: $graph_id})
    MATCH (s:Signal {graph_id: $graph_id})-[:OBSERVES_CONCEPT]->(c)
    WHERE $branch_id IN COALESCE(s.on_branches, [])
    RETURN s.signal_id AS signal_id,
           s.signal_type AS signal_type,
           s.timestamp AS timestamp,
           s.graph_id AS graph_id,
           s.branch_id AS branch_id,
           s.document_id AS document_id,
           s.block_id AS block_id,
           s.concept_id AS concept_id,
           s.payload AS payload,
           s.session_id AS session_id,
           s.user_id AS user_id,
           s.created_at AS created_at
    ORDER BY s.timestamp DESC
    LIMIT $limit
    """
    
    result = session.run(query, concept_id=concept_id, graph_id=graph_id, branch_id=branch_id, limit=limit)
    return [_map_signal(record.data()) for record in result]


def _map_task(record: dict) -> Task:
    """Map Neo4j record to Task model."""
    return Task(
        task_id=record["task_id"],
        task_type=TaskType(record["task_type"]),
        status=TaskStatus(record["status"]),
        created_at=record["created_at"],
        started_at=record.get("started_at"),
        completed_at=record.get("completed_at"),
        graph_id=record["graph_id"],
        branch_id=record["branch_id"],
        document_id=record.get("document_id"),
        block_id=record.get("block_id"),
        concept_id=record.get("concept_id"),
        params=json.loads(record.get("params", "{}")) if isinstance(record.get("params"), str) else (record.get("params") or {}),
        result=json.loads(record.get("result", "{}")) if isinstance(record.get("result"), str) else (record.get("result")),
        error=record.get("error"),
        created_by_signal_id=record.get("created_by_signal_id"),
        session_id=record.get("session_id"),
    )


def create_task(session: Session, payload: TaskCreate) -> Task:
    """
    Create a new background task.
    
    Tasks are queued for background processing and can be polled for status.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    task_id = f"TASK_{uuid4().hex[:10]}"
    timestamp = int(datetime.utcnow().timestamp() * 1000)  # milliseconds
    params_json = json.dumps(payload.params) if payload.params else "{}"
    
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MERGE (t:Task {task_id: $task_id})
    ON CREATE SET
        t.task_type = $task_type,
        t.status = $status,
        t.created_at = $created_at,
        t.graph_id = $graph_id,
        t.branch_id = $branch_id,
        t.document_id = $document_id,
        t.block_id = $block_id,
        t.concept_id = $concept_id,
        t.params = $params,
        t.created_by_signal_id = $created_by_signal_id,
        t.session_id = $session_id,
        t.on_branches = [$branch_id],
        t.created_at = datetime()
    MERGE (t)-[:BELONGS_TO]->(g)
    
    // Link to signal if provided
    OPTIONAL MATCH (s:Signal {signal_id: $created_by_signal_id, graph_id: $graph_id})
    FOREACH (x IN CASE WHEN s IS NOT NULL THEN [1] ELSE [] END |
        MERGE (s)-[:TRIGGERED_TASK]->(t)
    )
    
    RETURN t.task_id AS task_id,
           t.task_type AS task_type,
           t.status AS status,
           t.created_at AS created_at,
           t.started_at AS started_at,
           t.completed_at AS completed_at,
           t.graph_id AS graph_id,
           t.branch_id AS branch_id,
           t.document_id AS document_id,
           t.block_id AS block_id,
           t.concept_id AS concept_id,
           t.params AS params,
           t.result AS result,
           t.error AS error,
           t.created_by_signal_id AS created_by_signal_id,
           t.session_id AS session_id
    """
    
    result = session.run(
        query,
        task_id=task_id,
        task_type=payload.task_type.value,
        status=TaskStatus.QUEUED.value,
        created_at=timestamp,
        graph_id=graph_id,
        branch_id=branch_id,
        document_id=payload.document_id,
        block_id=payload.block_id,
        concept_id=payload.concept_id,
        params=params_json,
        created_by_signal_id=payload.created_by_signal_id,
        session_id=payload.session_id,
    )
    
    record = result.single()
    if not record:
        raise ValueError(f"Failed to create task {task_id}")
    
    return _map_task(record.data())


def get_task(session: Session, task_id: str) -> Optional[Task]:
    """Get a task by ID."""
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    query = """
    MATCH (t:Task {task_id: $task_id, graph_id: $graph_id})
    WHERE $branch_id IN COALESCE(t.on_branches, [])
    RETURN t.task_id AS task_id,
           t.task_type AS task_type,
           t.status AS status,
           t.created_at AS created_at,
           t.started_at AS started_at,
           t.completed_at AS completed_at,
           t.graph_id AS graph_id,
           t.branch_id AS branch_id,
           t.document_id AS document_id,
           t.block_id AS block_id,
           t.concept_id AS concept_id,
           t.params AS params,
           t.result AS result,
           t.error AS error,
           t.created_by_signal_id AS created_by_signal_id,
           t.session_id AS session_id
    """
    
    result = session.run(query, task_id=task_id, graph_id=graph_id, branch_id=branch_id)
    record = result.single()
    if not record:
        return None
    
    return _map_task(record.data())


def list_tasks(
    session: Session,
    status: Optional[TaskStatus] = None,
    task_type: Optional[TaskType] = None,
    limit: int = 50,
    offset: int = 0
) -> TaskListResponse:
    """List tasks with optional filters."""
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    conditions = ["t.graph_id = $graph_id", "$branch_id IN COALESCE(t.on_branches, [])"]
    params = {"graph_id": graph_id, "branch_id": branch_id, "limit": limit, "offset": offset}
    
    if status:
        conditions.append("t.status = $status")
        params["status"] = status.value
    
    if task_type:
        conditions.append("t.task_type = $task_type")
        params["task_type"] = task_type.value
    
    where_clause = " AND ".join(conditions)
    
    query = f"""
    MATCH (t:Task)
    WHERE {where_clause}
    RETURN t.task_id AS task_id,
           t.task_type AS task_type,
           t.status AS status,
           t.created_at AS created_at,
           t.started_at AS started_at,
           t.completed_at AS completed_at,
           t.graph_id AS graph_id,
           t.branch_id AS branch_id,
           t.document_id AS document_id,
           t.block_id AS block_id,
           t.concept_id AS concept_id,
           t.params AS params,
           t.result AS result,
           t.error AS error,
           t.created_by_signal_id AS created_by_signal_id,
           t.session_id AS session_id
    ORDER BY t.created_at DESC
    SKIP $offset
    LIMIT $limit
    """
    
    result = session.run(query, **params)
    tasks = [_map_task(record.data()) for record in result]
    
    # Get total count
    count_query = f"""
    MATCH (t:Task)
    WHERE {where_clause}
    RETURN count(t) AS total
    """
    count_result = session.run(count_query, **{k: v for k, v in params.items() if k not in ["limit", "offset"]})
    total = count_result.single()["total"] if count_result.single() else 0
    
    return TaskListResponse(tasks=tasks, total=total)
