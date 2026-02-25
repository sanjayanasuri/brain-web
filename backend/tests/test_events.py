"""Tests for event system."""
import pytest

pytestmark = pytest.mark.unit
import os
import tempfile
from datetime import datetime
from events.schema import EventEnvelope, EventType, ObjectRef
from events.store.sqlite import SQLiteEventStore
from events.emitter import emit_event
from projectors.session_context import SessionContextProjector


@pytest.fixture
def sqlite_store(monkeypatch):
    """Create a temporary SQLite store for testing."""
    fd, path = tempfile.mkstemp(suffix='.db')
    os.close(fd)
    # Override EVENTS_SQLITE_PATH for this test
    monkeypatch.setenv("EVENTS_SQLITE_PATH", path)
    store = SQLiteEventStore(db_path=path)
    yield store
    try:
        os.unlink(path)
    except Exception:
        pass


def test_event_envelope_creation():
    """Test creating an event envelope."""
    envelope = EventEnvelope(
        event_id="test-123",
        event_type=EventType.CHAT_MESSAGE_CREATED,
        session_id="session-123",
        actor_id="user-123",
        occurred_at=datetime.utcnow(),
        object_ref=ObjectRef(type="chat_message", id="msg-123"),
        payload={"message": "Hello"},
    )
    assert envelope.event_id == "test-123"
    assert envelope.event_type == EventType.CHAT_MESSAGE_CREATED
    assert envelope.session_id == "session-123"
    assert envelope.object_ref.type == "chat_message"


def test_event_store_append(sqlite_store):
    """Test appending events to store."""
    event = EventEnvelope(
        event_id="test-1",
        event_type=EventType.CHAT_MESSAGE_CREATED,
        session_id="session-1",
        occurred_at=datetime.utcnow(),
        payload={"message": "Test"},
    )
    sqlite_store.append(event)
    
    events = sqlite_store.list_events("session-1")
    assert len(events) == 1
    assert events[0].event_id == "test-1"


def test_event_store_idempotency(sqlite_store):
    """Test idempotency behavior."""
    event = EventEnvelope(
        event_id="test-2",
        event_type=EventType.CHAT_MESSAGE_CREATED,
        session_id="session-2",
        occurred_at=datetime.utcnow(),
        idempotency_key="key-123",
        payload={"message": "Test"},
    )
    
    # Append twice with same idempotency key
    sqlite_store.append(event)
    sqlite_store.append(event)
    
    # Should only have one event
    events = sqlite_store.list_events("session-2")
    assert len(events) == 1


def test_event_store_replay(sqlite_store):
    """Test replaying events."""
    # Add multiple events
    for i in range(5):
        event = EventEnvelope(
            event_id=f"test-{i}",
            event_type=EventType.CHAT_MESSAGE_CREATED,
            session_id="session-3",
            occurred_at=datetime.utcnow(),
            payload={"index": i},
        )
        sqlite_store.append(event)
    
    events = sqlite_store.replay("session-3")
    assert len(events) == 5
    # Should be in chronological order
    assert events[0].event_id == "test-0"
    assert events[4].event_id == "test-4"


def test_session_context_projector(sqlite_store, monkeypatch):
    """Test session context projection."""
    # Mock the store in projector
    projector = SessionContextProjector()
    projector.store = sqlite_store
    
    session_id = "session-4"
    
    # Add some events directly to the store (bypassing emit_event to avoid factory)
    from events.schema import EventEnvelope
    
    event1 = EventEnvelope(
        event_id="test-chat-1",
        event_type=EventType.CHAT_MESSAGE_CREATED,
        session_id=session_id,
        occurred_at=datetime.utcnow(),
        payload={
            "message": "What is Python?",
            "mentioned_concepts": [
                {"concept_id": "concept-1", "name": "Python"},
                {"concept_id": "concept-2", "name": "Programming"},
            ],
        },
    )
    sqlite_store.append(event1)
    
    event2 = EventEnvelope(
        event_id="test-source-1",
        event_type=EventType.SOURCE_CAPTURED,
        session_id=session_id,
        occurred_at=datetime.utcnow(),
        object_ref=ObjectRef(type="artifact", id="artifact-1"),
    )
    sqlite_store.append(event2)
    
    # Project context
    context = projector.project(session_id)
    
    assert context.session_id == session_id
    assert len(context.active_concepts) > 0
    assert len(context.active_objects) > 0
    assert 0.0 <= context.uncertainty_score <= 1.0

