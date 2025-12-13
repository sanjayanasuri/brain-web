"""
Tests for the lectures endpoints.
"""
import pytest
from tests.mock_helpers import MockNeo4jRecord, MockNeo4jResult


def test_create_lecture(client, mock_neo4j_session, sample_lecture_data):
    """Test creating a new lecture."""
    # Mock the CREATE query response
    mock_record = MockNeo4jRecord({
        "lecture_id": "L123",
        "title": sample_lecture_data["title"],
        "description": sample_lecture_data.get("description"),
        "primary_concept": sample_lecture_data.get("primary_concept"),
        "level": sample_lecture_data.get("level"),
        "estimated_time": sample_lecture_data.get("estimated_time"),
        "slug": sample_lecture_data.get("slug"),
    })
    mock_result = MockNeo4jResult(mock_record)
    mock_neo4j_session.run.return_value = mock_result
    
    response = client.post("/lectures/", json=sample_lecture_data)
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == sample_lecture_data["title"]
    assert "lecture_id" in data
    assert data["lecture_id"].startswith("L")


def test_get_lecture(client, mock_neo4j_session, sample_lecture_data):
    """Test getting a lecture by ID."""
    lecture_id = "L123"
    
    def run_side_effect(query, **params):
        if "CREATE" in query:
            # CREATE query for creating lecture
            mock_record = MockNeo4jRecord({
                "lecture_id": lecture_id,
                "title": sample_lecture_data["title"],
                "description": sample_lecture_data.get("description"),
                "primary_concept": sample_lecture_data.get("primary_concept"),
                "level": sample_lecture_data.get("level"),
                "estimated_time": sample_lecture_data.get("estimated_time"),
                "slug": sample_lecture_data.get("slug"),
            })
            return MockNeo4jResult(mock_record)
        elif "MATCH (l:Lecture" in query:
            # MATCH query for getting lecture
            mock_record = MockNeo4jRecord({
                "lecture_id": lecture_id,
                "title": sample_lecture_data["title"],
                "description": sample_lecture_data.get("description"),
                "primary_concept": sample_lecture_data.get("primary_concept"),
                "level": sample_lecture_data.get("level"),
                "estimated_time": sample_lecture_data.get("estimated_time"),
                "slug": sample_lecture_data.get("slug"),
            })
            return MockNeo4jResult(mock_record)
        return MockNeo4jResult(record=None)
    
    mock_neo4j_session.run.side_effect = run_side_effect
    
    # First create a lecture
    create_response = client.post("/lectures/", json=sample_lecture_data)
    assert create_response.status_code == 200
    
    # Then get it
    response = client.get(f"/lectures/{lecture_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["lecture_id"] == lecture_id
    assert data["title"] == sample_lecture_data["title"]


def test_get_lecture_not_found(client, mock_neo4j_session):
    """Test getting a lecture that doesn't exist."""
    mock_result = MockNeo4jResult(record=None)
    mock_neo4j_session.run.return_value = mock_result
    
    response = client.get("/lectures/LNONEXISTENT")
    assert response.status_code == 404


def test_add_lecture_step(client, mock_neo4j_session, sample_lecture_data):
    """Test adding a step to a lecture."""
    lecture_id = "L123"
    
    def run_side_effect(query, **params):
        if "CREATE" in query:
            # CREATE query for creating lecture
            mock_record = MockNeo4jRecord({
                "lecture_id": lecture_id,
                "title": sample_lecture_data["title"],
            })
            return MockNeo4jResult(mock_record)
        elif "MATCH (l:Lecture" in query and "MERGE" in query:
            # MERGE query for adding lecture step
            mock_record = MockNeo4jRecord({
                "lecture_id": lecture_id,
                "step_order": params.get("step_order", 1),
                "node_id": params.get("concept_id", "N001"),
                "name": "Test Concept",
                "domain": "Testing",
                "type": "concept",
                "notes_key": None,
                "lecture_key": None,
                "url_slug": None,
            })
            return MockNeo4jResult(mock_record)
        elif "MATCH (l:Lecture" in query:
            # MATCH query for getting lecture
            mock_record = MockNeo4jRecord({
                "lecture_id": lecture_id,
                "title": sample_lecture_data["title"],
            })
            return MockNeo4jResult(mock_record)
        elif "MATCH (c:Concept" in query:
            # MATCH query for getting concept
            mock_record = MockNeo4jRecord({
                "node_id": "N001",
                "name": "Test Concept",
                "domain": "Testing",
                "type": "concept",
                "description": None,
                "tags": None,
                "notes_key": None,
                "lecture_key": None,
                "url_slug": None,
                "lecture_sources": [],
                "created_by": None,
                "last_updated_by": None,
            })
            return MockNeo4jResult(mock_record)
        return MockNeo4jResult(record=None)
    
    mock_neo4j_session.run.side_effect = run_side_effect
    
    # Create a lecture
    create_response = client.post("/lectures/", json=sample_lecture_data)
    assert create_response.status_code == 200
    
    # Add a step (using an existing concept)
    step_data = {
        "concept_id": "N001",  # Software Architecture
        "step_order": 1,
    }
    response = client.post(f"/lectures/{lecture_id}/steps", json=step_data)
    assert response.status_code == 200
    data = response.json()
    assert data["lecture_id"] == lecture_id
    assert data["step_order"] == 1
    assert "concept" in data


def test_add_lecture_step_invalid_concept(client, mock_neo4j_session, sample_lecture_data):
    """Test adding a step with a non-existent concept."""
    lecture_id = "L123"
    call_count = [0]
    
    def run_side_effect(query, **params):
        call_count[0] += 1
        if "CREATE" in query:
            # CREATE query for creating lecture
            mock_record = MockNeo4jRecord({
                "lecture_id": lecture_id,
                "title": sample_lecture_data["title"],
            })
            return MockNeo4jResult(mock_record)
        elif "MATCH (l:Lecture" in query and "MATCH (c:Concept" in query and "MERGE" in query:
            # This is the add_lecture_step query - concept doesn't exist, so return None
            # The query does: MATCH (l:Lecture) MATCH (c:Concept) MERGE ...
            # If concept doesn't exist, second MATCH fails, so whole query returns None
            return MockNeo4jResult(record=None)
        elif "MATCH (l:Lecture" in query:
            # MATCH query for getting lecture
            mock_record = MockNeo4jRecord({
                "lecture_id": lecture_id,
                "title": sample_lecture_data["title"],
            })
            return MockNeo4jResult(mock_record)
        return MockNeo4jResult(record=None)
    
    mock_neo4j_session.run.side_effect = run_side_effect
    
    # Create a lecture
    create_response = client.post("/lectures/", json=sample_lecture_data)
    assert create_response.status_code == 200
    
    # Try to add a step with invalid concept
    step_data = {
        "concept_id": "NONEXISTENT",
        "step_order": 1,
    }
    response = client.post(f"/lectures/{lecture_id}/steps", json=step_data)
    assert response.status_code == 400


def test_get_lecture_steps(client, mock_neo4j_session, sample_lecture_data):
    """Test getting all steps for a lecture."""
    lecture_id = "L123"
    call_count = [0]
    
    def run_side_effect(query, **params):
        call_count[0] += 1
        if "CREATE" in query:
            # CREATE query for creating lecture
            mock_record = MockNeo4jRecord({
                "lecture_id": lecture_id,
                "title": sample_lecture_data["title"],
            })
            return MockNeo4jResult(mock_record)
        elif "MATCH (l:Lecture" in query and "MERGE" in query:
            # MERGE query for adding lecture step
            mock_record = MockNeo4jRecord({
                "lecture_id": lecture_id,
                "step_order": params.get("step_order", 1),
                "node_id": params.get("concept_id", "N001"),
                "name": "Test Concept",
                "domain": "Testing",
                "type": "concept",
                "notes_key": None,
                "lecture_key": None,
                "url_slug": None,
            })
            return MockNeo4jResult(mock_record)
        elif "MATCH (l:Lecture" in query and "step_order" in query:
            # Query for getting lecture steps
            mock_record = MockNeo4jRecord({
                "lecture_id": lecture_id,
                "step_order": 1,
                "node_id": "N001",
                "name": "Test Concept",
                "domain": "Testing",
                "type": "concept",
                "notes_key": None,
                "lecture_key": None,
                "url_slug": None,
            })
            return MockNeo4jResult(records=[mock_record])
        elif "MATCH (l:Lecture" in query:
            # MATCH query for getting lecture
            mock_record = MockNeo4jRecord({
                "lecture_id": lecture_id,
                "title": sample_lecture_data["title"],
            })
            return MockNeo4jResult(mock_record)
        elif "MATCH (c:Concept" in query:
            # MATCH query for getting concept
            mock_record = MockNeo4jRecord({
                "node_id": "N001",
                "name": "Test Concept",
                "domain": "Testing",
                "type": "concept",
                "description": None,
                "tags": None,
                "notes_key": None,
                "lecture_key": None,
                "url_slug": None,
                "lecture_sources": [],
                "created_by": None,
                "last_updated_by": None,
            })
            return MockNeo4jResult(mock_record)
        return MockNeo4jResult(record=None)
    
    mock_neo4j_session.run.side_effect = run_side_effect
    
    # Create a lecture
    create_response = client.post("/lectures/", json=sample_lecture_data)
    assert create_response.status_code == 200
    
    # Add a step
    step_data = {
        "concept_id": "N001",
        "step_order": 1,
    }
    client.post(f"/lectures/{lecture_id}/steps", json=step_data)
    
    # Get all steps
    response = client.get(f"/lectures/{lecture_id}/steps")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    if len(data) > 0:
        assert data[0]["step_order"] == 1


def test_get_lecture_steps_empty(client, mock_neo4j_session, sample_lecture_data):
    """Test getting steps for a lecture with no steps."""
    lecture_id = "L123"
    
    def run_side_effect(query, **params):
        if "CREATE" in query:
            # CREATE query for creating lecture
            mock_record = MockNeo4jRecord({
                "lecture_id": lecture_id,
                "title": sample_lecture_data["title"],
            })
            return MockNeo4jResult(mock_record)
        elif "MATCH (l:Lecture" in query and "step_order" in query:
            # Query for getting lecture steps (empty)
            return MockNeo4jResult(records=[])
        elif "MATCH (l:Lecture" in query:
            # MATCH query for getting lecture
            mock_record = MockNeo4jRecord({
                "lecture_id": lecture_id,
                "title": sample_lecture_data["title"],
            })
            return MockNeo4jResult(mock_record)
        return MockNeo4jResult(record=None)
    
    mock_neo4j_session.run.side_effect = run_side_effect
    
    # Create a lecture
    create_response = client.post("/lectures/", json=sample_lecture_data)
    assert create_response.status_code == 200
    
    # Get steps (should be empty)
    response = client.get(f"/lectures/{lecture_id}/steps")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) == 0

