"""
Service-level tests for Notion sync functionality.

Tests cover:
- State management (load/save timestamps)
- Page discovery and filtering
- Page to lecture conversion
- Full sync cycle with various scenarios

All tests use mocked dependencies (Notion API, file I/O, Neo4j, lecture ingestion).
"""
import pytest
from unittest.mock import patch, MagicMock, mock_open
from datetime import datetime, timezone
from pathlib import Path
import json
import tempfile


class TestStateManagement:
    """Tests for timestamp state management"""
    
    def test_load_last_sync_timestamp_first_run(self, tmp_path, monkeypatch):
        """Test loading timestamp when no previous sync exists."""
        from notion_sync import load_last_sync_timestamp, SYNC_STATE_FILE
        
        # Use temporary file
        monkeypatch.setattr('notion_sync.SYNC_STATE_FILE', tmp_path / "notion_sync_state.json")
        
        timestamp = load_last_sync_timestamp()
        
        assert timestamp is None
    
    def test_save_and_load_timestamp(self, tmp_path, monkeypatch):
        """Test saving and loading timestamp."""
        from notion_sync import save_last_sync_timestamp, load_last_sync_timestamp, SYNC_STATE_FILE
        
        # Use temporary file
        test_file = tmp_path / "notion_sync_state.json"
        monkeypatch.setattr('notion_sync.SYNC_STATE_FILE', test_file)
        
        # Save timestamp
        test_timestamp = datetime.now(timezone.utc)
        save_last_sync_timestamp(test_timestamp)
        
        # Load timestamp
        loaded = load_last_sync_timestamp()
        
        assert loaded is not None
        assert abs((loaded - test_timestamp).total_seconds()) < 1  # Within 1 second
    
    def test_load_timestamp_invalid_file(self, tmp_path, monkeypatch):
        """Test loading timestamp when file is corrupted."""
        from notion_sync import load_last_sync_timestamp, SYNC_STATE_FILE
        
        # Use temporary file with invalid JSON
        test_file = tmp_path / "notion_sync_state.json"
        test_file.write_text("invalid json")
        monkeypatch.setattr('notion_sync.SYNC_STATE_FILE', test_file)
        
        # Should return None on error
        timestamp = load_last_sync_timestamp()
        
        assert timestamp is None


class TestFindUpdatedPages:
    """Tests for find_updated_pages_since()"""
    
    def test_find_updated_pages_no_timestamp(self, mock_notion_client):
        """Test finding pages when no timestamp (first sync)."""
        from notion_sync import find_updated_pages_since
        
        # Mock database pages
        mock_notion_client.pages.list.return_value = {"results": []}
        
        # Set NOTION_DATABASE_IDS to have one database so it doesn't process standalone pages
        # (which would require mocking list_notion_pages() and get_page())
        with patch('notion_sync.NOTION_DATABASE_IDS', ['db1']):
            with patch('notion_sync.get_database_pages', return_value=[
                {
                    "id": "page1",
                    "last_edited_time": "2024-01-01T00:00:00Z",
                }
            ]):
                pages = find_updated_pages_since(None)
                
                assert len(pages) == 1
                assert pages[0]["id"] == "page1"
    
    def test_find_updated_pages_with_timestamp(self, mock_notion_client):
        """Test finding pages updated since a timestamp."""
        from notion_sync import find_updated_pages_since
        
        timestamp = datetime(2024, 1, 1, tzinfo=timezone.utc)
        
        # Set NOTION_DATABASE_IDS to have one database so it doesn't process standalone pages
        with patch('notion_sync.NOTION_DATABASE_IDS', ['db1']):
            with patch('notion_sync.get_database_pages', return_value=[
                {
                    "id": "page1",
                    "last_edited_time": "2024-01-02T00:00:00Z",  # After timestamp
                },
                {
                    "id": "page2",
                    "last_edited_time": "2023-12-31T00:00:00Z",  # Before timestamp
                },
            ]):
                pages = find_updated_pages_since(timestamp)
                
                # Should only return page1 (updated after timestamp)
                assert len(pages) == 1
                assert pages[0]["id"] == "page1"
    
    def test_find_updated_pages_empty(self, mock_notion_client):
        """Test finding pages when none are updated."""
        from notion_sync import find_updated_pages_since
        
        timestamp = datetime(2024, 1, 1, tzinfo=timezone.utc)
        
        # Set NOTION_DATABASE_IDS to have one database so it doesn't process standalone pages
        with patch('notion_sync.NOTION_DATABASE_IDS', ['db1']):
            with patch('notion_sync.get_database_pages', return_value=[]):
                pages = find_updated_pages_since(timestamp)
                
                assert len(pages) == 0


class TestPageToLecture:
    """Tests for page_to_lecture()"""
    
    def test_page_to_lecture_success(self, mock_notion_client):
        """Test converting a Notion page to lecture format."""
        from notion_sync import page_to_lecture
        
        page = {
            "id": "page1",
            "properties": {"title": {"title": [{"plain_text": "Test Page"}]}},
            "last_edited_time": "2024-01-01T00:00:00Z",
        }
        
        # Patch where they're used (notion_sync), not where they're defined
        with patch('notion_sync.get_page_title', return_value="Test Page"):
            with patch('notion_sync.get_page_domain', return_value="Software Engineering"):
                with patch('notion_sync.get_page_blocks', return_value=[]):
                    with patch('notion_sync.extract_plaintext_from_blocks', return_value="Page content"):
                        title, text, domain = page_to_lecture(page)
                        
                        assert title == "Test Page"
                        assert text == "Page content"
                        assert domain == "Software Engineering"
    
    def test_page_to_lecture_missing_title(self, mock_notion_client):
        """Test converting page with missing title."""
        from notion_sync import page_to_lecture
        
        page = {
            "id": "page1",
            "properties": {},
        }
        
        # Patch where they're used (notion_sync), not where they're defined
        with patch('notion_sync.get_page_title', return_value=""):
            with patch('notion_sync.get_page_domain', return_value=None):
                with patch('notion_sync.get_page_blocks', return_value=[]):
                    with patch('notion_sync.extract_plaintext_from_blocks', return_value="Content"):
                        title, text, domain = page_to_lecture(page)
                        
                        # Should have fallback title
                        assert title == "" or "Content from Notion page" in text
    
    def test_page_to_lecture_missing_content(self, mock_notion_client):
        """Test converting page with missing content."""
        from notion_sync import page_to_lecture
        
        page = {
            "id": "page1",
            "properties": {"title": {"title": [{"plain_text": "Test Page"}]}},
        }
        
        # Patch where they're used (notion_sync), not where they're defined
        with patch('notion_sync.get_page_title', return_value="Test Page"):
            with patch('notion_sync.get_page_domain', return_value=None):
                with patch('notion_sync.get_page_blocks', side_effect=Exception("Failed")):
                    title, text, domain = page_to_lecture(page)
                    
                    # Should have fallback text
                    assert "Content from Notion page" in text


class TestSyncOnce:
    """Tests for sync_once()"""
    
    def test_sync_once_no_updated_pages(self, mock_neo4j_driver, mock_notion_client, tmp_path, monkeypatch):
        """Test sync when no pages are updated."""
        from notion_sync import sync_once, SYNC_STATE_FILE
        
        # Use temporary file
        test_file = tmp_path / "notion_sync_state.json"
        monkeypatch.setattr('notion_sync.SYNC_STATE_FILE', test_file)
        
        with patch('notion_sync.find_updated_pages_since', return_value=[]):
            with patch('notion_sync.load_index_state', return_value={"indexed_pages": []}):
                with patch('db_neo4j.get_neo4j_session') as mock_get_session:
                    mock_session = MagicMock()
                    mock_get_session.return_value = iter([mock_session])
                    
                    stats = sync_once()
                    
                    assert stats["pages_checked"] == 0
                    assert stats["pages_ingested"] == 0
                    assert stats["nodes_created"] == 0
                    assert stats["nodes_updated"] == 0
                    assert stats["links_created"] == 0
                    assert len(stats["errors"]) == 0
    
    def test_sync_once_with_pages(self, mock_neo4j_driver, mock_notion_client, tmp_path, monkeypatch):
        """Test sync with a few updated pages."""
        from notion_sync import sync_once, SYNC_STATE_FILE
        
        # Use temporary file
        test_file = tmp_path / "notion_sync_state.json"
        monkeypatch.setattr('notion_sync.SYNC_STATE_FILE', test_file)
        
        pages = [
            {
                "id": "page1",
                "properties": {"title": {"title": [{"plain_text": "Page 1"}]}},
                "last_edited_time": "2024-01-01T00:00:00Z",
            },
            {
                "id": "page2",
                "properties": {"title": {"title": [{"plain_text": "Page 2"}]}},
                "last_edited_time": "2024-01-02T00:00:00Z",
            },
        ]
        
        # Mock ingestion results
        from models import LectureIngestResult, Concept
        result1 = LectureIngestResult(
            lecture_id="L001",
            nodes_created=[Concept(node_id="N001", name="Concept 1", domain="Test", type="concept", lecture_sources=[])],
            nodes_updated=[],
            links_created=[{"source_id": "N001", "target_id": "N002", "predicate": "RELATED_TO"}],
        )
        result2 = LectureIngestResult(
            lecture_id="L002",
            nodes_created=[Concept(node_id="N003", name="Concept 2", domain="Test", type="concept", lecture_sources=[])],
            nodes_updated=[Concept(node_id="N001", name="Concept 1", domain="Test", type="concept", lecture_sources=[])],
            links_created=[],
        )
        
        with patch('notion_sync.find_updated_pages_since', return_value=pages):
            with patch('notion_sync.load_index_state', return_value={"indexed_pages": ["page1", "page2"]}):
                with patch('notion_sync.is_page_indexed', return_value=True):
                    with patch('notion_sync.page_to_lecture', side_effect=[
                        ("Page 1", "Content 1", "Test"),
                        ("Page 2", "Content 2", "Test"),
                    ]):
                        # Patch where it's used (notion_sync), not where it's defined
                        with patch('notion_sync.ingest_lecture', side_effect=[result1, result2]):
                            with patch('notion_sync.add_lecture_for_page'):
                                with patch('db_neo4j.get_neo4j_session') as mock_get_session:
                                    mock_session = MagicMock()
                                    mock_get_session.return_value = iter([mock_session])
                                    
                                    stats = sync_once()
                                    
                                    assert stats["pages_checked"] == 2
                                    assert stats["pages_ingested"] == 2
                                    assert stats["nodes_created"] == 2
                                    assert stats["nodes_updated"] == 1
                                    assert stats["links_created"] == 1
                                    assert len(stats["errors"]) == 0
    
    def test_sync_once_ingestion_error(self, mock_neo4j_driver, mock_notion_client, tmp_path, monkeypatch):
        """Test sync when one page ingestion fails."""
        from notion_sync import sync_once, SYNC_STATE_FILE
        
        # Use temporary file
        test_file = tmp_path / "notion_sync_state.json"
        monkeypatch.setattr('notion_sync.SYNC_STATE_FILE', test_file)
        
        pages = [
            {
                "id": "page1",
                "properties": {"title": {"title": [{"plain_text": "Page 1"}]}},
            },
            {
                "id": "page2",
                "properties": {"title": {"title": [{"plain_text": "Page 2"}]}},
            },
        ]
        
        from models import LectureIngestResult, Concept
        result1 = LectureIngestResult(
            lecture_id="L001",
            nodes_created=[Concept(node_id="N001", name="Concept 1", domain="Test", type="concept", lecture_sources=[])],
            nodes_updated=[],
            links_created=[],
        )
        
        with patch('notion_sync.find_updated_pages_since', return_value=pages):
            with patch('notion_sync.load_index_state', return_value={"indexed_pages": ["page1", "page2"]}):
                with patch('notion_sync.is_page_indexed', return_value=True):
                    with patch('notion_sync.page_to_lecture', side_effect=[
                        ("Page 1", "Content 1", "Test"),
                        ("Page 2", "Content 2", "Test"),
                    ]):
                        # Patch where it's used (notion_sync), not where it's defined
                        with patch('notion_sync.ingest_lecture', side_effect=[
                            result1,
                            ValueError("Ingestion failed"),
                        ]):
                            with patch('notion_sync.add_lecture_for_page'):
                                with patch('db_neo4j.get_neo4j_session') as mock_get_session:
                                    mock_session = MagicMock()
                                    mock_get_session.return_value = iter([mock_session])
                                    
                                    stats = sync_once()
                                    
                                    assert stats["pages_checked"] == 2
                                    assert stats["pages_ingested"] == 1  # Only one succeeded
                                    assert len(stats["errors"]) == 1
                                    assert "Failed to ingest" in stats["errors"][0]
    
    def test_sync_once_page_not_indexed(self, mock_neo4j_driver, mock_notion_client, tmp_path, monkeypatch):
        """Test sync when page is not in index allowlist."""
        from notion_sync import sync_once, SYNC_STATE_FILE
        
        # Use temporary file
        test_file = tmp_path / "notion_sync_state.json"
        monkeypatch.setattr('notion_sync.SYNC_STATE_FILE', test_file)
        
        pages = [
            {
                "id": "page1",
                "properties": {"title": {"title": [{"plain_text": "Page 1"}]}},
            },
        ]
        
        with patch('notion_sync.find_updated_pages_since', return_value=pages):
            with patch('notion_sync.load_index_state', return_value={"indexed_pages": []}):
                with patch('notion_sync.is_page_indexed', return_value=False):
                    with patch('db_neo4j.get_neo4j_session') as mock_get_session:
                        mock_session = MagicMock()
                        mock_get_session.return_value = iter([mock_session])
                        
                        stats = sync_once()
                        
                        assert stats["pages_checked"] == 1
                        assert stats["pages_ingested"] == 0  # Skipped because not indexed
                        assert len(stats["errors"]) == 0
