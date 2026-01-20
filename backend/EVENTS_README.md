# Event-Driven Integration System

This document describes the event-driven integration system for Brain Web, which provides a typed event schema, durable event log, and session context projection.

## Overview

The event system enables:
- **Event Sourcing**: All user actions are recorded as events
- **Idempotency**: Events can be safely replayed without duplicates
- **Session Context**: Derived context from events (active concepts, objects, uncertainty)
- **Replay**: Full session replay for debugging and analysis

## Architecture

### Components

1. **Event Schema** (`events/schema.py`): Typed event envelopes with EventType enum
2. **Event Store** (`events/store/`): Abstract interface with DynamoDB and SQLite implementations
3. **Event Emitter** (`events/emitter.py`): Helper for emitting events with idempotency
4. **Session Context Projector** (`projectors/session_context.py`): Derives session context from events
5. **API Endpoints** (`api_sessions_events.py`): REST endpoints for events and context

### Event Types

- `UserViewed`: User viewed a concept
- `UserHighlighted`: User highlighted text
- `ChatMessageCreated`: Chat message was created
- `SourceCaptured`: Source/artifact was captured
- `ClaimUpserted`: Claim was created or updated
- `RecommendationGenerated`: Recommendation was generated
- `SessionContextUpdated`: Session context was updated (system event)

## Configuration

### Environment Variables

- `EVENTS_DDB_TABLE`: DynamoDB table name (if using DynamoDB)
- `EVENTS_SQLITE_PATH`: Path to SQLite database file (default: `events.db`)
- `AWS_REGION`: AWS region for DynamoDB (default: `us-east-1`)

### Store Selection

The system automatically selects the store:
1. If `EVENTS_DDB_TABLE` is set → DynamoDB
2. Otherwise → SQLite (dev fallback)

## Usage

### Emitting Events

```python
from events.emitter import emit_event
from events.schema import EventType, ObjectRef

# Emit a chat message event
emit_event(
    event_type=EventType.CHAT_MESSAGE_CREATED,
    session_id="session-123",
    actor_id="user-456",
    object_ref=ObjectRef(type="chat_message", id="msg-789"),
    payload={"message": "Hello", "intent": "question"},
    correlation_id="corr-123",
)
```

### Getting Session Context

```python
from projectors.session_context import SessionContextProjector

projector = SessionContextProjector()
context = projector.project("session-123")

print(context.active_concepts)  # List of ActiveConcept
print(context.active_objects)   # List of ActiveObject
print(context.uncertainty_score)  # 0.0-1.0
```

### API Endpoints

#### List Events
```
GET /api/sessions/{session_id}/events?after_ts=2024-01-01T00:00:00Z&limit=100
```

Returns paginated list of events for a session.

#### Get Session Context
```
GET /api/sessions/{session_id}/context
```

Returns derived session context (active concepts, objects, uncertainty score).
Loads from read model store if available, otherwise projects from events.

#### WebSocket Context Stream
```
WS /api/sessions/{session_id}/context/stream
```

Real-time WebSocket connection that receives context updates whenever the session context changes.

## Running Locally

### Development (SQLite)

1. No configuration needed - SQLite is used by default
2. Database file: `events.db` (in backend directory)
3. Events are stored automatically when actions occur

### Production (DynamoDB)

1. Set `EVENTS_DDB_TABLE` environment variable
2. Ensure AWS credentials are configured
3. Create DynamoDB table with:
   - Partition key: `pk` (String)
   - Sort key: `sk` (String)
   - Optional GSI: `idempotency_key-index` on `idempotency_key`

## Replaying a Session

### Programmatic Replay

```python
from events.store import get_event_store

store = get_event_store()
events = store.replay("session-123")

for event in events:
    print(f"{event.occurred_at}: {event.event_type} - {event.payload}")
```

### API Replay

Use the list events endpoint with no `after_ts` parameter to get all events:

```
GET /api/sessions/{session_id}/events?limit=10000
```

## Integration Points

Events are automatically emitted from:

1. **Chat Messages**: `api_retrieval.py` → `retrieve_endpoint()`
2. **Source Capture**: `services_sync_capture.py` → `capture_selection_into_graph()`
3. **Claim Upserts**: `services_graph.py` → `upsert_claim()`

## Testing

Run tests with:

```bash
pytest backend/tests/test_events.py -v
```

Tests cover:
- Event envelope creation
- Event store append and idempotency
- Event replay
- Session context projection

## Design Notes

- **Idempotency**: Events with the same `idempotency_key` are deduplicated
- **Async Projection**: Context is updated asynchronously via background task queue (non-blocking)
- **Read Model Store**: Context is persisted in Neo4j for fast retrieval without replaying events
- **Minimal Invasiveness**: Events are emitted with try/except to never break existing flows
- **Type Safety**: All events are typed with Pydantic models
- **Real-time Updates**: WebSocket support for live context updates

## Enhancements Implemented

✅ **Async Processing**: Background task queue processes projections asynchronously
✅ **Read Model Persistence**: Session context stored in Neo4j for fast retrieval
✅ **WebSocket Support**: Real-time context updates via WebSocket connections
✅ **User Preferences Projector**: Tracks user interaction patterns and preferences

## Future Enhancements

- Event versioning and migration
- Event filtering and querying
- Analytics dashboard
- ML-powered recommendations based on event patterns
- Cross-session insights

