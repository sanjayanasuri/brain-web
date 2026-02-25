# Background AI task and calendar event models.
from typing import Optional, List, Dict, Any

from pydantic import BaseModel, Field
from enum import Enum


class TaskStatus(str, Enum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    READY = "READY"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class TaskType(str, Enum):
    GENERATE_ANSWERS = "GENERATE_ANSWERS"
    SUMMARIZE = "SUMMARIZE"
    EXPLAIN = "EXPLAIN"
    GAP_ANALYSIS = "GAP_ANALYSIS"
    RETRIEVE_CONTEXT = "RETRIEVE_CONTEXT"
    EXTRACT_CONCEPTS = "EXTRACT_CONCEPTS"
    REBUILD_COMMUNITIES = "REBUILD_COMMUNITIES"


class Task(BaseModel):
    """Background AI task requested via voice or UI."""
    task_id: str
    task_type: TaskType
    status: TaskStatus
    created_at: int
    started_at: Optional[int] = None
    completed_at: Optional[int] = None
    graph_id: str
    branch_id: str
    document_id: Optional[str] = None
    block_id: Optional[str] = None
    concept_id: Optional[str] = None
    params: Dict[str, Any] = Field(default_factory=dict)
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    created_by_signal_id: Optional[str] = None
    session_id: Optional[str] = None


class TaskCreate(BaseModel):
    task_type: TaskType
    document_id: Optional[str] = None
    block_id: Optional[str] = None
    concept_id: Optional[str] = None
    params: Dict[str, Any] = Field(default_factory=dict)
    created_by_signal_id: Optional[str] = None
    session_id: Optional[str] = None


class TaskListResponse(BaseModel):
    tasks: List[Task]
    total: int


class CalendarEvent(BaseModel):
    event_id: str
    title: str
    description: Optional[str] = None
    location: Optional[str] = None
    start_date: str
    end_date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    all_day: bool = True
    color: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class CalendarEventCreate(BaseModel):
    title: str
    description: Optional[str] = None
    location: Optional[str] = None
    start_date: str
    end_date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    all_day: bool = True
    color: Optional[str] = None


class CalendarEventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    location: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    all_day: Optional[bool] = None
    color: Optional[str] = None


class CalendarEventListResponse(BaseModel):
    events: List[CalendarEvent]
    total: int
