"""
Artifact CRUD and URL/text helpers.
"""
import hashlib
import json
from typing import Any, Dict, Optional
from urllib.parse import urlparse, urlunparse
from uuid import uuid4

from neo4j import Session

from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context


def canonicalize_url(url: str, strip_query: bool = True) -> str:
    """
    Canonicalize a URL: remove fragment, optionally query, normalize trailing slash.
    """
    parsed = urlparse(url)
    query = "" if strip_query else parsed.query
    path = parsed.path.rstrip("/") or "/"
    canonical = urlunparse((parsed.scheme, parsed.netloc, path, parsed.params, query, ""))
    return canonical


def normalize_text_for_hash(text: str) -> str:
    """Normalize text for consistent hashing (strip whitespace, lower case)."""
    if not text:
        return ""
    return " ".join(text.strip().lower().split())


def create_or_get_artifact(
    session: Session,
    artifact_type: str,
    source_url: Optional[str],
    source_id: Optional[str],
    title: Optional[str],
    text: str,
    metadata: Optional[dict],
    created_by_run_id: Optional[str] = None,
    strip_url_query: bool = True,
    tenant_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Create or get an artifact node. Idempotent by (graph_id, artifact_type, COALESCE(canonical_url, source_id), content_hash).
    Returns dict with keys: artifact_id, reused_existing, content_hash, canonical_url
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session, tenant_id=tenant_id)

    normalized_text = normalize_text_for_hash(text)
    content_hash = hashlib.sha256(normalized_text.encode("utf-8")).hexdigest()

    canonical_url = None
    if source_url:
        canonical_url = canonicalize_url(source_url, strip_query=strip_url_query)

    artifact_id = f"A{uuid4().hex[:8].upper()}"
    metadata_str = json.dumps(metadata) if metadata else None
    text_len = len(text)

    url_value = canonical_url or source_url
    if not url_value and source_id:
        url_value = f"{artifact_type}://{source_id}"

    on_create_set = [
        "a.artifact_id = $artifact_id",
        "a.artifact_type = $artifact_type",
        "a.url = $url_value",
        "a.source_url = $source_url",
        "a.canonical_url = $canonical_url",
        "a.source_id = $source_id",
        "a.title = $title",
        "a.text_len = $text_len",
        "a.content_hash = $content_hash",
        "a.metadata = $metadata_str",
        "a.on_branches = [$branch_id]",
        "a.created_at = timestamp()",
        "a.updated_at = timestamp()",
    ]
    if created_by_run_id:
        on_create_set.append("a.created_by_run_id = $created_by_run_id")

    on_match_set = [
        """a.on_branches = CASE
            WHEN a.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN a.on_branches THEN a.on_branches
            ELSE a.on_branches + $branch_id
        END""",
        "a.updated_at = timestamp()",
    ]

    if not url_value:
        raise ValueError(
            "Cannot create Artifact: url is required by constraint. Need source_url, canonical_url, or source_id"
        )

    merge_query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MERGE (a:Artifact {
        graph_id: $graph_id,
        url: $url_value,
        content_hash: $content_hash
    })
    ON CREATE SET """ + ", ".join(on_create_set) + """
    ON MATCH SET """ + ", ".join(on_match_set) + """
    MERGE (a)-[:BELONGS_TO]->(g)
    """

    check_query = """
    MATCH (a:Artifact {
        graph_id: $graph_id,
        url: $url_value,
        content_hash: $content_hash
    })
    RETURN a.artifact_id AS artifact_id
    LIMIT 1
    """
    existing = session.run(
        check_query,
        graph_id=graph_id,
        url_value=url_value,
        content_hash=content_hash,
    ).single()

    reused_existing = existing is not None

    if source_url and canonical_url:
        merge_query += """
        WITH a, g
        MERGE (s:Source {graph_id: $graph_id, url: $canonical_url})
        ON CREATE SET
            s.on_branches = [$branch_id]
        ON MATCH SET
            s.on_branches = CASE
                WHEN s.on_branches IS NULL THEN [$branch_id]
                WHEN $branch_id IN s.on_branches THEN s.on_branches
                ELSE s.on_branches + $branch_id
            END
        MERGE (s)-[:BELONGS_TO]->(g)
        MERGE (a)-[:FROM_SOURCE]->(s)
        """

    merge_query += """
    RETURN a.artifact_id AS artifact_id
    """

    params = {
        "artifact_id": artifact_id,
        "graph_id": graph_id,
        "branch_id": branch_id,
        "artifact_type": artifact_type,
        "url_value": url_value,
        "source_url": source_url,
        "canonical_url": canonical_url,
        "source_id": source_id,
        "title": title,
        "text_len": text_len,
        "content_hash": content_hash,
        "metadata_str": metadata_str,
    }
    if created_by_run_id:
        params["created_by_run_id"] = created_by_run_id

    result = session.run(merge_query, **params)
    record = result.single()
    if not record:
        raise ValueError("Failed to create/get artifact")
    artifact_id = record["artifact_id"]

    return {
        "artifact_id": artifact_id,
        "reused_existing": reused_existing,
        "content_hash": content_hash,
        "canonical_url": canonical_url,
    }


def link_artifact_mentions_concept(
    session: Session,
    artifact_id: str,
    concept_node_id: str,
    ingestion_run_id: Optional[str] = None,
    tenant_id: Optional[str] = None,
) -> None:
    """Create or merge a MENTIONS relationship from an Artifact to a Concept."""
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session, tenant_id=tenant_id)

    set_clauses = [
        "r.graph_id = COALESCE(r.graph_id, $graph_id)",
        """r.on_branches = CASE
            WHEN r.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN r.on_branches THEN r.on_branches
            ELSE r.on_branches + $branch_id
        END""",
        "r.created_at = COALESCE(r.created_at, timestamp())",
        "r.updated_at = timestamp()",
    ]
    if ingestion_run_id is not None:
        set_clauses.append("r.ingestion_run_id = $ingestion_run_id")

    params = {
        "artifact_id": artifact_id,
        "concept_node_id": concept_node_id,
        "graph_id": graph_id,
        "branch_id": branch_id,
    }
    if ingestion_run_id is not None:
        params["ingestion_run_id"] = ingestion_run_id

    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MATCH (a:Artifact {{artifact_id: $artifact_id}})-[:BELONGS_TO]->(g)
    MATCH (c:Concept {{node_id: $concept_node_id}})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(a.on_branches, []) AND $branch_id IN COALESCE(c.on_branches, [])
    MERGE (a)-[r:MENTIONS]->(c)
    SET {', '.join(set_clauses)}
    RETURN 1
    """
    session.run(query, **params)


def get_artifact(session: Session, artifact_id: str) -> Optional[Dict[str, Any]]:
    """Get an artifact by artifact_id. Returns dict with artifact fields or None."""
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)

    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (a:Artifact {artifact_id: $artifact_id})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(a.on_branches, [])
    RETURN a.artifact_id AS artifact_id,
           a.graph_id AS graph_id,
           a.artifact_type AS artifact_type,
           a.url AS url,
           a.title AS title,
           a.domain AS domain,
           a.captured_at AS captured_at,
           a.content_hash AS content_hash,
           a.text AS text,
           a.metadata AS metadata,
           a.created_by_run_id AS created_by_run_id
    """
    result = session.run(query, graph_id=graph_id, branch_id=branch_id, artifact_id=artifact_id)
    record = result.single()
    if not record:
        return None

    data = dict(record.data())
    if data.get("metadata") and isinstance(data["metadata"], str):
        try:
            data["metadata"] = json.loads(data["metadata"])
        except json.JSONDecodeError:
            data["metadata"] = {}
    elif data.get("metadata") is None:
        data["metadata"] = {}

    return data
