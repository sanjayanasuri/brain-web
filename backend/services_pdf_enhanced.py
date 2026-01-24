"""
Enhanced PDF processing service.

Handles:
- Multi-library PDF text extraction with fallbacks
- Metadata extraction
- Page-level chunking with page references
- Table extraction
- OCR support for scanned PDFs
"""

from typing import Optional, List, Dict, Any
from datetime import datetime
import io
import logging

from models import PDFMetadata, PDFPage, PDFExtractionResult

logger = logging.getLogger("brain_web")


def extract_pdf_enhanced(
    pdf_path: Optional[str] = None,
    pdf_bytes: Optional[bytes] = None,
    use_ocr: bool = False,
    extract_tables: bool = True,
) -> PDFExtractionResult:
    """
    Enhanced PDF extraction with multiple fallback strategies.
    
    Strategy order:
    1. pdfplumber (best for tables/layouts)
    2. PyMuPDF/fitz (fast, good formatting)
    3. PyPDF2 (fallback, already installed)
    4. OCR (if use_ocr=True and text extraction yields little)
    
    Args:
        pdf_path: Path to PDF file
        pdf_bytes: PDF file bytes
        use_ocr: Enable OCR for scanned PDFs
        extract_tables: Extract tables as structured text
        
    Returns:
        PDFExtractionResult with full text, pages, and metadata
    """
    warnings = []
    errors = []
    
    # Try pdfplumber first (best for tables)
    try:
        result = _extract_with_pdfplumber(pdf_path, pdf_bytes, extract_tables)
        if result and result.full_text.strip():
            result.extraction_method = "pdfplumber"
            return result
    except Exception as e:
        warning_msg = f"pdfplumber extraction failed: {e}"
        warnings.append(warning_msg)
        logger.warning(warning_msg)
    
    # Try PyMuPDF/fitz (fast, good formatting)
    try:
        result = _extract_with_pymupdf(pdf_path, pdf_bytes)
        if result and result.full_text.strip():
            result.extraction_method = "pymupdf"
            result.warnings.extend(warnings)
            return result
    except Exception as e:
        warning_msg = f"PyMuPDF extraction failed: {e}"
        warnings.append(warning_msg)
        logger.warning(warning_msg)
    
    # Try PyPDF2 (fallback)
    try:
        result = _extract_with_pypdf2(pdf_path, pdf_bytes)
        if result and result.full_text.strip():
            result.extraction_method = "pypdf2"
            result.warnings.extend(warnings)
            return result
    except Exception as e:
        warning_msg = f"PyPDF2 extraction failed: {e}"
        warnings.append(warning_msg)
        logger.warning(warning_msg)
    
    # Try OCR if enabled and text extraction yielded little
    if use_ocr:
        try:
            result = _extract_with_ocr(pdf_path, pdf_bytes)
            if result and result.full_text.strip():
                result.extraction_method = "ocr"
                result.warnings.extend(warnings)
                return result
        except Exception as e:
            error_msg = f"OCR extraction failed: {e}"
            errors.append(error_msg)
            logger.error(error_msg)
    
    # All methods failed
    return PDFExtractionResult(
        full_text="",
        pages=[],
        metadata=PDFMetadata(page_count=0),
        extraction_method="failed",
        warnings=warnings,
        errors=errors + ["All PDF extraction methods failed"],
    )


def _extract_with_pdfplumber(
    pdf_path: Optional[str],
    pdf_bytes: Optional[bytes],
    extract_tables: bool,
) -> Optional[PDFExtractionResult]:
    """Extract using pdfplumber (best for tables)."""
    try:
        import pdfplumber
    except ImportError:
        logger.warning("pdfplumber not installed, skipping")
        return None
    
    if pdf_bytes:
        pdf_file = io.BytesIO(pdf_bytes)
        pdf = pdfplumber.open(pdf_file)
    else:
        pdf = pdfplumber.open(pdf_path)
    
    try:
        pages = []
        full_text_parts = []
        metadata_dict = {}
        
        # Extract metadata
        if pdf.metadata:
            metadata_dict = {
                "title": pdf.metadata.get("Title"),
                "author": pdf.metadata.get("Author"),
                "subject": pdf.metadata.get("Subject"),
                "creator": pdf.metadata.get("Creator"),
                "producer": pdf.metadata.get("Producer"),
            }
            # Parse dates
            creation_date = _parse_pdf_date(pdf.metadata.get("CreationDate"))
            mod_date = _parse_pdf_date(pdf.metadata.get("ModDate"))
            if creation_date:
                metadata_dict["creation_date"] = creation_date
            if mod_date:
                metadata_dict["modification_date"] = mod_date
        
        # Extract pages
        for page_num, page in enumerate(pdf.pages, start=1):
            page_text_parts = []
            
            # Extract text
            text = page.extract_text() or ""
            if text:
                page_text_parts.append(text)
            
            # Extract tables if requested
            table_count = 0
            if extract_tables:
                tables = page.extract_tables()
                for table in tables:
                    table_count += 1
                    # Convert table to markdown-like format
                    table_text = _table_to_text(table)
                    page_text_parts.append(f"\n\n[Table {table_count}]\n{table_text}")
            
            # Check for images
            images = page.images
            image_count = len(images) if images else 0
            
            page_text = "\n".join(page_text_parts)
            full_text_parts.append(page_text)
            
            pages.append(PDFPage(
                page_number=page_num,
                text=page_text,
                has_table=table_count > 0,
                has_image=image_count > 0,
                table_count=table_count,
                image_count=image_count,
            ))
        
        full_text = "\n\n--- Page Break ---\n\n".join(full_text_parts)
        
        # Detect if scanned (low text-to-page ratio)
        is_scanned = _detect_scanned_pdf(pages)
        
        metadata = PDFMetadata(
            **metadata_dict,
            page_count=len(pages),
            is_scanned=is_scanned,
            has_tables=any(p.has_table for p in pages),
            has_images=any(p.has_image for p in pages),
        )
        
        return PDFExtractionResult(
            full_text=full_text,
            pages=pages,
            metadata=metadata,
            extraction_method="pdfplumber",
        )
    finally:
        pdf.close()


def _extract_with_pymupdf(
    pdf_path: Optional[str],
    pdf_bytes: Optional[bytes],
) -> Optional[PDFExtractionResult]:
    """Extract using PyMuPDF/fitz (fast, preserves formatting)."""
    try:
        import fitz  # PyMuPDF
    except ImportError:
        logger.warning("PyMuPDF (pymupdf) not installed, skipping")
        return None
    
    if pdf_bytes:
        pdf_file = io.BytesIO(pdf_bytes)
        pdf = fitz.open(stream=pdf_file, filetype="pdf")
    else:
        pdf = fitz.open(pdf_path)
    
    try:
        pages = []
        full_text_parts = []
        
        # Extract metadata
        metadata_dict = pdf.metadata
        creation_date = _parse_pdf_date(metadata_dict.get("creationDate"))
        mod_date = _parse_pdf_date(metadata_dict.get("modDate"))
        
        metadata = PDFMetadata(
            title=metadata_dict.get("title"),
            author=metadata_dict.get("author"),
            subject=metadata_dict.get("subject"),
            creator=metadata_dict.get("creator"),
            producer=metadata_dict.get("producer"),
            creation_date=creation_date,
            modification_date=mod_date,
            page_count=len(pdf),
        )
        
        # Extract pages
        for page_num in range(len(pdf)):
            page = pdf[page_num]
            text = page.get_text()
            
            # Check for images
            image_list = page.get_images()
            image_count = len(image_list)
            
            pages.append(PDFPage(
                page_number=page_num + 1,
                text=text,
                has_image=image_count > 0,
                image_count=image_count,
            ))
            
            full_text_parts.append(text)
        
        full_text = "\n\n--- Page Break ---\n\n".join(full_text_parts)
        
        # Detect if scanned
        is_scanned = _detect_scanned_pdf(pages)
        metadata.is_scanned = is_scanned
        
        return PDFExtractionResult(
            full_text=full_text,
            pages=pages,
            metadata=metadata,
            extraction_method="pymupdf",
        )
    finally:
        pdf.close()


def _extract_with_pypdf2(
    pdf_path: Optional[str],
    pdf_bytes: Optional[bytes],
) -> Optional[PDFExtractionResult]:
    """Extract using PyPDF2 (fallback, already installed)."""
    try:
        import PyPDF2
    except ImportError:
        logger.warning("PyPDF2 not installed, skipping")
        return None
    
    if pdf_bytes:
        pdf_file = io.BytesIO(pdf_bytes)
        pdf_reader = PyPDF2.PdfReader(pdf_file)
    else:
        with open(pdf_path, 'rb') as file:
            pdf_reader = PyPDF2.PdfReader(file)
    
    pages = []
    full_text_parts = []
    
    # Extract metadata
    metadata_dict = pdf_reader.metadata or {}
    creation_date = _parse_pdf_date(metadata_dict.get("/CreationDate"))
    mod_date = _parse_pdf_date(metadata_dict.get("/ModDate"))
    
    metadata = PDFMetadata(
        title=metadata_dict.get("/Title"),
        author=metadata_dict.get("/Author"),
        subject=metadata_dict.get("/Subject"),
        creator=metadata_dict.get("/Creator"),
        producer=metadata_dict.get("/Producer"),
        creation_date=creation_date,
        modification_date=mod_date,
        page_count=len(pdf_reader.pages),
    )
    
    # Extract pages
    for page_num, page in enumerate(pdf_reader.pages, start=1):
        text = page.extract_text() or ""
        pages.append(PDFPage(
            page_number=page_num,
            text=text,
        ))
        full_text_parts.append(text)
    
    full_text = "\n\n--- Page Break ---\n\n".join(full_text_parts)
    
    # Detect if scanned
    is_scanned = _detect_scanned_pdf(pages)
    metadata.is_scanned = is_scanned
    
    return PDFExtractionResult(
        full_text=full_text,
        pages=pages,
        metadata=metadata,
        extraction_method="pypdf2",
    )


def _extract_with_ocr(
    pdf_path: Optional[str],
    pdf_bytes: Optional[bytes],
) -> Optional[PDFExtractionResult]:
    """Extract using OCR (for scanned PDFs)."""
    try:
        import pytesseract
        from PIL import Image
        import fitz  # PyMuPDF for rendering PDF pages as images
    except ImportError as e:
        logger.warning(f"OCR dependencies not installed: {e}")
        raise ImportError("OCR dependencies not installed: pytesseract, Pillow, PyMuPDF")
    
    if pdf_bytes:
        pdf_file = io.BytesIO(pdf_bytes)
        pdf = fitz.open(stream=pdf_file, filetype="pdf")
    else:
        pdf = fitz.open(pdf_path)
    
    try:
        pages = []
        full_text_parts = []
        
        for page_num in range(len(pdf)):
            page = pdf[page_num]
            
            # Render page as image
            mat = fitz.Matrix(2, 2)  # 2x zoom for better OCR
            pix = page.get_pixmap(matrix=mat)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            
            # Run OCR
            text = pytesseract.image_to_string(img)
            
            pages.append(PDFPage(
                page_number=page_num + 1,
                text=text,
            ))
            full_text_parts.append(text)
        
        full_text = "\n\n--- Page Break ---\n\n".join(full_text_parts)
        
        metadata = PDFMetadata(
            page_count=len(pages),
            is_scanned=True,
        )
        
        return PDFExtractionResult(
            full_text=full_text,
            pages=pages,
            metadata=metadata,
            extraction_method="ocr",
        )
    finally:
        pdf.close()


def _table_to_text(table: List[List[str]]) -> str:
    """Convert table structure to readable text format."""
    if not table:
        return ""
    
    lines = []
    for row in table:
        # Filter out None values and join with tabs
        row_text = "\t".join(str(cell) if cell else "" for cell in row)
        lines.append(row_text)
    
    return "\n".join(lines)


def _parse_pdf_date(date_str: Optional[str]) -> Optional[datetime]:
    """Parse PDF date string to datetime."""
    if not date_str:
        return None
    
    try:
        # PDF dates are typically: D:YYYYMMDDHHmmSSOHH'mm
        # Remove D: prefix if present
        date_str = date_str.replace("D:", "").strip()
        
        # Try parsing common formats
        formats = [
            "%Y%m%d%H%M%S",      # 20240101120000
            "%Y%m%d",            # 20240101
            "%Y-%m-%d %H:%M:%S", # 2024-01-01 12:00:00
            "%Y-%m-%d",          # 2024-01-01
        ]
        
        for fmt in formats:
            try:
                # For formats with separators, try to parse the full string
                # For formats without separators, slice to match format length
                if any(sep in fmt for sep in ['-', ' ', ':']):
                    # Format has separators, try parsing full string
                    return datetime.strptime(date_str, fmt)
                else:
                    # Format without separators, slice to match expected length
                    expected_len = len(fmt.replace('%Y', 'YYYY').replace('%m', 'MM').replace('%d', 'DD').replace('%H', 'HH').replace('%M', 'MM').replace('%S', 'SS'))
                    if len(date_str) >= expected_len:
                        return datetime.strptime(date_str[:expected_len], fmt)
            except (ValueError, IndexError):
                continue
        
        return None
    except Exception as e:
        logger.warning(f"Failed to parse PDF date '{date_str}': {e}")
        return None


def _detect_scanned_pdf(pages: List[PDFPage]) -> bool:
    """
    Detect if PDF is scanned (image-based) by checking text density.
    
    Returns True if average text per page is very low.
    """
    if not pages:
        return True
    
    total_chars = sum(len(page.text) for page in pages)
    avg_chars_per_page = total_chars / len(pages)
    
    # If average is less than 100 characters per page, likely scanned
    return avg_chars_per_page < 100


def chunk_pdf_with_page_references(
    pdf_result: PDFExtractionResult,
    max_chars: int = 1200,
    overlap: int = 150,
) -> List[Dict[str, Any]]:
    """
    Chunk PDF text with page references preserved.
    
    Returns chunks with page_number metadata.
    """
    chunks = []
    
    # Build page boundaries
    page_boundaries = []
    current_pos = 0
    page_break_marker = "\n\n--- Page Break ---\n\n"
    
    for page in pdf_result.pages:
        page_start = current_pos
        page_end = current_pos + len(page.text)
        page_boundaries.append({
            "page_number": page.page_number,
            "start": page_start,
            "end": page_end,
        })
        current_pos = page_end + len(page_break_marker)
    
    # Chunk full text
    full_text = pdf_result.full_text
    text_length = len(full_text)
    
    start = 0
    chunk_index = 0
    
    while start < text_length:
        # Calculate end position
        end = min(start + max_chars, text_length)
        
        # Try to break at sentence boundary
        if end < text_length:
            # Look for sentence endings near the end
            for i in range(end, max(start, end - 100), -1):
                if full_text[i] in '.!?\n':
                    end = i + 1
                    break
        
        chunk_text = full_text[start:end]
        
        # Find which pages this chunk spans
        chunk_pages = []
        for boundary in page_boundaries:
            if (boundary["start"] <= start < boundary["end"]) or \
               (boundary["start"] < end <= boundary["end"]) or \
               (start <= boundary["start"] and end >= boundary["end"]):
                chunk_pages.append(boundary["page_number"])
        
        chunk = {
            "text": chunk_text,
            "chunk_index": chunk_index,
            "start_char": start,
            "end_char": end,
            "page_numbers": chunk_pages,
            "page_range": f"{min(chunk_pages)}-{max(chunk_pages)}" if chunk_pages else None,
        }
        
        chunks.append(chunk)
        
        # Move start position with overlap
        start = end - overlap
        chunk_index += 1
    
    return chunks
