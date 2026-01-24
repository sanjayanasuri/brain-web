"""
Integration tests for Contextual Branching with database.

These tests require a test PostgreSQL database.
Set TEST_POSTGRES_CONNECTION_STRING environment variable to use a test DB.

Run with: pytest tests/test_contextual_branches_integration.py -v
"""
import pytest
import os
from datetime import datetime
import hashlib

from services_contextual_branches import (
    create_branch,
    get_branch,
    add_branch_message,
    get_message_branches,
    save_bridging_hints,
)
from models_contextual_branches import BranchCreateRequest


# Skip integration tests if test DB not configured
TEST_DB = os.getenv("TEST_POSTGRES_CONNECTION_STRING")
pytestmark = pytest.mark.skipif(
    not TEST_DB,
    reason="TEST_POSTGRES_CONNECTION_STRING not set - skipping integration tests"
)


@pytest.fixture(autouse=True)
def setup_test_db(monkeypatch):
    """Override connection string for integration tests."""
    if TEST_DB:
        monkeypatch.setenv("POSTGRES_CONNECTION_STRING", TEST_DB)
        # Reinitialize the pool
        from services_contextual_branches import _pool
        global _pool
        _pool = None


class TestBranchCreationIntegration:
    """Integration tests for branch creation with real database."""
    
    def test_create_and_retrieve_branch(self):
        """Test creating a branch and retrieving it from database."""
        request = BranchCreateRequest(
            parent_message_id="msg-integration-123",
            start_offset=10,
            end_offset=50,
            selected_text="Integration test selected text"
        )
        
        # Create branch
        branch = create_branch(request, "test-user")
        
        assert branch.id is not None
        assert branch.anchor.start_offset == 10
        assert branch.anchor.end_offset == 50
        
        # Retrieve branch
        retrieved = get_branch(branch.id)
        
        assert retrieved is not None
        assert retrieved.id == branch.id
        assert retrieved.anchor.selected_text == "Integration test selected text"
    
    def test_idempotency_integration(self):
        """Test that creating same branch twice returns existing one."""
        request = BranchCreateRequest(
            parent_message_id="msg-integration-456",
            start_offset=0,
            end_offset=20,
            selected_text="Same text"
        )
        
        # Create first branch
        branch1 = create_branch(request, "test-user")
        
        # Create second branch with same text
        branch2 = create_branch(request, "test-user")
        
        # Should return same branch (idempotency)
        assert branch1.id == branch2.id


class TestBranchMessagesIntegration:
    """Integration tests for branch messages."""
    
    def test_add_and_retrieve_messages(self):
        """Test adding messages to branch and retrieving them."""
        # Create branch first
        request = BranchCreateRequest(
            parent_message_id="msg-integration-789",
            start_offset=0,
            end_offset=30,
            selected_text="Message test text"
        )
        branch = create_branch(request, "test-user")
        
        # Add user message
        user_msg = add_branch_message(branch.id, "user", "Test question", "test-user")
        
        # Add assistant message
        assistant_msg = add_branch_message(branch.id, "assistant", "Test answer", "test-user")
        
        # Retrieve branch with messages
        retrieved = get_branch(branch.id)
        
        assert len(retrieved.messages) == 2
        assert retrieved.messages[0].role == "user"
        assert retrieved.messages[1].role == "assistant"


class TestBridgingHintsIntegration:
    """Integration tests for bridging hints."""
    
    def test_save_and_retrieve_hints(self):
        """Test saving and retrieving bridging hints."""
        # Create branch
        request = BranchCreateRequest(
            parent_message_id="msg-integration-hints",
            start_offset=0,
            end_offset=25,
            selected_text="Hints test text"
        )
        branch = create_branch(request, "test-user")
        
        # Save hints
        hints = [
            {
                "hint_text": "This concept is used again later.",
                "target_offset": 100,
            },
            {
                "hint_text": "See the conclusion section.",
                "target_offset": 200,
            },
        ]
        
        hint_set = save_bridging_hints(branch.id, hints, "test-user")
        
        assert len(hint_set.hints) == 2
        
        # Retrieve branch and verify hints
        retrieved = get_branch(branch.id)
        assert retrieved.bridging_hints is not None
        assert len(retrieved.bridging_hints.hints) == 2


class TestMultipleBranchesIntegration:
    """Integration tests for multiple branches per message."""
    
    def test_multiple_branches_per_message(self):
        """Test that multiple branches can exist for same message."""
        parent_id = "msg-integration-multi"
        
        # Create first branch
        request1 = BranchCreateRequest(
            parent_message_id=parent_id,
            start_offset=0,
            end_offset=20,
            selected_text="First selection"
        )
        branch1 = create_branch(request1, "test-user")
        
        # Create second branch
        request2 = BranchCreateRequest(
            parent_message_id=parent_id,
            start_offset=30,
            end_offset=50,
            selected_text="Second selection"
        )
        branch2 = create_branch(request2, "test-user")
        
        # Get all branches for message
        branches = get_message_branches(parent_id)
        
        assert len(branches) >= 2
        branch_ids = [b.id for b in branches]
        assert branch1.id in branch_ids
        assert branch2.id in branch_ids
