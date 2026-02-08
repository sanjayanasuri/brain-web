"""
Unit tests for contextual branches service layer.

Tests cover:
- Database operations
- Idempotency checks
- Message persistence
- Bridging hints storage

Run with: pytest tests/test_contextual_branches_service.py -v
"""
import pytest
from unittest.mock import Mock, patch, MagicMock
from datetime import datetime
import hashlib
import os

# Set test environment variables
os.environ.setdefault("POSTGRES_CONNECTION_STRING", "postgresql://test:test@localhost:5432/testdb")

from services_contextual_branches import (
    create_branch,
    create_anchor_branch,
    get_branch,
    add_branch_message,
    get_message_branches,
    save_bridging_hints,
    get_branch_by_hash,
)
from models_contextual_branches import BranchCreateRequest, BranchMessageRequest


class TestCreateBranch:
    """Tests for create_branch service function."""
    
    @patch('services_contextual_branches._get_pool')
    @patch('services_contextual_branches.log_event')
    def test_create_branch_success(self, mock_log, mock_pool):
        """Test successful branch creation."""
        # Mock connection pool
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_pool_instance = MagicMock()
        mock_pool_instance.getconn.return_value = mock_conn
        mock_pool_instance.putconn = MagicMock()
        mock_pool.return_value = mock_pool_instance
        
        request = BranchCreateRequest(
            parent_message_id="msg-123",
            start_offset=10,
            end_offset=50,
            selected_text="Selected text"
        )
        
        # Mock cursor execute (no existing branch)
        mock_cursor.fetchone.return_value = None
        
        branch = create_branch(request, "user-123")
        
        assert branch.id.startswith("branch-")
        assert branch.anchor.start_offset == 10
        assert branch.anchor.end_offset == 50
        assert branch.anchor.selected_text == "Selected text"
        assert branch.anchor.parent_message_id == "msg-123"
        
        # Verify database insert was called
        assert mock_cursor.execute.called
    
    @patch('services_contextual_branches._get_pool')
    def test_create_branch_idempotency(self, mock_pool):
        """Test that creating same branch returns existing one."""
        # Mock connection pool
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_pool_instance = MagicMock()
        mock_pool_instance.getconn.return_value = mock_conn
        mock_pool_instance.putconn = MagicMock()
        mock_pool.return_value = mock_pool_instance
        
        request = BranchCreateRequest(
            parent_message_id="msg-123",
            start_offset=10,
            end_offset=50,
            selected_text="Selected text"
        )
        
        text_hash = hashlib.sha256("Selected text".encode('utf-8')).hexdigest()
        
        # Mock existing branch found
        from models_contextual_branches import BranchThread, AnchorSpan
        existing_branch = BranchThread(
            id="branch-existing",
            anchor=AnchorSpan.create(10, 50, "Selected text", "msg-123"),
            messages=[],
            bridging_hints=None,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
            parent_message_id="msg-123"
        )
        
        # Mock get_branch_by_hash to return existing branch
        with patch('services_contextual_branches.get_branch_by_hash') as mock_get_hash:
            mock_get_hash.return_value = existing_branch
            
            branch = create_branch(request, "user-123")
            
            assert branch.id == "branch-existing"
            # Verify new branch was not created
            mock_cursor.execute.assert_not_called()


class TestGetBranch:
    """Tests for get_branch service function."""
    
    @patch('services_contextual_branches._get_pool')
    def test_get_branch_with_messages(self, mock_pool):
        """Test getting branch with all messages."""
        # Mock connection pool
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_pool_instance = MagicMock()
        mock_pool_instance.getconn.return_value = mock_conn
        mock_pool_instance.putconn = MagicMock()
        mock_pool.return_value = mock_pool_instance
        
        # Mock branch row
        from psycopg2.extras import RealDictRow
        branch_row = {
            'id': 'branch-123',
            'parent_message_id': 'msg-123',
            'start_offset': 10,
            'end_offset': 50,
            'selected_text': 'Selected text',
            'selected_text_hash': hashlib.sha256('Selected text'.encode()).hexdigest(),
            'created_at': datetime.utcnow(),
            'updated_at': datetime.utcnow(),
        }
        
        # Mock message rows
        message_rows = [
            {
                'id': 'msg-1',
                'branch_id': 'branch-123',
                'role': 'user',
                'content': 'Question',
                'timestamp': datetime.utcnow(),
                'created_at': datetime.utcnow(),
            },
            {
                'id': 'msg-2',
                'branch_id': 'branch-123',
                'role': 'assistant',
                'content': 'Answer',
                'timestamp': datetime.utcnow(),
                'created_at': datetime.utcnow(),
            },
        ]
        
        mock_cursor.fetchone.side_effect = [branch_row, None]  # Branch, then no more hints
        mock_cursor.fetchall.side_effect = [message_rows, []]  # Messages, then no hints
        
        branch = get_branch('branch-123')
        
        assert branch is not None
        assert branch.id == 'branch-123'
        assert len(branch.messages) == 2
        assert branch.messages[0].role == 'user'
        assert branch.messages[1].role == 'assistant'


class TestCreateAnchorBranch:
    """Tests for create_anchor_branch service function."""

    @patch('services_contextual_branches._ensure_db_initialized')
    @patch('services_contextual_branches.store_parent_message_version')
    @patch('services_contextual_branches.get_branch_by_hash')
    @patch('services_contextual_branches._get_pool')
    @patch('services_contextual_branches.log_event')
    def test_create_anchor_branch_success(
        self,
        mock_log,
        mock_pool,
        mock_get_by_hash,
        mock_store_parent,
        mock_ensure_db,
    ):
        """Test successful anchor branch creation."""
        mock_ensure_db.return_value = None
        mock_store_parent.return_value = 2
        mock_get_by_hash.return_value = None

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_pool_instance = MagicMock()
        mock_pool_instance.getconn.return_value = mock_conn
        mock_pool_instance.putconn = MagicMock()
        mock_pool.return_value = mock_pool_instance

        anchor_ref = {
            "anchor_id": "anchor-abc123",
            "artifact": {"namespace": "neo4j", "type": "concept", "id": "concept-123"},
            "selector": {
                "kind": "bbox",
                "x": 0.1,
                "y": 0.2,
                "w": 0.3,
                "h": 0.4,
                "unit": "pct",
                "image_width": 1000,
                "image_height": 800,
            },
            "preview": "Handwritten selection: Cell cycle",
        }

        branch = create_anchor_branch(
            anchor_ref=anchor_ref,
            snippet_image_data_url="data:image/png;base64,AAA",
            context="Some parent context",
            chat_id="chat-123",
            user_id="user-123",
        )

        assert branch.anchor_kind == "anchor_ref"
        assert branch.anchor_ref == anchor_ref
        assert branch.anchor_snippet_data_url == "data:image/png;base64,AAA"
        assert branch.chat_id == "chat-123"
        assert branch.parent_message_id == "anchor:neo4j:concept:concept-123"
        assert branch.parent_message_version == 2
        assert branch.anchor.selected_text == "Handwritten selection: Cell cycle"
        assert branch.anchor.parent_message_id == "anchor:neo4j:concept:concept-123"

        assert mock_cursor.execute.called

    @patch('services_contextual_branches._ensure_db_initialized')
    @patch('services_contextual_branches.store_parent_message_version')
    @patch('services_contextual_branches.get_branch_by_hash')
    def test_create_anchor_branch_idempotency(self, mock_get_by_hash, mock_store_parent, mock_ensure_db):
        """Test that creating same anchor branch returns existing one."""
        from models_contextual_branches import BranchThread, AnchorSpan

        mock_ensure_db.return_value = None
        mock_store_parent.return_value = 1

        existing_branch = BranchThread(
            id="branch-existing",
            anchor=AnchorSpan.create(0, 1, "Selected region", "anchor:neo4j:concept:concept-123"),
            anchor_kind="anchor_ref",
            anchor_ref={"anchor_id": "anchor-abc123"},
            anchor_snippet_data_url=None,
            messages=[],
            bridging_hints=None,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
            parent_message_id="anchor:neo4j:concept:concept-123",
        )

        mock_get_by_hash.return_value = existing_branch

        anchor_ref = {
            "anchor_id": "anchor-abc123",
            "artifact": {"namespace": "neo4j", "type": "concept", "id": "concept-123"},
            "selector": {"kind": "bbox", "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4, "unit": "pct"},
        }

        branch = create_anchor_branch(
            anchor_ref=anchor_ref,
            snippet_image_data_url=None,
            context=None,
            chat_id=None,
            user_id="user-123",
        )

        assert branch.id == "branch-existing"


class TestAddBranchMessage:
    """Tests for add_branch_message service function."""
    
    @patch('services_contextual_branches._get_pool')
    @patch('services_contextual_branches.log_event')
    def test_add_message_success(self, mock_log, mock_pool):
        """Test successfully adding a message to branch."""
        # Mock connection pool
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_pool_instance = MagicMock()
        mock_pool_instance.getconn.return_value = mock_conn
        mock_pool_instance.putconn = MagicMock()
        mock_pool.return_value = mock_pool_instance
        
        message = add_branch_message('branch-123', 'user', 'Test message', 'user-123')
        
        assert message.id.startswith('msg-')
        assert message.branch_id == 'branch-123'
        assert message.role == 'user'
        assert message.content == 'Test message'
        
        # Verify database insert was called
        assert mock_cursor.execute.called
        # Verify branch updated_at was updated
        assert mock_cursor.execute.call_count >= 2  # Insert message + update branch


class TestGetMessageBranches:
    """Tests for get_message_branches service function."""
    
    @patch('services_contextual_branches._get_pool')
    def test_get_message_branches_multiple(self, mock_pool):
        """Test getting multiple branches for a message."""
        # Mock connection pool
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_pool_instance = MagicMock()
        mock_pool_instance.getconn.return_value = mock_conn
        mock_pool_instance.putconn = MagicMock()
        mock_pool.return_value = mock_pool_instance
        
        # Mock branch rows
        branch_rows = [
            {
                'id': 'branch-1',
                'parent_message_id': 'msg-123',
                'start_offset': 10,
                'end_offset': 30,
                'selected_text': 'Text 1',
                'selected_text_hash': 'hash1',
                'created_at': datetime.utcnow(),
                'updated_at': datetime.utcnow(),
            },
            {
                'id': 'branch-2',
                'parent_message_id': 'msg-123',
                'start_offset': 40,
                'end_offset': 60,
                'selected_text': 'Text 2',
                'selected_text_hash': 'hash2',
                'created_at': datetime.utcnow(),
                'updated_at': datetime.utcnow(),
            },
        ]
        
        mock_cursor.fetchall.return_value = branch_rows
        
        branches = get_message_branches('msg-123')
        
        assert len(branches) == 2
        assert branches[0].id == 'branch-1'
        assert branches[1].id == 'branch-2'


class TestSaveBridgingHints:
    """Tests for save_bridging_hints service function."""
    
    @patch('services_contextual_branches._get_pool')
    @patch('services_contextual_branches.log_event')
    def test_save_hints_success(self, mock_log, mock_pool):
        """Test successfully saving bridging hints."""
        # Mock connection pool
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_pool_instance = MagicMock()
        mock_pool_instance.getconn.return_value = mock_conn
        mock_pool_instance.putconn = MagicMock()
        mock_pool.return_value = mock_pool_instance
        
        hints = [
            {
                'hint_text': 'This concept appears again later.',
                'target_offset': 100,
            },
            {
                'hint_text': 'This is referenced in the conclusion.',
                'target_offset': 200,
            },
        ]
        
        hint_set = save_bridging_hints('branch-123', hints, 'user-123')
        
        assert hint_set.branch_id == 'branch-123'
        assert len(hint_set.hints) == 2
        assert hint_set.hints[0].hint_text == 'This concept appears again later.'
        assert hint_set.hints[1].hint_text == 'This is referenced in the conclusion.'
        
        # Verify database operations
        assert mock_cursor.execute.called
        # Should delete old hints and insert new ones
        assert mock_cursor.execute.call_count >= 3  # DELETE + 2 INSERTs
        
        # Verify logging
        mock_log.assert_called_once_with('hints_generated', {
            'branch_id': 'branch-123',
            'hint_count': 2,
            'user_id': 'user-123',
        })
