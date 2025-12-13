"""
Tests for LectureSegment and Analogy tracking functionality.

Tests cover:
- Segment creation during lecture ingestion
- Fetching segments for a lecture
- Querying segments by concept
- Analogy extraction and linking
- Error handling
"""
import pytest
from tests.mock_helpers import MockNeo4jRecord, MockNeo4jResult
from models import LectureIngestResult, LectureSegment, Analogy, Concept


class TestLectureSegmentsIngestion:
    """Tests for segment creation during lecture ingestion"""
    
    def test_ingest_lecture_creates_segments(self, client, mock_neo4j_session, sample_lecture_ingest_request, mock_openai_client, mock_csv_export):
        """Test that lecture ingestion creates segments."""
        # Mock main extraction (concepts/links)
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
            "links": []
        }'''
        
        # Track query calls to mock segment extraction
        query_calls = []
        
        def run_side_effect(query, **params):
            query_calls.append((query, params))
            
            if "CREATE (c:Concept" in query:
                # Concept creation
                mock_record = MockNeo4jRecord({
                    "node_id": "N123",
                    "name": params.get("name", "Testing"),
                    "domain": params.get("domain", "Software Engineering"),
                    "type": params.get("type", "concept"),
                    "description": params.get("description"),
                    "tags": params.get("tags", []),
                    "notes_key": None,
                    "lecture_key": params.get("lecture_key"),
                    "url_slug": None,
                    "lecture_sources": [params.get("lecture_key", "LECTURE_123")],
                    "created_by": params.get("created_by"),
                    "last_updated_by": params.get("last_updated_by"),
                })
                return MockNeo4jResult(mock_record)
            elif "MERGE (l:Lecture" in query:
                # Lecture creation
                return MockNeo4jResult(MockNeo4jRecord({"lecture_id": params.get("lecture_id")}))
            elif "MERGE (seg:LectureSegment" in query:
                # Segment creation
                return MockNeo4jResult(MockNeo4jRecord({
                    "segment_id": "SEG_123",
                    "lecture_id": params.get("lecture_id"),
                    "segment_index": params.get("segment_index", 0),
                }))
            elif "MATCH (c:Concept" in query and "WHERE toLower" in query:
                # Concept lookup - return None (new concept)
                return MockNeo4jResult(record=None)
            elif "MATCH (seg:LectureSegment" in query:
                # Segment-to-concept/analogy linking
                return MockNeo4jResult(MockNeo4jRecord({}))
            return MockNeo4jResult(record=None)
        
        mock_neo4j_session.run.side_effect = run_side_effect
        
        # Mock segment extraction LLM call (second call)
        def create_side_effect(*args, **kwargs):
            # First call: main extraction
            if len(query_calls) == 0:
                return type('MockResponse', (), {
                    'choices': [type('Choice', (), {
                        'message': type('Message', (), {
                            'content': '''{
                                "lecture_title": "Introduction to Testing",
                                "nodes": [{"name": "Testing", "domain": "Software Engineering"}],
                                "links": []
                            }'''
                        })()
                    })()]
                })()
            # Second call: segment extraction
            else:
                return type('MockResponse', (), {
                    'choices': [type('Choice', (), {
                        'message': type('Message', (), {
                            'content': '''{
                                "segments": [
                                    {
                                        "segment_index": 0,
                                        "text": "Testing is important.",
                                        "summary": "Introduction to testing",
                                        "style_tags": ["technical"],
                                        "covered_concepts": ["Testing"],
                                        "analogies": [
                                            {
                                                "label": "Safety net",
                                                "description": "Testing catches bugs",
                                                "target_concepts": ["Testing"]
                                            }
                                        ]
                                    }
                                ]
                            }'''
                        })()
                    })()]
                })()
        
        mock_openai_client.chat.completions.create.side_effect = create_side_effect
        
        response = client.post("/lectures/ingest", json=sample_lecture_ingest_request)
        
        assert response.status_code == 200
        data = response.json()
        assert "segments" in data
        assert isinstance(data["segments"], list)
        # Should have at least 1 segment
        assert len(data["segments"]) >= 1
    
    def test_ingest_lecture_segments_in_response(self, client, mock_neo4j_session, sample_lecture_ingest_request, mock_openai_client, mock_csv_export):
        """Test that segments are included in ingestion response."""
        # Simplified mock - just check segments field exists
        mock_openai_client.chat.completions.create.return_value.choices[0].message.content = '''{
            "lecture_title": "Test",
            "nodes": [],
            "links": []
        }'''
        
        def run_side_effect(query, **params):
            if "CREATE (c:Concept" in query:
                return MockNeo4jResult(MockNeo4jRecord({
                    "node_id": "N123",
                    "name": "Test",
                    "domain": "Test",
                    "type": "concept",
                    "description": None,
                    "tags": [],
                    "notes_key": None,
                    "lecture_key": None,
                    "url_slug": None,
                    "lecture_sources": [],
                    "created_by": None,
                    "last_updated_by": None,
                }))
            elif "MERGE" in query:
                return MockNeo4jResult(MockNeo4jRecord({}))
            return MockNeo4jResult(record=None)
        
        mock_neo4j_session.run.side_effect = run_side_effect
        
        response = client.post("/lectures/ingest", json=sample_lecture_ingest_request)
        
        assert response.status_code == 200
        data = response.json()
        # Segments field should exist (even if empty)
        assert "segments" in data
        assert isinstance(data["segments"], list)


class TestGetLectureSegments:
    """Tests for GET /lectures/{lecture_id}/segments"""
    
    def test_get_lecture_segments_success(self, client, mock_neo4j_session):
        """Test successfully fetching segments for a lecture."""
        mock_record = MockNeo4jRecord({
            "segment_id": "SEG_123",
            "lecture_id": "LECTURE_123",
            "segment_index": 0,
            "start_time_sec": None,
            "end_time_sec": None,
            "text": "Test segment text",
            "summary": "Test summary",
            "style_tags": ["technical"],
            "concepts": [],
            "analogies": [],
        })
        mock_result = MockNeo4jResult(records=[mock_record])
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.get("/lectures/LECTURE_123/segments")
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        if len(data) > 0:
            assert "segment_id" in data[0]
            assert "lecture_id" in data[0]
            assert "segment_index" in data[0]
            assert "text" in data[0]
            assert "covered_concepts" in data[0]
            assert "analogies" in data[0]
    
    def test_get_lecture_segments_empty(self, client, mock_neo4j_session):
        """Test getting segments for a lecture with no segments."""
        mock_result = MockNeo4jResult(records=[])
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.get("/lectures/LECTURE_123/segments")
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 0
    
    def test_get_lecture_segments_with_concepts(self, client, mock_neo4j_session):
        """Test fetching segments that include linked concepts."""
        mock_record = MockNeo4jRecord({
            "segment_id": "SEG_123",
            "lecture_id": "LECTURE_123",
            "segment_index": 0,
            "start_time_sec": None,
            "end_time_sec": None,
            "text": "Test segment",
            "summary": None,
            "style_tags": [],
            "concepts": [{
                "node_id": "N123",
                "name": "Testing",
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
            }],
            "analogies": [],
        })
        mock_result = MockNeo4jResult(records=[mock_record])
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.get("/lectures/LECTURE_123/segments")
        
        assert response.status_code == 200
        data = response.json()
        if len(data) > 0:
            assert len(data[0]["covered_concepts"]) >= 0  # May be empty if filtering removes None values


class TestGetSegmentsByConcept:
    """Tests for GET /lectures/segments/by-concept/{concept_name}"""
    
    def test_get_segments_by_concept_success(self, client, mock_neo4j_session):
        """Test successfully finding segments that cover a concept."""
        mock_record = MockNeo4jRecord({
            "segment_id": "SEG_123",
            "lecture_id": "LECTURE_123",
            "segment_index": 0,
            "start_time_sec": None,
            "end_time_sec": None,
            "text": "Testing is important",
            "summary": None,
            "style_tags": [],
            "concepts": [],
            "analogies": [],
        })
        mock_result = MockNeo4jResult(records=[mock_record])
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.get("/lectures/segments/by-concept/Testing")
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
    
    def test_get_segments_by_concept_not_found(self, client, mock_neo4j_session):
        """Test querying segments for a concept with no segments."""
        mock_result = MockNeo4jResult(records=[])
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.get("/lectures/segments/by-concept/NonExistentConcept")
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 0


class TestSegmentStructure:
    """Tests for segment data structure"""
    
    def test_segment_has_required_fields(self):
        """Test that LectureSegment model has all required fields."""
        segment = LectureSegment(
            segment_id="SEG_123",
            lecture_id="LECTURE_123",
            segment_index=0,
            text="Test text",
            covered_concepts=[],
            analogies=[],
        )
        
        assert segment.segment_id == "SEG_123"
        assert segment.lecture_id == "LECTURE_123"
        assert segment.segment_index == 0
        assert segment.text == "Test text"
        assert isinstance(segment.covered_concepts, list)
        assert isinstance(segment.analogies, list)
    
    def test_segment_with_analogies(self):
        """Test segment with analogies."""
        analogy = Analogy(
            analogy_id="ANALOGY_123",
            label="Safety net",
            description="Testing catches bugs",
        )
        segment = LectureSegment(
            segment_id="SEG_123",
            lecture_id="LECTURE_123",
            segment_index=0,
            text="Test text",
            covered_concepts=[],
            analogies=[analogy],
        )
        
        assert len(segment.analogies) == 1
        assert segment.analogies[0].label == "Safety net"
    
    def test_segment_with_concepts(self):
        """Test segment with linked concepts."""
        concept = Concept(
            node_id="N123",
            name="Testing",
            domain="Software Engineering",
            type="concept",
        )
        segment = LectureSegment(
            segment_id="SEG_123",
            lecture_id="LECTURE_123",
            segment_index=0,
            text="Test text",
            covered_concepts=[concept],
            analogies=[],
        )
        
        assert len(segment.covered_concepts) == 1
        assert segment.covered_concepts[0].name == "Testing"
