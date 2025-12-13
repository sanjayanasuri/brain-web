"""
Tests for the concepts endpoints.
"""
import pytest
from tests.mock_helpers import MockNeo4jRecord, MockNeo4jResult


def test_get_concept_by_id(client, mock_neo4j_session):
    """Test getting a concept by node_id."""
    mock_record = MockNeo4jRecord({
        "node_id": "N001",
        "name": "Software Architecture",
        "domain": "Software Engineering",
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
    mock_result = MockNeo4jResult(mock_record)
    mock_neo4j_session.run.return_value = mock_result
    
    # Test with existing concept
    response = client.get("/concepts/N001")
    assert response.status_code == 200
    data = response.json()
    assert data["node_id"] == "N001"
    assert data["name"] == "Software Architecture"
    assert "domain" in data
    assert "type" in data


def test_get_concept_by_id_not_found(client, mock_neo4j_session):
    """Test getting a concept that doesn't exist."""
    mock_result = MockNeo4jResult(record=None)
    mock_neo4j_session.run.return_value = mock_result
    
    response = client.get("/concepts/NONEXISTENT")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_get_concept_by_name(client, mock_neo4j_session):
    """Test getting a concept by name."""
    mock_record = MockNeo4jRecord({
        "node_id": "N001",
        "name": "Software Architecture",
        "domain": "Software Engineering",
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
    mock_result = MockNeo4jResult(mock_record)
    mock_neo4j_session.run.return_value = mock_result
    
    response = client.get("/concepts/by-name/Software%20Architecture")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Software Architecture"
    assert data["node_id"] == "N001"


def test_get_concept_by_name_not_found(client, mock_neo4j_session):
    """Test getting a concept by name that doesn't exist."""
    mock_result = MockNeo4jResult(record=None)
    mock_neo4j_session.run.return_value = mock_result
    
    response = client.get("/concepts/by-name/NonexistentConcept")
    assert response.status_code == 404


def test_create_and_delete_concept(client, mock_neo4j_session):
    """Create a concept and delete it via endpoint."""
    import time
    name = f"Disposable Concept {int(time.time() * 1000)}"
    node_id = "N123"
    call_count = [0]
    
    def run_side_effect(query, **params):
        call_count[0] += 1
        if "CREATE" in query:
            # CREATE query
            mock_record = MockNeo4jRecord({
                "node_id": node_id,
                "name": name,
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
        elif "DELETE" in query or "DETACH DELETE" in query:
            # DELETE query returns count of deleted nodes
            mock_record = MockNeo4jRecord({"deleted": 1})
            return MockNeo4jResult(mock_record)
        elif "MATCH (c:Concept" in query:
            # MATCH query - return None after delete
            if call_count[0] > 2:  # After delete
                return MockNeo4jResult(record=None)
            # Before delete
            mock_record = MockNeo4jRecord({
                "node_id": node_id,
                "name": name,
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
    
    payload = {"name": name, "domain": "Testing", "type": "concept"}
    create_resp = client.post("/concepts/", json=payload)
    assert create_resp.status_code == 200

    delete_resp = client.delete(f"/concepts/{node_id}")
    assert delete_resp.status_code == 200
    assert delete_resp.json()["status"] == "ok"

    # Ensure it's gone
    get_resp = client.get(f"/concepts/{node_id}")
    assert get_resp.status_code == 404


def test_create_concept(client, mock_neo4j_session, sample_concept_data):
    """Test creating a new concept."""
    node_id = "N123"
    mock_record = MockNeo4jRecord({
        "node_id": node_id,
        "name": sample_concept_data["name"],
        "domain": sample_concept_data["domain"],
        "type": sample_concept_data.get("type", "concept"),
        "description": sample_concept_data.get("description"),
        "tags": sample_concept_data.get("tags"),
        "notes_key": None,
        "lecture_key": None,
        "url_slug": None,
        "lecture_sources": [],
        "created_by": None,
        "last_updated_by": None,
    })
    mock_result = MockNeo4jResult(mock_record)
    mock_neo4j_session.run.return_value = mock_result
    
    response = client.post("/concepts/", json=sample_concept_data)
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == sample_concept_data["name"]
    assert data["domain"] == sample_concept_data["domain"]
    assert "node_id" in data
    assert data["node_id"].startswith("N")


def test_create_relationship(client, sample_relationship_data):
    """Test creating a relationship between concepts."""
    response = client.post("/concepts/relationship", json=sample_relationship_data)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"


def test_create_relationship_by_ids_and_delete(client, mock_neo4j_session):
    """Create a relationship by IDs, then delete it."""
    import time
    unique_suffix = int(time.time() * 1000)
    source_id = "N001"
    target_id = "N002"
    call_count = [0]
    
    def run_side_effect(query, **params):
        call_count[0] += 1
        if "CREATE" in query and "Concept" in query:
            # CREATE concept query
            node_id = source_id if call_count[0] == 1 else target_id
            name = f"Relink Source {unique_suffix}" if call_count[0] == 1 else f"Relink Target {unique_suffix}"
            mock_record = MockNeo4jRecord({
                "node_id": node_id,
                "name": name,
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
        elif "CREATE" in query or "MERGE" in query:
            # CREATE/MERGE relationship query
            return MockNeo4jResult(record=None)
        elif "DELETE" in query and "relationship" in query.lower():
            # DELETE relationship query - returns count of deleted relationships
            mock_record = MockNeo4jRecord({"deleted": 1})
            return MockNeo4jResult(mock_record)
        elif "DELETE" in query or "DETACH DELETE" in query:
            # DELETE node query - returns count of deleted nodes
            mock_record = MockNeo4jRecord({"deleted": 1})
            return MockNeo4jResult(mock_record)
        elif "MATCH (c:Concept" in query and "-[r]-" in query:
            # Get neighbors-with-relationships query - returns flat records
            if call_count[0] <= 5:  # Before delete
                mock_record = MockNeo4jRecord({
                    "node_id": target_id,
                    "name": f"Relink Target {unique_suffix}",
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
                    "predicate": "TEST_LINK",
                    "is_outgoing": True,
                })
                return MockNeo4jResult(records=[mock_record])
            else:  # After delete
                return MockNeo4jResult(records=[])
        return MockNeo4jResult(record=None)
    
    mock_neo4j_session.run.side_effect = run_side_effect
    
    source_payload = {"name": f"Relink Source {unique_suffix}", "domain": "Testing", "type": "concept"}
    target_payload = {"name": f"Relink Target {unique_suffix}", "domain": "Testing", "type": "concept"}

    source_resp = client.post("/concepts/", json=source_payload)
    target_resp = client.post("/concepts/", json=target_payload)
    assert source_resp.status_code == target_resp.status_code == 200

    create_resp = client.post(
        "/concepts/relationship-by-ids",
        params={"source_id": source_id, "target_id": target_id, "predicate": "TEST_LINK"},
    )
    assert create_resp.status_code == 200

    neighbors = client.get(f"/concepts/{source_id}/neighbors-with-relationships")
    assert neighbors.status_code == 200
    found = [n for n in neighbors.json() if n["concept"]["node_id"] == target_id and n["predicate"] == "TEST_LINK"]
    assert found, "Relationship should be present"

    delete_resp = client.delete(
        "/concepts/relationship",
        params={"source_id": source_id, "target_id": target_id, "predicate": "TEST_LINK"},
    )
    assert delete_resp.status_code == 200

    neighbors_after = client.get(f"/concepts/{source_id}/neighbors-with-relationships")
    assert neighbors_after.status_code == 200
    gone = [n for n in neighbors_after.json() if n["concept"]["node_id"] == target_id and n["predicate"] == "TEST_LINK"]
    assert not gone

    # Cleanup nodes
    client.delete(f"/concepts/{source_id}")
    client.delete(f"/concepts/{target_id}")


def test_get_neighbors(client):
    """Test getting neighbors of a concept."""
    response = client.get("/concepts/N001/neighbors")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    # N001 should have neighbors (we know from earlier testing)
    if len(data) > 0:
        assert "node_id" in data[0]
        assert "name" in data[0]


def test_get_all_graph_data(client):
    """Ensure the graph endpoint returns nodes and links."""
    response = client.get("/concepts/all/graph")
    assert response.status_code == 200
    data = response.json()
    assert "nodes" in data and "links" in data
    assert isinstance(data["nodes"], list)
    assert isinstance(data["links"], list)


def test_get_neighbors_empty(client, mock_neo4j_session):
    """Test getting neighbors of a concept with no neighbors."""
    import time
    unique_name = f"Isolated Concept {int(time.time() * 1000)}"
    node_id = "N123"
    call_count = [0]
    
    def run_side_effect(query, **params):
        call_count[0] += 1
        if "CREATE" in query:
            # CREATE concept query
            mock_record = MockNeo4jRecord({
                "node_id": node_id,
                "name": unique_name,
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
        elif "neighbors" in query.lower() or ("MATCH (c:Concept" in query and "-[r]-" in query):
            # Get neighbors query (empty)
            return MockNeo4jResult(records=[])
        elif "DELETE" in query or "DETACH DELETE" in query:
            # DELETE query - returns count of deleted nodes
            mock_record = MockNeo4jRecord({"deleted": 1})
            return MockNeo4jResult(mock_record)
        return MockNeo4jResult(record=None)
    
    mock_neo4j_session.run.side_effect = run_side_effect
    
    concept_data = {
        "name": unique_name,
        "domain": "Testing",
        "type": "concept",
    }
    create_response = client.post("/concepts/", json=concept_data)
    assert create_response.status_code == 200
    
    # Check its neighbors (should be empty)
    response = client.get(f"/concepts/{node_id}/neighbors")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    # cleanup
    client.delete(f"/concepts/{node_id}")


def test_get_neighbors_with_relationships(client):
    """Neighbors-with-relationships should include predicate and direction keys."""
    response = client.get("/concepts/N001/neighbors-with-relationships")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    if data:
        first = data[0]
        assert "concept" in first
        assert "predicate" in first
        assert "is_outgoing" in first


def test_cleanup_test_data(client, mock_neo4j_session):
    """Ensure cleanup-test-data deletes temporary/testing nodes."""
    import time
    name = f"Cleanup Target {int(time.time() * 1000)}"
    node_id = "N123"
    call_count = [0]
    
    def run_side_effect(query, **params):
        call_count[0] += 1
        if "CREATE" in query and "Concept" in query:
            # CREATE concept query
            mock_record = MockNeo4jRecord({
                "node_id": node_id,
                "name": name,
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
        elif "DELETE" in query or "DETACH DELETE" in query or "cleanup" in query.lower():
            # DELETE/cleanup query - returns count of deleted nodes
            mock_record = MockNeo4jRecord({"deleted": 1})
            return MockNeo4jResult(mock_record)
        elif "MATCH (c:Concept" in query:
            # MATCH query - return None after cleanup
            if call_count[0] > 2:  # After cleanup
                return MockNeo4jResult(record=None)
            # Before cleanup
            mock_record = MockNeo4jRecord({
                "node_id": node_id,
                "name": name,
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
    
    payload = {"name": name, "domain": "Testing", "type": "concept"}
    resp = client.post("/concepts/", json=payload)
    assert resp.status_code == 200

    cleanup = client.post("/concepts/cleanup-test-data")
    assert cleanup.status_code == 200
    assert cleanup.json()["status"] == "ok"

    # Verify the test node is gone
    get_resp = client.get(f"/concepts/{node_id}")
    assert get_resp.status_code == 404
