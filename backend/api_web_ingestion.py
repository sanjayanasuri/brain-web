"""
API endpoints for webpage ingestion.

This module handles ingestion of webpages from the browser extension.
It creates SourceDocument artifacts, chunks text, and extracts claims.
"""
from typing import Dict, Any, Optional, List
from fastapi import APIRouter, Depends, HTTPException, Request
from neo4j import Session
from pydantic import BaseModel
import hashlib
import json
from urllib.parse import urlparse
from uuid import uuid4

from db_neo4j import get_neo4j_session
from services_ingestion_runs import (
    create_ingestion_run,
    update_ingestion_run_status,
)
from services_branch_explorer import (
    ensure_graph_scoping_initialized,
    get_active_graph_context,
)
from services_sources import (
    upsert_source_document,
    get_source_document,
    mark_source_document_status,
)
from services_graph import (
    canonicalize_url,
    upsert_source_chunk,
    upsert_claim,
    link_claim_mentions,
    get_all_concepts,
)
from services_lecture_ingestion import chunk_text
from services_claims import extract_claims_from_chunk
from models import Concept

router = APIRouter(prefix="/web", tags=["web"])


def _normalize_name(name: str) -> str:
    """Normalize concept name for matching."""
    return name.lower().strip()


def _compute_checksum(canonical_url: str, text: str) -> str:
    """Compute SHA256 checksum of canonical_url + text."""
    combined = canonical_url + text
    return hashlib.sha256(combined.encode('utf-8')).hexdigest()


class WebIngestRequest(BaseModel):
    """Request to ingest a webpage via the extension."""
    url: str
    title: Optional[str] = None
    capture_mode: str = "reader"  # "selection" | "reader" | "full"
    text: str  # extracted body text from extension
    selection_text: Optional[str] = None
    domain: Optional[str] = "General"
    tags: List[str] = []
    note: Optional[str] = None
    metadata: Dict[str, Any] = {}


class WebIngestResponse(BaseModel):
    """Response from web ingestion endpoint."""
    status: str  # "INGESTED" | "SKIPPED" | "FAILED"
    artifact_id: str  # doc_id from SourceDocument
    run_id: Optional[str] = None
    chunks_created: int = 0
    claims_created: int = 0
    errors: List[str] = []


def _check_local_only(request: Request) -> None:
    """Check if request is from localhost, raise 403 if not."""
    client_host = request.client.host if request.client else None
    if not client_host:
        raise HTTPException(status_code=403, detail="Cannot determine client host")
    
    # Allow localhost variants
    allowed_hosts = ["127.0.0.1", "::1", "localhost"]
    if client_host not in allowed_hosts and not client_host.startswith("127."):
        raise HTTPException(
            status_code=403,
            detail=f"Web ingestion endpoint is only accessible from localhost. Client: {client_host}"
        )


@router.post("/ingest", response_model=WebIngestResponse)
def ingest_web(
    payload: WebIngestRequest,
    request: Request,
    session: Session = Depends(get_neo4j_session),
):
    """
    Ingest a webpage from the browser extension.
    
    This endpoint:
    1. Validates local-only access
    2. Creates an ingestion run
    3. Canonicalizes URL and computes checksum for idempotency
    4. Checks if already ingested (by canonical_url + checksum)
    5. Creates/updates SourceDocument
    6. Chunks text and extracts claims
    7. Links claims to existing concepts
    
    Args:
        payload: WebIngestRequest with webpage details
        request: FastAPI request (for local-only check)
        session: Neo4j session (dependency)
    
    Returns:
        WebIngestResponse with status, artifact_id, run_id, and counts
    """
    errors: List[str] = []
    
    # Step 1: Local-only guard
    try:
        _check_local_only(request)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=403, detail=f"Access check failed: {str(e)}")
    
    # Step 2: Ensure graph scoping
    try:
        ensure_graph_scoping_initialized(session)
        graph_id, branch_id = get_active_graph_context(session)
    except Exception as e:
        errors.append(f"Failed to initialize graph scoping: {str(e)}")
        return WebIngestResponse(
            status="FAILED",
            artifact_id="",
            errors=errors,
        )
    
    # Step 3: Canonicalize URL and compute checksum
    # Canonicalize: strip fragments, remove query params (including UTM params), normalize
    try:
        canonical_url_str = canonicalize_url(payload.url, strip_query=True)
    except Exception as e:
        errors.append(f"Failed to canonicalize URL: {str(e)}")
        canonical_url_str = payload.url  # Fallback to original URL
    
    # Compute checksum for idempotency (canonical_url + text)
    checksum = _compute_checksum(canonical_url_str, payload.text)
    
    # Step 4: Create ingestion run
    try:
        ingestion_run = create_ingestion_run(
            session=session,
            source_type="WEB",
            source_label=payload.url,
        )
        run_id = ingestion_run.run_id
    except Exception as e:
        errors.append(f"Failed to create ingestion run: {str(e)}")
        return WebIngestResponse(
            status="FAILED",
            artifact_id="",
            errors=errors,
        )
    
    # Step 5: Prepare metadata
    hostname = urlparse(payload.url).netloc if payload.url else None
    metadata = {
        "title": payload.title,
        "capture_mode": payload.capture_mode,
        "tags": payload.tags,
        "note": payload.note,
        "selection_text": payload.selection_text,
        "hostname": hostname,
        "canonical_url": canonical_url_str,
        "content_checksum": checksum,  # Store our custom checksum for idempotency
        **payload.metadata,
    }
    
    # Step 6: Upsert SourceDocument
    try:
        doc_data = upsert_source_document(
            session=session,
            graph_id=graph_id,
            branch_id=branch_id,
            source="WEB",
            external_id=canonical_url_str,
            url=payload.url,
            text=payload.text,
            metadata=metadata,
        )
        artifact_id = doc_data["doc_id"]
    except Exception as e:
        errors.append(f"Failed to create SourceDocument: {str(e)}")
        update_ingestion_run_status(
            session=session,
            run_id=run_id,
            status="FAILED",
            errors=errors,
        )
        return WebIngestResponse(
            status="FAILED",
            artifact_id="",
            run_id=run_id,
            errors=errors,
        )
    
    # Step 7: Check idempotency
    existing_doc = get_source_document(session, graph_id, artifact_id)
    if existing_doc:
        existing_status = existing_doc.get("status")
        # Check our custom checksum from metadata
        existing_metadata = existing_doc.get("metadata")
        existing_content_checksum = None
        if existing_metadata:
            try:
                if isinstance(existing_metadata, str):
                    existing_metadata_dict = json.loads(existing_metadata)
                else:
                    existing_metadata_dict = existing_metadata
                existing_content_checksum = existing_metadata_dict.get("content_checksum")
            except Exception:
                pass
        
        # If already ingested and checksum matches, skip
        if existing_status == "INGESTED" and existing_content_checksum == checksum:
            update_ingestion_run_status(
                session=session,
                run_id=run_id,
                status="COMPLETED",
                summary_counts={"chunks_created": 0, "claims_created": 0},
            )
            return WebIngestResponse(
                status="SKIPPED",
                artifact_id=artifact_id,
                run_id=run_id,
                chunks_created=0,
                claims_created=0,
                errors=[],
            )
    
    # Step 8: Chunk text
    try:
        chunks = chunk_text(payload.text, max_chars=1200, overlap=150)
        if not chunks:
            errors.append("No chunks created from text")
            mark_source_document_status(session, graph_id, artifact_id, "FAILED", "No chunks created")
            update_ingestion_run_status(
                session=session,
                run_id=run_id,
                status="FAILED",
                errors=errors,
            )
            return WebIngestResponse(
                status="FAILED",
                artifact_id=artifact_id,
                run_id=run_id,
                errors=errors,
            )
    except Exception as e:
        errors.append(f"Failed to chunk text: {str(e)}")
        mark_source_document_status(session, graph_id, artifact_id, "FAILED", str(e))
        update_ingestion_run_status(
            session=session,
            run_id=run_id,
            status="FAILED",
            errors=errors,
        )
        return WebIngestResponse(
            status="FAILED",
            artifact_id=artifact_id,
            run_id=run_id,
            errors=errors,
        )
    
    # Step 9: Get existing concepts for mention resolution
    try:
        existing_concepts = get_all_concepts(session)
        existing_concept_map = {_normalize_name(c.name): c.node_id for c in existing_concepts}
        known_concepts = [
            {"name": c.name, "node_id": c.node_id, "description": c.description}
            for c in existing_concepts
        ]
    except Exception as e:
        errors.append(f"Failed to get existing concepts: {str(e)}")
        known_concepts = []
        existing_concept_map = {}
    
    # Step 10: Process chunks and extract claims
    chunks_created = 0
    claims_created = 0
    
    for chunk in chunks:
        chunk_id = f"CHUNK_{uuid4().hex[:8].upper()}"
        
        # Create SourceChunk
        chunk_metadata = {
            "source": "WEB",
            "external_id": canonical_url_str,
            "doc_id": artifact_id,
            "domain": payload.domain,
            "capture_mode": payload.capture_mode,
        }
        try:
            upsert_source_chunk(
                session=session,
                graph_id=graph_id,
                branch_id=branch_id,
                chunk_id=chunk_id,
                source_id=artifact_id,
                chunk_index=chunk["index"],
                text=chunk["text"],
                metadata=chunk_metadata,
            )
            # Note: FROM_DOCUMENT relationship is now created automatically in upsert_source_chunk
            chunks_created += 1
        except Exception as e:
            error_msg = f"Failed to create SourceChunk {chunk_id}: {str(e)}"
            errors.append(error_msg)
            continue
        
        # Extract claims from chunk
        try:
            claims = extract_claims_from_chunk(chunk["text"], known_concepts)
        except Exception as e:
            error_msg = f"Failed to extract claims from chunk {chunk_id}: {str(e)}"
            errors.append(error_msg)
            continue
        
        # Process each claim
        for claim_data in claims:
            claim_id = f"CLAIM_{uuid4().hex[:8].upper()}"
            
            # Resolve mentioned concept node_ids
            mentioned_node_ids = []
            for concept_name in claim_data.get("mentioned_concept_names", []):
                normalized = _normalize_name(concept_name)
                if normalized in existing_concept_map:
                    mentioned_node_ids.append(existing_concept_map[normalized])
            
            # Create Claim
            try:
                upsert_claim(
                    session=session,
                    graph_id=graph_id,
                    branch_id=branch_id,
                    claim_id=claim_id,
                    text=claim_data["claim_text"],
                    confidence=claim_data.get("confidence", 0.5),
                    method="llm",
                    source_id=artifact_id,
                    source_span=claim_data.get("source_span", f"chunk {chunk['index']}"),
                    chunk_id=chunk_id,
                    ingestion_run_id=run_id,
                )
                
                # Link claim to mentioned concepts
                if mentioned_node_ids:
                    try:
                        link_claim_mentions(
                            session=session,
                            graph_id=graph_id,
                            claim_id=claim_id,
                            mentioned_node_ids=mentioned_node_ids,
                        )
                    except Exception as e:
                        error_msg = f"Failed to link claim {claim_id} to concepts: {str(e)}"
                        errors.append(error_msg)
                
                claims_created += 1
            except Exception as e:
                error_msg = f"Failed to create Claim {claim_id}: {str(e)}"
                errors.append(error_msg)
                continue
    
    # Step 11: Mark SourceDocument status
    if chunks_created > 0:
        mark_source_document_status(session, graph_id, artifact_id, "INGESTED")
    else:
        mark_source_document_status(session, graph_id, artifact_id, "FAILED", "No chunks created")
    
    # Step 12: Update ingestion run status
    summary_counts = {
        "chunks_created": chunks_created,
        "claims_created": claims_created,
    }
    final_status = "COMPLETED" if chunks_created > 0 else "FAILED"
    update_ingestion_run_status(
        session=session,
        run_id=run_id,
        status=final_status,
        summary_counts=summary_counts,
        errors=errors if errors else None,
    )
    
    # Step 13: Return response
    response_status = "INGESTED" if chunks_created > 0 else "FAILED"
    return WebIngestResponse(
        status=response_status,
        artifact_id=artifact_id,
        run_id=run_id,
        chunks_created=chunks_created,
        claims_created=claims_created,
        errors=errors,
    )
