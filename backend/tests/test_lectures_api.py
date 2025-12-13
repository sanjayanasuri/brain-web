"""
Comprehensive tests for the Lectures API endpoints.

Tests cover:
- Lecture ingestion (LLM-based extraction)
- Lecture CRUD operations
- Lecture steps management
- Error handling for ingestion failures

All tests use mocked dependencies (Neo4j, OpenAI, CSV export).
"""
import pytest
from tests.mock_helpers import MockNeo4jRecord, MockNeo4jResult
from models import LectureIngestResult, Concept


class TestIngestLecture:
    """Tests for POST /lectures/ingest"""
    
    def test_ingest_lecture_success(self, client, mock_neo4j_session, sample_lecture_ingest_request, mock_openai_client, mock_csv_export):
        """Test successful lecture ingestion."""
        # Mock OpenAI response
        mock_openai_client.chat.completions.create.return_value.choices[0].message.content = '''{
            "lecture_title": "Introduction to Testing",
            "nodes": [
                {
                    "name": "Testing",
                    "description": "The process of verifying software functionality",
                    "domain": "Software Engineering",
                    "type": "concept",
                    "tags": ["quality"]
                }
            ],
            "links": [
                {
                    "source_name": "Testing",
                    "target_name": "Quality Assurance",
                    "predicate": "RELATED_TO",
                    "confidence": 0.9
                }
            ]
        }'''
        
        # Mock: find_concept_by_name_and_domain returns None (new concept)
        mock_result_find = MockNeo4jResult(record=None)
        
        # Mock: create_concept returns new concept
        def run_side_effect(query, **params):
            if "CREATE" in query:
                mock_record = MockNeo4jRecord({
                    "node_id": "N123",
                    "name": params.get("name", "Testing"),
                    "domain": params.get("domain", "Software Engineering"),
                    "type": params.get("type", "concept"),
                    "description": params.get("description"),
                    "tags": params.get("tags", []),
                    "notes_key": None,
                    "lecture_key": None,
                    "url_slug": None,
                    "lecture_sources": [params.get("lecture_key", "LECTURE_123")],
                    "created_by": params.get("created_by"),
                    "last_updated_by": params.get("last_updated_by"),
                })
                return MockNeo4jResult(mock_record)
            elif "MERGE" in query:
                # For relationship creation
                return MockNeo4jResult(MockNeo4jRecord({}))
            return mock_result_find
        
        mock_neo4j_session.run.side_effect = run_side_effect
        
        response = client.post("/lectures/ingest", json=sample_lecture_ingest_request)
        
        assert response.status_code == 200
        data = response.json()
        assert "lecture_id" in data
        assert "nodes_created" in data
        assert "nodes_updated" in data
        assert "links_created" in data
        assert "segments" in data  # NEW: segments field should exist
        assert isinstance(data["nodes_created"], list)
        assert isinstance(data["links_created"], list)
        assert isinstance(data["segments"], list)  # NEW: segments should be a list
    
    def test_ingest_lecture_missing_required_fields(self, client):
        """Test ingestion with missing required fields."""
        invalid_payload = {
            "lecture_text": "Some text",
            # Missing "lecture_title"
        }
        
        response = client.post("/lectures/ingest", json=invalid_payload)
        
        assert response.status_code == 422  # Validation error
    
    def test_ingest_lecture_empty_text(self, client):
        """Test ingestion with empty lecture text."""
        invalid_payload = {
            "lecture_title": "Test",
            "lecture_text": "",
        }
        
        response = client.post("/lectures/ingest", json=invalid_payload)
        
        # Should still be accepted by validation, but may fail in LLM call
        assert response.status_code in [200, 400, 500]
    
    def test_ingest_lecture_llm_error(self, client, mock_neo4j_session, sample_lecture_ingest_request, mock_openai_client):
        """Test ingestion when LLM call fails."""
        # Mock OpenAI to raise an error
        mock_openai_client.chat.completions.create.side_effect = ValueError("Invalid API key")
        
        response = client.post("/lectures/ingest", json=sample_lecture_ingest_request)
        
        assert response.status_code == 400
        assert "detail" in response.json()
    
    def test_ingest_lecture_internal_error(self, client, mock_neo4j_session, sample_lecture_ingest_request, mock_openai_client):
        """Test ingestion when internal error occurs."""
        # Mock OpenAI to return invalid JSON
        mock_openai_client.chat.completions.create.return_value.choices[0].message.content = "Invalid JSON response"
        
        response = client.post("/lectures/ingest", json=sample_lecture_ingest_request)
        
        # Should return 500 or 400 depending on error handling
        assert response.status_code in [400, 500]
        assert "detail" in response.json()


class TestCreateLecture:
    """Tests for POST /lectures/"""
    
    def test_create_lecture_success(self, client, mock_neo4j_session, sample_lecture_data, mock_csv_export):
        """Test successfully creating a lecture."""
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
    
    def test_create_lecture_missing_required_fields(self, client):
        """Test creating a lecture with missing required fields."""
        invalid_payload = {
            "description": "Some description",
            # Missing "title"
        }
        
        response = client.post("/lectures/", json=invalid_payload)
        
        assert response.status_code == 422


class TestGetLecture:
    """Tests for GET /lectures/{lecture_id}"""
    
    def test_get_lecture_success(self, client, mock_neo4j_session):
        """Test successfully getting a lecture by ID."""
        mock_record = MockNeo4jRecord({
                "lecture_id": "L123",
                "title": "Test Lecture",
                "description": "A test lecture",
                "primary_concept": None,
                "level": "beginner",
                "estimated_time": 30,
                "slug": None,
        })
        mock_result = MockNeo4jResult(mock_record)
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.get("/lectures/L123")
        
        assert response.status_code == 200
        data = response.json()
        assert data["lecture_id"] == "L123"
        assert data["title"] == "Test Lecture"
    
    def test_get_lecture_not_found(self, client, mock_neo4j_session):
        """Test getting a lecture that doesn't exist."""
        mock_result = MockNeo4jResult(record=None)
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.get("/lectures/LNONEXISTENT")
        
        assert response.status_code == 404


class TestAddLectureStep:
    """Tests for POST /lectures/{lecture_id}/steps"""
    
    def test_add_lecture_step_success(self, client, mock_neo4j_session, mock_csv_export):
        """Test successfully adding a step to a lecture."""
        # Mock: get_lecture_by_id returns a lecture
        def run_side_effect(query, **params):
            if "MATCH (l:Lecture" in query and "MERGE" in query:
                # This is the add_lecture_step query - MERGE returns the full record
                mock_record_step = MockNeo4jRecord({
                    "lecture_id": "L123",
                    "step_order": 1,
                    "node_id": "N001",
                    "name": "Test Concept",
                    "domain": "Testing",
                    "type": "concept",
                    "notes_key": None,
                    "lecture_key": None,
                    "url_slug": None,
                })
                return MockNeo4jResult(mock_record_step)
            elif "MATCH (l:Lecture" in query:
                # This is get_lecture_by_id
                mock_record_lecture = MockNeo4jRecord({
                    "lecture_id": "L123",
                    "title": "Test Lecture",
                })
                return MockNeo4jResult(mock_record_lecture)
            elif "MATCH (c:Concept" in query:
                # Mock: get_concept_by_id returns a concept
                mock_record_concept = MockNeo4jRecord({
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
                return MockNeo4jResult(mock_record_concept)
            return MockNeo4jResult(record=None)
        
        mock_neo4j_session.run.side_effect = run_side_effect
        
        step_data = {
            "concept_id": "N001",
            "step_order": 1,
        }
        response = client.post("/lectures/L123/steps", json=step_data)
        
        assert response.status_code == 200
        data = response.json()
        assert data["lecture_id"] == "L123"
        assert data["step_order"] == 1
    
    def test_add_lecture_step_invalid_concept(self, client, mock_neo4j_session):
        """Test adding a step with a non-existent concept."""
        # Mock: get_lecture_by_id returns a lecture
        def run_side_effect(query, **params):
            if "MATCH (l:Lecture" in query and "MERGE" in query:
                # This is the add_lecture_step query - but concept not found, so return None
                return MockNeo4jResult(record=None)
            elif "MATCH (l:Lecture" in query:
                # This is get_lecture_by_id
                mock_record_lecture = MockNeo4jRecord({
                    "lecture_id": "L123",
                    "title": "Test Lecture",
                })
                return MockNeo4jResult(mock_record_lecture)
            elif "MATCH (c:Concept" in query:
                # Mock: concept not found
                return MockNeo4jResult(record=None)
            return MockNeo4jResult(record=None)
        
        mock_neo4j_session.run.side_effect = run_side_effect
        
        step_data = {
            "concept_id": "NONEXISTENT",
            "step_order": 1,
        }
        response = client.post("/lectures/L123/steps", json=step_data)
        
        assert response.status_code == 400


class TestGetLectureSteps:
    """Tests for GET /lectures/{lecture_id}/steps"""
    
    def test_get_lecture_steps_success(self, client, mock_neo4j_session):
        """Test successfully getting lecture steps."""
        mock_record = MockNeo4jRecord({
            "lecture_id": "L123",
            "step_order": 1,
            "node_id": "N001",
            "name": "Test Concept",
            "domain": "Testing",
            "type": "concept",
            "notes_key": None,
            "lecture_key": None,
            "url_slug": None,
        })
        mock_result = MockNeo4jResult(records=[mock_record])
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.get("/lectures/L123/steps")
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        if len(data) > 0:
            assert data[0]["step_order"] == 1
    
    def test_get_lecture_steps_empty(self, client, mock_neo4j_session):
        """Test getting steps for a lecture with no steps."""
        mock_result = MockNeo4jResult(records=[])
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.get("/lectures/L123/steps")
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 0


class TestDraftNextLecture:
    """Tests for POST /lectures/draft-next"""
    
    def test_draft_next_lecture_success(self, client, mock_neo4j_session, mock_openai_client):
        """Test successfully drafting a follow-up lecture."""
        # Mock teaching style
        mock_style_record = MockNeo4jRecord({
            "id": "default",
            "tone": "intuitive, grounded",
            "teaching_style": "analogy-first",
            "sentence_structure": "short, minimal filler",
            "explanation_order": ["big picture", "core concept"],
            "forbidden_styles": ["overly formal"],
        })
        mock_style_result = MockNeo4jResult(mock_style_record)
        
        # Mock concept lookup
        mock_concept_record = MockNeo4jRecord({
            "node_id": "N001",
            "name": "Testing",
            "domain": "Software Engineering",
            "type": "concept",
            "description": "The process of verifying software",
            "tags": None,
            "notes_key": None,
            "lecture_key": None,
            "url_slug": None,
            "lecture_sources": [],
            "created_by": None,
            "last_updated_by": None,
        })
        mock_concept_result = MockNeo4jResult(mock_concept_record)
        
        # Mock neighbors
        mock_neighbor_record = MockNeo4jRecord({
            "concept": {
                "node_id": "N002",
                "name": "Quality Assurance",
            },
            "predicate": "RELATED_TO",
            "is_outgoing": True,
        })
        mock_neighbor_result = MockNeo4jResult([mock_neighbor_record])
        
        # Configure side effect for different queries
        def run_side_effect(query, **params):
            if "TeachingStyle" in query:
                return mock_style_result
            elif "Concept" in query and "name" in query.lower():
                return mock_concept_result
            elif "neighbors" in query.lower() or "MATCH" in query and "RELATED_TO" in query:
                return mock_neighbor_result
            return MockNeo4jResult(record=None)
        
        mock_neo4j_session.run.side_effect = run_side_effect
        
        # Mock OpenAI response
        mock_openai_client.chat.completions.create.return_value.choices[0].message.content = '''{
            "outline": [
                "1. Recap: What we already know",
                "2. Deep dive into Testing",
                "3. Advanced testing strategies"
            ],
            "sections": [
                {
                    "title": "Recap: What we already know",
                    "summary": "Brief recap of prior concepts"
                },
                {
                    "title": "Deep dive into Testing",
                    "summary": "Detailed exploration of testing concepts"
                }
            ],
            "suggested_analogies": [
                {
                    "label": "Testing as quality check",
                    "description": "Testing is like quality control in manufacturing",
                    "target_concepts": ["Testing"]
                }
            ]
        }'''
        
        payload = {
            "seed_concepts": ["Testing"],
            "target_level": "intermediate",
        }
        
        response = client.post("/lectures/draft-next", json=payload)
        
        assert response.status_code == 200
        data = response.json()
        assert "outline" in data
        assert "sections" in data
        assert "suggested_analogies" in data
        assert isinstance(data["outline"], list)
        assert len(data["outline"]) > 0
        assert isinstance(data["sections"], list)
        assert isinstance(data["suggested_analogies"], list)
    
    def test_draft_next_lecture_missing_concepts(self, client, mock_neo4j_session):
        """Test drafting with missing seed_concepts."""
        payload = {
            "target_level": "intermediate",
        }
        
        response = client.post("/lectures/draft-next", json=payload)
        
        assert response.status_code == 400
        assert "seed_concepts" in response.json()["detail"].lower()
    
    def test_draft_next_lecture_empty_concepts(self, client, mock_neo4j_session):
        """Test drafting with empty seed_concepts list."""
        payload = {
            "seed_concepts": [],
            "target_level": "intermediate",
        }
        
        response = client.post("/lectures/draft-next", json=payload)
        
        assert response.status_code == 400
        assert "seed_concepts" in response.json()["detail"].lower()
    
    def test_draft_next_lecture_with_source(self, client, mock_neo4j_session, mock_openai_client):
        """Test drafting with source_lecture_id."""
        # Mock teaching style
        mock_style_record = MockNeo4jRecord({
            "id": "default",
            "tone": "intuitive",
            "teaching_style": "analogy-first",
            "sentence_structure": "short",
            "explanation_order": ["big picture"],
            "forbidden_styles": [],
        })
        mock_style_result = MockNeo4jResult(mock_style_record)
        
        # Mock lecture lookup
        mock_lecture_record = MockNeo4jRecord({
            "lecture_id": "L123",
            "title": "Intro to Testing",
            "description": "A test lecture",
            "primary_concept": None,
            "level": None,
            "estimated_time": None,
            "slug": None,
        })
        mock_lecture_result = MockNeo4jResult(mock_lecture_record)
        
        # Mock segments
        mock_segment_record = MockNeo4jRecord({
            "summary": "First segment summary",
            "text": "First segment text",
        })
        mock_segment_result = MockNeo4jResult([mock_segment_record])
        
        # Mock concept
        mock_concept_record = MockNeo4jRecord({
            "node_id": "N001",
            "name": "Testing",
            "domain": "Software Engineering",
            "type": "concept",
            "description": "Testing description",
            "tags": None,
            "notes_key": None,
            "lecture_key": None,
            "url_slug": None,
            "lecture_sources": [],
            "created_by": None,
            "last_updated_by": None,
        })
        mock_concept_result = MockNeo4jResult(mock_concept_record)
        
        def run_side_effect(query, **params):
            if "TeachingStyle" in query:
                return mock_style_result
            elif "Lecture" in query and "lecture_id" in query:
                if "HAS_SEGMENT" in query:
                    return mock_segment_result
                return mock_lecture_result
            elif "Concept" in query:
                return mock_concept_result
            return MockNeo4jResult(record=None)
        
        mock_neo4j_session.run.side_effect = run_side_effect
        
        # Mock OpenAI
        mock_openai_client.chat.completions.create.return_value.choices[0].message.content = '''{
            "outline": ["1. Section 1"],
            "sections": [{"title": "Section 1", "summary": "Summary 1"}],
            "suggested_analogies": []
        }'''
        
        payload = {
            "seed_concepts": ["Testing"],
            "source_lecture_id": "L123",
            "target_level": "intermediate",
        }
        
        response = client.post("/lectures/draft-next", json=payload)
        
        assert response.status_code == 200
        data = response.json()
        assert "outline" in data
        assert "sections" in data
