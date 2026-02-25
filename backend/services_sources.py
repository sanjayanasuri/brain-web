"""
Service for managing SourceDocument nodes in Neo4j.
SourceDocument represents external documents (web pages, uploads, etc.) before ingestion.
"""
from typing import Optional, Dict, Any
from neo4j import Session
import hashlib
import json

from utils.timestamp import utcnow_ms
from services_branch_explorer import (
    ensure_graph_scoping_initialized,
    get_active_graph_context,
)


def _compute_checksum(text: str) -> str:
    """Compute SHA256 checksum of text."""
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def _generate_doc_id(source: str, external_id: str) -> str:
    """
    Generate deterministic doc_id from source and external_id.
    Format: {source}_{hash(external_id)[:16]}
    """
    external_hash = hashlib.md5(external_id.encode('utf-8')).hexdigest()[:16]
    return f"{source.upper()}_{external_hash}"


def upsert_source_document(
    session: Session,
    graph_id: str,
    branch_id: str,
    source: str,  # e.g. "WEB" | "RESOURCE" | ...
    external_id: str,
    url: str,
    doc_type: Optional[str] = None,
    published_at: Optional[int] = None,  # Unix timestamp
    text: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Create or update a SourceDocument node.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        branch_id: Branch ID for scoping
        source: Source type (e.g. "WEB")
        external_id: External identifier (e.g. canonical URL)
        url: URL to the document
        doc_type: Document type (optional)
        published_at: Publication timestamp (Unix timestamp, optional)
        text: Document text content (optional, for checksum computation)
        metadata: Optional metadata dict
    
    Returns:
        dict with doc_id and basic fields
    """
    ensure_graph_scoping_initialized(session)
    
    doc_id = _generate_doc_id(source, external_id)
    checksum = _compute_checksum(text) if text else None
    metadata_str = json.dumps(metadata) if metadata else None
    now_ts = utcnow_ms()
    
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MERGE (d:SourceDocument {graph_id: $graph_id, doc_id: $doc_id})
    ON CREATE SET
        d.source = $source,
        d.external_id = $external_id,
        d.url = $url,
        d.doc_type = $doc_type,
        d.published_at = $published_at,
        d.checksum = $checksum,
        d.status = 'NEW',
        d.metadata = $metadata,
        d.on_branches = [$branch_id],
        d.created_at = $now_ts,
        d.updated_at = $now_ts
    ON MATCH SET
        d.url = $url,
        d.doc_type = $doc_type,
        d.published_at = $published_at,
        d.checksum = $checksum,
        d.metadata = $metadata,
        d.on_branches = CASE
            WHEN d.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN d.on_branches THEN d.on_branches
            ELSE d.on_branches + $branch_id
        END,
        d.updated_at = $now_ts
    MERGE (d)-[:BELONGS_TO]->(g)
    RETURN d.doc_id AS doc_id,
           d.source AS source,
           d.external_id AS external_id,
           d.status AS status,
           d.checksum AS checksum
    """
    result = session.run(
        query,
        graph_id=graph_id,
        branch_id=branch_id,
        doc_id=doc_id,
        source=source,
        external_id=external_id,
        url=url,
        doc_type=doc_type,
        published_at=published_at,
        checksum=checksum,
        metadata=metadata_str,
        now_ts=now_ts
    )
    record = result.single()
    if not record:
        raise ValueError(f"Failed to create/update SourceDocument {doc_id}")
    return record.data()


def mark_source_document_status(
    session: Session,
    graph_id: str,
    doc_id: str,
    status: str,  # "NEW" | "INGESTED" | "FAILED"
    error: Optional[str] = None
) -> None:
    """
    Update the status of a SourceDocument.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        doc_id: Document ID
        status: New status
        error: Optional error message (for FAILED status)
    """
    ensure_graph_scoping_initialized(session)
    
    now_ts = utcnow_ms()
    
    query = """
    MATCH (d:SourceDocument {graph_id: $graph_id, doc_id: $doc_id})
    SET d.status = $status,
        d.updated_at = $now_ts
    """
    if error:
        query += ", d.error = $error"
    
    params = {
        "graph_id": graph_id,
        "doc_id": doc_id,
        "status": status,
        "now_ts": now_ts
    }
    if error:
        params["error"] = error
    
    session.run(query, **params)


def source_document_exists(
    session: Session,
    graph_id: str,
    external_id: str,
    source: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Check if a SourceDocument exists by external_id.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        external_id: External identifier
        source: Optional source type filter
    
    Returns:
        dict with doc_id, status, checksum if found, None otherwise
    """
    ensure_graph_scoping_initialized(session)
    
    if source:
        doc_id = _generate_doc_id(source, external_id)
        query = """
        MATCH (d:SourceDocument {graph_id: $graph_id, doc_id: $doc_id})
        RETURN d.doc_id AS doc_id,
               d.status AS status,
               d.checksum AS checksum,
               d.source AS source
        """
        result = session.run(query, graph_id=graph_id, doc_id=doc_id)
    else:
        # Search by external_id across all sources
        query = """
        MATCH (d:SourceDocument {graph_id: $graph_id})
        WHERE d.external_id = $external_id
        RETURN d.doc_id AS doc_id,
               d.status AS status,
               d.checksum AS checksum,
               d.source AS source
        LIMIT 1
        """
        result = session.run(query, graph_id=graph_id, external_id=external_id)
    
    record = result.single()
    if record:
        return record.data()
    return None


def get_source_document(
    session: Session,
    graph_id: str,
    doc_id: str
) -> Optional[Dict[str, Any]]:
    """
    Get a SourceDocument by doc_id.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        doc_id: Document ID
    
    Returns:
        dict with document fields if found, None otherwise
    """
    ensure_graph_scoping_initialized(session)
    
    query = """
    MATCH (d:SourceDocument {graph_id: $graph_id, doc_id: $doc_id})
    RETURN d.doc_id AS doc_id,
           d.source AS source,
           d.external_id AS external_id,
           d.url AS url,
           d.doc_type AS doc_type,
           d.published_at AS published_at,
           d.checksum AS checksum,
           d.status AS status,
           d.metadata AS metadata,
           d.created_at AS created_at,
           d.updated_at AS updated_at
    """
    result = session.run(query, graph_id=graph_id, doc_id=doc_id)
    record = result.single()
    if record:
        return record.data()
    return None
