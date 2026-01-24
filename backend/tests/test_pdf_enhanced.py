"""
Tests for enhanced PDF processing functionality.

Tests cover:
- PDF extraction with multiple libraries (pdfplumber, PyMuPDF, PyPDF2)
- Metadata extraction
- Page-level chunking with page references
- Table extraction
- OCR support (mocked)
- Error handling and fallbacks
"""

import pytest
from unittest.mock import Mock, MagicMock, patch, mock_open
from datetime import datetime
import io

from models import PDFMetadata, PDFPage, PDFExtractionResult
from services_pdf_enhanced import (
    extract_pdf_enhanced,
    chunk_pdf_with_page_references,
    _parse_pdf_date,
    _detect_scanned_pdf,
    _table_to_text,
)


class TestPDFDateParsing:
    """Tests for PDF date parsing."""
    
    def test_parse_pdf_date_standard_format(self):
        """Test parsing standard PDF date format."""
        date_str = "D:20240101120000"
        result = _parse_pdf_date(date_str)
        assert result is not None
        assert result.year == 2024
        assert result.month == 1
        assert result.day == 1
    
    def test_parse_pdf_date_iso_format(self):
        """Test parsing ISO date format."""
        date_str = "2024-01-01"
        result = _parse_pdf_date(date_str)
        assert result is not None
        assert result.year == 2024
    
    def test_parse_pdf_date_none(self):
        """Test parsing None date."""
        result = _parse_pdf_date(None)
        assert result is None
    
    def test_parse_pdf_date_invalid(self):
        """Test parsing invalid date."""
        result = _parse_pdf_date("invalid-date")
        assert result is None


class TestTableToText:
    """Tests for table to text conversion."""
    
    def test_table_to_text_simple(self):
        """Test converting simple table to text."""
        table = [
            ["Name", "Age"],
            ["Alice", "30"],
            ["Bob", "25"],
        ]
        result = _table_to_text(table)
        assert "Alice" in result
        assert "Bob" in result
    
    def test_table_to_text_empty(self):
        """Test converting empty table."""
        result = _table_to_text([])
        assert result == ""
    
    def test_table_to_text_with_none(self):
        """Test converting table with None values."""
        table = [
            ["Name", "Age"],
            ["Alice", None],
            [None, "25"],
        ]
        result = _table_to_text(table)
        assert "Alice" in result


class TestDetectScannedPDF:
    """Tests for scanned PDF detection."""
    
    def test_detect_scanned_pdf_low_text(self):
        """Test detecting scanned PDF with low text density."""
        pages = [
            PDFPage(page_number=1, text=" " * 50),  # Very little text
            PDFPage(page_number=2, text=" " * 30),
        ]
        assert _detect_scanned_pdf(pages) == True
    
    def test_detect_scanned_pdf_high_text(self):
        """Test detecting non-scanned PDF with high text density."""
        pages = [
            PDFPage(page_number=1, text="This is a lot of text. " * 100),
            PDFPage(page_number=2, text="More text here. " * 100),
        ]
        assert _detect_scanned_pdf(pages) == False
    
    def test_detect_scanned_pdf_empty(self):
        """Test detecting scanned PDF with empty pages."""
        assert _detect_scanned_pdf([]) == True


class TestChunkPDFWithPageReferences:
    """Tests for PDF chunking with page references."""
    
    def test_chunk_pdf_basic(self):
        """Test basic PDF chunking with page references."""
        # Create a simple PDF result
        pages = [
            PDFPage(page_number=1, text="Page 1 content. " * 50),
            PDFPage(page_number=2, text="Page 2 content. " * 50),
        ]
        pdf_result = PDFExtractionResult(
            full_text="Page 1 content. " * 50 + "\n\n--- Page Break ---\n\n" + "Page 2 content. " * 50,
            pages=pages,
            metadata=PDFMetadata(page_count=2),
            extraction_method="test",
        )
        
        chunks = chunk_pdf_with_page_references(pdf_result, max_chars=200, overlap=50)
        
        assert len(chunks) > 0
        assert all("page_numbers" in chunk for chunk in chunks)
        assert all("text" in chunk for chunk in chunks)
        assert all("chunk_index" in chunk for chunk in chunks)
    
    def test_chunk_pdf_page_references(self):
        """Test that page references are correctly assigned."""
        pages = [
            PDFPage(page_number=1, text="A" * 500),
            PDFPage(page_number=2, text="B" * 500),
        ]
        pdf_result = PDFExtractionResult(
            full_text="A" * 500 + "\n\n--- Page Break ---\n\n" + "B" * 500,
            pages=pages,
            metadata=PDFMetadata(page_count=2),
            extraction_method="test",
        )
        
        chunks = chunk_pdf_with_page_references(pdf_result, max_chars=300, overlap=50)
        
        # First chunk should reference page 1
        assert 1 in chunks[0]["page_numbers"]
        # Later chunks should reference page 2
        assert any(2 in chunk["page_numbers"] for chunk in chunks)


class TestPDFExtractionWithPyPDF2:
    """Tests for PDF extraction using PyPDF2 (fallback)."""
    
    @patch('services_pdf_enhanced.PyPDF2')
    def test_extract_with_pypdf2_success(self, mock_pypdf2):
        """Test successful extraction with PyPDF2."""
        # Mock PyPDF2
        mock_page = MagicMock()
        mock_page.extract_text.return_value = "Sample PDF text content"
        
        mock_reader = MagicMock()
        mock_reader.pages = [mock_page]
        mock_reader.metadata = {
            "/Title": "Test PDF",
            "/Author": "Test Author",
            "/CreationDate": "D:20240101120000",
        }
        
        mock_pypdf2.PdfReader.return_value = mock_reader
        
        result = extract_pdf_enhanced(pdf_path="test.pdf", use_ocr=False)
        
        assert result.full_text is not None
        assert len(result.pages) > 0
        assert result.metadata.page_count > 0
    
    @patch('services_pdf_enhanced.PyPDF2')
    def test_extract_with_pypdf2_no_metadata(self, mock_pypdf2):
        """Test extraction with PyPDF2 when metadata is missing."""
        mock_page = MagicMock()
        mock_page.extract_text.return_value = "Sample text"
        
        mock_reader = MagicMock()
        mock_reader.pages = [mock_page]
        mock_reader.metadata = None
        
        mock_pypdf2.PdfReader.return_value = mock_reader
        
        result = extract_pdf_enhanced(pdf_path="test.pdf", use_ocr=False)
        
        assert result.full_text is not None
        assert result.metadata.page_count > 0


class TestPDFExtractionFallback:
    """Tests for PDF extraction fallback strategy."""
    
    @patch('services_pdf_enhanced._extract_with_pdfplumber')
    @patch('services_pdf_enhanced._extract_with_pymupdf')
    @patch('services_pdf_enhanced._extract_with_pypdf2')
    def test_extraction_fallback_chain(self, mock_pypdf2, mock_pymupdf, mock_pdfplumber):
        """Test that extraction falls back through libraries."""
        # pdfplumber fails
        mock_pdfplumber.side_effect = Exception("pdfplumber failed")
        
        # PyMuPDF fails
        mock_pymupdf.side_effect = Exception("pymupdf failed")
        
        # PyPDF2 succeeds
        mock_pypdf2.return_value = PDFExtractionResult(
            full_text="Test text",
            pages=[PDFPage(page_number=1, text="Test text")],
            metadata=PDFMetadata(page_count=1),
            extraction_method="pypdf2",
        )
        
        result = extract_pdf_enhanced(pdf_path="test.pdf", use_ocr=False)
        
        assert result.extraction_method == "pypdf2"
        assert result.full_text == "Test text"
    
    @patch('services_pdf_enhanced._extract_with_pdfplumber')
    @patch('services_pdf_enhanced._extract_with_pymupdf')
    @patch('services_pdf_enhanced._extract_with_pypdf2')
    @patch('services_pdf_enhanced._extract_with_ocr')
    def test_extraction_fallback_to_ocr(self, mock_ocr, mock_pypdf2, mock_pymupdf, mock_pdfplumber):
        """Test that extraction falls back to OCR when enabled."""
        # All text extraction methods fail
        mock_pdfplumber.side_effect = Exception("pdfplumber failed")
        mock_pymupdf.side_effect = Exception("pymupdf failed")
        mock_pypdf2.side_effect = Exception("pypdf2 failed")
        
        # OCR succeeds
        mock_ocr.return_value = PDFExtractionResult(
            full_text="OCR extracted text",
            pages=[PDFPage(page_number=1, text="OCR extracted text")],
            metadata=PDFMetadata(page_count=1, is_scanned=True),
            extraction_method="ocr",
        )
        
        result = extract_pdf_enhanced(pdf_path="test.pdf", use_ocr=True)
        
        assert result.extraction_method == "ocr"
        assert result.full_text == "OCR extracted text"
    
    @patch('services_pdf_enhanced._extract_with_pdfplumber')
    @patch('services_pdf_enhanced._extract_with_pymupdf')
    @patch('services_pdf_enhanced._extract_with_pypdf2')
    def test_extraction_all_methods_fail(self, mock_pypdf2, mock_pymupdf, mock_pdfplumber):
        """Test when all extraction methods fail."""
        mock_pdfplumber.side_effect = Exception("pdfplumber failed")
        mock_pymupdf.side_effect = Exception("pymupdf failed")
        mock_pypdf2.side_effect = Exception("pypdf2 failed")
        
        result = extract_pdf_enhanced(pdf_path="test.pdf", use_ocr=False)
        
        assert result.extraction_method == "failed"
        assert result.full_text == ""
        assert len(result.errors) > 0


class TestPDFExtractionWithBytes:
    """Tests for PDF extraction using bytes instead of file path."""
    
    @patch('services_pdf_enhanced.PyPDF2')
    def test_extract_with_bytes(self, mock_pypdf2):
        """Test extraction using PDF bytes."""
        pdf_bytes = b"fake pdf bytes"
        
        mock_page = MagicMock()
        mock_page.extract_text.return_value = "Text from bytes"
        
        mock_reader = MagicMock()
        mock_reader.pages = [mock_page]
        mock_reader.metadata = {}
        
        mock_pypdf2.PdfReader.return_value = mock_reader
        
        result = extract_pdf_enhanced(pdf_bytes=pdf_bytes, use_ocr=False)
        
        # Verify PdfReader was called with BytesIO
        assert mock_pypdf2.PdfReader.called
        assert result.full_text is not None


class TestPDFMetadataExtraction:
    """Tests for PDF metadata extraction."""
    
    @patch('services_pdf_enhanced.PyPDF2')
    def test_metadata_extraction(self, mock_pypdf2):
        """Test that metadata is correctly extracted."""
        mock_page = MagicMock()
        mock_page.extract_text.return_value = "Content"
        
        mock_reader = MagicMock()
        mock_reader.pages = [mock_page]
        mock_reader.metadata = {
            "/Title": "Test Document",
            "/Author": "John Doe",
            "/Subject": "Testing",
            "/Creator": "Test Creator",
            "/Producer": "Test Producer",
            "/CreationDate": "D:20240101120000",
            "/ModDate": "D:20240201120000",
        }
        
        mock_pypdf2.PdfReader.return_value = mock_reader
        
        result = extract_pdf_enhanced(pdf_path="test.pdf", use_ocr=False)
        
        assert result.metadata.title == "Test Document"
        assert result.metadata.author == "John Doe"
        assert result.metadata.subject == "Testing"
        assert result.metadata.creation_date is not None


class TestPDFPageTracking:
    """Tests for PDF page-level tracking."""
    
    @patch('services_pdf_enhanced.PyPDF2')
    def test_page_tracking(self, mock_pypdf2):
        """Test that pages are correctly tracked."""
        mock_page1 = MagicMock()
        mock_page1.extract_text.return_value = "Page 1 content"
        
        mock_page2 = MagicMock()
        mock_page2.extract_text.return_value = "Page 2 content"
        
        mock_reader = MagicMock()
        mock_reader.pages = [mock_page1, mock_page2]
        mock_reader.metadata = {}
        
        mock_pypdf2.PdfReader.return_value = mock_reader
        
        result = extract_pdf_enhanced(pdf_path="test.pdf", use_ocr=False)
        
        assert len(result.pages) == 2
        assert result.pages[0].page_number == 1
        assert result.pages[1].page_number == 2
        assert result.metadata.page_count == 2
