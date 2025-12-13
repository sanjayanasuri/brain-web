"""
Tests for the root endpoint.
"""
def test_read_root(client):
    """Test the root health check endpoint."""
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "message" in data
    assert "Brain Web backend is running" in data["message"]

