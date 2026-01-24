"""
Integration tests for PDF processing API endpoints.

Tests cover:
- POST /resources/pdf/extract endpoint
- POST /resources/upload with enhanced PDF processing
- Error handling
- Metadata storage
"""

import pytest
from unittest.mock import Mock, MagicMock, patch, mock_open
from fastapi.testclient import TestClient
from io import BytesIO

from models import PDFExtractionResult, PDFMetadata, PDFPage
from tests.mock_helpers import MockNeo4jRecord, MockNeo4jResult


class TestPDFExtractEndpoint:
    """Tests for POST /resources/pdf/extract endpoint."""
    
    @patch('services_pdf_enhanced.extract_pdf_enhanced')
    @patch('storage.save_file')
    @patch('storage.read_file')
    def test_extract_pdf_success(self, mock_read_file, mock_save_file, mock_extract, client, mock_neo4j_session):
        """Test successful PDF extraction."""
        # Setup mocks
        mock_save_file.return_value = ("/url/test.pdf", "/storage/test.pdf")
        mock_read_file.return_value = b"fake pdf bytes"
        
        # Mock PDF extraction result
        pdf_result = PDFExtractionResult(
            full_text="Extracted text from PDF",
            pages=[
                PDFPage(page_number=1, text="Page 1 text"),
                PDFPage(page_number=2, text="Page 2 text"),
            ],
            metadata=PDFMetadata(
                title="Test PDF",
                author="Test Author",
                page_count=2,
            ),
            extraction_method="pdfplumber",
        )
        mock_extract.return_value = pdf_result
        
        # Create test PDF file
        pdf_file = BytesIO(b"fake pdf content")
        pdf_file.name = "test.pdf"
        
        response = client.post(
            "/resources/pdf/extract",
            files={"file": ("test.pdf", pdf_file, "application/pdf")},
            params={"use_ocr": False, "extract_tables": True},
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["full_text"] == "Extracted text from PDF"
        assert len(data["pages"]) == 2
        assert data["metadata"]["title"] == "Test PDF"
        assert data["extraction_method"] == "pdfplumber"
    
    def test_extract_pdf_invalid_file_type(self, client, mock_neo4j_session):
        """Test extraction with non-PDF file."""
        text_file = BytesIO(b"not a pdf")
        text_file.name = "test.txt"
        
        response = client.post(
            "/resources/pdf/extract",
            files={"file": ("test.txt", text_file, "text/plain")},
        )
        
        assert response.status_code == 400
        assert "PDF" in response.json()["detail"]
    
    def test_extract_pdf_missing_file(self, client, mock_neo4j_session):
        """Test extraction without file."""
        response = client.post("/resources/pdf/extract")
        
        assert response.status_code == 422  # Validation error


class TestPDFUploadEndpoint:
    """Tests for POST /resources/upload with enhanced PDF processing."""
    
    @patch('services_resources.create_resource')
    @patch('services_pdf_enhanced.extract_pdf_enhanced')
    @patch('services_resource_ai.extract_pdf_text')
    @patch('services_resource_ai.summarize_pdf_text')
    @patch('storage.save_file')
    @patch('storage.read_file')
    def test_upload_pdf_basic(self, mock_read_file, mock_save_file, mock_summarize, 
                               mock_extract_text, mock_extract_enhanced, mock_create_resource, 
                               client, mock_neo4j_session):
        """Test basic PDF upload without enhanced processing."""
        # Setup mocks
        mock_save_file.return_value = ("/url/test.pdf", "/storage/test.pdf")
        mock_read_file.return_value = b"fake pdf bytes"
        mock_extract_text.return_value = "PDF text content"
        mock_summarize.return_value = "PDF summary"
        
        mock_resource = Mock()
        mock_resource.resource_id = "RES_123"
        mock_create_resource.return_value = mock_resource
        
        # Mock Neo4j queries for resource creation
        mock_record = MockNeo4jRecord({
            "resource_id": "RES_123",
            "kind": "pdf",
            "url": "/url/test.pdf",
            "title": "test.pdf",
        })
        mock_result = MockNeo4jResult(mock_record)
        mock_neo4j_session.run.return_value = mock_result
        
        pdf_file = BytesIO(b"fake pdf content")
        pdf_file.name = "test.pdf"
        
        response = client.post(
            "/resources/upload",
            files={"file": ("test.pdf", pdf_file, "application/pdf")},
            data={"enhanced_pdf": "false"},
        )
        
        assert response.status_code == 200
        # Verify basic extraction was used
        mock_extract_text.assert_called_once()
        mock_extract_enhanced.assert_not_called()
    
    @patch('api_resources.create_resource')
    @patch('api_resources.extract_pdf_enhanced')
    @patch('api_resources.summarize_pdf_text')
    @patch('api_resources.save_file')
    @patch('api_resources.read_file')
    def test_upload_pdf_enhanced(self, mock_read_file, mock_save_file, mock_summarize,
                                  mock_extract_enhanced, mock_create_resource,
                                  client, mock_neo4j_session):
        """Test PDF upload with enhanced processing."""
        # Setup mocks
        mock_save_file.return_value = ("/url/test.pdf", "/storage/test.pdf")
        mock_read_file.return_value = b"fake pdf bytes"
        mock_summarize.return_value = "PDF summary"
        
        # Mock enhanced PDF extraction
        pdf_result = PDFExtractionResult(
            full_text="Enhanced extracted text",
            pages=[PDFPage(page_number=1, text="Page 1")],
            metadata=PDFMetadata(
                title="Test PDF Title",
                author="Test Author",
                page_count=1,
            ),
            extraction_method="pdfplumber",
        )
        mock_extract_enhanced.return_value = pdf_result
        
        mock_resource = Mock()
        mock_resource.resource_id = "RES_123"
        mock_create_resource.return_value = mock_resource
        
        # Mock Neo4j queries
        mock_record = MockNeo4jRecord({
            "resource_id": "RES_123",
            "kind": "pdf",
            "url": "/url/test.pdf",
            "title": "test.pdf",
            "metadata": {
                "pdf_metadata": pdf_result.metadata.dict(),
                "extraction_method": "pdfplumber",
            },
        })
        mock_result = MockNeo4jResult(mock_record)
        mock_neo4j_session.run.return_value = mock_result
        
        pdf_file = BytesIO(b"fake pdf content")
        pdf_file.name = "test.pdf"
        
        response = client.post(
            "/resources/upload",
            files={"file": ("test.pdf", pdf_file, "application/pdf")},
            data={"enhanced_pdf": "true", "use_ocr": "false"},
        )
        
        assert response.status_code == 200
        # Verify enhanced extraction was used
        mock_extract_enhanced.assert_called_once()
        # Verify metadata was stored
        call_args = mock_create_resource.call_args
        assert call_args[1]["metadata"] is not None
        assert "pdf_metadata" in call_args[1]["metadata"]
    
    @patch('services_resources.create_resource')
    @patch('services_pdf_enhanced.extract_pdf_enhanced')
    @patch('storage.save_file')
    @patch('storage.read_file')
    def test_upload_pdf_with_ocr(self, mock_read_file, mock_save_file,
                                  mock_extract_enhanced, mock_create_resource,
                                  client, mock_neo4j_session):
        """Test PDF upload with OCR enabled."""
        mock_save_file.return_value = ("/url/test.pdf", "/storage/test.pdf")
        mock_read_file.return_value = b"fake pdf bytes"
        
        pdf_result = PDFExtractionResult(
            full_text="OCR extracted text",
            pages=[PDFPage(page_number=1, text="OCR text")],
            metadata=PDFMetadata(page_count=1, is_scanned=True),
            extraction_method="ocr",
        )
        mock_extract_enhanced.return_value = pdf_result
        
        mock_resource = Mock()
        mock_resource.resource_id = "RES_123"
        mock_create_resource.return_value = mock_resource
        
        mock_record = MockNeo4jRecord({"resource_id": "RES_123"})
        mock_result = MockNeo4jResult(mock_record)
        mock_neo4j_session.run.return_value = mock_result
        
        pdf_file = BytesIO(b"fake pdf content")
        pdf_file.name = "test.pdf"
        
        response = client.post(
            "/resources/upload",
            files={"file": ("test.pdf", pdf_file, "application/pdf")},
            data={"enhanced_pdf": "true", "use_ocr": "true"},
        )
        
        assert response.status_code == 200
        # Verify OCR was requested
        call_args = mock_extract_enhanced.call_args
        assert call_args[1]["use_ocr"] == True


class TestPDFErrorHandling:
    """Tests for error handling in PDF processing."""
    
    @patch('api_resources.extract_pdf_enhanced')
    @patch('api_resources.save_file')
    @patch('api_resources.read_file')
    def test_extract_pdf_extraction_fails(self, mock_read_file, mock_save_file,
                                          mock_extract, client, mock_neo4j_session):
        """Test handling when PDF extraction fails."""
        mock_save_file.return_value = ("/url/test.pdf", "/storage/test.pdf")
        mock_read_file.return_value = b"fake pdf bytes"
        
        # Mock extraction failure
        pdf_result = PDFExtractionResult(
            full_text="",
            pages=[],
            metadata=PDFMetadata(page_count=0),
            extraction_method="failed",
            errors=["All PDF extraction methods failed"],
        )
        mock_extract.return_value = pdf_result
        
        pdf_file = BytesIO(b"fake pdf content")
        pdf_file.name = "test.pdf"
        
        response = client.post(
            "/resources/pdf/extract",
            files={"file": ("test.pdf", pdf_file, "application/pdf")},
        )
        
        assert response.status_code == 200  # Endpoint still returns 200, but with errors
        data = response.json()
        assert data["extraction_method"] == "failed"
        assert len(data["errors"]) > 0
    
    @patch('services_resources.create_resource')
    @patch('services_pdf_enhanced.extract_pdf_enhanced')
    @patch('storage.save_file')
    @patch('storage.read_file')
    def test_upload_pdf_extraction_error(self, mock_read_file, mock_save_file,
                                         mock_extract_enhanced, mock_create_resource,
                                         client, mock_neo4j_session):
        """Test upload when PDF extraction raises exception."""
        mock_save_file.return_value = ("/url/test.pdf", "/storage/test.pdf")
        mock_read_file.return_value = b"fake pdf bytes"
        
        # Mock extraction exception
        mock_extract_enhanced.side_effect = Exception("Extraction failed")
        
        mock_resource = Mock()
        mock_resource.resource_id = "RES_123"
        mock_create_resource.return_value = mock_resource
        
        mock_record = MockNeo4jRecord({"resource_id": "RES_123"})
        mock_result = MockNeo4jResult(mock_record)
        mock_neo4j_session.run.return_value = mock_result
        
        pdf_file = BytesIO(b"fake pdf content")
        pdf_file.name = "test.pdf"
        
        # Should not raise exception, but continue without caption
        response = client.post(
            "/resources/upload",
            files={"file": ("test.pdf", pdf_file, "application/pdf")},
            data={"enhanced_pdf": "true"},
        )
        
        # Upload should still succeed, but without PDF metadata
        assert response.status_code == 200
