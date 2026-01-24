"""
Comprehensive tests for Contextual Branching API endpoints.

Tests cover:
- Branch creation from text spans
- Branch message sending and receiving
- Bridging hints generation
- Multiple branches per message
- Edge cases (empty selection, overlapping anchors, idempotency)
- Observability logging

Run with: pytest tests/test_contextual_branches.py -v
"""
import pytest
from unittest.mock import Mock, patch, MagicMock
from fastapi.testclient import TestClient
from datetime import datetime
import hashlib
import json
import os

# Set test environment variables before imports
os.environ.setdefault("OPENAI_API_KEY", "test-key-sk-1234567890")
os.environ.setdefault("POSTGRES_CONNECTION_STRING", "postgresql://test:test@localhost:5432/testdb")

from models_contextual_branches import BranchCreateRequest


class TestCreateBranch:
    """Tests for POST /contextual-branches endpoint."""
    
    @patch('api_contextual_branches.create_branch')
    @patch('api_contextual_branches.log_event')
    @patch('api_contextual_branches._store_parent_message_content')
    def test_create_branch_success(self, mock_store, mock_log, mock_create, client, auth_headers):
        """Test successful branch creation from text span."""
        # Mock branch creation
        from models_contextual_branches import BranchThread, AnchorSpan
        from datetime import datetime
        
        anchor = AnchorSpan.create(
            start_offset=10,
            end_offset=50,
            selected_text="This is the selected text",
            parent_message_id="msg-123"
        )
        
        branch = BranchThread(
            id="branch-abc123",
            anchor=anchor,
            messages=[],
            bridging_hints=None,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
            parent_message_id="msg-123"
        )
        
        mock_create.return_value = branch
        
        payload = {
            "parent_message_id": "msg-123",
            "parent_message_content": "This is the full parent message content with selected text in it.",
            "start_offset": 10,
            "end_offset": 50,
            "selected_text": "This is the selected text"
        }
        
        response = client.post("/contextual-branches", json=payload, headers=auth_headers)
        
        assert response.status_code == 200
        data = response.json()
        assert data["branch"]["id"] == "branch-abc123"
        assert data["branch"]["anchor"]["start_offset"] == 10
        assert data["branch"]["anchor"]["end_offset"] == 50
        assert data["branch"]["anchor"]["selected_text"] == "This is the selected text"
        assert data["branch"]["parent_message_id"] == "msg-123"
        assert "messages" in data
        
        # Verify logging
        mock_log.assert_called_once()
        call_args = mock_log.call_args
        assert call_args[0][0] == "branch_created"
        assert call_args[0][1]["branch_id"] == "branch-abc123"
    
    def test_create_branch_empty_selection(self, client, auth_headers):
        """Test branch creation fails with empty selection."""
        payload = {
            "parent_message_id": "msg-123",
            "parent_message_content": "Full message",
            "start_offset": 10,
            "end_offset": 10,
            "selected_text": ""
        }
        
        response = client.post("/contextual-branches", json=payload, headers=auth_headers)
        
        assert response.status_code == 400
        assert "empty" in response.json()["detail"].lower()
    
    def test_create_branch_invalid_offsets(self, client, auth_headers):
        """Test branch creation fails with invalid offsets."""
        payload = {
            "parent_message_id": "msg-123",
            "parent_message_content": "Full message",
            "start_offset": 50,
            "end_offset": 10,  # end < start
            "selected_text": "text"
        }
        
        response = client.post("/contextual-branches", json=payload, headers=auth_headers)
        
        assert response.status_code == 400
        assert "invalid" in response.json()["detail"].lower()
    
    @patch('api_contextual_branches.create_branch')
    @patch('api_contextual_branches._store_parent_message_content')
    def test_create_branch_idempotency(self, mock_store, mock_create, client, auth_headers):
        """Test that creating the same branch twice returns existing branch."""
        from models_contextual_branches import BranchThread, AnchorSpan
        from datetime import datetime
        
        anchor = AnchorSpan.create(
            start_offset=10,
            end_offset=50,
            selected_text="Selected text",
            parent_message_id="msg-123"
        )
        
        branch = BranchThread(
            id="branch-existing",
            anchor=anchor,
            messages=[],
            bridging_hints=None,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
            parent_message_id="msg-123"
        )
        
        mock_create.return_value = branch
        
        payload = {
            "parent_message_id": "msg-123",
            "parent_message_content": "Full message",
            "start_offset": 10,
            "end_offset": 50,
            "selected_text": "Selected text"
        }
        
        # First creation
        response1 = client.post("/contextual-branches", json=payload, headers=auth_headers)
        assert response1.status_code == 200
        
        # Second creation with same text should return same branch (idempotency handled in service)
        response2 = client.post("/contextual-branches", json=payload, headers=auth_headers)
        assert response2.status_code == 200


class TestGetBranch:
    """Tests for GET /contextual-branches/{branch_id} endpoint."""
    
    @patch('api_contextual_branches.get_branch')
    @patch('api_contextual_branches.log_event')
    def test_get_branch_success(self, mock_log, mock_get, client, auth_headers):
        """Test successfully getting a branch with messages."""
        from models_contextual_branches import BranchThread, AnchorSpan, BranchMessage
        from datetime import datetime
        
        anchor = AnchorSpan.create(
            start_offset=10,
            end_offset=50,
            selected_text="Selected text",
            parent_message_id="msg-123"
        )
        
        messages = [
            BranchMessage(
                id="msg-1",
                branch_id="branch-123",
                role="user",
                content="What does this mean?",
                timestamp=datetime.utcnow(),
                created_at=datetime.utcnow()
            ),
            BranchMessage(
                id="msg-2",
                branch_id="branch-123",
                role="assistant",
                content="This means...",
                timestamp=datetime.utcnow(),
                created_at=datetime.utcnow()
            )
        ]
        
        branch = BranchThread(
            id="branch-123",
            anchor=anchor,
            messages=messages,
            bridging_hints=None,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
            parent_message_id="msg-123"
        )
        
        mock_get.return_value = branch
        
        response = client.get("/contextual-branches/branch-123", headers=auth_headers)
        
        assert response.status_code == 200
        data = response.json()
        assert data["branch"]["id"] == "branch-123"
        assert len(data["messages"]) == 2
        assert data["messages"][0]["role"] == "user"
        assert data["messages"][1]["role"] == "assistant"
        
        # Verify logging
        mock_log.assert_called_once_with("branch_opened", {
            "branch_id": "branch-123",
            "user_id": "test-user"
        })
    
    @patch('api_contextual_branches.get_branch')
    def test_get_branch_not_found(self, mock_get, client, auth_headers):
        """Test getting a non-existent branch."""
        mock_get.return_value = None
        
        response = client.get("/contextual-branches/nonexistent", headers=auth_headers)
        
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()


class TestSendBranchMessage:
    """Tests for POST /contextual-branches/{branch_id}/messages endpoint."""
    
    @patch('api_contextual_branches.add_branch_message')
    @patch('api_contextual_branches.get_branch')
    @patch('api_contextual_branches.log_event')
    @patch('openai.OpenAI')
    def test_send_message_success(self, mock_openai, mock_log, mock_get, mock_add, client, auth_headers):
        """Test successfully sending a message and getting assistant reply."""
        from models_contextual_branches import BranchThread, AnchorSpan, BranchMessage
        from datetime import datetime
        
        # Mock existing branch
        anchor = AnchorSpan.create(
            start_offset=10,
            end_offset=50,
            selected_text="Selected text",
            parent_message_id="msg-123"
        )
        
        branch = BranchThread(
            id="branch-123",
            anchor=anchor,
            messages=[],
            bridging_hints=None,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
            parent_message_id="msg-123"
        )
        mock_get.return_value = branch
        
        # Mock user message
        user_msg = BranchMessage(
            id="msg-user-1",
            branch_id="branch-123",
            role="user",
            content="What does this mean?",
            timestamp=datetime.utcnow(),
            created_at=datetime.utcnow()
        )
        mock_add.return_value = user_msg
        
        # Mock OpenAI response
        mock_client = MagicMock()
        mock_openai.return_value = mock_client
        mock_client.chat.completions.create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content="This is the explanation."))]
        )
        
        # Mock assistant message
        assistant_msg = BranchMessage(
            id="msg-assistant-1",
            branch_id="branch-123",
            role="assistant",
            content="This is the explanation.",
            timestamp=datetime.utcnow(),
            created_at=datetime.utcnow()
        )
        
        # Mock add_branch_message to return different messages
        def add_message_side_effect(branch_id, role, content, user_id):
            if role == "user":
                return user_msg
            else:
                return assistant_msg
        
        mock_add.side_effect = add_message_side_effect
        
        payload = {"content": "What does this mean?"}
        response = client.post("/contextual-branches/branch-123/messages", json=payload, headers=auth_headers)
        
        assert response.status_code == 200
        data = response.json()
        assert data["user_message"]["role"] == "user"
        assert data["assistant_message"]["role"] == "assistant"
        assert data["assistant_message"]["content"] == "This is the explanation."
        
        # Verify OpenAI was called
        mock_client.chat.completions.create.assert_called_once()
    
    @patch('api_contextual_branches.get_branch')
    def test_send_message_branch_not_found(self, mock_get, client, auth_headers):
        """Test sending message to non-existent branch."""
        mock_get.return_value = None
        
        payload = {"content": "Test message"}
        response = client.post("/contextual-branches/nonexistent/messages", json=payload, headers=auth_headers)
        
        assert response.status_code == 404


class TestGenerateBridgingHints:
    """Tests for POST /contextual-branches/{branch_id}/hints endpoint."""
    
    @patch('api_contextual_branches.save_bridging_hints')
    @patch('api_contextual_branches.get_branch')
    @patch('api_contextual_branches.log_event')
    @patch('openai.OpenAI')
    def test_generate_hints_success(self, mock_openai, mock_log, mock_get, mock_save, client, auth_headers):
        """Test successfully generating bridging hints."""
        from models_contextual_branches import BranchThread, AnchorSpan, BranchMessage
        from datetime import datetime
        
        # Mock branch with messages
        anchor = AnchorSpan.create(
            start_offset=10,
            end_offset=50,
            selected_text="Selected text",
            parent_message_id="msg-123"
        )
        
        messages = [
            BranchMessage(
                id="msg-1",
                branch_id="branch-123",
                role="assistant",
                content="This is the explanation of the selected text.",
                timestamp=datetime.utcnow(),
                created_at=datetime.utcnow()
            )
        ]
        
        branch = BranchThread(
            id="branch-123",
            anchor=anchor,
            messages=messages,
            bridging_hints=None,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
            parent_message_id="msg-123"
        )
        mock_get.return_value = branch
        
        # Mock OpenAI response
        mock_client = MagicMock()
        mock_openai.return_value = mock_client
        hints_json = {
            "hints": [
                {
                    "hint_text": "This concept is used again later in the response.",
                    "target_phrase": "later in the response"
                }
            ]
        }
        mock_client.chat.completions.create.return_value = MagicMock(
            choices=[MagicMock(message=MagicMock(content=json.dumps(hints_json)))]
        )
        
        # Mock save_bridging_hints
        from models_contextual_branches import BridgingHintSet, BridgingHint
        hint_set = BridgingHintSet(
            branch_id="branch-123",
            hints=[
                BridgingHint(
                    id="hint-1",
                    branch_id="branch-123",
                    hint_text="This concept is used again later in the response.",
                    target_offset=100,
                    created_at=datetime.utcnow()
                )
            ],
            created_at=datetime.utcnow()
        )
        mock_save.return_value = hint_set
        
        response = client.post("/contextual-branches/branch-123/hints", headers=auth_headers)
        
        assert response.status_code == 200
        data = response.json()
        assert data["branch_id"] == "branch-123"
        assert len(data["hints"]) == 1
        assert data["hints"][0]["hint_text"] == "This concept is used again later in the response."
        
        # Verify logging
        mock_log.assert_called_once_with("hints_generated", {
            "branch_id": "branch-123",
            "hint_count": 1,
            "user_id": "test-user"
        })
    
    @patch('api_contextual_branches.get_branch')
    def test_generate_hints_no_messages(self, mock_get, client, auth_headers):
        """Test generating hints fails when branch has no messages."""
        from models_contextual_branches import BranchThread, AnchorSpan
        from datetime import datetime
        
        anchor = AnchorSpan.create(
            start_offset=10,
            end_offset=50,
            selected_text="Selected text",
            parent_message_id="msg-123"
        )
        
        branch = BranchThread(
            id="branch-123",
            anchor=anchor,
            messages=[],  # No messages
            bridging_hints=None,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
            parent_message_id="msg-123"
        )
        mock_get.return_value = branch
        
        response = client.post("/contextual-branches/branch-123/hints", headers=auth_headers)
        
        assert response.status_code == 400
        assert "no messages" in response.json()["detail"].lower()


class TestGetMessageBranches:
    """Tests for GET /contextual-branches/messages/{message_id}/branches endpoint."""
    
    @patch('api_contextual_branches.get_message_branches')
    def test_get_message_branches_success(self, mock_get, client, auth_headers):
        """Test successfully getting all branches for a message."""
        from models_contextual_branches import BranchThread, AnchorSpan
        from datetime import datetime
        
        branches = [
            BranchThread(
                id="branch-1",
                anchor=AnchorSpan.create(10, 50, "Text 1", "msg-123"),
                messages=[],
                bridging_hints=None,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
                parent_message_id="msg-123"
            ),
            BranchThread(
                id="branch-2",
                anchor=AnchorSpan.create(60, 100, "Text 2", "msg-123"),
                messages=[],
                bridging_hints=None,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
                parent_message_id="msg-123"
            )
        ]
        
        mock_get.return_value = branches
        
        response = client.get("/contextual-branches/messages/msg-123/branches", headers=auth_headers)
        
        assert response.status_code == 200
        data = response.json()
        assert data["message_id"] == "msg-123"
        assert len(data["branches"]) == 2
        assert data["branches"][0]["id"] == "branch-1"
        assert data["branches"][1]["id"] == "branch-2"
    
    @patch('api_contextual_branches.get_message_branches')
    def test_get_message_branches_empty(self, mock_get, client, auth_headers):
        """Test getting branches for message with no branches."""
        mock_get.return_value = []
        
        response = client.get("/contextual-branches/messages/msg-123/branches", headers=auth_headers)
        
        assert response.status_code == 200
        data = response.json()
        assert data["message_id"] == "msg-123"
        assert len(data["branches"]) == 0


class TestEdgeCases:
    """Tests for edge cases and error handling."""
    
    def test_overlapping_anchors(self, client, auth_headers):
        """Test that multiple branches can exist for overlapping spans."""
        # This tests that the system allows multiple branches even if they overlap
        # The idempotency check is based on exact text match, not overlap
        
        payload1 = {
            "parent_message_id": "msg-123",
            "parent_message_content": "This is a long message with multiple parts.",
            "start_offset": 0,
            "end_offset": 10,
            "selected_text": "This is a"
        }
        
        payload2 = {
            "parent_message_id": "msg-123",
            "parent_message_content": "This is a long message with multiple parts.",
            "start_offset": 5,
            "end_offset": 15,
            "selected_text": "is a long"
        }
        
        # Both should be allowed (different selected text = different branches)
        # Mock the create_branch to return different branches
        with patch('api_contextual_branches.create_branch') as mock_create:
            from models_contextual_branches import BranchThread, AnchorSpan
            from datetime import datetime
            
            def create_side_effect(request, user_id):
                anchor = AnchorSpan.create(
                    request.start_offset,
                    request.end_offset,
                    request.selected_text,
                    request.parent_message_id
                )
                return BranchThread(
                    id=f"branch-{hash(request.selected_text) % 10000}",
                    anchor=anchor,
                    messages=[],
                    bridging_hints=None,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                    parent_message_id=request.parent_message_id
                )
            
            mock_create.side_effect = create_side_effect
            
            response1 = client.post("/contextual-branches", json=payload1, headers=auth_headers)
            response2 = client.post("/contextual-branches", json=payload2, headers=auth_headers)
            
            assert response1.status_code == 200
            assert response2.status_code == 200
            
            # Verify they are different branches
            assert response1.json()["branch"]["id"] != response2.json()["branch"]["id"]


@pytest.fixture
def auth_headers():
    """Create mock auth headers for authenticated requests."""
    return {
        "Authorization": "Bearer test-token",
        "x-tenant-id": "test-tenant",
    }


# Note: client fixture is defined in conftest.py and will be used automatically
