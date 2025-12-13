"""
Tests for error logging and exception handling.

Tests verify that:
- Unhandled exceptions are caught and logged
- Error responses are sanitized (no internal details leaked)
- HTTPExceptions are logged at appropriate levels
- Validation errors are handled correctly
"""
import pytest
import logging
from tests.mock_helpers import MockNeo4jResult
from fastapi import HTTPException


class TestUnhandledExceptions:
    """Tests for unhandled exception handling"""
    
    def test_unhandled_exception_logged(self, client, caplog):
        """Test that unhandled exceptions are logged with stack trace."""
        # Create a test endpoint that raises an exception
        from main import app
        
        @app.get("/test-error-endpoint")
        def test_error_endpoint():
            raise RuntimeError("Boom! This is a test error")
        
        with caplog.at_level(logging.ERROR):
            response = client.get("/test-error-endpoint")
            
            # Should return 500 with sanitized message
            assert response.status_code == 500
            assert response.json()["detail"] == "Internal server error"
            
            # Should log the error with stack trace
            assert len(caplog.records) > 0
            error_logs = [r for r in caplog.records if r.levelno >= logging.ERROR]
            assert len(error_logs) > 0
            assert "Unhandled exception" in error_logs[0].message or "RuntimeError" in str(error_logs[0].message)
    
    def test_unhandled_exception_sanitized(self, client):
        """Test that error response doesn't leak internal details."""
        from main import app
        
        @app.get("/test-error-endpoint-2")
        def test_error_endpoint_2():
            raise ValueError("Sensitive internal error: database password is xyz")
        
        response = client.get("/test-error-endpoint-2")
        
        # Should return generic error message
        assert response.status_code == 500
        data = response.json()
        assert data["detail"] == "Internal server error"
        # Should not contain internal error details
        assert "Sensitive" not in data["detail"]
        assert "password" not in data["detail"]


class TestHTTPExceptions:
    """Tests for HTTPException handling"""
    
    def test_404_exception_logged_as_warning(self, client, caplog, mock_neo4j_session):
        """Test that 4xx errors are logged at WARNING level."""
        mock_result = MockNeo4jResult(record=None)
        mock_neo4j_session.run.return_value = mock_result
        
        with caplog.at_level(logging.WARNING):
            response = client.get("/concepts/NONEXISTENT")
            
            assert response.status_code == 404
            
            # Should log at WARNING level, not ERROR
            warning_logs = [r for r in caplog.records if r.levelno == logging.WARNING]
            assert len(warning_logs) > 0
            assert "404" in warning_logs[0].message
    
    def test_500_exception_logged_as_error(self, client, caplog):
        """Test that 5xx errors are logged at ERROR level."""
        from main import app
        
        @app.get("/test-500-endpoint")
        def test_500_endpoint():
            raise HTTPException(status_code=500, detail="Internal server error")
        
        with caplog.at_level(logging.ERROR):
            response = client.get("/test-500-endpoint")
            
            assert response.status_code == 500
            
            # Should log at ERROR level
            error_logs = [r for r in caplog.records if r.levelno >= logging.ERROR]
            assert len(error_logs) > 0
            assert "500" in error_logs[0].message
    
    def test_http_exception_not_double_wrapped(self, client):
        """Test that HTTPExceptions are not double-wrapped."""
        from main import app
        
        @app.get("/test-http-exception")
        def test_http_exception():
            raise HTTPException(status_code=400, detail="Bad request")
        
        response = client.get("/test-http-exception")
        
        # Should return the exact detail from HTTPException
        assert response.status_code == 400
        assert response.json()["detail"] == "Bad request"


class TestValidationErrors:
    """Tests for request validation error handling"""
    
    def test_validation_error_logged(self, client, caplog):
        """Test that validation errors are logged at WARNING level."""
        invalid_payload = {
            "domain": "Testing",
            # Missing required "name" field
        }
        
        with caplog.at_level(logging.WARNING):
            response = client.post("/concepts/", json=invalid_payload)
            
            assert response.status_code == 422
            
            # Should log validation error
            warning_logs = [r for r in caplog.records if r.levelno == logging.WARNING]
            assert len(warning_logs) > 0
            assert "Validation error" in warning_logs[0].message
    
    def test_validation_error_returns_details(self, client):
        """Test that validation errors return detailed error information."""
        invalid_payload = {
            "domain": "Testing",
            # Missing required "name" field
        }
        
        response = client.post("/concepts/", json=invalid_payload)
        
        assert response.status_code == 422
        data = response.json()
        assert "detail" in data
        # FastAPI validation errors include field-level details
        assert isinstance(data["detail"], list)


class TestErrorContext:
    """Tests for error logging context"""
    
    def test_error_includes_request_context(self, client, caplog):
        """Test that errors include request method and path in logs."""
        from main import app
        
        @app.get("/test-context-endpoint")
        def test_context_endpoint():
            raise RuntimeError("Test error")
        
        with caplog.at_level(logging.ERROR):
            response = client.get("/test-context-endpoint")
            
            assert response.status_code == 500
            
            # Check that log includes request context
            error_logs = [r for r in caplog.records if r.levelno >= logging.ERROR]
            assert len(error_logs) > 0
            # Log should include method and path
            log_message = str(error_logs[0].message)
            assert "GET" in log_message or "test-context-endpoint" in log_message


class TestServiceLevelErrors:
    """Tests for errors from service layer"""
    
    def test_lecture_ingestion_value_error(self, client, mock_neo4j_session, sample_lecture_ingest_request, mock_openai_client):
        """Test that ValueError from lecture ingestion is handled correctly."""
        # Mock OpenAI to raise ValueError
        mock_openai_client.chat.completions.create.side_effect = ValueError("Invalid API key")
        
        response = client.post("/lectures/ingest", json=sample_lecture_ingest_request)
        
        # Should return 400 (not 500) for ValueError
        assert response.status_code == 400
        assert "detail" in response.json()
        # Error message should be user-friendly
        assert "Invalid API key" in response.json()["detail"] or "Failed to ingest" in response.json()["detail"]
    
    def test_lecture_ingestion_generic_error(self, client, caplog, mock_neo4j_session, sample_lecture_ingest_request, mock_openai_client):
        """Test that generic Exception from lecture ingestion is logged and sanitized."""
        # Mock OpenAI to raise generic Exception
        mock_openai_client.chat.completions.create.side_effect = Exception("Internal database error: connection failed")
        
        with caplog.at_level(logging.ERROR):
            response = client.post("/lectures/ingest", json=sample_lecture_ingest_request)
            
            # Should return 500 with sanitized message
            assert response.status_code == 500
            data = response.json()
            assert "detail" in data
            # Should not leak internal error details
            assert "database error" not in data["detail"].lower() or "Failed to ingest" in data["detail"]
            
            # Should log the full error
            error_logs = [r for r in caplog.records if r.levelno >= logging.ERROR]
            assert len(error_logs) > 0
