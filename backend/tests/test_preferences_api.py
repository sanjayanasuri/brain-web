"""
Comprehensive tests for the Preferences API endpoints.

Tests cover:
- Response style profile (GET/POST)
- Focus areas (list, create, toggle active)
- User profile (GET/POST)
- Tutor profile (GET/POST/PATCH)
- Notion configuration (GET/POST)

All tests use mocked Neo4j sessions via the mock_neo4j_session fixture.
"""
import pytest  # type: ignore[reportMissingImports]
from tests.mock_helpers import MockNeo4jRecord, MockNeo4jResult
from models import ResponseStyleProfile, ResponseStyleProfileWrapper, FocusArea, UserProfile, NotionConfig
from models_tutor_profile import TutorProfile


class TestResponseStyle:
    """Tests for GET/POST /preferences/response-style"""
    
    def test_get_response_style_success(self, client, mock_neo4j_session):
        """Test successfully getting response style profile."""
        value_str = '{"tone": "intuitive", "teaching_style": "analogy-first", "sentence_structure": "short", "explanation_order": ["big picture"], "forbidden_styles": ["formal"]}'
        mock_record = MockNeo4jRecord({"value": value_str})
        mock_result = MockNeo4jResult(mock_record)
        mock_neo4j_session.run.return_value = mock_result
            
        response = client.get("/preferences/response-style")
            
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert "profile" in data
        assert "tone" in data["profile"]
        assert "teaching_style" in data["profile"]
    
    def test_get_response_style_default(self, client, mock_neo4j_session):
        """Test getting response style when none exists (returns default)."""
            # MERGE creates default if not exists
        value_str = '{"tone": "intuitive, grounded, exploratory, conversational but technical", "teaching_style": "analogy-first, zoom-out then zoom-in, highlight big picture first", "sentence_structure": "short, minimal filler, no dramatic flourishes", "explanation_order": ["big picture", "core concept definition", "example/analogy", "connection to adjacent concepts", "common pitfalls", "summary"], "forbidden_styles": ["overly formal", "glib", "generic", "high-level nothingness", "GPT-polish"]}'
        mock_record = MockNeo4jRecord({"value": value_str})
        mock_result = MockNeo4jResult(mock_record)
        mock_neo4j_session.run.return_value = mock_result
            
        response = client.get("/preferences/response-style")
        
        assert response.status_code == 200
        data = response.json()
        assert "profile" in data
    
    def test_update_response_style_success(self, client, mock_neo4j_session):
        """Test successfully updating response style profile."""
        value_str = '{"tone": "updated tone", "teaching_style": "updated style", "sentence_structure": "short", "explanation_order": ["big picture"], "forbidden_styles": []}'
        mock_record = MockNeo4jRecord({"value": value_str})
        mock_result = MockNeo4jResult(mock_record)
        mock_neo4j_session.run.return_value = mock_result
            
        payload = {
            "id": "default",
            "profile": {
                "tone": "updated tone",
                "teaching_style": "updated style",
                "sentence_structure": "short",
                "explanation_order": ["big picture"],
                "forbidden_styles": [],
            }
        }
        response = client.post("/preferences/response-style", json=payload)
        
        assert response.status_code == 200
        data = response.json()
        assert data["profile"]["tone"] == "updated tone"


class TestFocusAreas:
    """Tests for GET/POST /preferences/focus-areas"""
    
    def test_list_focus_areas_success(self, client, mock_neo4j_session):
        """Test successfully listing focus areas."""
        f_data1 = {
            "id": "fa1",
            "name": "Distributed Systems",
            "description": "Learning distributed systems",
            "active": True,
        }
        f_data2 = {
            "id": "fa2",
            "name": "Web Development",
            "description": "Learning web dev",
            "active": False,
        }
        mock_record1 = MockNeo4jRecord({"f": f_data1})
        mock_record2 = MockNeo4jRecord({"f": f_data2})
        mock_result = MockNeo4jResult(records=[mock_record1, mock_record2])
        mock_neo4j_session.run.return_value = mock_result
            
        response = client.get("/preferences/focus-areas")
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 2
        assert data[0]["name"] == "Distributed Systems"
    
    def test_list_focus_areas_empty(self, client, mock_neo4j_session):
        """Test listing focus areas when none exist."""
        mock_result = MockNeo4jResult(records=[])
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.get("/preferences/focus-areas")
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 0
    
    def test_create_focus_area_success(self, client, mock_neo4j_session):
        """Test successfully creating a focus area."""
        f_data = {
            "id": "fa1",
            "name": "New Focus Area",
            "description": "Description",
            "active": True,
        }
        mock_record = MockNeo4jRecord({"f": f_data})
        mock_result = MockNeo4jResult(mock_record)
        mock_neo4j_session.run.return_value = mock_result
        
        payload = {
            "id": "fa1",
            "name": "New Focus Area",
            "description": "Description",
            "active": True,
        }
        response = client.post("/preferences/focus-areas", json=payload)
        
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == "fa1"
        assert data["name"] == "New Focus Area"
    
    def test_toggle_focus_area_active(self, client, mock_neo4j_session):
        """Test toggling focus area active status."""
        f_data = {
            "id": "fa1",
            "name": "Focus Area",
            "description": None,
            "active": False,  # Toggled to False
        }
        mock_record = MockNeo4jRecord({"f": f_data})
        mock_result = MockNeo4jResult(mock_record)
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.post("/preferences/focus-areas/fa1/active?active=false")
        
        assert response.status_code == 200
        data = response.json()
        assert data["active"] is False
    
    def test_toggle_focus_area_not_found(self, client, mock_neo4j_session):
        """Test toggling focus area that doesn't exist."""
        mock_result = MockNeo4jResult(record=None)
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.post("/preferences/focus-areas/nonexistent/active?active=true")
        
        assert response.status_code == 500  # ValueError raised, caught by error handler


class TestUserProfile:
    """Tests for GET/POST /preferences/user-profile"""
    
    def test_get_user_profile_success(self, client, mock_neo4j_session):
        """Test successfully getting user profile."""
        u_data = {
            "id": "guest",
            "name": "Sanjay",
            "background": ["CS", "Software Engineering"],
            "interests": ["Distributed Systems"],
            "weak_spots": ["Networking"],
            "learning_preferences": '{"preferred_format": "analogies"}',
        }
        mock_record = MockNeo4jRecord({"u": u_data})
        mock_result = MockNeo4jResult(mock_record)
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.get("/preferences/user-profile")
        
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == "guest"
        assert data["name"] == "Sanjay"
        assert isinstance(data["background"], list)
        assert isinstance(data["interests"], list)
    
    def test_get_user_profile_default(self, client, mock_neo4j_session):
        """Test getting user profile when none exists (returns default)."""
        # MERGE creates default if not exists
        u_data = {
            "id": "guest",
            "name": "Sanjay",
            "background": [],
            "interests": [],
            "weak_spots": [],
            "learning_preferences": "{}",
        }
        mock_record = MockNeo4jRecord({"u": u_data})
        mock_result = MockNeo4jResult(mock_record)
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.get("/preferences/user-profile")
        
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Sanjay"
    
    def test_update_user_profile_success(self, client, mock_neo4j_session):
        """Test successfully updating user profile."""
        u_data = {
            "id": "guest",
            "name": "Updated Name",
            "background": ["Updated Background"],
            "interests": ["Updated Interest"],
            "weak_spots": [],
            "learning_preferences": "{}",
        }
        mock_record = MockNeo4jRecord({"u": u_data})
        mock_result = MockNeo4jResult(mock_record)
        mock_neo4j_session.run.return_value = mock_result
        
        payload = {
            "id": "guest",
            "name": "Updated Name",
            "background": ["Updated Background"],
            "interests": ["Updated Interest"],
            "weak_spots": [],
            "learning_preferences": {},
        }
        response = client.post("/preferences/user-profile", json=payload)
        
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated Name"
        assert data["background"] == ["Updated Background"]


class TestTutorProfile:
    """Tests for GET/POST/PATCH /preferences/tutor-profile"""

    def test_get_tutor_profile_default(self, client, mock_neo4j_session):
        """Returns a default TutorProfile when missing in learning_preferences."""
        u_data = {
            "id": "guest",
            "name": "Sanjay",
            "background": [],
            "interests": [],
            "weak_spots": [],
            "learning_preferences": "{}",
        }
        mock_record = MockNeo4jRecord({"u": u_data})
        mock_neo4j_session.run.return_value = MockNeo4jResult(mock_record)

        response = client.get("/preferences/tutor-profile")

        assert response.status_code == 200
        data = response.json()
        assert data["version"] == "tutor_profile_v1"
        assert data["audience_mode"] == "default"
        assert data["response_mode"] == "compact"

    def test_set_tutor_profile_success(self, client, mock_neo4j_session):
        """Persists TutorProfile under learning_preferences.tutor_profile."""
        # patch_user_profile() -> get_user_profile() then update_user_profile()
        u_before = {
            "id": "guest",
            "name": "Sanjay",
            "background": [],
            "interests": [],
            "weak_spots": [],
            "learning_preferences": "{}",
        }
        u_after = {
            "id": "guest",
            "name": "Sanjay",
            "background": [],
            "interests": [],
            "weak_spots": [],
            "learning_preferences": '{"tutor_profile":{"version":"tutor_profile_v1","audience_mode":"eli5","response_mode":"compact","ask_question_policy":"at_most_one","end_with_next_step":true,"pacing":"normal","turn_taking":"normal","no_glazing":true,"voice_id":"friendly"}}',
        }
        mock_neo4j_session.run.side_effect = [
            MockNeo4jResult(MockNeo4jRecord({"u": u_before})),
            MockNeo4jResult(MockNeo4jRecord({"u": u_after})),
        ]

        payload = TutorProfile(audience_mode="eli5", voice_id="friendly").model_dump()
        response = client.post("/preferences/tutor-profile", json=payload)

        assert response.status_code == 200
        data = response.json()
        assert data["audience_mode"] == "eli5"
        assert data["voice_id"] == "friendly"

    def test_patch_tutor_profile_success(self, client, mock_neo4j_session):
        """Patches a subset of TutorProfile fields."""
        # patch_tutor_profile() -> get_user_profile()
        # then set_tutor_profile() -> patch_user_profile() -> get_user_profile() -> update_user_profile()
        u_with_profile = {
            "id": "guest",
            "name": "Sanjay",
            "background": [],
            "interests": [],
            "weak_spots": [],
            "learning_preferences": '{"tutor_profile":{"version":"tutor_profile_v1","audience_mode":"default","response_mode":"compact","ask_question_policy":"at_most_one","end_with_next_step":true,"pacing":"normal","turn_taking":"normal","no_glazing":true,"voice_id":"neutral"}}',
        }
        u_updated = {
            "id": "guest",
            "name": "Sanjay",
            "background": [],
            "interests": [],
            "weak_spots": [],
            "learning_preferences": '{"tutor_profile":{"version":"tutor_profile_v1","audience_mode":"ceo_pitch","response_mode":"compact","ask_question_policy":"at_most_one","end_with_next_step":true,"pacing":"normal","turn_taking":"normal","no_glazing":true,"voice_id":"direct"}}',
        }
        mock_neo4j_session.run.side_effect = [
            MockNeo4jResult(MockNeo4jRecord({"u": u_with_profile})),  # initial get
            MockNeo4jResult(MockNeo4jRecord({"u": u_with_profile})),  # patch_user_profile get
            MockNeo4jResult(MockNeo4jRecord({"u": u_updated})),       # update
        ]

        response = client.patch(
            "/preferences/tutor-profile",
            json={"audience_mode": "ceo_pitch", "voice_id": "direct"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["audience_mode"] == "ceo_pitch"
        assert data["voice_id"] == "direct"


class TestNotionConfig:
    """Tests for GET/POST /admin/notion-config"""
    
    def test_get_notion_config_success(self, client, mock_neo4j_session):
        """Test successfully getting Notion config."""
        value_str = '{"database_ids": ["db1", "db2"], "enable_auto_sync": true}'
        mock_record = MockNeo4jRecord({"value": value_str})
        mock_result = MockNeo4jResult(mock_record)
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.get("/admin/notion-config")
        
        assert response.status_code == 200
        data = response.json()
        assert "database_ids" in data
        assert "enable_auto_sync" in data
        assert data["database_ids"] == ["db1", "db2"]
        assert data["enable_auto_sync"] is True
    
    def test_get_notion_config_default(self, client, mock_neo4j_session):
        """Test getting Notion config when none exists (returns default)."""
        # MERGE creates default if not exists
        value_str = '{"database_ids": [], "enable_auto_sync": false}'
        mock_record = MockNeo4jRecord({"value": value_str})
        mock_result = MockNeo4jResult(mock_record)
        mock_neo4j_session.run.return_value = mock_result
        
        response = client.get("/admin/notion-config")
        
        assert response.status_code == 200
        data = response.json()
        assert data["database_ids"] == []
        assert data["enable_auto_sync"] is False
    
    def test_update_notion_config_success(self, client, mock_neo4j_session):
        """Test successfully updating Notion config."""
        value_str = '{"database_ids": ["db1"], "enable_auto_sync": false}'
        mock_record = MockNeo4jRecord({"value": value_str})
        mock_result = MockNeo4jResult(mock_record)
        mock_neo4j_session.run.return_value = mock_result
        
        payload = {
            "database_ids": ["db1"],
            "enable_auto_sync": False,
        }
        response = client.post("/admin/notion-config", json=payload)
        
        assert response.status_code == 200
        data = response.json()
        assert data["database_ids"] == ["db1"]
        assert data["enable_auto_sync"] is False
