"""
Tests for the AI endpoints.
"""
def test_ai_chat(client):
    """Test the AI chat endpoint (currently a stub)."""
    payload = {"message": "Hello, AI!"}
    response = client.post("/ai/chat", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "reply" in data
    assert "Hello, AI!" in data["reply"] or "You said:" in data["reply"]


def test_ai_chat_empty_message(client):
    """Test AI chat with empty message."""
    payload = {"message": ""}
    response = client.post("/ai/chat", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "reply" in data

