"""
API endpoints for PDF ingestion into the knowledge graph.

This module handles ingestion of PDF files:
1. Extracts text and metadata from PDF
2. Ingests into graph using the unified ingestion kernel
3. Creates concepts, relationships, chunks, and claims
4. Enables chat with PDF content via the graph
"""
from typing import Dict, Any, Optional
from datetime import datetime
import json
import logging
import threading
import time
from queue import Queue, Empty
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request
from fastapi.responses import StreamingResponse
from neo4j import Session
from pydantic import BaseModel

from db_neo4j import get_neo4j_session, get_driver
from config import NEO4J_DATABASE
from auth import require_auth
from storage import save_file, read_file
from services_pdf_enhanced import extract_pdf_enhanced
from services_ingestion_kernel import ingest_artifact
from models_ingestion_kernel import ArtifactInput, IngestionActions, IngestionPolicy
from models import PDFExtractionResult
from config import (
    PDF_MAX_FILE_SIZE_BYTES,
    PDF_MAX_PAGES,
    PDF_RATE_LIMIT_PER_MINUTE,
    REQUEST_TIMEOUT_SECONDS,
)

logger = logging.getLogger("brain_web")

router = APIRouter(prefix="/pdf", tags=["pdf"])

# Simple in-memory rate limiter (per user_id)
# In production, use Redis for distributed rate limiting
_rate_limit_store: Dict[str, list] = defaultdict(list)
_rate_limit_lock = threading.Lock()


def _check_rate_limit(user_id: str) -> bool:
    """Check if user has exceeded rate limit."""
    with _rate_limit_lock:
        now = time.time()
        # Clean old entries (older than 1 minute)
        _rate_limit_store[user_id] = [
            timestamp for timestamp in _rate_limit_store[user_id]
            if now - timestamp < 60
        ]
        
        # Check limit
        if len(_rate_limit_store[user_id]) >= PDF_RATE_LIMIT_PER_MINUTE:
            return False
        
        # Record this request
        _rate_limit_store[user_id].append(now)
        return True


class PDFIngestResponse(BaseModel):
    """Response from PDF ingestion endpoint."""
    status: str  # "COMPLETED" | "PARTIAL" | "FAILED"
    artifact_id: Optional[str] = None
    run_id: Optional[str] = None
    concepts_created: int = 0
    concepts_updated: int = 0
    links_created: int = 0
    chunks_created: int = 0
    claims_created: int = 0
    page_count: int = 0
    extraction_method: Optional[str] = None
    warnings: list[str] = []
    errors: list[str] = []


def convert_datetime_to_iso(obj: Any) -> Any:
    """Recursively convert datetime objects to ISO strings for JSON serialization."""
    if isinstance(obj, datetime):
        return obj.isoformat()
    elif isinstance(obj, dict):
        return {k: convert_datetime_to_iso(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_datetime_to_iso(item) for item in obj]
    return obj


def _validate_file_size(file_size: int) -> None:
    """Validate file size against limits."""
    if file_size > PDF_MAX_FILE_SIZE_BYTES:
        max_mb = PDF_MAX_FILE_SIZE_BYTES / (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=f"File too large: {file_size / (1024 * 1024):.1f}MB. Maximum size is {max_mb}MB"
        )


def _validate_pdf_result(pdf_result: PDFExtractionResult) -> None:
    """Validate PDF extraction result."""
    if not pdf_result.full_text or len(pdf_result.full_text.strip()) < 50:
        raise HTTPException(
            status_code=400,
            detail=f"PDF extraction yielded insufficient text ({len(pdf_result.full_text)} chars). "
                   f"Try enabling OCR if this is a scanned PDF."
        )
    
    if pdf_result.metadata.page_count > PDF_MAX_PAGES:
        raise HTTPException(
            status_code=400,
            detail=f"PDF has too many pages: {pdf_result.metadata.page_count}. Maximum is {PDF_MAX_PAGES} pages"
        )


@router.post("/ingest-stream")
async def ingest_pdf_stream(
    file: UploadFile = File(...),
    domain: Optional[str] = Form(None),
    use_ocr: bool = Form(False),
    extract_tables: bool = Form(True),
    extract_concepts: bool = Form(True),
    extract_claims: bool = Form(True),
    request: Request = None,
    auth: dict = Depends(require_auth),
    session: Session = Depends(get_neo4j_session),
):
    """
    Stream PDF ingestion with real-time progress updates.
    
    Uses Server-Sent Events (SSE) to stream progress updates including:
    - Page-by-page extraction progress
    - Concepts as they're extracted
    - Final results
    
    Production improvements:
    - File size validation
    - Rate limiting
    - Client disconnect handling
    - Better error handling
    - Resource cleanup
    """
    user_id = auth.get("user_id", "anonymous")
    ingestion_thread: Optional[threading.Thread] = None
    thread_session: Optional[Session] = None
    
    # Read file content before generator (since generator can't use await)
    file_content = await file.read()
    file_size = len(file_content)
    _validate_file_size(file_size)
    
    def generate():
        nonlocal ingestion_thread, thread_session
        try:
            logger.info(f"PDF ingestion stream generator started for user {user_id}, file: {file.filename}")
            # Send initial connection event immediately to establish stream
            yield f"data: {json.dumps({'type': 'progress', 'stage': 'initializing', 'message': 'Starting PDF ingestion...', 'progress': 1})}\n\n"
            
            # Rate limiting
            if not _check_rate_limit(user_id):
                logger.warning(f"Rate limit exceeded for user {user_id}")
                yield f"data: {json.dumps({'type': 'error', 'message': f'Rate limit exceeded. Maximum {PDF_RATE_LIMIT_PER_MINUTE} PDFs per minute.'})}\n\n"
                return
            
            if not file.filename:
                yield f"data: {json.dumps({'type': 'error', 'message': 'Missing filename'})}\n\n"
                return
            
            if file.content_type != "application/pdf":
                yield f"data: {json.dumps({'type': 'error', 'message': 'File must be a PDF'})}\n\n"
                return
            
            # Step 1: Upload and validate file size
            yield f"data: {json.dumps({'type': 'progress', 'stage': 'uploading', 'message': 'Uploading PDF file...', 'progress': 5})}\n\n"
            
            tenant_id = getattr(request.state, "tenant_id", None) if request else None
            
            filename = file.filename or "upload.pdf"
            logger.info(f"PDF upload started: {filename} ({file_size / (1024 * 1024):.1f}MB) by user {user_id}")
            
            url_path, storage_path = save_file(file_content, filename, tenant_id=tenant_id)
            
            # Step 2: Extract text page by page with progress
            yield f"data: {json.dumps({'type': 'progress', 'stage': 'extracting_text', 'message': 'Extracting text from PDF...', 'progress': 10})}\n\n"
            
            try:
                pdf_result = extract_pdf_enhanced(
                    pdf_path=storage_path,
                    pdf_bytes=file_content,
                    use_ocr=use_ocr,
                    extract_tables=extract_tables,
                )
            except Exception as e:
                logger.error(f"PDF extraction failed for {filename}: {e}", exc_info=True)
                yield f"data: {json.dumps({'type': 'error', 'message': f'PDF extraction failed: {str(e)}'})}\n\n"
                return
            
            # Validate extraction result
            try:
                _validate_pdf_result(pdf_result)
            except HTTPException as e:
                yield f"data: {json.dumps({'type': 'error', 'message': e.detail})}\n\n"
                return
            
            # Send page extraction progress
            total_pages = len(pdf_result.pages)
            for i, page in enumerate(pdf_result.pages, 1):
                progress = 10 + int((i / total_pages) * 30)  # 10-40%
                yield f"data: {json.dumps({'type': 'page_extracted', 'page_number': page.page_number, 'total_pages': total_pages, 'progress': progress, 'text_preview': page.text[:200] + '...' if len(page.text) > 200 else page.text})}\n\n"
            
            # Step 3: Prepare metadata
            pdf_metadata_raw = {
                "pdf_metadata": pdf_result.metadata.dict(),
                "extraction_method": pdf_result.extraction_method,
                "page_count": pdf_result.metadata.page_count,
                "is_scanned": pdf_result.metadata.is_scanned,
                "has_tables": pdf_result.metadata.has_tables,
                "has_images": pdf_result.metadata.has_images,
                "file_name": filename,
                "file_url": url_path,
                "pdf_result": pdf_result.dict(),
            }
            pdf_metadata = convert_datetime_to_iso(pdf_metadata_raw)
            title = pdf_result.metadata.title or filename.replace('.pdf', '').replace('_', ' ').title()
            
            # Step 4: Extract concepts with progress
            if extract_concepts:
                yield f"data: {json.dumps({'type': 'progress', 'stage': 'extracting_concepts', 'message': 'Extracting concepts and relationships...', 'progress': 45})}\n\n"
            
            # Step 5: Extract claims
            if extract_claims:
                yield f"data: {json.dumps({'type': 'progress', 'stage': 'extracting_claims', 'message': 'Extracting claims and evidence...', 'progress': 60})}\n\n"
            
            # Step 6: Ingest into graph
            yield f"data: {json.dumps({'type': 'progress', 'stage': 'creating_graph', 'message': 'Creating graph nodes and relationships...', 'progress': 75})}\n\n"
            
            # Use a queue to pass events from ingestion thread to generator
            event_queue: Queue = Queue()
            ingestion_result_container = {"result": None, "error": None}
            ingestion_complete = threading.Event()
            ingestion_cancelled = threading.Event()
            
            def event_callback(event_type: str, event_data: dict):
                """Callback to emit extraction events in real-time via queue."""
                if ingestion_cancelled.is_set():
                    return  # Don't process events if cancelled
                    
                if event_type == "extraction":
                    # Try to find page number if concept name appears in PDF pages
                    page_number = None
                    concept_name = event_data.get("name", "").lower()
                    if concept_name and pdf_result and hasattr(pdf_result, 'pages'):
                        for page in pdf_result.pages:
                            if concept_name in page.text.lower():
                                page_number = page.page_number
                                break
                    
                    extraction_event = {
                        "type": "extraction",
                        "extraction_type": event_data.get("type", "concept"),
                        "name": event_data.get("name"),
                        "node_type": event_data.get("node_type", "concept"),
                        "action": event_data.get("action", "created"),
                        "description": event_data.get("description"),
                        "page": page_number,
                    }
                    # Put event in queue for real-time streaming
                    try:
                        event_queue.put(("event", extraction_event), timeout=1.0)
                        logger.debug(f"Queued extraction event: {extraction_event.get('name')}")
                    except Exception as e:
                        logger.warning(f"Failed to queue extraction event: {e}")
                        pass  # Queue full, skip this event
            
            def run_ingestion():
                """Run ingestion in a separate thread."""
                nonlocal thread_session
                thread_session = None
                try:
                    artifact_input = ArtifactInput(
                        artifact_type="pdf",
                        source_url=url_path,
                        source_id=filename,
                        title=title,
                        domain=domain or "General",
                        text=pdf_result.full_text,
                        metadata=pdf_metadata,
                        actions=IngestionActions(
                            run_lecture_extraction=extract_concepts,
                            run_chunk_and_claims=extract_claims,
                            embed_claims=extract_claims,
                            create_lecture_node=True,
                            create_artifact_node=True,
                        ),
                        policy=IngestionPolicy(
                            local_only=True,
                            max_chars=500_000,
                            min_chars=50,
                        ),
                    )
                    
                    # Create a new session for the thread (Neo4j sessions are not thread-safe)
                    # Use driver directly to avoid generator context manager issues
                    driver = get_driver()
                    thread_session = driver.session(database=NEO4J_DATABASE)
                    try:
                        if not ingestion_cancelled.is_set():
                            logger.info(f"Starting ingestion for {filename} with session {id(thread_session)}")
                            result = ingest_artifact(thread_session, artifact_input, event_callback=event_callback)
                            ingestion_result_container["result"] = result
                            logger.info(f"Ingestion completed for {filename}")
                    except Exception as ingestion_error:
                        # Don't re-raise - store error for main thread to handle
                        if not ingestion_cancelled.is_set():
                            ingestion_result_container["error"] = ingestion_error
                            logger.error(f"PDF ingestion failed for {filename}: {ingestion_error}", exc_info=True)
                except Exception as e:
                    if not ingestion_cancelled.is_set():
                        ingestion_result_container["error"] = e
                        logger.error(f"PDF ingestion thread error for {filename}: {e}", exc_info=True)
                finally:
                    # Close session after ingestion completes (but before signaling completion)
                    if thread_session:
                        try:
                            logger.debug(f"Closing thread session for {filename}")
                            thread_session.close()
                        except Exception as close_error:
                            logger.warning(f"Error closing thread session for {filename}: {close_error}")
                    # Signal that ingestion is complete
                    ingestion_complete.set()
                    try:
                        event_queue.put(("complete", None), timeout=1.0)
                    except:
                        pass
            
            # Start ingestion in a separate thread (non-daemon for proper cleanup)
            ingestion_thread = threading.Thread(target=run_ingestion)
            ingestion_thread.start()
            
            # Stream events in real-time as they arrive
            try:
                while True:
                    # Check if client disconnected (this is best-effort)
                    # Note: Can't use await in generator, so we skip disconnect check
                    # Client disconnect will be handled naturally when connection closes
                    
                    try:
                        # Check for events with a short timeout to allow real-time streaming
                        item_type, item_data = event_queue.get(timeout=0.1)
                        
                        if item_type == "event":
                            # Yield extraction event immediately
                            logger.debug(f"Yielding extraction event: {item_data.get('name', 'unknown')}")
                            yield f"data: {json.dumps(item_data)}\n\n"
                        elif item_type == "complete":
                            # Ingestion complete, break to process final result
                            break
                    except Empty:
                        # No event available, check if ingestion is complete
                        if ingestion_complete.is_set():
                            # Process any remaining events
                            while True:
                                try:
                                    item_type, item_data = event_queue.get_nowait()
                                    if item_type == "event":
                                        yield f"data: {json.dumps(item_data)}\n\n"
                                    elif item_type == "complete":
                                        break
                                except Empty:
                                    break
                            break
                        # Continue waiting for events
                        continue
            except GeneratorExit:
                # Client disconnected, cancel ingestion
                logger.warning(f"Client disconnected during PDF ingestion: {filename}")
                ingestion_cancelled.set()
                raise
            
            # Wait for thread to complete (with timeout)
            ingestion_thread.join(timeout=REQUEST_TIMEOUT_SECONDS)
            
            if ingestion_thread.is_alive():
                # Thread didn't complete in time
                ingestion_cancelled.set()
                yield f"data: {json.dumps({'type': 'error', 'message': 'Ingestion timeout - process took too long'})}\n\n"
                return
            
            # Get final result
            if ingestion_result_container["error"]:
                error = ingestion_result_container["error"]
                error_msg = str(error)
                logger.error(f"PDF ingestion error for {filename}: {error_msg}")
                yield f"data: {json.dumps({'type': 'error', 'message': error_msg})}\n\n"
                return
            
            ingestion_result = ingestion_result_container["result"]
            if not ingestion_result:
                yield f"data: {json.dumps({'type': 'error', 'message': 'Ingestion completed but no result was returned'})}\n\n"
                return
            
            # Send completion with results
            logger.info(f"PDF ingestion completed: {filename} - {ingestion_result.summary_counts.get('concepts_created', 0)} concepts, {ingestion_result.summary_counts.get('links_created', 0)} links")
            yield f"data: {json.dumps({'type': 'complete', 'status': ingestion_result.status, 'artifact_id': ingestion_result.artifact_id, 'run_id': ingestion_result.run_id, 'concepts_created': ingestion_result.summary_counts.get('concepts_created', 0), 'concepts_updated': ingestion_result.summary_counts.get('concepts_updated', 0), 'links_created': ingestion_result.summary_counts.get('links_created', 0), 'chunks_created': ingestion_result.summary_counts.get('chunks_created', 0), 'claims_created': ingestion_result.summary_counts.get('claims_created', 0), 'page_count': pdf_result.metadata.page_count, 'extraction_method': pdf_result.extraction_method, 'warnings': ingestion_result.warnings + pdf_result.warnings, 'errors': ingestion_result.errors + pdf_result.errors, 'progress': 100})}\n\n"
            
        except Exception as e:
            logger.error(f"Unexpected error in PDF ingestion stream: {e}", exc_info=True)
            try:
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            except:
                pass  # If we can't yield, connection is already broken
        finally:
            # Cleanup: ensure thread is stopped and session is closed
            if ingestion_thread and ingestion_thread.is_alive():
                logger.warning(f"PDF ingestion thread still running for {filename}, waiting for completion...")
                ingestion_thread.join(timeout=10)
            # Ensure thread session is closed if it still exists
            if 'thread_session' in locals() and thread_session:
                try:
                    thread_session.close()
                except:
                    pass  # Session may already be closed
    
    logger.info(f"Creating StreamingResponse for PDF ingestion: {file.filename}")
    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.post("/ingest", response_model=PDFIngestResponse)
async def ingest_pdf(
    file: UploadFile = File(...),
    domain: Optional[str] = Form(None, description="Domain/category for the PDF (e.g., 'Research', 'Legal', 'Academic')"),
    use_ocr: bool = Form(False, description="Enable OCR for scanned PDFs"),
    extract_tables: bool = Form(True, description="Extract tables as structured text"),
    extract_concepts: bool = Form(True, description="Extract concepts and relationships using LLM"),
    extract_claims: bool = Form(True, description="Extract claims and evidence"),
    request: Request = None,
    auth: dict = Depends(require_auth),
    session: Session = Depends(get_neo4j_session),
):
    """
    Ingest a PDF file into the knowledge graph.
    
    This endpoint:
    1. Extracts text and metadata from the PDF
    2. Uses LLM to extract concepts, relationships, and entities (names, dates, locations)
    3. Creates chunks and claims for evidence-based retrieval
    4. Links everything together in the graph
    5. Enables chat with the PDF content via the graph
    
    The PDF content becomes searchable and queryable through the chat interface.
    
    Args:
        file: PDF file to ingest
        domain: Optional domain/category
        use_ocr: Enable OCR for scanned PDFs
        extract_tables: Extract tables as structured text
        extract_concepts: Extract concepts and relationships (default: True)
        extract_claims: Extract claims and evidence (default: True)
    
    Returns:
        PDFIngestResponse with ingestion results and statistics
    """
    user_id = auth.get("user_id", "anonymous")
    
    # Rate limiting
    if not _check_rate_limit(user_id):
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded. Maximum {PDF_RATE_LIMIT_PER_MINUTE} PDFs per minute."
        )
    
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="File must be a PDF")
    
    # Step 1: Read and validate file size
    file_content = await file.read()
    file_size = len(file_content)
    _validate_file_size(file_size)
    
    filename = file.filename or "upload.pdf"
    logger.info(f"PDF ingestion started: {filename} ({file_size / (1024 * 1024):.1f}MB) by user {user_id}")
    
    # Step 2: Save uploaded file
    tenant_id = getattr(request.state, "tenant_id", None) if request else None
    url_path, storage_path = save_file(file_content, filename, tenant_id=tenant_id)
    
    # Step 3: Extract text and metadata from PDF
    try:
        pdf_result = extract_pdf_enhanced(
            pdf_path=storage_path,
            pdf_bytes=file_content,
            use_ocr=use_ocr,
            extract_tables=extract_tables,
        )
    except Exception as e:
        logger.error(f"PDF extraction failed for {filename}: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to extract PDF text: {str(e)}"
        )
    
    # Validate extraction result
    _validate_pdf_result(pdf_result)
    
    # Step 4: Prepare PDF metadata for ingestion
    # Convert datetime objects to ISO strings for JSON serialization
    pdf_metadata_raw = {
        "pdf_metadata": pdf_result.metadata.dict(),
        "extraction_method": pdf_result.extraction_method,
        "page_count": pdf_result.metadata.page_count,
        "is_scanned": pdf_result.metadata.is_scanned,
        "has_tables": pdf_result.metadata.has_tables,
        "has_images": pdf_result.metadata.has_images,
        "file_name": filename,
        "file_url": url_path,
        # Store PDF result for page-aware chunking
        "pdf_result": pdf_result.dict(),
    }
    
    # Convert datetime objects to ISO strings
    pdf_metadata = convert_datetime_to_iso(pdf_metadata_raw)
    
    # Use PDF title if available, otherwise use filename
    title = pdf_result.metadata.title or filename.replace('.pdf', '').replace('_', ' ').title()
    
    # Step 5: Ingest into graph using unified ingestion kernel
    try:
        artifact_input = ArtifactInput(
            artifact_type="pdf",
            source_url=url_path,
            source_id=filename,
            title=title,
            domain=domain or "General",
            text=pdf_result.full_text,
            metadata=pdf_metadata,
            actions=IngestionActions(
                run_lecture_extraction=extract_concepts,  # Extract concepts and relationships
                run_chunk_and_claims=extract_claims,      # Extract chunks and claims
                embed_claims=extract_claims,
                create_lecture_node=True,                  # Create lecture node for PDF
                create_artifact_node=True,                 # Create artifact node
            ),
            policy=IngestionPolicy(
                local_only=True,
                max_chars=500_000,  # Allow larger PDFs
                min_chars=50,
            ),
        )
        
        ingestion_result = ingest_artifact(session, artifact_input)
        
        logger.info(f"PDF ingestion completed: {filename} - {ingestion_result.summary_counts.get('concepts_created', 0)} concepts, {ingestion_result.summary_counts.get('links_created', 0)} links")
        
        return PDFIngestResponse(
            status=ingestion_result.status,
            artifact_id=ingestion_result.artifact_id,
            run_id=ingestion_result.run_id,
            concepts_created=ingestion_result.summary_counts.get("concepts_created", 0),
            concepts_updated=ingestion_result.summary_counts.get("concepts_updated", 0),
            links_created=ingestion_result.summary_counts.get("links_created", 0),
            chunks_created=ingestion_result.summary_counts.get("chunks_created", 0),
            claims_created=ingestion_result.summary_counts.get("claims_created", 0),
            page_count=pdf_result.metadata.page_count,
            extraction_method=pdf_result.extraction_method,
            warnings=ingestion_result.warnings + pdf_result.warnings,
            errors=ingestion_result.errors + pdf_result.errors,
        )
        
    except Exception as e:
        logger.error(f"PDF ingestion failed for {filename}: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to ingest PDF into graph: {str(e)}"
        )
