"""
Unified ingestion kernel - single entry point for artifact ingestion.

This module provides a unified ingestion function that handles all artifact types
(webpages, Notion pages, lectures, manual entries, PDFs) through a
consistent interface.

Do not call backend endpoints from backend services. Use ingestion kernel/internal services to prevent ingestion path drift.
"""
from typing import Optional, List, Dict, Any, Callable
from uuid import uuid4
from urllib.parse import urlparse
from neo4j import Session

from models_ingestion_kernel import ArtifactInput, IngestionResult
from services_branch_explorer import (
    ensure_graph_scoping_initialized,
    get_active_graph_context,
)
from services_ingestion_runs import (
    create_ingestion_run,
    update_ingestion_run_status,
)
from services_graph import (
    create_or_get_artifact,
    link_artifact_mentions_concept,
    normalize_text_for_hash,
    canonicalize_url,
)
from services_lecture_ingestion import (
    run_lecture_extraction_engine,
    run_chunk_and_claims_engine,
    run_segments_and_analogies_engine,
)
from services_pdf_enhanced import chunk_pdf_with_page_references
from models import Concept, LectureSegment, PDFExtractionResult


def ingest_artifact(
    session: Session, 
    payload: ArtifactInput,
    event_callback: Optional[Callable[[str, Dict[str, Any]], None]] = None,
    tenant_id: Optional[str] = None,
) -> IngestionResult:
    """
    Unified ingestion function for all artifact types.
    
    This is the single entry point for ingesting artifacts. It handles:
    - Policy enforcement (denylist, text length validation)
    - Graph scoping initialization
    - Ingestion run creation
    - Artifact node creation/reuse
    - Optional lecture extraction
    - Optional chunk and claims extraction
    - Linking artifacts to concepts
    - Status tracking and result reporting
    
    Args:
        session: Neo4j session
        payload: ArtifactInput with artifact details and actions
        event_callback: Optional callback function(event_type, event_data) for real-time events
        
    Returns:
        IngestionResult with run_id, artifact_id, status, and summary
    """
    warnings: List[str] = []
    errors: List[str] = []
    summary_counts: Dict[str, Any] = {
        "chunks_created": 0,
        "claims_created": 0,
        "concepts_created": 0,
        "concepts_updated": 0,
        "links_created": 0,
    }
    
    # ===== STEP 1: Policy Enforcement =====
    
    # Check denylist
    if payload.source_url and payload.policy.denylist_domains:
        try:
            parsed_url = urlparse(payload.source_url)
            domain = parsed_url.netloc
            if domain:
                # Remove port if present
                domain = domain.split(':')[0].lower()
                # Check against denylist (case-insensitive)
                if domain in [d.lower() for d in payload.policy.denylist_domains]:
                    return IngestionResult(
                        run_id="",  # No run created for skipped items
                        artifact_id=None,
                        status="SKIPPED",
                        reused_existing=False,
                        summary_counts={},
                        warnings=[],
                        errors=[f"Domain {domain} is in denylist"],
                    )
        except Exception as e:
            warnings.append(f"Failed to parse URL for denylist check: {e}")
    
    # Check text length - truncate if too long
    text = payload.text
    if len(text) > payload.policy.max_chars:
        text = text[:payload.policy.max_chars]
        warnings.append(f"Text truncated from {len(payload.text)} to {payload.policy.max_chars} characters")
        # Update metadata to indicate truncation
        payload.metadata = {**payload.metadata, "truncated": True, "original_length": len(payload.text)}
    
    # Check text length - fail if too short
    if len(text) < payload.policy.min_chars:
        return IngestionResult(
            run_id="",  # No run created for failed items
            artifact_id=None,
            status="FAILED",
            reused_existing=False,
            summary_counts={},
            warnings=warnings,
            errors=[f"Text too short: {len(text)} characters, minimum {payload.policy.min_chars} required"],
        )
    
    # ===== STEP 2: Graph Scoping Initialization =====
    
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session, tenant_id=tenant_id)
    
    # ===== STEP 3: Create Ingestion Run =====
    
    # Map artifact_type to source_type
    source_type_map = {
        "webpage": "WEB",
        "notion_page": "NOTION",
        "lecture": "LECTURE",
        "manual": "MANUAL",
        "pdf": "PDF",
    }
    source_type = source_type_map.get(payload.artifact_type, "UNKNOWN")
    
    # Determine source_label
    source_label = payload.title or payload.source_id or payload.source_url or "Untitled"
    
    ingestion_run = create_ingestion_run(
        session=session,
        source_type=source_type,
        source_label=source_label,
        tenant_id=tenant_id,
    )
    run_id = ingestion_run.run_id
    
    # ===== OPTIMIZATION: Check for Content Hash Match =====
    # If the exact same content exists for this URL, skip expensive processing.
    try:
        if payload.source_url:
            import hashlib
            normalized_text = normalize_text_for_hash(text)
            content_hash = hashlib.sha256(normalized_text.encode('utf-8')).hexdigest()
            canonical = canonicalize_url(payload.source_url, strip_query=payload.policy.strip_url_query)
            
            # Check for latest artifact at this URL
            check_query = """
            MATCH (g:GraphSpace {graph_id: $graph_id})
            MATCH (a:Artifact {graph_id: $graph_id, canonical_url: $canonical})
            RETURN a.content_hash as stored_hash, a.artifact_id as artifact_id
            ORDER BY a.created_at DESC
            LIMIT 1
            """
            result = session.run(check_query, graph_id=graph_id, canonical=canonical)
            record = result.single()
            
            if record and record["stored_hash"] == content_hash:
                print(f"[Ingestion Kernel] SKIPPING: Content unsync for {canonical} (Hash Match)")
                
                # Close the empty run as SKIPPED
                update_ingestion_run_status(
                    session=session,
                    run_id=run_id,
                    status="SKIPPED",
                    summary_counts={"skipped_reason": "content_unchanged"},
                    tenant_id=tenant_id,
                )
                
                return IngestionResult(
                    run_id=run_id,
                    artifact_id=record["artifact_id"],
                    status="SKIPPED",
                    reused_existing=True,
                    summary_counts={"skipped": True},
                    warnings=["Content unchanged, skipped processing"],
                    errors=[],
                    nodes_created=[],
                    nodes_updated=[],
                    links_created=[],
                    segments=[],
                )
    except Exception as e:
        print(f"[Ingestion Kernel] Warning: Failed to check content hash: {e}")
    
    try:
        # ===== STEP 4: Create or Reuse Artifact Node =====
        
        # Prepare metadata with basics
        artifact_metadata = {
            **payload.metadata,
            "artifact_type": payload.artifact_type,
            "title": payload.title,
            "domain": payload.domain,
            "source_id": payload.source_id,
        }
        
        artifact_result = create_or_get_artifact(
            session=session,
            artifact_type=payload.artifact_type,
            source_url=payload.source_url,
            source_id=payload.source_id,
            title=payload.title,
            text=text,
            metadata=artifact_metadata,
            created_by_run_id=run_id,
            strip_url_query=payload.policy.strip_url_query,
            tenant_id=tenant_id,
        )
        
        artifact_id = artifact_result["artifact_id"]
        reused_existing = artifact_result["reused_existing"]
        
        # ===== STEP 5: Handle Lecture Extraction (if requested) =====
        
        lecture_id: Optional[str] = None
        nodes_created: List[Concept] = []
        nodes_updated: List[Concept] = []
        links_created: List[Dict[str, Any]] = []
        segments: List[LectureSegment] = []
        node_name_to_id: Dict[str, str] = {}
        created_claim_ids: List[str] = []
        
        if payload.actions.run_lecture_extraction:
            # Generate lecture_id based on artifact_type
            if payload.artifact_type in ["lecture", "notion_page", "webpage", "manual", "pdf"]:
                lecture_id = f"LECTURE_{uuid4().hex[:8].upper()}"
                
                # Determine lecture title and text
                lecture_title = payload.title or source_label
                lecture_text = text
                
                try:
                    extraction_result = run_lecture_extraction_engine(
                        session=session,
                        lecture_title=lecture_title,
                        lecture_text=lecture_text,
                        domain=payload.domain,
                        run_id=run_id,
                        lecture_id=lecture_id,
                        event_callback=event_callback,
                        tenant_id=tenant_id,
                    )
                    
                    nodes_created = extraction_result.get("nodes_created", [])
                    nodes_updated = extraction_result.get("nodes_updated", [])
                    links_created = extraction_result.get("links_created", [])
                    node_name_to_id = extraction_result.get("node_name_to_id", {})
                    
                    summary_counts["concepts_created"] = extraction_result.get("concepts_created", 0)
                    summary_counts["concepts_updated"] = extraction_result.get("concepts_updated", 0)
                    summary_counts["links_created"] = len(links_created)
                    
                    if extraction_result.get("errors"):
                        errors.extend(extraction_result["errors"])
                    
                    # Run segments and analogies engine
                    try:
                        segments = run_segments_and_analogies_engine(
                            session=session,
                            lecture_id=lecture_id,
                            lecture_title=lecture_title,
                            lecture_text=lecture_text,
                            domain=payload.domain,
                            node_name_to_id=node_name_to_id,
                            nodes_created=nodes_created,
                            nodes_updated=nodes_updated,
                            tenant_id=tenant_id,
                        )
                    except Exception as e:
                        error_msg = f"Segments and analogies extraction failed: {str(e)}"
                        errors.append(error_msg)
                        print(f"[Ingestion Kernel] ERROR: {error_msg}")
                    
                    # Create Lecture node if requested (properly scoped to graph + branch)
                    if payload.actions.create_lecture_node and lecture_id:
                        try:
                            # Extract markdown from metadata if available (for Notion pages)
                            markdown = payload.metadata.get("markdown") if payload.metadata else None
                            
                            # Create or update Lecture node with proper graph scoping
                            # graph_id and branch_id are already available from Step 2
                            lecture_query = """
                            MATCH (g:GraphSpace {graph_id: $graph_id})
                            MERGE (l:Lecture {lecture_id: $lecture_id})
                            ON CREATE SET l.graph_id = $graph_id,
                                          l.on_branches = [$branch_id],
                                          l.title = $title,
                                          l.raw_text = $raw_text,
                                          l.metadata_json = $metadata_json
                            ON MATCH SET l.title = COALESCE(l.title, $title),
                                         l.raw_text = COALESCE(l.raw_text, $raw_text),
                                         l.graph_id = COALESCE(l.graph_id, $graph_id),
                                         l.metadata_json = COALESCE($metadata_json, l.metadata_json),
                                         l.on_branches = CASE
                                           WHEN $branch_id IN COALESCE(l.on_branches, []) THEN l.on_branches
                                           ELSE COALESCE(l.on_branches, []) + $branch_id
                                         END
                            MERGE (l)-[:BELONGS_TO]->(g)
                            RETURN l.lecture_id AS lecture_id
                            """
                            import json
                            metadata_json = json.dumps({"markdown": markdown}) if markdown else None
                            session.run(
                                lecture_query,
                                graph_id=graph_id,
                                branch_id=branch_id,
                                lecture_id=lecture_id,
                                title=lecture_title,
                                raw_text=lecture_text,
                                metadata_json=metadata_json,
                            )
                            print(f"[Ingestion Kernel] Created/updated Lecture node: {lecture_id} (scoped to graph {graph_id}, branch {branch_id})")
                        except Exception as e:
                            error_msg = f"Failed to create Lecture node: {str(e)}"
                            errors.append(error_msg)
                            print(f"[Ingestion Kernel] ERROR: {error_msg}")
                        
                except Exception as e:
                    error_msg = f"Lecture extraction failed: {str(e)}"
                    errors.append(error_msg)
                    print(f"[Ingestion Kernel] ERROR: {error_msg}")
        # ===== STEP 6: Handle Chunk and Claims (if requested) =====
        
        if payload.actions.run_chunk_and_claims:
            # Determine source_id for chunk/claims engine
            # Use lecture_id if it exists, otherwise use artifact_id
            chunk_source_id = lecture_id if lecture_id else artifact_id
            chunk_source_label = payload.title or source_label
            
            # Collect all known concepts from lecture extraction
            known_concepts = nodes_created + nodes_updated
            
            # Check if this is a PDF with page metadata
            pdf_result = None
            if payload.metadata and "pdf_result" in payload.metadata:
                try:
                    pdf_result = PDFExtractionResult(**payload.metadata["pdf_result"])
                    print(f"[Ingestion Kernel] Detected PDF with {len(pdf_result.pages)} pages, using page-aware chunking")
                except Exception as e:
                    print(f"[Ingestion Kernel] Warning: Failed to parse PDF result from metadata: {e}")
                    pdf_result = None
            
            try:
                # Use PDF-specific chunking if PDF metadata is available
                if pdf_result:
                    # Use PDF chunking with page references
                    pdf_chunks = chunk_pdf_with_page_references(
                        pdf_result,
                        max_chars=1200,
                        overlap=150,
                    )
                    # Convert PDF chunks to format expected by chunk_and_claims_engine
                    # We'll need to modify run_chunk_and_claims_engine to accept pre-chunked data
                    # For now, pass the full text but store PDF metadata for later use
                    chunk_claims_result = run_chunk_and_claims_engine(
                        session=session,
                        source_id=chunk_source_id,
                        source_label=chunk_source_label,
                        domain=payload.domain,
                        text=text,
                        run_id=run_id,
                        known_concepts=known_concepts,
                        include_existing_concepts=True,
                        pdf_chunks=pdf_chunks,  # Pass PDF chunks for page reference storage
                        tenant_id=tenant_id,
                    )
                else:
                    # Standard chunking
                    chunk_claims_result = run_chunk_and_claims_engine(
                        session=session,
                        source_id=chunk_source_id,
                        source_label=chunk_source_label,
                        domain=payload.domain,
                        text=text,
                        run_id=run_id,
                        known_concepts=known_concepts,
                        include_existing_concepts=True,
                        tenant_id=tenant_id,
                    )
                
                summary_counts["chunks_created"] = chunk_claims_result.get("chunks_created", 0)
                summary_counts["claims_created"] = chunk_claims_result.get("claims_created", 0)
                created_claim_ids = chunk_claims_result.get("claim_ids", [])
                
                if chunk_claims_result.get("errors"):
                    errors.extend(chunk_claims_result["errors"])
                    
            except Exception as e:
                error_msg = f"Chunk and claims extraction failed: {str(e)}"
                errors.append(error_msg)
                print(f"[Ingestion Kernel] ERROR: {error_msg}")
        
        # ===== STEP 7: Link Artifact to Concepts =====
        
        # Link artifact to all concepts from nodes_created + nodes_updated
        all_concepts = nodes_created + nodes_updated
        for concept in all_concepts:
            try:
                link_artifact_mentions_concept(
                    session=session,
                    artifact_id=artifact_id,
                    concept_node_id=concept.node_id,
                    ingestion_run_id=run_id,
                    tenant_id=tenant_id,
                )
            except Exception as e:
                error_msg = f"Failed to link artifact to concept {concept.node_id}: {str(e)}"
                errors.append(error_msg)
                print(f"[Ingestion Kernel] ERROR: {error_msg}")
        
        # ===== STEP 8: Update Ingestion Run Status =====
        
        # Determine final status
        if errors and len(errors) > 0:
            # If we have errors but also some success, it's PARTIAL
            if (summary_counts["concepts_created"] > 0 or 
                summary_counts["concepts_updated"] > 0 or 
                summary_counts["chunks_created"] > 0 or 
                summary_counts["claims_created"] > 0):
                status = "PARTIAL"
            else:
                status = "FAILED"
        else:
            status = "COMPLETED"
        
        # Update ingestion run with final status
        update_ingestion_run_status(
            session=session,
            run_id=run_id,
            status=status,
            summary_counts=summary_counts,
            error_count=len(errors) if errors else None,
            errors=errors if errors else None,
            tenant_id=tenant_id,
        )
        
        # ===== STEP 9: Return Result =====
        
        # Extract concept IDs from nodes
        created_concept_ids = [concept.node_id for concept in nodes_created]
        updated_concept_ids = [concept.node_id for concept in nodes_updated]
        
        # Count relationships
        created_relationship_count = len(links_created)
        
        return IngestionResult(
            run_id=run_id,
            artifact_id=artifact_id,
            status=status,
            reused_existing=reused_existing,
            summary_counts=summary_counts,
            warnings=warnings,
            errors=errors,
            lecture_id=lecture_id,
            nodes_created=nodes_created,
            nodes_updated=nodes_updated,
            links_created=links_created,
            segments=segments,
            created_concept_ids=created_concept_ids,
            updated_concept_ids=updated_concept_ids,
            created_relationship_count=created_relationship_count,
            created_claim_ids=created_claim_ids,
        )
        
    except Exception as e:
        # If anything fails, update run status to FAILED
        error_msg = f"Ingestion failed: {str(e)}"
        errors.append(error_msg)
        print(f"[Ingestion Kernel] FATAL ERROR: {error_msg}")
        
        try:
            update_ingestion_run_status(
                session=session,
                run_id=run_id,
                status="FAILED",
                summary_counts=summary_counts,
                error_count=len(errors),
                errors=errors,
            )
        except Exception as update_error:
            print(f"[Ingestion Kernel] Failed to update run status: {update_error}")
        
        return IngestionResult(
            run_id=run_id,
            artifact_id=None,
            status="FAILED",
            reused_existing=False,
            summary_counts=summary_counts,
            warnings=warnings,
            errors=errors,
            lecture_id=None,
            nodes_created=[],
            nodes_updated=[],
            links_created=[],
            segments=[],
            created_concept_ids=[],
            updated_concept_ids=[],
            created_relationship_count=0,
            created_claim_ids=[],
        )
