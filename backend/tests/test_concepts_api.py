"""
Comprehensive tests for the Concepts API endpoints.

Tests cover:
- Happy paths (successful operations)
- Error paths (not found, validation errors, etc.)
- Edge cases (empty results, duplicate relationships, etc.)

All tests use mocked Neo4j sessions via the mock_neo4j_session fixture.
"""
import pytest
from tests.mock_helpers import MockNeo4jRecord, MockNeo4jResult
from models import Concept


class TestGetConceptById:
    """Tests for GET /concepts/{node_id}"""
    
    def test_get_concept_by_id_success(self, client, mock_neo4j_session):
        """Test successfully getting a concept by node_id."""
        mock_record = MockNeo4jRecord({
                "node_id": "N001",
                "name": "Test Concept",
                "domain": "Testing",
                "type": "concept",
                "description": "A test concept",
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
        
        response = client.get("/concepts/N001")
        
        assert response.status_code == 200
        data = response.json()
        assert data["node_id"] == "N001"
        assert data["name"] == "Test Concept"
        assert "domain" in data
        assert "type" in data
    
    def test_get_concept_by_id_not_found(self, client, mock_neo4j_session):
        """Test getting a concept that doesn't exist."""
        mock_result = MockNeo4jResult(record=None)
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.get("/concepts/NONEXISTENT")
        
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()


class TestGetConceptByName:
    """Tests for GET /concepts/by-name/{name}"""
    
    def test_get_concept_by_name_success(self, client, mock_neo4j_session):
        """Test successfully getting a concept by name."""
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
        mock_result = MockNeo4jResult(mock_record)
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.get("/concepts/by-name/Test%20Concept")
        
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Test Concept"
        assert data["node_id"] == "N001"
    
    def test_get_concept_by_name_not_found(self, client, mock_neo4j_session):
        """Test getting a concept by name that doesn't exist."""
        mock_result = MockNeo4jResult(record=None)
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.get("/concepts/by-name/NonexistentConcept")
        
        assert response.status_code == 404


class TestCreateConcept:
    """Tests for POST /concepts/"""
    
    def test_create_concept_success(self, client, mock_neo4j_session, sample_concept_data, mock_csv_export):
        """Test successfully creating a concept."""
        mock_record = MockNeo4jRecord({
                "node_id": "N123",
                "name": sample_concept_data["name"],
                "domain": sample_concept_data["domain"],
                "type": sample_concept_data["type"],
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
    
    def test_create_concept_missing_required_fields(self, client):
        """Test creating a concept with missing required fields."""
        invalid_payload = {
            "domain": "Testing",
            # Missing "name" field
        }
        
        response = client.post("/concepts/", json=invalid_payload)
        
        assert response.status_code == 422  # Validation error


class TestCreateRelationship:
    """Tests for POST /concepts/relationship"""
    
    def test_create_relationship_success(self, client, mock_neo4j_session, sample_relationship_data, mock_csv_export):
        """Test successfully creating a relationship."""
        mock_record = MockNeo4jRecord({})  # MERGE returns a record (empty is fine)
        mock_result = MockNeo4jResult(mock_record)
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.post("/concepts/relationship", json=sample_relationship_data)
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
    
    def test_create_relationship_duplicate(self, client, mock_neo4j_session, sample_relationship_data, mock_csv_export):
        """Test creating a relationship that already exists (MERGE should handle this)."""
        mock_record = MockNeo4jRecord({})  # MERGE returns existing
        mock_result = MockNeo4jResult(mock_record)
        mock_neo4j_session.run.return_value = mock_result
        
        # First creation
        response1 = client.post("/concepts/relationship", json=sample_relationship_data)
        assert response1.status_code == 200
        
        # Second creation (should be idempotent)
        response2 = client.post("/concepts/relationship", json=sample_relationship_data)
        assert response2.status_code == 200


class TestCreateRelationshipByIds:
    """Tests for POST /concepts/relationship-by-ids"""
    
    def test_create_relationship_by_ids_success(self, client, mock_neo4j_session, mock_csv_export):
        """Test successfully creating a relationship by node IDs."""
        mock_record = MockNeo4jRecord({})
        mock_result = MockNeo4jResult(mock_record)
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.post(
            "/concepts/relationship-by-ids",
            params={"source_id": "N001", "target_id": "N002", "predicate": "RELATED_TO"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"


class TestGetNeighbors:
    """Tests for GET /concepts/{node_id}/neighbors"""
    
    def test_get_neighbors_success(self, client, mock_neo4j_session):
        """Test successfully getting neighbors of a concept."""
        mock_record1 = MockNeo4jRecord({
                "node_id": "N002",
                "name": "Neighbor 1",
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
        mock_record2 = MockNeo4jRecord({
                "node_id": "N003",
                "name": "Neighbor 2",
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
        mock_result = MockNeo4jResult(records=[mock_record1, mock_record2])
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.get("/concepts/N001/neighbors")
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 2
    
    def test_get_neighbors_empty(self, client, mock_neo4j_session):
        """Test getting neighbors when concept has no neighbors."""
        mock_result = MockNeo4jResult(records=[])
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.get("/concepts/N001/neighbors")
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 0


class TestDeleteConcept:
    """Tests for DELETE /concepts/{node_id}"""
    
    def test_delete_concept_success(self, client, mock_neo4j_session, mock_csv_export):
        """Test successfully deleting a concept."""
        mock_record = MockNeo4jRecord({"deleted": 1})
        mock_result = MockNeo4jResult(mock_record)
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.delete("/concepts/N001")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
    
    def test_delete_concept_not_found(self, client, mock_neo4j_session):
        """Test deleting a concept that doesn't exist."""
        mock_record = MockNeo4jRecord({"deleted": 0})
        mock_result = MockNeo4jResult(mock_record)
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.delete("/concepts/NONEXISTENT")
        
        assert response.status_code == 404


class TestDeleteRelationship:
    """Tests for DELETE /concepts/relationship"""
    
    def test_delete_relationship_success(self, client, mock_neo4j_session, mock_csv_export):
        """Test successfully deleting a relationship."""
        mock_record = MockNeo4jRecord({"deleted": 1})
        mock_result = MockNeo4jResult(mock_record)
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.delete(
            "/concepts/relationship",
            params={"source_id": "N001", "target_id": "N002", "predicate": "RELATED_TO"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
    
    def test_delete_relationship_not_found(self, client, mock_neo4j_session):
        """Test deleting a relationship that doesn't exist."""
        mock_record = MockNeo4jRecord({"deleted": 0})
        mock_result = MockNeo4jResult(mock_record)
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.delete(
            "/concepts/relationship",
            params={"source_id": "N001", "target_id": "N002", "predicate": "NONEXISTENT"}
        )
        
        assert response.status_code == 404


class TestGetMissingDescriptions:
    """Tests for GET /concepts/missing-descriptions"""
    
    def test_get_missing_descriptions_success(self, client, mock_neo4j_session):
        """Test getting concepts missing descriptions."""
        mock_record = MockNeo4jRecord({
                "node_id": "N001",
                "name": "Concept Without Description",
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
        mock_result = MockNeo4jResult(records=[mock_record])
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.get("/concepts/missing-descriptions?limit=3")
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)


class TestGetConceptGaps:
    """Tests for GET /concepts/gaps"""
    
    def test_get_concept_gaps_success(self, client, mock_neo4j_session):
        """Test getting concept gaps."""
        mock_record = MockNeo4jRecord({"name": "Gap Concept"})
        mock_result = MockNeo4jResult(records=[mock_record])
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.get("/concepts/gaps?limit=5")
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
