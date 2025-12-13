"""
Tests for the admin endpoints.
Note: These tests actually run import/export operations, so they may be slower.
"""
import pytest


@pytest.mark.skip(reason="Admin endpoints modify database - run manually if needed")
def test_admin_import(client):
    """Test the admin import endpoint."""
    response = client.post("/admin/import")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["action"] == "import"


@pytest.mark.skip(reason="Admin endpoints modify database - run manually if needed")
def test_admin_export(client):
    """Test the admin export endpoint."""
    response = client.post("/admin/export")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["action"] == "export"

