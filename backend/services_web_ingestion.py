"""
Shared web ingestion service used by both /web/ingest and /events/replay.

This module contains the core ingestion logic that can be called from:
  - POST /web/ingest (local-only endpoint)
  - POST /events/replay (offline mirror replay)
"""
from typing import Any, Dict, List, Optional, Tuple
from neo4j import Session
import hashlib
import json
from urllib.parse import urlparse
from uuid import uuid4

from services_ingestion_runs import create_ingestion_run, update_ingestion_run_status
from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context
from services_sources import upsert_source_document, get_source_document, mark_source_document_status
from services_graph import canonicalize_url, upsert_source_chunk, upsert_claim, link_claim_mentions, get_all_concepts, upsert_quote
from services_lecture_ingestion import chunk_text
from services_claims import extract_claims_from_chunk


def _normalize_name(name: str) -> str:
    """Normalize concept name for matching."""
    return name.lower().strip()


def _compute_checksum(canonical_url: str, text: str) -> str:
    """Compute SHA256 checksum of canonical_url + text."""
    combined = canonical_url + text
    return hashlib.sha256(combined.encode("utf-8")).hexdigest()


def ingest_web_payload(
    *,
    session: Session,
    url: str,
    text: str,
    title: Optional[str] = None,
    capture_mode: str = "reader",
    selection_text: Optional[str] = None,
    anchor: Optional[Dict[str, Any]] = None,
    domain: Optional[str] = "General",
    tags: Optional[List[str]] = None,
    note: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    trail_id: Optional[str] = None,
    # optional override (events can supply graph/branch explicitly)
    graph_id_override: Optional[str] = None,
    branch_id_override: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Shared ingestion implementation used by:
      - POST /web/ingest (local-only endpoint)
      - POST /events/replay (offline mirror replay)

    Returns a dict compatible with WebIngestResponse.
    """
    tags = tags or []
    metadata = metadata or {}
    errors: List[str] = []

    # 1) Ensure graph scoping
    try:
        ensure_graph_scoping_initialized(session)
        if graph_id_override and branch_id_override is not None:
            graph_id, branch_id = graph_id_override, branch_id_override
        else:
            graph_id, branch_id = get_active_graph_context(session)
            if graph_id_override:
                graph_id = graph_id_override
            if branch_id_override is not None:
                branch_id = branch_id_override
    except Exception as e:
        errors.append(f"Failed to initialize graph scoping: {str(e)}")
        return {
            "status": "FAILED",
            "artifact_id": "",
            "quote_id": None,
            "run_id": None,
            "chunks_created": 0,
            "claims_created": 0,
            "errors": errors,
        }

    # 2) Canonicalize URL and checksum
    try:
        canonical_url_str = canonicalize_url(url, strip_query=True)
    except Exception as e:
        errors.append(f"Failed to canonicalize URL: {str(e)}")
        canonical_url_str = url

    checksum = _compute_checksum(canonical_url_str, text)

    # 3) Create ingestion run
    try:
        ingestion_run = create_ingestion_run(session=session, source_type="WEB", source_label=url)
        run_id = ingestion_run.run_id
    except Exception as e:
        errors.append(f"Failed to create ingestion run: {str(e)}")
        return {
            "status": "FAILED",
            "artifact_id": "",
            "quote_id": None,
            "run_id": None,
            "chunks_created": 0,
            "claims_created": 0,
            "errors": errors,
        }

    # 4) Prepare metadata
    hostname = urlparse(url).netloc if url else None
    merged_metadata = {
        "title": title,
        "capture_mode": capture_mode,
        "tags": tags,
        "note": note,
        "selection_text": selection_text,
        "hostname": hostname,
        "canonical_url": canonical_url_str,
        "content_checksum": checksum,
        **metadata,
    }

    # 5) Upsert SourceDocument
    try:
        doc_data = upsert_source_document(
            session=session,
            graph_id=graph_id,
            branch_id=branch_id,
            source="WEB",
            external_id=canonical_url_str,
            url=url,
            text=text,
            metadata=merged_metadata,
        )
        artifact_id = doc_data["doc_id"]
    except Exception as e:
        errors.append(f"Failed to create SourceDocument: {str(e)}")
        update_ingestion_run_status(session=session, run_id=run_id, status="FAILED", errors=errors)
        return {
            "status": "FAILED",
            "artifact_id": "",
            "quote_id": None,
            "run_id": run_id,
            "chunks_created": 0,
            "claims_created": 0,
            "errors": errors,
        }

    # 6) Optional Quote
    quote_id = None
    if capture_mode == "selection" and selection_text and anchor:
        try:
            anchor_exact = anchor.get("exact", selection_text)
            anchor_prefix = anchor.get("prefix", "") or ""
            anchor_suffix = anchor.get("suffix", "") or ""
            quote_hash_input = f"{url}\n{anchor_exact}\n{anchor_prefix}\n{anchor_suffix}"
            quote_hash = hashlib.sha256(quote_hash_input.encode("utf-8")).hexdigest()[:16].upper()
            quote_id = f"QUOTE_{quote_hash}"

            upsert_quote(
                session=session,
                graph_id=graph_id,
                branch_id=branch_id,
                quote_id=quote_id,
                text=selection_text,
                anchor=anchor,
                source_doc_id=artifact_id,
                user_note=note,
                tags=tags if tags else None,
            )
        except Exception as e:
            errors.append(f"Failed to create Quote: {str(e)}")

    # 7) Idempotency via checksum (existing behavior)
    existing_doc = get_source_document(session, graph_id, artifact_id)
    if existing_doc:
        existing_status = existing_doc.get("status")
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

        if existing_status == "INGESTED" and existing_content_checksum == checksum:
            update_ingestion_run_status(
                session=session,
                run_id=run_id,
                status="COMPLETED",
                summary_counts={"chunks_created": 0, "claims_created": 0},
            )
            return {
                "status": "SKIPPED",
                "artifact_id": artifact_id,
                "quote_id": quote_id,
                "run_id": run_id,
                "chunks_created": 0,
                "claims_created": 0,
                "errors": [],
            }

    # 8) Chunk text
    try:
        chunks = chunk_text(text, max_chars=1200, overlap=150)
        if not chunks:
            errors.append("No chunks created from text")
            mark_source_document_status(session, graph_id, artifact_id, "FAILED", "No chunks created")
            update_ingestion_run_status(session=session, run_id=run_id, status="FAILED", errors=errors)
            return {
                "status": "FAILED",
                "artifact_id": artifact_id,
                "quote_id": quote_id,
                "run_id": run_id,
                "chunks_created": 0,
                "claims_created": 0,
                "errors": errors,
            }
    except Exception as e:
        errors.append(f"Failed to chunk text: {str(e)}")
        mark_source_document_status(session, graph_id, artifact_id, "FAILED", str(e))
        update_ingestion_run_status(session=session, run_id=run_id, status="FAILED", errors=errors)
        return {
            "status": "FAILED",
            "artifact_id": artifact_id,
            "quote_id": quote_id,
            "run_id": run_id,
            "chunks_created": 0,
            "claims_created": 0,
            "errors": errors,
        }

    # 9) Concepts
    try:
        existing_concepts = get_all_concepts(session)
        existing_concept_map = {_normalize_name(c.name): c.node_id for c in existing_concepts}
        known_concepts = [{"name": c.name, "node_id": c.node_id, "description": c.description} for c in existing_concepts]
    except Exception as e:
        errors.append(f"Failed to get existing concepts: {str(e)}")
        known_concepts = []
        existing_concept_map = {}

    # 10) Extract claims per chunk
    chunks_created = 0
    claims_created = 0

    for chunk in chunks:
        chunk_id = f"CHUNK_{uuid4().hex[:8].upper()}"
        chunk_metadata = {
            "source": "WEB",
            "external_id": canonical_url_str,
            "doc_id": artifact_id,
            "domain": domain,
            "capture_mode": capture_mode,
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
            chunks_created += 1
        except Exception as e:
            errors.append(f"Failed to create SourceChunk {chunk_id}: {str(e)}")
            continue

        try:
            claims = extract_claims_from_chunk(chunk["text"], known_concepts)
        except Exception as e:
            errors.append(f"Failed to extract claims from chunk {chunk_id}: {str(e)}")
            continue

        for claim_data in claims:
            claim_id = f"CLAIM_{uuid4().hex[:8].upper()}"
            mentioned_node_ids = []
            for concept_name in claim_data.get("mentioned_concept_names", []):
                normalized = _normalize_name(concept_name)
                if normalized in existing_concept_map:
                    mentioned_node_ids.append(existing_concept_map[normalized])

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

                if mentioned_node_ids:
                    try:
                        link_claim_mentions(session=session, graph_id=graph_id, claim_id=claim_id, mentioned_node_ids=mentioned_node_ids)
                    except Exception as e:
                        errors.append(f"Failed to link claim {claim_id} to concepts: {str(e)}")

                claims_created += 1
            except Exception as e:
                errors.append(f"Failed to create Claim {claim_id}: {str(e)}")
                continue

    # 11) Status updates
    if chunks_created > 0:
        mark_source_document_status(session, graph_id, artifact_id, "INGESTED")
    else:
        mark_source_document_status(session, graph_id, artifact_id, "FAILED", "No chunks created")

    summary_counts = {"chunks_created": chunks_created, "claims_created": claims_created}
    final_status = "COMPLETED" if chunks_created > 0 else "FAILED"
    update_ingestion_run_status(session=session, run_id=run_id, status=final_status, summary_counts=summary_counts, errors=errors if errors else None)

    # 12) Trail append (unchanged)
    if trail_id:
        try:
            from services_trails import append_step
            append_step(
                session=session,
                graph_id=graph_id,
                branch_id=branch_id,
                trail_id=trail_id,
                kind="page",
                ref_id=url,
                title=title,
                note=note,
                meta={"capture_mode": capture_mode, "domain": domain},
            )
            if quote_id:
                append_step(
                    session=session,
                    graph_id=graph_id,
                    branch_id=branch_id,
                    trail_id=trail_id,
                    kind="quote",
                    ref_id=quote_id,
                    title=selection_text[:100] if selection_text else None,
                )
        except Exception as e:
            errors.append(f"Failed to append to trail: {str(e)}")

    return {
        "status": "INGESTED" if chunks_created > 0 else "FAILED",
        "artifact_id": artifact_id,
        "quote_id": quote_id,
        "run_id": run_id,
        "chunks_created": chunks_created,
        "claims_created": claims_created,
        "errors": errors,
    }
