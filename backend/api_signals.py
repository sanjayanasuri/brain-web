"""
API endpoints for Signal abstraction (Learning State Engine).

Signals represent observations of user learning behavior.
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query

from db_neo4j import get_neo4j_session
from models import (
    Signal, SignalType, SignalCreate, SignalListResponse,
    Task, TaskType, TaskStatus, TaskCreate, TaskListResponse
)
from services_signals import (
    create_signal,
    list_signals,
    get_signals_for_concept,
    create_task,
    get_task,
    list_tasks,
)

router = APIRouter(prefix="/signals", tags=["signals"])


@router.post("/", response_model=Signal)
def create_signal_endpoint(
    payload: SignalCreate,
    session=Depends(get_neo4j_session),
):
    """
    Create a new signal.
    
    Signals update graph state but never directly trigger teaching.
    """
    try:
        return create_signal(session, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/", response_model=SignalListResponse)
def list_signals_endpoint(
    signal_type: Optional[SignalType] = Query(None),
    document_id: Optional[str] = Query(None),
    block_id: Optional[str] = Query(None),
    concept_id: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    session=Depends(get_neo4j_session),
):
    """List signals with optional filters."""
    return list_signals(
        session,
        signal_type=signal_type,
        document_id=document_id,
        block_id=block_id,
        concept_id=concept_id,
        limit=limit,
        offset=offset,
    )


@router.get("/concept/{concept_id}", response_model=list[Signal])
def get_signals_for_concept_endpoint(
    concept_id: str,
    limit: int = Query(50, ge=1, le=200),
    session=Depends(get_neo4j_session),
):
    """Get all signals related to a concept."""
    return get_signals_for_concept(session, concept_id, limit=limit)


# ---------- Task Endpoints ----------

@router.post("/tasks", response_model=Task)
def create_task_endpoint(
    payload: TaskCreate,
    session=Depends(get_neo4j_session),
):
    """
    Create a new background task.
    
    Tasks are queued for background processing and can be polled for status.
    """
    try:
        return create_task(session, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/tasks/{task_id}", response_model=Task)
def get_task_endpoint(
    task_id: str,
    session=Depends(get_neo4j_session),
):
    """Get a task by ID."""
    task = get_task(session, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.get("/tasks", response_model=TaskListResponse)
def list_tasks_endpoint(
    status: Optional[TaskStatus] = Query(None),
    task_type: Optional[TaskType] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    session=Depends(get_neo4j_session),
):
    """List tasks with optional filters."""
    return list_tasks(
        session,
        status=status,
        task_type=task_type,
        limit=limit,
        offset=offset,
    )
