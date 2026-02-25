"""
Chunk text, extract claims (LLM), persist SourceChunks and Claims.
"""
import hashlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional, List, Dict, Any
from uuid import uuid4

from neo4j import Session

from models import Concept
from services_graph import (
    get_active_graph_context,
    ensure_graph_scoping_initialized,
    upsert_source_chunk,
    upsert_claim,
    link_claim_mentions,
    get_all_concepts,
)
from services_claims import extract_claims_from_chunk, normalize_claim_text
from services_search import embed_text

from .chunking import chunk_text, normalize_name


def process_chunk_atomic(
    chunk_data: Dict[str, Any], known_concepts_dict: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Process a single chunk atomically (no DB side effects).
    - Extracts claims (LLM)
    - Computes embeddings (LLM)

    Returns:
        Dict with 'chunk': chunk_data, 'claims': list_of_claims_with_embeddings, 'errors': list
    """
    errors = []
    claims_with_embeddings = []

    try:
        claims = extract_claims_from_chunk(chunk_data["text"], known_concepts_dict)

        for claim_data in claims:
            try:
                embedding = embed_text(claim_data["claim_text"])
            except Exception as e:
                print(f"[Lecture Ingestion] WARNING: Failed to embed claim, continuing without embedding: {e}")
                embedding = None
            claim_data["embedding"] = embedding
            claims_with_embeddings.append(claim_data)
    except Exception as e:
        errors.append(f"Failed to process chunk {chunk_data.get('index')}: {e}")

    return {
        "chunk": chunk_data,
        "claims": claims_with_embeddings,
        "errors": errors,
    }


def run_chunk_and_claims_engine(
    session: Session,
    source_id: str,
    source_label: str,
    domain: Optional[str],
    text: str,
    run_id: str,
    known_concepts: List[Concept],
    include_existing_concepts: bool = True,
    pdf_chunks: Optional[List[Dict[str, Any]]] = None,
    tenant_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Chunk text and extract claims from chunks.
    """
    errors = []
    chunks_created = 0
    claims_created = 0
    chunk_ids = []
    claim_ids = []

    graph_id, branch_id = get_active_graph_context(session, tenant_id=tenant_id)
    print(f"[Chunk Ingestion] Using Graph: {graph_id}, Branch: {branch_id}")
    print(f"[Lecture Ingestion] Creating chunks and extracting claims")
    ensure_graph_scoping_initialized(session)

    if pdf_chunks:
        chunks = [
            {
                "text": chunk["text"],
                "index": chunk["chunk_index"],
                "page_numbers": chunk.get("page_numbers", []),
                "page_range": chunk.get("page_range"),
            }
            for chunk in pdf_chunks
        ]
        print(f"[Lecture Ingestion] Using PDF chunks with page references: {len(chunks)} chunks")
    else:
        chunks = chunk_text(text, max_chars=1200, overlap=150)
        print(f"[Lecture Ingestion] Created {len(chunks)} chunks")

    known_concepts_dict = [
        {"name": c.name, "node_id": c.node_id, "description": c.description}
        for c in known_concepts
    ]

    existing_concept_map = {}
    if include_existing_concepts:
        existing_concepts = get_all_concepts(session)
        existing_concept_map = {normalize_name(c.name): c.node_id for c in existing_concepts}

    chunk_map = {}

    for chunk in chunks:
        chunk_id = f"CHUNK_{uuid4().hex[:8].upper()}"
        chunk["chunk_id"] = chunk_id
        metadata = {
            "lecture_id": source_id,
            "lecture_title": source_label,
            "domain": domain,
        }
        if "page_numbers" in chunk:
            metadata["page_numbers"] = chunk["page_numbers"]
        if "page_range" in chunk:
            metadata["page_range"] = chunk["page_range"]
        try:
            upsert_source_chunk(
                session=session,
                graph_id=graph_id,
                branch_id=branch_id,
                chunk_id=chunk_id,
                source_id=source_id,
                chunk_index=chunk["index"],
                text=chunk["text"],
                metadata=metadata,
            )
            chunks_created += 1
            chunk_ids.append(chunk_id)
            chunk_map[chunk["index"]] = chunk_id
        except Exception as e:
            error_msg = f"Failed to create SourceChunk {chunk_id}: {e}"
            errors.append(error_msg)
            print(f"[Lecture Ingestion] ERROR: {error_msg}")
            continue

    print(f"[Lecture Ingestion] Parallel processing {len(chunks)} chunks with 5 workers...")
    processed_claims_results = []
    with ThreadPoolExecutor(max_workers=5) as executor:
        future_to_chunk = {
            executor.submit(process_chunk_atomic, chunk, known_concepts_dict): chunk
            for chunk in chunks
        }
        for future in as_completed(future_to_chunk):
            try:
                result = future.result()
                processed_claims_results.append(result)
                if result["errors"]:
                    errors.extend(result["errors"])
            except Exception as exc:
                print(f"[Lecture Ingestion] Chunk processing generated an exception: {exc}")
                errors.append(str(exc))

    processed_claims_results.sort(key=lambda x: x["chunk"]["index"])

    for result in processed_claims_results:
        chunk = result["chunk"]
        chunk_id = chunk.get("chunk_id")
        if not chunk_id:
            continue
        claims_data_list = result["claims"]
        for claim_data in claims_data_list:
            normalized_claim_text = normalize_claim_text(claim_data["claim_text"])
            claim_id_hash = hashlib.sha256(
                f"{graph_id}{source_id}{normalized_claim_text}".encode()
            ).hexdigest()[:16]
            claim_id = f"CLAIM_{claim_id_hash.upper()}"
            mentioned_node_ids = []
            for concept_name in claim_data.get("mentioned_concept_names", []):
                normalized_concept_name = normalize_name(concept_name)
                found_id = None
                for c in known_concepts:
                    if normalize_name(c.name) == normalized_concept_name:
                        found_id = c.node_id
                        break
                if not found_id and include_existing_concepts:
                    found_id = existing_concept_map.get(normalized_concept_name)
                if found_id:
                    mentioned_node_ids.append(found_id)
            claim_embedding = claim_data.get("embedding")
            try:
                upsert_claim(
                    session=session,
                    graph_id=graph_id,
                    branch_id=branch_id,
                    claim_id=claim_id,
                    text=claim_data["claim_text"],
                    confidence=claim_data["confidence"],
                    method="llm",
                    source_id=source_id,
                    source_span=claim_data.get("source_span", f"chunk {chunk['index']}"),
                    chunk_id=chunk_id,
                    embedding=claim_embedding,
                    ingestion_run_id=run_id,
                )
                if mentioned_node_ids:
                    link_claim_mentions(
                        session=session,
                        graph_id=graph_id,
                        claim_id=claim_id,
                        mentioned_node_ids=mentioned_node_ids,
                    )
                claims_created += 1
                claim_ids.append(claim_id)
            except Exception as e:
                error_msg = f"Failed to create Claim {claim_id}: {e}"
                errors.append(error_msg)
                print(f"[Lecture Ingestion] ERROR: {error_msg}")
                continue

    print(f"[Lecture Ingestion] Created {claims_created} claims from {len(chunks)} chunks")
    return {
        "chunks_created": chunks_created,
        "claims_created": claims_created,
        "chunk_ids": chunk_ids,
        "claim_ids": claim_ids,
        "errors": errors,
    }
