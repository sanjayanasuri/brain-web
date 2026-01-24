"""
Pytest configuration and fixtures for testing the Brain Web API.

This module provides:
- Test client fixture for FastAPI app
- Mock fixtures for external dependencies (Neo4j, OpenAI, Notion)
- Sample data fixtures for testing
- Environment variable overrides to prevent real API calls
"""
import pytest
import os
import uuid
from datetime import datetime
from unittest.mock import Mock, MagicMock, patch
from fastapi.testclient import TestClient
from typing import Generator, List, Dict, Any, Optional, Callable

# Import mock classes from mock_helpers
from tests.mock_helpers import MockNeo4jRecord, MockNeo4jResult

# Override environment variables to prevent real API calls
os.environ.setdefault("OPENAI_API_KEY", "test-key-sk-1234567890")
os.environ.setdefault("NEO4J_URI", "bolt://localhost:7687")
os.environ.setdefault("NEO4J_USER", "neo4j")
os.environ.setdefault("NEO4J_PASSWORD", "test-password")
os.environ.setdefault("NOTION_API_KEY", "test-notion-key")
os.environ.setdefault("ENABLE_NOTION_AUTO_SYNC", "false")

# Import app after env vars are set
# Note: Make sure you've activated the virtual environment before running tests:
#   source .venv/bin/activate  (or .venv\Scripts\activate on Windows)
try:
    from main import app
except ImportError as e:
    import sys
    if "neo4j" in str(e).lower() or "No module named" in str(e):
        print("\n" + "="*70)
        print("ERROR: Missing dependencies. Please activate the virtual environment:")
        print("  source .venv/bin/activate  (Linux/Mac)")
        print("  .venv\\Scripts\\activate     (Windows)")
        print("\nThen install dependencies:")
        print("  pip install -r requirements.txt")
        print("="*70 + "\n")
    raise


@pytest.fixture
def test_app():
    """
    Create a FastAPI app instance for testing.
    This is the same app from main.py, but we can override dependencies here.
    """
    return app


@pytest.fixture
def client(test_app):
    """
    Create a test client for the FastAPI app.
    This uses FastAPI's TestClient which is built on httpx.
    
    Set raise_server_exceptions=False so that exceptions are caught by
    exception handlers and returned as responses (matching production behavior),
    rather than being raised and causing tests to fail.
    """
    return TestClient(test_app, raise_server_exceptions=False)


@pytest.fixture
def mock_neo4j_session():
    """
    Mock Neo4j session that uses MockNeo4jRecord and MockNeo4jResult.
    
    This fixture returns a MagicMock session where run() returns MockNeo4jResult
    instances that contain MockNeo4jRecord instances. This ensures dict-style
    access works correctly (rec['u'], rec['value'], etc.).
    
    The fixture automatically handles common queries like GraphSpace and Branch
    creation/retrieval to prevent test failures.
    
    Usage in tests:
        # Configure a single record result
        mock_record = MockNeo4jRecord({"u": {"id": "default", "name": "Test"}})
        mock_result = MockNeo4jResult(mock_record)
        mock_neo4j_session.run.return_value = mock_result
        
        # Configure multiple records for iteration
        mock_records = [
            MockNeo4jRecord({"f": {"id": "fa1", "name": "Focus 1"}}),
            MockNeo4jRecord({"f": {"id": "fa2", "name": "Focus 2"}})
        ]
        mock_result = MockNeo4jResult(records=mock_records)
        mock_neo4j_session.run.return_value = mock_result
        
        # Configure None result (not found)
        mock_result = MockNeo4jResult(record=None)
        mock_neo4j_session.run.return_value = mock_result
    """
    session = MagicMock()
    
    def run_side_effect(query, params=None, **kwargs):
        """Handle common queries automatically."""
        # Handle both session.run(query, params) and session.run(query, **params) patterns
        if params is None:
            params = kwargs
        elif isinstance(params, dict):
            # Merge params dict with kwargs
            params = {**params, **kwargs}
        else:
            # If params is not a dict, treat it as kwargs
            params = kwargs
        
        query_lower = query.lower()
        
        # Handle GraphSpace queries (for ensure_graphspace_exists) - must return "g" key
        if "graphspace" in query_lower and ("merge" in query_lower or "match" in query_lower):
            if "return g" in query_lower:
                return MockNeo4jResult(record=MockNeo4jRecord({
                    "g": {
                        "graph_id": params.get("graph_id", "default"),
                        "name": params.get("name", "Default"),
                        "created_at": "2024-01-01T00:00:00Z",
                        "updated_at": "2024-01-01T00:00:00Z",
                        "tenant_id": params.get("tenant_id"),
                    }
                }))
        
        # Handle Branch queries (for ensure_branch_exists) - must return "b" key
        if "branch" in query_lower and ("merge" in query_lower or "match" in query_lower):
            if "return b" in query_lower:
                return MockNeo4jResult(record=MockNeo4jRecord({
                    "b": {
                        "branch_id": params.get("branch_id", "main"),
                        "graph_id": params.get("graph_id", "default"),
                        "name": params.get("name", "Main"),
                        "created_at": "2024-01-01T00:00:00Z",
                        "updated_at": "2024-01-01T00:00:00Z",
                    }
                }))
        
        # Handle slug uniqueness queries (for concept creation)
        if "url_slug" in query_lower and "limit 1" in query_lower:
            # Return empty result to indicate slug is available
            return MockNeo4jResult(record=None)
        
        # Handle Lecture creation queries
        if ("create (l:lecture" in query_lower or "merge (l:lecture" in query_lower or 
            "create (l:Lecture" in query_lower or "merge (l:Lecture" in query_lower):
            if "return l" in query_lower or "return l.lecture_id" in query_lower:
                return MockNeo4jResult(record=MockNeo4jRecord({
                    "lecture_id": params.get("lecture_id", "L001"),
                    "title": params.get("title", "Test Lecture"),
                    "description": params.get("description", ""),
                    "primary_concept": params.get("primary_concept"),
                    "level": params.get("level", "beginner"),
                    "estimated_time": params.get("estimated_time", 30),
                    "slug": params.get("slug"),
                    "raw_text": params.get("raw_text", ""),
                }))
        
        # Handle Signal creation queries
        if ("create (s:signal" in query_lower or "merge (s:signal" in query_lower or
            "create (s:Signal" in query_lower or "merge (s:Signal" in query_lower):
            if "return s" in query_lower or "return s.signal_id" in query_lower:
                # Convert timestamp to ISO string if it's an integer
                timestamp = params.get("timestamp")
                if isinstance(timestamp, int):
                    # Convert milliseconds timestamp to ISO string
                    created_at = datetime.fromtimestamp(timestamp / 1000).isoformat() + "Z"
                else:
                    created_at = params.get("timestamp", "2024-01-01T00:00:00Z")
                
                return MockNeo4jResult(record=MockNeo4jRecord({
                    "signal_id": params.get("signal_id", "SIG_test"),
                    "signal_type": params.get("signal_type", "voice_note"),
                    "timestamp": timestamp if isinstance(timestamp, int) else params.get("timestamp", 1704067200000),
                    "graph_id": params.get("graph_id", "default"),
                    "branch_id": params.get("branch_id", "main"),
                    "document_id": params.get("document_id"),
                    "block_id": params.get("block_id"),
                    "concept_id": params.get("concept_id"),
                    "payload": params.get("payload", "{}"),
                    "session_id": params.get("session_id"),
                    "user_id": params.get("user_id"),
                    "created_at": created_at,  # ISO timestamp string
                }))
        
        # Handle Concept creation queries
        if ("create (c:concept" in query_lower or "merge (c:concept" in query_lower or
            "create (c:Concept" in query_lower or "merge (c:Concept" in query_lower):
            if "return c" in query_lower or "return c.node_id" in query_lower:
                return MockNeo4jResult(record=MockNeo4jRecord({
                    "node_id": params.get("node_id", "N001"),
                    "name": params.get("name", "Test Concept"),
                    "domain": params.get("domain", "Testing"),
                    "type": params.get("type", "concept"),
                    "description": params.get("description", ""),
                    "tags": params.get("tags", []),
                    "url_slug": params.get("url_slug"),
                }))
        
        # Default behavior: return empty result for queries
        return MockNeo4jResult(record=None)
    
    session.run.side_effect = run_side_effect
    
    return session


@pytest.fixture
def mock_neo4j_driver(monkeypatch):
    """
    Mock Neo4j driver to prevent real database connections.
    Patches the driver in db_neo4j module.
    
    Note: This fixture is kept for backward compatibility but is deprecated.
    Use mock_neo4j_session with dependency_overrides instead.
    """
    mock_driver = MagicMock()
    mock_session = MagicMock()
    mock_driver.session.return_value = mock_session
    
    # Patch the driver import
    with patch('db_neo4j.driver', mock_driver):
        yield mock_driver


@pytest.fixture(autouse=True)
def override_neo4j_dependency(test_app, mock_neo4j_session):
    """
    Automatically override FastAPI dependency injection for get_neo4j_session.
    
    This fixture uses FastAPI's dependency_overrides mechanism to ensure all
    endpoints use the mock_neo4j_session fixture. This is the single source
    of truth for Neo4j mocking in tests.
    
    This fixture is autouse=True, so it runs for every test automatically.
    """
    from db_neo4j import get_neo4j_session
    
    def get_mock_session():
        """Generator function that yields the mock session (matching get_neo4j_session signature)."""
        yield mock_neo4j_session
    
    # Override the dependency
    test_app.dependency_overrides[get_neo4j_session] = get_mock_session
    
    yield
    
    # Clean up: remove the override after the test
    test_app.dependency_overrides.pop(get_neo4j_session, None)


@pytest.fixture
def mock_openai_client(monkeypatch):
    """
    Mock OpenAI client to prevent real API calls.
    Patches the client in services_lecture_ingestion module.
    """
    mock_client = MagicMock()
    
    # Default response for chat completions
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message = MagicMock()
    mock_response.choices[0].message.content = '{"lecture_title": "Test", "nodes": [], "links": []}'
    mock_client.chat.completions.create.return_value = mock_response
    
    # Patch the client
    with patch('services_lecture_ingestion.client', mock_client):
        yield mock_client


@pytest.fixture
def mock_notion_client(monkeypatch):
    """
    Mock Notion client to prevent real API calls.
    Patches the client in notion_wrapper module.
    """
    mock_client = MagicMock()
    
    # Default responses
    mock_client.pages.retrieve.return_value = {
        "id": "test-page-id",
        "properties": {"title": {"title": [{"plain_text": "Test Page"}]}},
        "last_edited_time": "2024-01-01T00:00:00Z"
    }
    mock_client.pages.list.return_value = {"results": []}
    mock_client.databases.list.return_value = {"results": []}
    mock_client.blocks.children.list.return_value = {"results": []}
    
    # Patch the client
    with patch('notion_wrapper.NOTION_CLIENT', mock_client):
        with patch('notion_wrapper._ensure_client', return_value=mock_client):
            yield mock_client


@pytest.fixture
def sample_concept_data():
    """Sample concept data for testing with unique name."""
    import time
    unique_name = f"Test Concept {int(time.time() * 1000)}"
    return {
        "name": unique_name,
        "domain": "Testing",
        "type": "concept",
        "description": "A test concept",
        "tags": ["test"],
        "notes_key": None,
        "lecture_key": None,
        "url_slug": None,
    }


@pytest.fixture
def sample_concept():
    """Sample Concept model instance."""
    from models import Concept
    return Concept(
        node_id="N001",
        name="Test Concept",
        domain="Testing",
        type="concept",
        description="A test concept",
        tags=["test"],
        lecture_sources=[],
    )


@pytest.fixture
def sample_relationship_data():
    """Sample relationship data for testing."""
    return {
        "source_name": "Software Architecture",
        "predicate": "HAS_SUBDOMAIN",
        "target_name": "Web Development",
    }


@pytest.fixture
def sample_lecture_data():
    """Sample lecture data for testing."""
    return {
        "title": "Test Lecture",
        "description": "A test lecture for automated testing",
        "primary_concept": None,
        "level": "beginner",
        "estimated_time": 30,
        "slug": None,
    }


@pytest.fixture
def sample_lecture_ingest_request():
    """Sample lecture ingestion request."""
    return {
        "lecture_title": "Introduction to Testing",
        "lecture_text": "This lecture covers testing concepts. Testing is important for quality.",
        "domain": "Software Engineering",
    }


@pytest.fixture
def sample_lecture_extraction():
    """Sample LLM extraction result."""
    from models import LectureExtraction, ExtractedNode, ExtractedLink
    
    return LectureExtraction(
        lecture_title="Introduction to Testing",
        nodes=[
            ExtractedNode(
                name="Testing",
                description="The process of verifying software functionality",
                domain="Software Engineering",
                type="concept",
                tags=["quality"],
            )
        ],
        links=[
            ExtractedLink(
                source_name="Testing",
                target_name="Quality Assurance",
                predicate="RELATED_TO",
                confidence=0.9,
            )
        ],
    )


@pytest.fixture
def mock_csv_export(monkeypatch):
    """Mock CSV export to prevent file I/O during tests."""
    mock_export = MagicMock()
    with patch('services_sync.auto_export_csv', mock_export):
        with patch('scripts.export_csv_from_neo4j.main', mock_export):
            yield mock_export


@pytest.fixture
def mock_csv_import(monkeypatch):
    """Mock CSV import to prevent file I/O during tests."""
    mock_import = MagicMock()
    with patch('scripts.import_csv_to_neo4j.main', mock_import):
        yield mock_import


@pytest.fixture
def caplog(caplog):
    """Enhanced caplog fixture for better error logging tests."""
    import logging
    caplog.set_level(logging.DEBUG)
    return caplog


@pytest.fixture
def auth_headers():
    """Create valid auth headers for authenticated requests."""
    from auth import create_token
    token = create_token("test-user", "test-tenant")
    return {
        "Authorization": f"Bearer {token}",
        "x-tenant-id": "test-tenant",
    }


@pytest.fixture
def events_sqlite_path(tmp_path, monkeypatch):
    """Configure a temporary SQLite event store for deterministic tests."""
    db_path = tmp_path / "events.db"
    monkeypatch.setenv("EVENTS_SQLITE_PATH", str(db_path))
    monkeypatch.delenv("EVENTS_DDB_TABLE", raising=False)
    monkeypatch.setenv("EVENTS_POSTGRES", "false")
    return db_path


@pytest.fixture
def notes_digest_db(monkeypatch):
    """Configure PostgreSQL-backed services to use the test database."""
    test_db = os.getenv("TEST_POSTGRES_CONNECTION_STRING")
    if not test_db:
        pytest.skip("TEST_POSTGRES_CONNECTION_STRING not set - skipping notes digest tests")

    monkeypatch.setenv("POSTGRES_CONNECTION_STRING", test_db)

    import config
    monkeypatch.setattr(config, "POSTGRES_CONNECTION_STRING", test_db, raising=False)

    import services_notes_digest as notes_service
    monkeypatch.setattr(notes_service, "POSTGRES_CONNECTION_STRING", test_db, raising=False)
    notes_service._pool = None
    notes_service._init_db()

    import services_contextual_branches as branches_service
    monkeypatch.setattr(branches_service, "POSTGRES_CONNECTION_STRING", test_db, raising=False)
    branches_service._pool = None
    branches_service._init_db()

    import services_lecture_links as lecture_links
    monkeypatch.setattr(lecture_links, "POSTGRES_CONNECTION_STRING", test_db, raising=False)
    lecture_links._pool = None
    try:
        lecture_links._init_db()
    except Exception:
        pass

    return test_db


@pytest.fixture
def disable_lecture_links(monkeypatch):
    """Disable lecture link resolution to keep tests focused and fast."""
    import services_lecture_links as lecture_links
    monkeypatch.setattr(lecture_links, "resolve_links_for_notes_entries", lambda *args, **kwargs: None)
    monkeypatch.setattr(lecture_links, "resolve_links_for_bridging_hints", lambda *args, **kwargs: None)


@pytest.fixture
def notes_digest_event_log(monkeypatch):
    """Capture notes digest service log events."""
    events: List[Dict[str, Any]] = []

    def _log(event_type: str, data: dict):
        events.append({"event_type": event_type, "data": data})

    import services_notes_digest as notes_service
    monkeypatch.setattr(notes_service, "log_event", _log)
    return events


class NotesLLMStub:
    """Deterministic stub for notes digest LLM calls."""

    def __init__(self):
        self.calls: List[Dict[str, Any]] = []
        self.responses: List[Any] = []

    def set_responses(self, responses: List[Any]) -> None:
        self.responses = list(responses)

    def __call__(self, prompt: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        self.calls.append({"prompt": prompt, "payload": payload})
        if not self.responses:
            return {"add_entries": [], "refine_entries": [], "new_sections": []}
        next_response = self.responses.pop(0)
        if isinstance(next_response, Exception):
            raise next_response
        return next_response


@pytest.fixture
def notes_llm_stub(monkeypatch):
    """Patch notes digest LLM call with a deterministic stub."""
    stub = NotesLLMStub()
    import services_notes_digest as notes_service
    monkeypatch.setattr(notes_service, "_call_llm", stub)
    return stub


@pytest.fixture
def chat_session_ids():
    """Generate a unique chat/session id pair."""
    chat_id = f"chat-{uuid.uuid4().hex[:12]}"
    return chat_id, chat_id


@pytest.fixture
def post_session_event(client, auth_headers, events_sqlite_path):
    """Helper to post ChatMessageCreated events to the session events API."""
    def _post(
        session_id: str,
        message: str,
        answer: str,
        answer_summary: Optional[str] = None,
        mentioned_concepts: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "message": message,
            "answer": answer,
        }
        if answer_summary is not None:
            payload["answer_summary"] = answer_summary
        if mentioned_concepts is not None:
            payload["mentioned_concepts"] = mentioned_concepts

        response = client.post(
            f"/api/sessions/{session_id}/events",
            json={
                "event_type": "ChatMessageCreated",
                "payload": payload,
            },
            headers=auth_headers,
        )
        assert response.status_code == 200, response.text
        return response.json()

    return _post


@pytest.fixture
def create_branch_with_messages(notes_digest_db, disable_lecture_links):
    """Helper to create a branch with optional messages and hints."""
    def _create(
        chat_id: str,
        selected_text: str,
        messages: Optional[List[tuple]] = None,
        hints: Optional[List[Dict[str, Any]]] = None,
        parent_message_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        from models_contextual_branches import BranchCreateRequest
        from services_contextual_branches import create_branch, add_branch_message, save_bridging_hints

        parent_id = parent_message_id or f"parent-{uuid.uuid4().hex[:10]}"
        request = BranchCreateRequest(
            parent_message_id=parent_id,
            parent_message_content=f"Parent message for {selected_text}",
            start_offset=0,
            end_offset=len(selected_text),
            selected_text=selected_text,
            chat_id=chat_id,
        )
        branch = create_branch(request, "test-user")

        message_objs = []
        for role, content in messages or []:
            message_objs.append(add_branch_message(branch.id, role, content, "test-user"))

        hint_objs = []
        if hints:
            hint_set = save_bridging_hints(branch.id, hints, "test-user")
            hint_objs = hint_set.hints

        return {
            "branch": branch,
            "messages": message_objs,
            "hints": hint_objs,
            "anchor_hash": branch.anchor.selected_text_hash,
        }

    return _create


@pytest.fixture
def db_conn(notes_digest_db):
    """Provide a raw psycopg2 connection to the test database."""
    import psycopg2
    conn = psycopg2.connect(notes_digest_db)
    try:
        yield conn
    finally:
        conn.close()
