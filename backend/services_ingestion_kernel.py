"""
Unified ingestion kernel - single entry point for artifact ingestion.

This module provides a unified ingestion function that handles all artifact types
(webpages, Notion pages, finance docs, lectures, manual entries) through a
consistent interface.

Do not call backend endpoints from backend services. Use ingestion kernel/internal services to prevent ingestion path drift.
"""
from typing import Optional, List, Dict, Any
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
)
from services_lecture_ingestion import (
    run_lecture_extraction_engine,
    run_chunk_and_claims_engine,
    run_segments_and_analogies_engine,
)
from models import Concept, LectureSegment


def ingest_artifact(session: Session, payload: ArtifactInput) -> IngestionResult:
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
    graph_id, branch_id = get_active_graph_context(session)
    
    # ===== STEP 3: Create Ingestion Run =====
    
    # Map artifact_type to source_type
    source_type_map = {
        "webpage": "WEB",
        "notion_page": "NOTION",
        "finance_doc": "FINANCE_DOC",
        "lecture": "LECTURE",
        "manual": "MANUAL",
    }
    source_type = source_type_map.get(payload.artifact_type, "UNKNOWN")
    
    # Determine source_label
    source_label = payload.title or payload.source_id or payload.source_url or "Untitled"
    
    ingestion_run = create_ingestion_run(
        session=session,
        source_type=source_type,
        source_label=source_label,
    )
    run_id = ingestion_run.run_id
    
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
            if payload.artifact_type in ["lecture", "notion_page", "webpage", "manual"]:
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
                        )
                    except Exception as e:
                        error_msg = f"Segments and analogies extraction failed: {str(e)}"
                        errors.append(error_msg)
                        print(f"[Ingestion Kernel] ERROR: {error_msg}")
                        
                except Exception as e:
                    error_msg = f"Lecture extraction failed: {str(e)}"
                    errors.append(error_msg)
                    print(f"[Ingestion Kernel] ERROR: {error_msg}")
            elif payload.artifact_type == "finance_doc":
                # Skip lecture extraction for finance_doc by default unless explicitly enabled
                # (This is handled by the run_lecture_extraction flag)
                pass
        
        # ===== STEP 6: Handle Chunk and Claims (if requested) =====
        
        if payload.actions.run_chunk_and_claims:
            # Determine source_id for chunk/claims engine
            # Use lecture_id if it exists, otherwise use artifact_id
            chunk_source_id = lecture_id if lecture_id else artifact_id
            chunk_source_label = payload.title or source_label
            
            # Collect all known concepts from lecture extraction
            known_concepts = nodes_created + nodes_updated
            
            try:
                chunk_claims_result = run_chunk_and_claims_engine(
                    session=session,
                    source_id=chunk_source_id,
                    source_label=chunk_source_label,
                    domain=payload.domain,
                    text=text,
                    run_id=run_id,
                    known_concepts=known_concepts,
                    include_existing_concepts=True,
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

