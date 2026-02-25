"""
Event schema for event-driven integration.

Defines typed event envelopes, event types, and object references.
OpenTelemetry: set trace_id (e.g. request_id or OTEL trace id) and correlation_id
on EventEnvelope so events can be correlated in traces and logs.
"""
from enum import Enum
from typing import Any, Dict, Optional
from pydantic import BaseModel, Field
from datetime import datetime


class EventType(str, Enum):
    """Event type enumeration."""
    USER_VIEWED = "UserViewed"
    USER_HIGHLIGHTED = "UserHighlighted"
    CHAT_MESSAGE_CREATED = "ChatMessageCreated"
    SOURCE_CAPTURED = "SourceCaptured"
    CLAIM_UPSERTED = "ClaimUpserted"
    RECOMMENDATION_GENERATED = "RecommendationGenerated"
    SESSION_CONTEXT_UPDATED = "SessionContextUpdated"


class ObjectRef(BaseModel):
    """Reference to an object in the system."""
    type: str = Field(..., description="Object type (e.g., 'concept', 'claim', 'source', 'chat_message')")
    id: str = Field(..., description="Object identifier")


class EventEnvelope(BaseModel):
    """Event envelope with metadata and payload."""
    event_id: str = Field(..., description="Unique event identifier")
    event_type: EventType = Field(..., description="Type of event")
    session_id: str = Field(..., description="Session identifier")
    actor_id: Optional[str] = Field(None, description="User/actor identifier")
    occurred_at: datetime = Field(..., description="When the event occurred (UTC)")
    version: int = Field(default=1, description="Event schema version")
    idempotency_key: Optional[str] = Field(None, description="Key for idempotency checks")
    correlation_id: Optional[str] = Field(None, description="Correlation ID for tracing related events")
    trace_id: Optional[str] = Field(None, description="Distributed trace ID")
    object_ref: Optional[ObjectRef] = Field(None, description="Reference to the primary object")
    payload: Dict[str, Any] = Field(default_factory=dict, description="Event-specific payload")

    class Config:
        use_enum_values = True
        json_encoders = {
            datetime: lambda v: v.isoformat() + "Z" if v.tzinfo is None else v.isoformat()
        }

