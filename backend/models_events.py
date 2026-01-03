# backend/models_events.py
from typing import Any, Dict, List, Optional, Literal
from pydantic import BaseModel, Field


class ReplayEvent(BaseModel):
    event_id: str
    device_id: str
    seq: int
    created_at: str
    type: Literal["artifact.ingested"] = "artifact.ingested"
    graph_id: str = "default"
    branch_id: Optional[str] = None
    trail_id: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)


class EventsReplayRequest(BaseModel):
    events: List[ReplayEvent]


class ReplayResult(BaseModel):
    event_id: str
    status: Literal["applied", "duplicate", "error"]
    detail: Optional[str] = None


class EventsReplayResponse(BaseModel):
    results: List[ReplayResult]
