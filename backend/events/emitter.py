"""Event emitter for publishing events."""
import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from .schema import EventEnvelope, EventType, ObjectRef
from .store import get_event_store
from .background import enqueue_projection


def emit_event(
    event_type: EventType,
    session_id: str,
    actor_id: Optional[str] = None,
    object_ref: Optional[ObjectRef] = None,
    payload: Optional[Dict[str, Any]] = None,
    correlation_id: Optional[str] = None,
    idempotency_key: Optional[str] = None,
    trace_id: Optional[str] = None,
) -> EventEnvelope:
    """
    Emit an event to the event store.
    
    Args:
        event_type: Type of event
        session_id: Session identifier
        actor_id: Optional user/actor identifier
        object_ref: Optional reference to the primary object
        payload: Optional event-specific payload
        correlation_id: Optional correlation ID for tracing related events
        idempotency_key: Optional key for idempotency (auto-generated if not provided)
        trace_id: Optional distributed trace ID
        
    Returns:
        EventEnvelope that was emitted
    """
    event_id = str(uuid.uuid4())
    occurred_at = datetime.utcnow()
    
    # Generate idempotency key if not provided
    if not idempotency_key:
        # Create a deterministic key from event type, session, and object ref
        key_parts = [event_type.value, session_id]
        if object_ref:
            key_parts.extend([object_ref.type, object_ref.id])
        if correlation_id:
            key_parts.append(correlation_id)
        # Hash to create a stable key
        import hashlib
        key_str = "|".join(key_parts)
        idempotency_key = hashlib.sha256(key_str.encode()).hexdigest()[:32]
    
    envelope = EventEnvelope(
        event_id=event_id,
        event_type=event_type,
        session_id=session_id,
        actor_id=actor_id,
        occurred_at=occurred_at,
        version=1,
        idempotency_key=idempotency_key,
        correlation_id=correlation_id,
        trace_id=trace_id,
        object_ref=object_ref,
        payload=payload or {},
    )
    
    store = get_event_store()
    store.append(envelope)
    
    # Enqueue projection task in background (non-blocking)
    try:
        enqueue_projection(session_id, projector_name="session_context")
    except Exception:
        # Don't fail event emission if background task fails
        pass
    
    return envelope

