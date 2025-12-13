"""
Comprehensive tests for the Admin API endpoints.

Tests cover:
- CSV import/export operations
- Notion sync (manual trigger)
- Notion page management
- Notion configuration
- Error handling

All tests use mocked dependencies (file I/O, Notion API, Neo4j).
"""
import pytest
from unittest.mock import patch
from tests.mock_helpers import MockNeo4jRecord, MockNeo4jResult


class TestAdminImport:
    """Tests for POST /admin/import"""
    
    def test_admin_import_success(self, client, mock_csv_import):
        """Test successful CSV import."""
        response = client.post("/admin/import")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["action"] == "import"
        mock_csv_import.assert_called_once()
    
    def test_admin_import_error(self, client):
        """Test CSV import when it fails."""
        with patch('scripts.import_csv_to_neo4j.main', side_effect=Exception("Import failed")):
            response = client.post("/admin/import")
            
            assert response.status_code == 500
            assert "detail" in response.json()


class TestAdminExport:
    """Tests for POST /admin/export"""
    
    def test_admin_export_success(self, client, mock_csv_export):
        """Test successful CSV export."""
        response = client.post("/admin/export")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["action"] == "export"
    
    def test_admin_export_error(self, client):
        """Test CSV export when it fails."""
        with patch('scripts.export_csv_from_neo4j.main', side_effect=Exception("Export failed")):
            response = client.post("/admin/export")
            
            assert response.status_code == 500
            assert "detail" in response.json()


class TestAdminSyncNotion:
    """Tests for POST /admin/sync-notion"""
    
    def test_sync_notion_success(self, client, mock_neo4j_driver, mock_notion_client):
        """Test successful Notion sync."""
        # Mock sync_once to return stats
        # IMPORTANT: Patch where it's used (api_admin.sync_once), not where it's defined
        mock_stats = {
            "pages_checked": 5,
            "pages_ingested": 3,
            "nodes_created": 10,
            "nodes_updated": 2,
            "links_created": 8,
            "errors": [],
        }
        
        with patch('api_admin.sync_once', return_value=mock_stats):
            response = client.post("/admin/sync-notion")
            
            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "ok"
            assert data["action"] == "sync-notion"
            assert data["pages_checked"] == 5
            assert data["pages_ingested"] == 3
            assert data["nodes_created"] == 10
            assert data["nodes_updated"] == 2
            assert data["links_created"] == 8
            assert data["errors"] == []
    
    def test_sync_notion_with_errors(self, client, mock_neo4j_driver, mock_notion_client):
        """Test Notion sync with some errors."""
        mock_stats = {
            "pages_checked": 5,
            "pages_ingested": 2,
            "nodes_created": 5,
            "nodes_updated": 1,
            "links_created": 3,
            "errors": ["Failed to ingest page abc123: Invalid content"],
        }
        
        with patch('api_admin.sync_once', return_value=mock_stats):
            response = client.post("/admin/sync-notion")
            
            assert response.status_code == 200
            data = response.json()
            assert len(data["errors"]) == 1
            assert "Failed to ingest" in data["errors"][0]
    
    def test_sync_notion_error(self, client):
        """Test Notion sync when it fails completely."""
        with patch('api_admin.sync_once', side_effect=Exception("Sync failed")):
            response = client.post("/admin/sync-notion")
            
            assert response.status_code == 500
            assert "detail" in response.json()
            assert "sync" in response.json()["detail"].lower()


class TestAdminNotionPages:
    """Tests for GET /admin/notion/pages"""
    
    def test_list_notion_pages_success(self, client, mock_notion_client):
        """Test successfully listing Notion pages.
        
        This test verifies the actual endpoint logic:
        1. Loads index state
        2. Processes configured databases (NOTION_DATABASE_IDS)
        3. Gets pages from each database
        4. Extracts title and checks indexing status for each page
        5. Returns properly formatted response
        """
        # Mock index state
        mock_index_state = {"indexed_pages": ["page1", "page2"]}
        
        # Mock pages from database - matches real Notion API structure
        mock_db_pages = [
            {
                "id": "page1",
                "properties": {"title": {"title": [{"plain_text": "Page 1"}]}},
                "last_edited_time": "2024-01-01T00:00:00Z",
            }
        ]
        
        # Patch all functions where they're used in api_admin
        # Set NOTION_DATABASE_IDS to have one database to test the configured databases path
        with patch('api_admin.NOTION_DATABASE_IDS', ['db1']):
            with patch('api_admin.load_index_state', return_value=mock_index_state):
                with patch('api_admin.is_page_indexed', return_value=True):
                    with patch('api_admin.get_database_pages', return_value=mock_db_pages):
                        with patch('api_admin.get_page_title', return_value="Page 1"):
                            response = client.get("/admin/notion/pages")
                            
                            assert response.status_code == 200
                            data = response.json()
                            assert isinstance(data, list)
                            assert len(data) == 1
                            
                            # Verify the response structure matches what the endpoint actually builds
                            page = data[0]
                            assert page["page_id"] == "page1"
                            assert page["title"] == "Page 1"
                            assert page["last_edited_time"] == "2024-01-01T00:00:00Z"
                            assert page["database_id"] == "db1"
                            assert page["database_name"] is None  # No title in our mock
                            assert page["indexed"] is True
    
    def test_list_notion_pages_auto_discovery(self, client, mock_notion_client):
        """Test listing Notion pages with auto-discovery (when NOTION_DATABASE_IDS is empty).
        
        This tests the alternative code path where databases are auto-discovered.
        """
        mock_index_state = {"indexed_pages": []}
        mock_databases = [{"id": "auto-db1", "title": "Auto Database"}]
        mock_db_pages = [
            {
                "id": "auto-page1",
                "properties": {"title": {"title": [{"plain_text": "Auto Page"}]}},
                "last_edited_time": "2024-01-02T00:00:00Z",
            }
        ]
        
        # Test auto-discovery path (NOTION_DATABASE_IDS is empty)
        with patch('api_admin.NOTION_DATABASE_IDS', []):
            with patch('api_admin.load_index_state', return_value=mock_index_state):
                with patch('api_admin.is_page_indexed', return_value=False):
                    with patch('api_admin.list_notion_databases', return_value=mock_databases):
                        with patch('api_admin.get_database_pages', return_value=mock_db_pages):
                            with patch('api_admin.get_page_title', return_value="Auto Page"):
                                with patch('api_admin.list_notion_pages', return_value=[]):  # No standalone pages
                                    response = client.get("/admin/notion/pages")
                                    
                                    assert response.status_code == 200
                                    data = response.json()
                                    assert isinstance(data, list)
                                    assert len(data) == 1
                                    assert data[0]["page_id"] == "auto-page1"
                                    assert data[0]["database_id"] == "auto-db1"
    
    def test_list_notion_pages_error(self, client, mock_notion_client):
        """Test listing Notion pages when it fails."""
        with patch('api_admin.load_index_state', side_effect=Exception("Failed")):
            response = client.get("/admin/notion/pages")
            
            assert response.status_code == 500
            assert "detail" in response.json()


class TestAdminNotionPageIndex:
    """Tests for POST /admin/notion/pages/index"""
    
    def test_toggle_page_indexing_success(self, client):
        """Test successfully toggling page indexing."""
        mock_state = {"indexed_pages": []}
        
        with patch('notion_index_state.set_page_indexed', return_value=mock_state):
            with patch('notion_index_state.is_page_indexed', return_value=True):
                payload = {
                    "page_id": "test-page-id",
                    "include": True,
                }
                response = client.post("/admin/notion/pages/index", json=payload)
                
                assert response.status_code == 200
                data = response.json()
                assert data["status"] == "ok"
                assert data["page_id"] == "test-page-id"
                assert data["include"] is True
                assert data["indexed"] is True
    
    def test_toggle_page_indexing_error(self, client):
        """Test toggling page indexing when it fails."""
        # Patch where it's used (api_admin.set_page_indexed), not where it's defined
        with patch('api_admin.set_page_indexed', side_effect=Exception("Failed")):
            payload = {
                "page_id": "test-page-id",
                "include": True,
            }
            response = client.post("/admin/notion/pages/index", json=payload)
            
            assert response.status_code == 500
            assert "detail" in response.json()


class TestAdminNotionUnlinkPage:
    """Tests for POST /admin/notion/unlink-page"""
    
    def test_unlink_page_success(self, client, mock_neo4j_driver):
        """Test successfully unlinking a Notion page."""
        # Mock lecture IDs for page
        mock_lecture_ids = ["L001", "L002"]
        
        # Mock unlink_lecture stats
        mock_stats = {
            "nodes_deleted": 5,
            "nodes_updated": 2,
            "relationships_deleted": 3,
        }
        
        # Patch where they're used (api_admin), not where they're defined
        # unlink_lecture is called once per lecture_id, so we need side_effect for multiple calls
        with patch('api_admin.get_lectures_for_page', return_value=mock_lecture_ids):
            with patch('api_admin.unlink_lecture', side_effect=[
                {"nodes_deleted": 3, "nodes_updated": 1, "relationships_deleted": 2},  # First lecture
                {"nodes_deleted": 2, "nodes_updated": 1, "relationships_deleted": 1},  # Second lecture
            ]):
                with patch('api_admin.remove_page_from_index'):
                    with patch('api_admin.set_page_indexed'):
                            payload = {"page_id": "test-page-id"}
                            response = client.post("/admin/notion/unlink-page", json=payload)
                            
                            assert response.status_code == 200
                            data = response.json()
                            assert data["status"] == "ok"
                            assert data["page_id"] == "test-page-id"
                            # Totals: 3+2=5 deleted, 1+1=2 updated, 2+1=3 relationships
                            assert data["nodes_deleted"] == 5
                            assert data["nodes_updated"] == 2
                            assert data["relationships_deleted"] == 3
    
    def test_unlink_page_no_lectures(self, client):
        """Test unlinking a page with no associated lectures."""
        # Patch where it's used (api_admin), not where it's defined
        with patch('api_admin.get_lectures_for_page', return_value=[]):
            payload = {"page_id": "test-page-id"}
            response = client.post("/admin/notion/unlink-page", json=payload)
            
            assert response.status_code == 200
            data = response.json()
            assert data["lecture_ids"] == []
            assert data["nodes_deleted"] == 0
    
    def test_unlink_page_error(self, client):
        """Test unlinking a page when it fails."""
        # Patch where it's used (api_admin), not where it's defined
        with patch('api_admin.get_lectures_for_page', side_effect=Exception("Failed")):
            payload = {"page_id": "test-page-id"}
            response = client.post("/admin/notion/unlink-page", json=payload)
            
            assert response.status_code == 500
            assert "detail" in response.json()


class TestAdminNotionConfig:
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
