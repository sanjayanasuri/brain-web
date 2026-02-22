"""
Unified ingestion kernel - single entry point for artifact ingestion.

This module provides a unified ingestion function that handles all artifact types
(webpages, Notion pages, lectures, manual entries, PDFs) through a
consistent interface.

Do not call backend endpoints from backend services. Use ingestion kernel/internal services to prevent ingestion path drift.
"""
import hashlib
import json
import logging
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
    upsert_quote,
)
from services_lecture_ingestion import (
    run_lecture_extraction_engine,
    run_chunk_and_claims_engine,
    run_segments_and_analogies_engine,
)
from services_pdf_enhanced import chunk_pdf_with_page_references
from services_trails import append_step
from models import Concept, LectureSegment, PDFExtractionResult

logger = logging.getLogger("brain_web")

def ingest_artifact(
    session: Session, 
    payload: ArtifactInput,
    event_callback: Optional[Callable[[str, Dict[str, Any]], None]] = None,
    tenant_id: Optional[str] = None,
    graph_id: Optional[str] = None,
    branch_id: Optional[str] = None,
) -> IngestionResult:
    """
    Unified ingestion function for all artifact types.
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
    if payload.source_url and payload.policy.denylist_domains:
        try:
            parsed_url = urlparse(payload.source_url)
            domain = parsed_url.netloc
            if domain:
                domain = domain.split(':')[0].lower()
                if domain in [d.lower() for d in payload.policy.denylist_domains]:
                    return IngestionResult(run_id="", status="SKIPPED", errors=[f"Domain {domain} is in denylist"])
        except Exception as e:
            warnings.append(f"Failed to parse URL for denylist check: {e}")
    
    text = payload.text
    if len(text) > payload.policy.max_chars:
        text = text[:payload.policy.max_chars]
        warnings.append(f"Text truncated to {payload.policy.max_chars} characters")
    
    if len(text) < payload.policy.min_chars:
        return IngestionResult(run_id="", status="FAILED", errors=[f"Text too short ({len(text)} chars)"])
    
    # ===== STEP 2: Graph Scoping =====
    if not graph_id or branch_id is None:
        ensure_graph_scoping_initialized(session)
        g_id, b_id = get_active_graph_context(session, tenant_id=tenant_id)
        if not graph_id: graph_id = g_id
        if branch_id is None: branch_id = b_id
    
    # ===== STEP 3: Create Ingestion Run =====
    source_type_map = {"webpage":"WEB", "notion_page":"NOTION", "lecture":"LECTURE", "manual":"MANUAL", "pdf":"PDF"}
    source_type = source_type_map.get(payload.artifact_type, "UNKNOWN")
    source_label = payload.title or payload.source_id or payload.source_url or "Untitled"
    
    ingestion_run = create_ingestion_run(session=session, source_type=source_type, source_label=source_label, tenant_id=tenant_id)
    run_id = ingestion_run.run_id
    
    # Optimization: Content Hash Check
    if payload.source_url:
        normalized_text = normalize_text_for_hash(text)
        content_hash = hashlib.sha256(normalized_text.encode('utf-8')).hexdigest()
        canonical = canonicalize_url(payload.source_url, strip_query=payload.policy.strip_url_query)
        
        check_query = "MATCH (g:GraphSpace {graph_id: $graph_id}), (a:Artifact {graph_id: $graph_id, canonical_url: $canonical}) RETURN a.content_hash as stored_hash, a.artifact_id as artifact_id ORDER BY a.created_at DESC LIMIT 1"
        res = session.run(check_query, graph_id=graph_id, canonical=canonical).single()
        if res and res["stored_hash"] == content_hash:
            update_ingestion_run_status(session=session, run_id=run_id, status="SKIPPED", summary_counts={"skipped_reason": "content_unchanged"}, tenant_id=tenant_id)
            return IngestionResult(run_id=run_id, artifact_id=res["artifact_id"], status="SKIPPED", reused_existing=True, warnings=["Content unchanged"])

    try:
        # ===== STEP 4: Create/Reuse Artifact =====
        artifact_result = create_or_get_artifact(
            session=session, artifact_type=payload.artifact_type, source_url=payload.source_url,
            source_id=payload.source_id or payload.existing_artifact_id, 
            title=payload.title, text=text,
            metadata={**payload.metadata, "artifact_type": payload.artifact_type},
            created_by_run_id=run_id, strip_url_query=payload.policy.strip_url_query, tenant_id=tenant_id
        )
        artifact_id = payload.existing_artifact_id or artifact_result["artifact_id"]
        reused_existing = artifact_result["reused_existing"] if not payload.existing_artifact_id else True

        # ===== OPTIONAL: Selection Quote =====
        quote_id = None
        if payload.selection_text and payload.anchor:
            try:
                anchor_exact = payload.anchor.get("exact", payload.selection_text)
                anchor_prefix = payload.anchor.get("prefix", "") or ""
                anchor_suffix = payload.anchor.get("suffix", "") or ""
                quote_hash = hashlib.sha256(f"{payload.source_url}\n{anchor_exact}\n{anchor_prefix}\n{anchor_suffix}".encode("utf-8")).hexdigest()[:16].upper()
                quote_id = f"QUOTE_{quote_hash}"
                upsert_quote(session=session, graph_id=graph_id, branch_id=branch_id, quote_id=quote_id, text=payload.selection_text, anchor=payload.anchor, source_doc_id=artifact_id, user_note=payload.metadata.get("note"), tags=payload.metadata.get("tags"))
                
                # Link Concept -> Quote if requested
                if payload.attach_concept_id:
                    session.run("""
                        MATCH (c:Concept {graph_id: $graph_id, node_id: $concept_id})
                        MATCH (q:Quote {graph_id: $graph_id, quote_id: $quote_id})
                        MERGE (c)-[r:MENTIONS_QUOTE {graph_id: $graph_id}]->(q)
                        SET r.on_branches = CASE
                          WHEN r.on_branches IS NULL THEN [$branch_id]
                          WHEN $branch_id IN r.on_branches THEN r.on_branches
                          ELSE r.on_branches + $branch_id
                        END
                    """, graph_id=graph_id, branch_id=branch_id, concept_id=payload.attach_concept_id, quote_id=quote_id)
            except Exception as e: warnings.append(f"Quote creation failed: {e}")

        # ===== OPTIONAL: Append to Trail =====
        if payload.trail_id:
            try:
                append_step(session=session, graph_id=graph_id, branch_id=branch_id, trail_id=payload.trail_id, kind="page", ref_id=payload.source_url or artifact_id, title=payload.title, note=payload.metadata.get("note"), meta={"capture_mode": payload.metadata.get("capture_mode"), "domain": payload.domain})
                if quote_id: append_step(session=session, graph_id=graph_id, branch_id=branch_id, trail_id=payload.trail_id, kind="quote", ref_id=quote_id, title=payload.selection_text[:100] if payload.selection_text else None)
            except Exception as e: warnings.append(f"Trail append failed: {e}")

        # ===== STEP 5: Lecture Extraction =====
        lecture_id = payload.existing_artifact_id if payload.artifact_type == "lecture" else None
        nodes_created = []
        nodes_updated = []
        links_created = []
        segments = []
        node_name_to_id = {}
        created_claim_ids = []

        if payload.actions.run_lecture_extraction:
            if not lecture_id:
                lecture_id = f"LECTURE_{uuid4().hex[:8].upper()}"
            try:
                ext_res = run_lecture_extraction_engine(session, payload.title or source_label, text, payload.domain, run_id, lecture_id, event_callback, tenant_id)
                nodes_created, nodes_updated, links_created = ext_res.get("nodes_created", []), ext_res.get("nodes_updated", []), ext_res.get("links_created", [])
                node_name_to_id = ext_res.get("node_name_to_id", {})
                summary_counts.update({"concepts_created": ext_res.get("concepts_created", 0), "concepts_updated": ext_res.get("concepts_updated", 0), "links_created": len(links_created)})
                if ext_res.get("errors"): errors.extend(ext_res["errors"])
                
                segments = run_segments_and_analogies_engine(session, lecture_id, payload.title or source_label, text, payload.domain, node_name_to_id, nodes_created, nodes_updated, tenant_id)
                
                if payload.actions.create_lecture_node:
                    session.run("MATCH (g:GraphSpace {graph_id: $graph_id}) MERGE (l:Lecture {lecture_id: $lecture_id}) SET l.graph_id = $graph_id, l.on_branches = [$branch_id], l.title = $title, l.raw_text = $raw_text MERGE (l)-[:BELONGS_TO]->(g)", graph_id=graph_id, branch_id=branch_id, lecture_id=lecture_id, title=payload.title or source_label, raw_text=text)
            except Exception as e: errors.append(f"Lecture extraction failed: {e}")

        # ===== STEP 6: Chunk and Claims =====
        if payload.actions.run_chunk_and_claims:
            pdf_result = PDFExtractionResult(**payload.metadata["pdf_result"]) if payload.metadata and "pdf_result" in payload.metadata else None
            try:
                pdf_chunks = chunk_pdf_with_page_references(pdf_result, 1200, 150) if pdf_result else None
                cc_res = run_chunk_and_claims_engine(session, lecture_id or artifact_id, payload.title or source_label, payload.domain, text, run_id, nodes_created + nodes_updated, True, pdf_chunks, tenant_id)
                summary_counts.update({"chunks_created": cc_res.get("chunks_created", 0), "claims_created": cc_res.get("claims_created", 0)})
                created_claim_ids = cc_res.get("claim_ids", [])
                if cc_res.get("errors"): errors.extend(cc_res["errors"])
            except Exception as e: errors.append(f"Chunk/claims failed: {e}")

        # ===== STEP 7: Linking =====
        for concept in nodes_created + nodes_updated:
            try: link_artifact_mentions_concept(session, artifact_id, concept.node_id, run_id, tenant_id)
            except Exception as e: errors.append(f"Linking failed: {e}")

        # ===== STEP 8: Status =====
        status = "COMPLETED" if not errors else ("PARTIAL" if any(summary_counts.values()) else "FAILED")
        update_ingestion_run_status(session, run_id, status, summary_counts, len(errors), errors if errors else None, tenant_id)
        
        return IngestionResult(run_id=run_id, artifact_id=artifact_id, quote_id=quote_id, status=status, reused_existing=reused_existing, summary_counts=summary_counts, warnings=warnings, errors=errors, lecture_id=lecture_id, nodes_created=nodes_created, nodes_updated=nodes_updated, links_created=links_created, segments=segments, created_concept_ids=[c.node_id for c in nodes_created], updated_concept_ids=[c.node_id for c in nodes_updated], created_relationship_count=len(links_created), created_claim_ids=created_claim_ids)

    except Exception as e:
        logger.error(f"Fatal ingestion error: {e}", exc_info=True)
        update_ingestion_run_status(session, run_id, "FAILED", summary_counts, len(errors)+1, errors + [str(e)])
        return IngestionResult(run_id=run_id, status="FAILED", errors=errors + [str(e)])
