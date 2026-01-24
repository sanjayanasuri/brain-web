"""
Integration test for GET /concepts/{node_id}/notes endpoint.

Tests that notes entries with related_node_ids are returned correctly.
"""
import os
import pytest
import uuid
from datetime import datetime

from tests.utils import db_fetchall, db_fetchone

TEST_DB = os.getenv("TEST_POSTGRES_CONNECTION_STRING")
pytestmark = pytest.mark.skipif(
    not TEST_DB,
    reason="TEST_POSTGRES_CONNECTION_STRING not set - skipping concept notes endpoint test",
)


def test_get_concept_notes_endpoint(
    client,
    auth_headers,
    notes_digest_db,
    mock_neo4j_session,
):
    """Test that notes entries linked to a concept are returned."""
    # Create a test concept in Neo4j mock
    node_id = "N001TEST"
    concept_record = {
        "node_id": node_id,
        "name": "Test Concept",
        "domain": "Testing",
        "type": "concept",
        "description": "A test concept",
        "aliases": [],
        "lecture_sources": [],
    }
    from tests.mock_helpers import MockNeo4jRecord, MockNeo4jResult
    mock_record = MockNeo4jRecord(concept_record)
    mock_result = MockNeo4jResult(mock_record)
    mock_neo4j_session.run.return_value = mock_result
    
    # Create a test digest and section
    chat_id = f"test-chat-{uuid.uuid4().hex[:8]}"
    digest_id = f"digest-{uuid.uuid4().hex[:8]}"
    section_id = f"section-{uuid.uuid4().hex[:8]}"
    entry_id = f"entry-{uuid.uuid4().hex[:8]}"
    
    # Insert test data directly into Postgres
    import psycopg2
    conn = psycopg2.connect(TEST_DB)
    try:
        with conn.cursor() as cur:
            # Create digest
            cur.execute("""
                INSERT INTO notes_digests (id, chat_id, created_at)
                VALUES (%s, %s, NOW())
            """, (digest_id, chat_id))
            
            # Create section
            cur.execute("""
                INSERT INTO notes_sections (id, digest_id, title, position, created_at, updated_at)
                VALUES (%s, %s, %s, %s, NOW(), NOW())
            """, (section_id, digest_id, "Concepts Clarified", 0))
            
            # Create entry with related_node_ids
            cur.execute("""
                INSERT INTO notes_entries (
                    id, section_id, chat_id, source_type, source_message_ids,
                    summary_text, confidence_level, related_node_ids, created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
            """, (
                entry_id,
                section_id,
                chat_id,
                "main_chat",
                [],
                "This is a test note about the concept.",
                0.8,
                [node_id],  # related_node_ids array
            ))
            
            conn.commit()
    finally:
        conn.close()
    
    # Call the endpoint
    response = client.get(
        f"/concepts/{node_id}/notes",
        headers=auth_headers,
    )
    
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    
    # Find our test entry
    test_entry = next((e for e in data if e["id"] == entry_id), None)
    assert test_entry is not None
    assert test_entry["chat_id"] == chat_id
    assert test_entry["section_id"] == section_id
    assert test_entry["section_title"] == "Concepts Clarified"
    assert test_entry["summary_text"] == "This is a test note about the concept."
    assert test_entry["source_type"] == "main_chat"
    assert test_entry["confidence_level"] == 0.8
    assert node_id in test_entry["related_node_ids"]


def test_get_concept_notes_not_found(client, auth_headers, mock_neo4j_session):
    """Test that 404 is returned when concept doesn't exist."""
    from tests.mock_helpers import MockNeo4jResult
    # Mock concept not found
    mock_result = MockNeo4jResult(record=None)
    mock_neo4j_session.run.return_value = mock_result
    
    response = client.get(
        "/concepts/NONEXISTENT/notes",
        headers=auth_headers,
    )
    
    assert response.status_code == 404
    assert "Concept not found" in response.json()["detail"]
