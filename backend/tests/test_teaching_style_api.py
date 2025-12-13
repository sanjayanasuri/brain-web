"""
Tests for the Teaching Style Profile API endpoints.

Tests cover:
- GET /teaching-style: Get current teaching style profile
- POST /teaching-style: Update teaching style profile
- POST /teaching-style/recompute: Recompute style from recent lectures
"""
import pytest
from tests.mock_helpers import MockNeo4jRecord, MockNeo4jResult
from models import TeachingStyleProfile, TeachingStyleUpdateRequest


class TestGetTeachingStyle:
    """Tests for GET /teaching-style"""
    
    def test_get_teaching_style_success(self, client, mock_neo4j_session):
        """Test successfully getting teaching style profile."""
        mock_record = MockNeo4jRecord({
            "id": "default",
            "tone": "intuitive, grounded",
            "teaching_style": "analogy-first",
            "sentence_structure": "short, minimal filler",
            "explanation_order": ["big picture", "core concept"],
            "forbidden_styles": ["overly formal", "verbose"],
        })
        mock_result = MockNeo4jResult(mock_record)
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.get("/teaching-style")
        
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == "default"
        assert data["tone"] == "intuitive, grounded"
        assert data["teaching_style"] == "analogy-first"
        assert isinstance(data["explanation_order"], list)
        assert isinstance(data["forbidden_styles"], list)
    
    def test_get_teaching_style_default(self, client, mock_neo4j_session):
        """Test getting teaching style when none exists (creates default)."""
        # First call returns None (no record), second call returns default
        mock_result_empty = MockNeo4jResult(records=[])
        mock_record_default = MockNeo4jRecord({
            "id": "default",
            "tone": "intuitive, grounded, exploratory, technical but conversational",
            "teaching_style": "analogy-first, zoom-out then zoom-in, highlight big picture, emphasize real-world pattern recognition",
            "sentence_structure": "short, minimal filler, avoid dramatic language",
            "explanation_order": ["big picture", "core concept definition", "example or analogy", "connection to adjacent concepts", "common pitfalls", "summary"],
            "forbidden_styles": ["overly formal", "generic GPT-like filler", "glib positivity", "verbose academic tone"],
        })
        mock_result_default = MockNeo4jResult(mock_record_default)
        
        # First query (get) returns empty, second query (create) returns default
        mock_neo4j_session.run.side_effect = [mock_result_empty, mock_result_default]
        
        response = client.get("/teaching-style")
        
        assert response.status_code == 200
        data = response.json()
        assert "tone" in data
        assert "teaching_style" in data


class TestUpdateTeachingStyle:
    """Tests for POST /teaching-style"""
    
    def test_update_teaching_style_success(self, client, mock_neo4j_session):
        """Test successfully updating teaching style profile."""
        # Mock: first get returns existing, then update returns updated
        mock_record_existing = MockNeo4jRecord({
            "id": "default",
            "tone": "intuitive, grounded",
            "teaching_style": "analogy-first",
            "sentence_structure": "short",
            "explanation_order": ["big picture"],
            "forbidden_styles": ["formal"],
        })
        mock_result_existing = MockNeo4jResult(mock_record_existing)
        
        mock_record_updated = MockNeo4jRecord({
            "id": "default",
            "tone": "updated tone",
            "teaching_style": "analogy-first",
            "sentence_structure": "short",
            "explanation_order": ["big picture"],
            "forbidden_styles": ["formal"],
        })
        mock_result_updated = MockNeo4jResult(mock_record_updated)
        
        mock_neo4j_session.run.side_effect = [mock_result_existing, mock_result_updated]
        
        payload = {
            "tone": "updated tone",
        }
        response = client.post("/teaching-style", json=payload)
        
        assert response.status_code == 200
        data = response.json()
        assert data["tone"] == "updated tone"
        assert data["teaching_style"] == "analogy-first"  # Unchanged


class TestRecomputeTeachingStyle:
    """Tests for POST /teaching-style/recompute"""
    
    def test_recompute_teaching_style_success(self, client, mock_neo4j_session):
        """Test successfully recomputing teaching style from lectures."""
        # This test is simplified - in reality, recompute would:
        # 1. Fetch recent lectures
        # 2. Extract style from each (LLM calls)
        # 3. Aggregate and persist
        
        # Mock: get existing style, then return updated style
        mock_record_existing = MockNeo4jRecord({
            "id": "default",
            "tone": "intuitive",
            "teaching_style": "analogy-first",
            "sentence_structure": "short",
            "explanation_order": ["big picture"],
            "forbidden_styles": ["formal"],
        })
        mock_result_existing = MockNeo4jResult(mock_record_existing)
        
        # Mock lecture query (returns empty for simplicity)
        mock_result_lectures = MockNeo4jResult(records=[])
        
        # Mock updated style
        mock_record_updated = MockNeo4jRecord({
            "id": "default",
            "tone": "recomputed tone",
            "teaching_style": "recomputed style",
            "sentence_structure": "short",
            "explanation_order": ["big picture", "core concept"],
            "forbidden_styles": ["formal", "verbose"],
        })
        mock_result_updated = MockNeo4jResult(mock_record_updated)
        
        # Sequence: get existing, query lectures (empty), update with recomputed
        mock_neo4j_session.run.side_effect = [
            mock_result_existing,  # get_teaching_style
            mock_result_lectures,  # get_recent_lectures_with_segments
            mock_result_updated,  # update_teaching_style
        ]
        
        response = client.post("/teaching-style/recompute?limit=5")
        
        # Should succeed even if no lectures found (returns existing style)
        assert response.status_code == 200
        data = response.json()
        assert "tone" in data
        assert "teaching_style" in data
