from typing import List, Optional, Dict, Any, Tuple
from neo4j import Session
import datetime
import json
import hashlib
import time
from urllib.parse import urlparse, urlunparse
from uuid import uuid4

from models import (
    Concept, ConceptCreate, RelationshipCreate,
    ResponseStyleProfile, ResponseStyleProfileWrapper,
    ExplanationFeedback, FeedbackSummary,
    FocusArea, UserProfile, NotionConfig,
    AnswerRecord, Revision, UIPreferences,
    ConversationSummary, LearningTopic
)

from services_branch_explorer import (
    ensure_graph_scoping_initialized,
    get_active_graph_context,
    get_request_graph_identity,
)

from config import PROPOSED_VISIBILITY_THRESHOLD

from services_user import get_user_by_id, update_user


def _resolve_required_tenant_id(tenant_id: Optional[str] = None, session: Optional[Session] = None) -> str:
    """Resolve tenant_id from argument or request context; require it for graph reads."""
    _, req_tenant_id = get_request_graph_identity()
    resolved_tenant_id = str(tenant_id).strip() if tenant_id else (str(req_tenant_id).strip() if req_tenant_id else "")
    if not resolved_tenant_id and session is not None:
        try:
            graph_id, _ = get_active_graph_context(session)
            rec = session.run(
                """
                MATCH (g:GraphSpace {graph_id: $graph_id})
                RETURN g.tenant_id AS tenant_id
                LIMIT 1
                """,
                graph_id=graph_id,
            ).single()
            if rec and rec.get("tenant_id"):
                resolved_tenant_id = str(rec.get("tenant_id")).strip()
        except Exception:
            pass
    if not resolved_tenant_id:
        raise ValueError("Tenant-scoped graph context is required")
    return resolved_tenant_id


def _get_tenant_scoped_graph_context(
    session: Session,
    *,
    tenant_id: Optional[str] = None,
) -> Tuple[str, str, str]:
    resolved_tenant_id = _resolve_required_tenant_id(tenant_id, session=session)
    graph_id, branch_id = get_active_graph_context(session, tenant_id=resolved_tenant_id)
    return graph_id, branch_id, resolved_tenant_id


def _build_tenant_filter_clause(tenant_id: str) -> str:
    """Build strict tenant filter for GraphSpace."""
    if not tenant_id:
        raise ValueError("tenant_id is required for tenant filtering")
    return "WHERE g.tenant_id = $tenant_id"


def _normalize_include_proposed(include_proposed: Optional[str]) -> str:
    """
    Normalize include_proposed parameter to valid values: 'auto', 'all', or 'none'.
    
    Args:
        include_proposed: User-provided value (can be None, empty string, or one of the valid values)
    
    Returns:
        Normalized value: 'auto' (default), 'all', or 'none'
    """
    if include_proposed in (None, "", "auto"):
        return "auto"
    if include_proposed in ("all", "none"):
        return include_proposed
    return "auto"


def _build_edge_visibility_where_clause(include_proposed: str) -> str:
    """
    Build Cypher WHERE clause snippet for relationship visibility policy.
    
    include_proposed: 'auto' | 'all' | 'none'
    Returns Cypher WHERE boolean expression snippet for relationship r.
    Assumes you already have `r` in scope and params include $threshold and $include_proposed.
    
    Policy:
    - 'none': Only ACCEPTED edges (or missing status treated as ACCEPTED)
    - 'auto': ACCEPTED + PROPOSED with confidence >= threshold
    - 'all': ACCEPTED + all PROPOSED
    - REJECTED edges are never included in normal exploration
    """
    if include_proposed == "none":
        return "(COALESCE(r.status, 'ACCEPTED') = 'ACCEPTED')"
    
    # For 'auto' or 'all'
    return """(
      COALESCE(r.status, 'ACCEPTED') = 'ACCEPTED'
      OR (
        COALESCE(r.status, 'ACCEPTED') = 'PROPOSED'
        AND (
          $include_proposed = 'all'
          OR ($include_proposed = 'auto' AND COALESCE(r.confidence, 0.0) >= $threshold)
        )
      )
    )"""


def _normalize_concept_from_db(record_data: Dict[str, Any]) -> Concept:
    """
    Normalize concept data from Neo4j, handling backward compatibility.
    If lecture_key exists but lecture_sources doesn't, migrate it.
    """
    data = dict(record_data)
    
    # Backward compatibility: if lecture_key exists but lecture_sources doesn't
    if data.get("lecture_key") and not data.get("lecture_sources"):
        lecture_key = data["lecture_key"]
        data["lecture_sources"] = [lecture_key]
        if not data.get("created_by"):
            data["created_by"] = lecture_key
        if not data.get("last_updated_by"):
            data["last_updated_by"] = lecture_key
    
    # Ensure lecture_sources is a list (default to empty)
    if "lecture_sources" not in data or data["lecture_sources"] is None:
        data["lecture_sources"] = []
    
    # Ensure run_id fields are present (default to None)
    if "created_by_run_id" not in data:
        data["created_by_run_id"] = None
    if "last_updated_by_run_id" not in data:
        data["last_updated_by_run_id"] = None
    
    # Ensure aliases is a list (default to empty)
    if "aliases" not in data or data["aliases"] is None:
        data["aliases"] = []
    
    return Concept(**data)


def get_concept_by_name(session: Session, name: str, include_archived: bool = False, tenant_id: Optional[str] = None) -> Optional[Concept]:
    """
    Find a concept by name (exact match) or by alias (normalized match).
    Phase 2: Now checks both name and aliases field.
    
    Args:
        session: Neo4j session
        name: Concept name to search for
        include_archived: Whether to include archived concepts
        tenant_id: Optional tenant_id for multi-tenant isolation
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id, resolved_tenant_id = _get_tenant_scoped_graph_context(session, tenant_id=tenant_id)
    where_clauses = [
        "$branch_id IN COALESCE(c.on_branches, [])"
    ]
    if not include_archived:
        where_clauses.append("COALESCE(c.archived, false) = false")
    
    # Add tenant filtering
    tenant_filter = _build_tenant_filter_clause(resolved_tenant_id)
    
    # Normalize name for matching
    normalized_name = name.lower().strip()
    
    params = {
        "name": name,
        "normalized_name": normalized_name,
        "graph_id": graph_id,
        "branch_id": branch_id,
        "tenant_id": resolved_tenant_id,
    }
    
    return_fields = """
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.description AS description,
           c.tags AS tags,
           c.notes_key AS notes_key,
           c.lecture_key AS lecture_key,
           c.url_slug AS url_slug,
           COALESCE(c.lecture_sources, []) AS lecture_sources,
           COALESCE(c.aliases, []) AS aliases,
           c.created_by AS created_by,
           c.last_updated_by AS last_updated_by
    LIMIT 1
    """

    # Fast path: exact name lookup via (graph_id, name) NODE KEY index.
    exact_query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    {tenant_filter}
    MATCH (c:Concept {{graph_id: $graph_id, name: $name}})-[:BELONGS_TO]->(g)
    WHERE {' AND '.join(where_clauses)}
    {return_fields}
    """
    record = session.run(exact_query, **params).single()
    if record:
        return _normalize_concept_from_db(record.data())

    # Fallback: case-insensitive name match or alias match.
    fallback_query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    {tenant_filter}
    MATCH (c:Concept {{graph_id: $graph_id}})-[:BELONGS_TO]->(g)
    WHERE {' AND '.join(where_clauses)}
      AND (
        toLower(trim(c.name)) = $normalized_name
        OR $normalized_name IN [alias IN COALESCE(c.aliases, []) | toLower(trim(alias))]
      )
    {return_fields}
    """
    record = session.run(fallback_query, **params).single()
    if not record:
        return None
    return _normalize_concept_from_db(record.data())


def get_concept_by_id(
    session: Session,
    node_id: str,
    include_archived: bool = False,
    tenant_id: Optional[str] = None,
) -> Optional[Concept]:
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id, tenant_id = _get_tenant_scoped_graph_context(session, tenant_id=tenant_id)
    where_clauses = [
        "$branch_id IN COALESCE(c.on_branches, [])"
    ]
    if not include_archived:
        where_clauses.append("COALESCE(c.archived, false) = false")
    
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    WHERE g.tenant_id = $tenant_id
    MATCH (c:Concept {{node_id: $node_id}})-[:BELONGS_TO]->(g)
    WHERE {' AND '.join(where_clauses)}
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.description AS description,
           c.tags AS tags,
           c.notes_key AS notes_key,
           c.lecture_key AS lecture_key,
           c.url_slug AS url_slug,
           COALESCE(c.lecture_sources, []) AS lecture_sources,
           COALESCE(c.aliases, []) AS aliases,
           c.created_by AS created_by,
           c.last_updated_by AS last_updated_by
    LIMIT 1
    """
    record = session.run(query, node_id=node_id, graph_id=graph_id, branch_id=branch_id, tenant_id=tenant_id).single()
    if not record:
        return None
    return _normalize_concept_from_db(record.data())


def get_concept_by_slug(session: Session, slug: str, include_archived: bool = False, tenant_id: Optional[str] = None) -> Optional[Concept]:
    """Get a concept by its URL slug (Wikipedia-style)."""
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id, resolved_tenant_id = _get_tenant_scoped_graph_context(session, tenant_id=tenant_id)
    where_clauses = [
        "$branch_id IN COALESCE(c.on_branches, [])"
    ]
    if not include_archived:
        where_clauses.append("COALESCE(c.archived, false) = false")
    
    query = f"""
    MATCH (c:Concept {{url_slug: $slug}})-[:BELONGS_TO]->(g:GraphSpace {{graph_id: $graph_id}})
    WHERE g.tenant_id = $tenant_id
      AND {' AND '.join(where_clauses)}
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.description AS description,
           c.tags AS tags,
           c.notes_key AS notes_key,
           c.lecture_key AS lecture_key,
           c.url_slug AS url_slug,
           COALESCE(c.lecture_sources, []) AS lecture_sources,
           COALESCE(c.aliases, []) AS aliases,
           c.created_by AS created_by,
           c.last_updated_by AS last_updated_by
    LIMIT 1
    """
    record = session.run(query, slug=slug, graph_id=graph_id, branch_id=branch_id, tenant_id=resolved_tenant_id).single()
    if not record:
        return None
    return _normalize_concept_from_db(record.data())


def create_concept(session: Session, payload: ConceptCreate, tenant_id: Optional[str] = None) -> Concept:
    """
    Creates a concept node with a generated node_id if not present.
    For now, node_id is just a UUID string.
    """
    from uuid import uuid4
    from utils.slug import generate_slug, ensure_unique_slug

    node_id = f"N{uuid4().hex[:8].upper()}"
    
    # Auto-generate slug if not provided
    if not payload.url_slug:
        base_slug = generate_slug(payload.name)
        url_slug = ensure_unique_slug(session, base_slug)
    else:
        url_slug = payload.url_slug
    
    # Handle backward compatibility: if lecture_key is provided but lecture_sources is not
    lecture_sources = payload.lecture_sources or []
    if payload.lecture_key and not lecture_sources:
        lecture_sources = [payload.lecture_key]
    
    created_by = payload.created_by
    if not created_by and lecture_sources:
        created_by = lecture_sources[0]
    
    last_updated_by = payload.last_updated_by
    if not last_updated_by and lecture_sources:
        last_updated_by = lecture_sources[-1]
    
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session, tenant_id=tenant_id)
    
    # Build ON CREATE SET clause with run_id tracking
    on_create_set = [
        "c.node_id = $node_id",
        "c.domain = $domain",
        "c.type = $type",
        "c.description = $description",
        "c.tags = $tags",
        "c.notes_key = $notes_key",
        "c.lecture_key = $lecture_key",
        "c.url_slug = $url_slug",
        "c.lecture_sources = $lecture_sources",
        "c.created_by = $created_by",
        "c.last_updated_by = $last_updated_by",
        "c.on_branches = [$branch_id]",
        "c.aliases = $aliases",
    ]
    
    # Add run_id tracking only on CREATE (don't overwrite existing created_by_run_id)
    if payload.created_by_run_id:
        on_create_set.append("c.created_by_run_id = $created_by_run_id")
    
    # Build ON MATCH SET clause with run_id tracking for updates
    on_match_set = [
        """c.on_branches = CASE
            WHEN c.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN c.on_branches THEN c.on_branches
            ELSE c.on_branches + $branch_id
        END""",
    ]
    
    # Set last_updated_by_run_id on updates (but preserve created_by_run_id)
    if payload.last_updated_by_run_id:
        on_match_set.append("c.last_updated_by_run_id = $last_updated_by_run_id")
    
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MERGE (c:Concept {{graph_id: $graph_id, name: $name}})
    ON CREATE SET {', '.join(on_create_set)}
    ON MATCH SET {', '.join(on_match_set)}
    MERGE (c)-[:BELONGS_TO]->(g)
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.description AS description,
           c.tags AS tags,
           c.notes_key AS notes_key,
           c.lecture_key AS lecture_key,
           c.url_slug AS url_slug,
           COALESCE(c.lecture_sources, []) AS lecture_sources,
           COALESCE(c.aliases, []) AS aliases,
           c.created_by AS created_by,
           c.last_updated_by AS last_updated_by,
           c.created_by_run_id AS created_by_run_id,
           c.last_updated_by_run_id AS last_updated_by_run_id,
           c.graph_id AS graph_id
    """
    params = {
        "node_id": node_id,
        "name": payload.name,
        "domain": payload.domain,
        "type": payload.type,
        "description": payload.description,
        "tags": payload.tags,
        "notes_key": payload.notes_key,
        "lecture_key": payload.lecture_key,
        "url_slug": url_slug,
        "lecture_sources": lecture_sources,
        "created_by": created_by,
        "last_updated_by": last_updated_by,
        "aliases": payload.aliases or [],
        "graph_id": graph_id,
        "branch_id": branch_id,
    }
    
    if payload.created_by_run_id:
        params["created_by_run_id"] = payload.created_by_run_id
    if payload.last_updated_by_run_id:
        params["last_updated_by_run_id"] = payload.last_updated_by_run_id
    
    record = session.run(query, **params).single()
    return _normalize_concept_from_db(record.data())


def update_concept(session: Session, node_id: str, update: Dict[str, Any]) -> Concept:
    """
    Update a concept with partial updates.
    Only updates fields that are provided (non-None).
    """
    # Build SET clause dynamically based on provided fields
    set_clauses = []
    params = {"node_id": node_id}
    
    if update.get("description") is not None:
        set_clauses.append("c.description = $description")
        params["description"] = update["description"]
    
    if update.get("tags") is not None:
        set_clauses.append("c.tags = $tags")
        params["tags"] = update["tags"]
    
    if update.get("domain") is not None:
        set_clauses.append("c.domain = $domain")
        params["domain"] = update["domain"]
    
    if update.get("type") is not None:
        set_clauses.append("c.type = $type")
        params["type"] = update["type"]
    
    if update.get("aliases") is not None:
        set_clauses.append("c.aliases = $aliases")
        params["aliases"] = update["aliases"]
    
    if not set_clauses:
        # No updates provided, just return the current concept
        return get_concept_by_id(session, node_id)
    
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MATCH (c:Concept {{node_id: $node_id}})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
    SET {', '.join(set_clauses)}
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.description AS description,
           c.tags AS tags,
           c.notes_key AS notes_key,
           c.lecture_key AS lecture_key,
           c.url_slug AS url_slug,
           COALESCE(c.lecture_sources, []) AS lecture_sources,
           COALESCE(c.aliases, []) AS aliases,
           c.created_by AS created_by,
           c.last_updated_by AS last_updated_by
    """
    params["graph_id"] = graph_id
    params["branch_id"] = branch_id
    result = session.run(query, **params)
    record = result.single()
    if not record:
        raise ValueError(f"Concept with node_id {node_id} not found")
    return _normalize_concept_from_db(record.data())


# ---------- Artifact Functions ----------

def canonicalize_url(url: str, strip_query: bool = True) -> str:
    """
    Canonicalize a URL by:
    - Always removing fragment
    - Optionally removing query params (if strip_query=True)
    - Normalizing trailing slash
    
    Args:
        url: URL to canonicalize
        strip_query: If True, remove query parameters
    
    Returns:
        Canonicalized URL string
    """
    parsed = urlparse(url)
    
    # Always remove fragment
    # Optionally remove query
    query = '' if strip_query else parsed.query
    
    # Normalize trailing slash: remove trailing slash from path unless it's the root
    path = parsed.path.rstrip('/') or '/'
    
    # Reconstruct URL
    canonical = urlunparse((
        parsed.scheme,
        parsed.netloc,
        path,
        parsed.params,
        query,
        ''  # fragment always empty
    ))
    
    return canonical


def normalize_text_for_hash(text: str) -> str:
    """Normalize text for consistent hashing (strip whitespace, lower case)."""
    if not text:
        return ""
    return ' '.join(text.strip().lower().split())


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
    
    Args:
        session: Neo4j session
        artifact_type: Type of artifact (e.g., 'webpage', 'document', etc.)
        source_url: Optional source URL
        source_id: Optional source identifier (used if source_url is None)
        title: Optional title
        text: Full text content
        metadata: Optional metadata dict
        created_by_run_id: Optional ingestion run ID
        strip_url_query: If True, strip query params when canonicalizing URL
    
    Returns:
        Dict with keys: artifact_id, reused_existing, content_hash, canonical_url
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session, tenant_id=tenant_id)
    
    # Normalize text and compute hash
    normalized_text = normalize_text_for_hash(text)
    content_hash = hashlib.sha256(normalized_text.encode('utf-8')).hexdigest()
    
    # Derive canonical_url if source_url exists
    canonical_url = None
    if source_url:
        canonical_url = canonicalize_url(source_url, strip_query=strip_url_query)
    
    # Generate artifact_id
    artifact_id = f"A{uuid4().hex[:8].upper()}"
    
    # Prepare metadata as JSON string
    metadata_str = json.dumps(metadata) if metadata else None
    
    # Compute text length
    text_len = len(text)
    
    # Determine url value for constraint (required by NODE KEY constraint)
    # Use canonical_url if available, otherwise source_url, otherwise construct from source_id
    url_value = canonical_url or source_url
    if not url_value and source_id:
        # For Notion pages and other sources without URLs, construct a placeholder URL
        url_value = f"{artifact_type}://{source_id}"
    
    # Build ON CREATE SET clause
    on_create_set = [
        "a.artifact_id = $artifact_id",
        "a.artifact_type = $artifact_type",
        "a.url = $url_value",  # Required by constraint
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
    
    # Add run_id tracking only on CREATE
    if created_by_run_id:
        on_create_set.append("a.created_by_run_id = $created_by_run_id")
    
    # Build ON MATCH SET clause for branch tracking
    on_match_set = [
        """a.on_branches = CASE
            WHEN a.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN a.on_branches THEN a.on_branches
            ELSE a.on_branches + $branch_id
        END""",
        "a.updated_at = timestamp()",
    ]
    
    # Build MERGE query - constraint requires (graph_id, url, content_hash) as NODE KEY
    # Use url_value (which is canonical_url or source_url or constructed URL) for the constraint
    if not url_value:
        raise ValueError("Cannot create Artifact: url is required by constraint. Need source_url, canonical_url, or source_id")
    
    merge_query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MERGE (a:Artifact {
        graph_id: $graph_id,
        url: $url_value,
        content_hash: $content_hash
    })
    ON CREATE SET """ + ', '.join(on_create_set) + """
    ON MATCH SET """ + ', '.join(on_match_set) + """
    MERGE (a)-[:BELONGS_TO]->(g)
    """
    
    # Check if artifact already exists before creating (using constraint key)
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
        content_hash=content_hash
    ).single()
    
    reused_existing = existing is not None
    
    # If source_url exists, add Source node linking
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
        "url_value": url_value,  # Required for constraint
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
        raise ValueError(f"Failed to create/get artifact")
    artifact_id = record["artifact_id"]
    
    return {
        "artifact_id": artifact_id,
        "reused_existing": reused_existing,
        "content_hash": content_hash,
        "canonical_url": canonical_url
    }


def link_artifact_mentions_concept(
    session: Session,
    artifact_id: str,
    concept_node_id: str,
    ingestion_run_id: Optional[str] = None,
    tenant_id: Optional[str] = None,
) -> None:
    """
    Create or merge a MENTIONS relationship from an Artifact to a Concept.
    
    Args:
        session: Neo4j session
        artifact_id: Artifact identifier
        concept_node_id: Concept node_id
        ingestion_run_id: Optional ingestion run ID to store on the relationship
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session, tenant_id=tenant_id)
    
    # Build SET clause for relationship properties
    set_clauses = [
        "r.graph_id = COALESCE(r.graph_id, $graph_id)",
        """r.on_branches = CASE
            WHEN r.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN r.on_branches THEN r.on_branches
            ELSE r.on_branches + $branch_id
        END""",
        "r.created_at = COALESCE(r.created_at, timestamp())",
        "r.updated_at = timestamp()"
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
    MATCH (a:Artifact {{artifact_id: $artifact_id}})-[:BELONGS_TO]->(g:GraphSpace {{graph_id: $graph_id}})
    MATCH (c:Concept {{node_id: $concept_node_id}})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(a.on_branches, []) AND $branch_id IN COALESCE(c.on_branches, [])
    MERGE (a)-[r:MENTIONS]->(c)
    SET {', '.join(set_clauses)}
    RETURN 1
    """
    
    session.run(query, **params)


def get_artifact(session: Session, artifact_id: str) -> Optional[Dict[str, Any]]:
    """
    Get an artifact by artifact_id.
    
    Args:
        session: Neo4j session
        artifact_id: Artifact ID
    
    Returns:
        dict with artifact fields, or None if not found
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    query = """
    MATCH (a:Artifact {artifact_id: $artifact_id})-[:BELONGS_TO]->(g:GraphSpace {graph_id: $graph_id})
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
    
    # Parse metadata JSON string back to dict
    if data.get("metadata") and isinstance(data["metadata"], str):
        try:
            data["metadata"] = json.loads(data["metadata"])
        except json.JSONDecodeError:
            data["metadata"] = {}
    elif data.get("metadata") is None:
        data["metadata"] = {}
    
    return data


def create_relationship(session: Session, payload: RelationshipCreate, tenant_id: Optional[str] = None) -> None:
    """
    Creates or merges a relationship between two concepts by name.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session, tenant_id=tenant_id)
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (s:Concept {graph_id: $graph_id, name: $source_name})-[:BELONGS_TO]->(g)
    MATCH (t:Concept {graph_id: $graph_id, name: $target_name})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(s.on_branches, []) AND $branch_id IN COALESCE(t.on_branches, [])
    MERGE (s)-[r:`%s`]->(t)
    SET r.graph_id = COALESCE(r.graph_id, $graph_id),
        r.on_branches = CASE
            WHEN r.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN r.on_branches THEN r.on_branches
            ELSE r.on_branches + $branch_id
        END
    RETURN 1
    """ % payload.predicate  # simple for now; later sanitize

    session.run(
        query,
        source_name=payload.source_name,
        target_name=payload.target_name,
        graph_id=graph_id,
        branch_id=branch_id,
    )


def get_neighbors(
    session: Session,
    node_id: str,
    include_proposed: str = "auto",
    tenant_id: Optional[str] = None,
) -> List[Concept]:
    """
    Returns direct neighbors of a concept node, excluding merged nodes.
    
    Args:
        session: Neo4j session
        node_id: Concept node_id
        include_proposed: Visibility policy for proposed edges:
            - "auto" (default): ACCEPTED + PROPOSED with confidence >= threshold
            - "all": ACCEPTED + all PROPOSED
            - "none": Only ACCEPTED
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id, resolved_tenant_id = _get_tenant_scoped_graph_context(session, tenant_id=tenant_id)
    
    include_proposed = _normalize_include_proposed(include_proposed)
    edge_visibility_clause = _build_edge_visibility_where_clause(include_proposed)
    
    params = {
        "node_id": node_id,
        "graph_id": graph_id,
        "branch_id": branch_id,
        "tenant_id": resolved_tenant_id,
        "include_proposed": include_proposed,
        "threshold": PROPOSED_VISIBILITY_THRESHOLD,
    }
    
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    WHERE g.tenant_id = $tenant_id
    MATCH (c:Concept {{node_id: $node_id}})-[:BELONGS_TO]->(g)
    MATCH (c)-[r]-(n:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND $branch_id IN COALESCE(n.on_branches, [])
      AND $branch_id IN COALESCE(r.on_branches, [])
      AND COALESCE(n.is_merged, false) = false
      AND {edge_visibility_clause}
    RETURN DISTINCT n.node_id AS node_id,
                    n.name AS name,
                    n.domain AS domain,
                    n.type AS type,
                    n.description AS description,
                    n.tags AS tags,
                    n.notes_key AS notes_key,
                    n.lecture_key AS lecture_key,
                    n.url_slug AS url_slug,
                    COALESCE(n.lecture_sources, []) AS lecture_sources,
                    n.created_by AS created_by,
                    n.last_updated_by AS last_updated_by
    """
    result = session.run(query, **params)
    return [_normalize_concept_from_db(record.data()) for record in result]


def get_neighbors_with_relationships(
    session: Session,
    node_id: str,
    include_proposed: str = "auto",
    tenant_id: Optional[str] = None,
) -> List[dict]:
    """
    Returns direct neighbors with their relationship types, excluding merged nodes.
    Returns a list of dicts with 'concept', 'predicate', 'is_outgoing', 'relationship_status',
    'relationship_confidence', and 'relationship_method' keys.
    
    Args:
        session: Neo4j session
        node_id: Concept node_id
        include_proposed: Visibility policy for proposed edges:
            - "auto" (default): ACCEPTED + PROPOSED with confidence >= threshold
            - "all": ACCEPTED + all PROPOSED
            - "none": Only ACCEPTED
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id, resolved_tenant_id = _get_tenant_scoped_graph_context(session, tenant_id=tenant_id)
    
    include_proposed = _normalize_include_proposed(include_proposed)
    edge_visibility_clause = _build_edge_visibility_where_clause(include_proposed)
    
    params = {
        "node_id": node_id,
        "graph_id": graph_id,
        "branch_id": branch_id,
        "tenant_id": resolved_tenant_id,
        "include_proposed": include_proposed,
        "threshold": PROPOSED_VISIBILITY_THRESHOLD,
    }
    
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    WHERE g.tenant_id = $tenant_id
    MATCH (c:Concept {{node_id: $node_id}})-[:BELONGS_TO]->(g)
    MATCH (c)-[r]-(n:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND $branch_id IN COALESCE(n.on_branches, [])
      AND $branch_id IN COALESCE(r.on_branches, [])
      AND COALESCE(n.is_merged, false) = false
      AND {edge_visibility_clause}
    RETURN DISTINCT n.node_id AS node_id,
                    n.name AS name,
                    n.domain AS domain,
                    n.type AS type,
                    n.description AS description,
                    n.tags AS tags,
                    n.notes_key AS notes_key,
                    n.lecture_key AS lecture_key,
                    n.url_slug AS url_slug,
                    COALESCE(n.lecture_sources, []) AS lecture_sources,
                    n.created_by AS created_by,
                    n.last_updated_by AS last_updated_by,
                    type(r) AS predicate,
                    startNode(r).node_id = $node_id AS is_outgoing,
                    COALESCE(r.status, 'ACCEPTED') AS relationship_status,
                    COALESCE(r.confidence, 0.0) AS relationship_confidence,
                    COALESCE(r.method, 'unknown') AS relationship_method,
                    r.rationale AS relationship_rationale,
                    r.source_id AS relationship_source_id,
                    r.chunk_id AS relationship_chunk_id
    """
    result = session.run(query, **params)
    return [
        {
            "concept": _normalize_concept_from_db({k: v for k, v in record.data().items() if k not in ["predicate", "is_outgoing", "relationship_status", "relationship_confidence", "relationship_method"]}),
            "predicate": record.data()["predicate"],
            "is_outgoing": record.data()["is_outgoing"],
            "relationship_status": record.data()["relationship_status"],
            "relationship_confidence": record.data()["relationship_confidence"],
            "relationship_method": record.data()["relationship_method"],
            "relationship_rationale": record.data()["relationship_rationale"],
            "relationship_source_id": record.data()["relationship_source_id"],
            "relationship_chunk_id": record.data()["relationship_chunk_id"],
        }
        for record in result
    ]


def get_all_concepts(session: Session, tenant_id: Optional[str] = None) -> List[Concept]:
    """
    Returns all Concept nodes in the database, excluding merged nodes.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id, resolved_tenant_id = _get_tenant_scoped_graph_context(session, tenant_id=tenant_id)
    
    # Try the scoped query first
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id, tenant_id: $tenant_id})
    MATCH (c:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND COALESCE(c.is_merged, false) = false
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.description AS description,
           c.tags AS tags,
           c.notes_key AS notes_key,
           c.lecture_key AS lecture_key,
           c.url_slug AS url_slug,
           c.graph_id AS graph_id,
           COALESCE(c.tenant_id, g.tenant_id) AS tenant_id,
           COALESCE(c.lecture_sources, []) AS lecture_sources,
           COALESCE(c.aliases, []) AS aliases,
           c.created_by AS created_by,
           c.last_updated_by AS last_updated_by
    ORDER BY c.node_id
    """
    result = session.run(query, graph_id=graph_id, branch_id=branch_id, tenant_id=resolved_tenant_id)
    concepts = [_normalize_concept_from_db(record.data()) for record in result]
    
    return concepts


def get_graph_overview(
    session: Session,
    limit_nodes: int = 300,
    limit_edges: int = 600,
    include_proposed: str = "auto",
    tenant_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Returns a lightweight overview of the graph with top nodes by degree.
    
    Args:
        session: Neo4j session
        limit_nodes: Maximum number of nodes to return
        limit_edges: Maximum number of edges to return
        include_proposed: Visibility policy for proposed edges
    
    Returns:
        Dict with 'nodes', 'edges', and 'meta' keys
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id, resolved_tenant_id = _get_tenant_scoped_graph_context(session, tenant_id=tenant_id)
    
    include_proposed = _normalize_include_proposed(include_proposed)
    edge_visibility_clause = _build_edge_visibility_where_clause(include_proposed)
    
    params = {
        "graph_id": graph_id,
        "branch_id": branch_id,
        "tenant_id": resolved_tenant_id,
        "limit_nodes": limit_nodes,
        "limit_edges": limit_edges,
        "include_proposed": include_proposed,
        "threshold": PROPOSED_VISIBILITY_THRESHOLD,
    }
    
    # Get top nodes by degree (most connected)
    # Also include nodes with 0 degree to ensure isolated nodes are visible
    # Debug: First check if GraphSpace exists and count nodes
    debug_query = """
    MATCH (g:GraphSpace {graph_id: $graph_id, tenant_id: $tenant_id})
    OPTIONAL MATCH (c:Concept)-[:BELONGS_TO]->(g)
    RETURN count(c) AS total_nodes, count(DISTINCT c.on_branches) AS branch_variants
    """
    debug_result = session.run(debug_query, graph_id=graph_id)
    debug_data = debug_result.single()
    if debug_data:
        total_nodes = debug_data.get("total_nodes", 0)
        branch_variants = debug_data.get("branch_variants", 0)
        # Log for debugging (can be removed later)
        import sys
        print(f"[DEBUG] Graph {graph_id}: {total_nodes} total nodes, branch_id={branch_id}, branch_variants={branch_variants}", file=sys.stderr)
    
    # Query strategy: Ensure isolated nodes (degree = 0) are ALWAYS included
    # This is critical for sparse graphs where nodes may not have relationships yet
    # We use a UNION to get both connected nodes AND isolated nodes separately
    query = f"""
    // First part: Get connected nodes (degree > 0), ordered by degree
    MATCH (g:GraphSpace {{graph_id: $graph_id, tenant_id: $tenant_id}})
    MATCH (c:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND COALESCE(c.is_merged, false) = false
    OPTIONAL MATCH (c)-[r]-(n:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(r.on_branches, [])
      AND $branch_id IN COALESCE(n.on_branches, [])
      AND {edge_visibility_clause}
    WITH c, count(DISTINCT r) AS degree
    WHERE degree > 0
    WITH c, degree
    ORDER BY degree DESC, c.node_id ASC
    LIMIT $limit_nodes
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.description AS description,
           c.tags AS tags,
           c.notes_key AS notes_key,
           c.lecture_key AS lecture_key,
           c.url_slug AS url_slug,
           COALESCE(c.lecture_sources, []) AS lecture_sources,
           c.created_by AS created_by,
           c.last_updated_by AS last_updated_by
    
    UNION
    
    // Second part: Get ALL isolated nodes (degree = 0) - always include these
    // Use a simpler approach: get all nodes, then filter out those that have relationships
    MATCH (g:GraphSpace {{graph_id: $graph_id, tenant_id: $tenant_id}})
    MATCH (c:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND COALESCE(c.is_merged, false) = false
    WITH c
    OPTIONAL MATCH (c)-[r]-(n:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(r.on_branches, [])
      AND $branch_id IN COALESCE(n.on_branches, [])
      AND {edge_visibility_clause}
    WITH c, count(DISTINCT r) AS degree
    WHERE degree = 0
    WITH c
    ORDER BY c.node_id ASC
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.description AS description,
           c.tags AS tags,
           c.notes_key AS notes_key,
           c.lecture_key AS lecture_key,
           c.url_slug AS url_slug,
           COALESCE(c.lecture_sources, []) AS lecture_sources,
           c.created_by AS created_by,
           c.last_updated_by AS last_updated_by
    """
    result = session.run(query, **params)
    nodes = [_normalize_concept_from_db({k: v for k, v in record.data().items() if k != "degree"}) for record in result]
    node_ids = {node.node_id for node in nodes}
    
    # Enhanced debugging for isolated nodes issue
    import sys
    print(f"[DEBUG] Query returned {len(nodes)} nodes for graph_id={graph_id}, branch_id={branch_id}", file=sys.stderr)
    if len(nodes) == 0:
        # Check if nodes exist at all
        check_query = """
        MATCH (g:GraphSpace {graph_id: $graph_id, tenant_id: $tenant_id})
        OPTIONAL MATCH (c:Concept)-[:BELONGS_TO]->(g)
        RETURN count(c) AS total_nodes,
               collect(c.node_id)[0..5] AS sample_node_ids,
               collect(c.on_branches)[0..5] AS sample_branches
        """
        check_result = session.run(check_query, graph_id=graph_id, tenant_id=resolved_tenant_id)
        check_data = check_result.single()
        if check_data:
            total = check_data.get("total_nodes", 0)
            sample_ids = check_data.get("sample_node_ids", [])
            sample_branches = check_data.get("sample_branches", [])
            print(f"[DEBUG] Graph {graph_id} has {total} total nodes", file=sys.stderr)
            print(f"[DEBUG] Sample node_ids: {sample_ids}", file=sys.stderr)
            print(f"[DEBUG] Sample on_branches: {sample_branches}", file=sys.stderr)
            print(f"[DEBUG] Query branch_id filter: {branch_id}", file=sys.stderr)
    else:
        print(f"[DEBUG] Found nodes: {[n.node_id for n in nodes[:5]]}", file=sys.stderr)
    
    # Get edges among the selected nodes
    if len(node_ids) > 0:
        edge_query = f"""
        MATCH (g:GraphSpace {{graph_id: $graph_id, tenant_id: $tenant_id}})
        MATCH (s:Concept)-[:BELONGS_TO]->(g)
        MATCH (t:Concept)-[:BELONGS_TO]->(g)
        MATCH (s)-[r]->(t)
        WHERE r.graph_id = $graph_id
          AND s.node_id IN $node_ids
          AND t.node_id IN $node_ids
          AND $branch_id IN COALESCE(r.on_branches, [])
          AND $branch_id IN COALESCE(s.on_branches, [])
          AND $branch_id IN COALESCE(t.on_branches, [])
          AND {edge_visibility_clause}
        RETURN s.node_id AS source_id,
               t.node_id AS target_id,
               type(r) AS predicate,
               COALESCE(r.status, 'ACCEPTED') AS status,
               COALESCE(r.confidence, 0.0) AS confidence,
               COALESCE(r.method, 'unknown') AS method,
               r.rationale AS rationale,
               r.source_id AS relationship_source_id,
               r.chunk_id AS chunk_id
        LIMIT $limit_edges
        """
        edge_result = session.run(edge_query, node_ids=list(node_ids), **params)
        edges = [
            {
                "source_id": record.data()["source_id"],
                "target_id": record.data()["target_id"],
                "predicate": record.data()["predicate"],
                "status": record.data()["status"],
                "confidence": record.data()["confidence"],
                "method": record.data()["method"],
                "rationale": record.data()["rationale"],
                "relationship_source_id": record.data()["relationship_source_id"],
                "chunk_id": record.data()["chunk_id"],
            }
            for record in edge_result
        ]
    else:
        edges = []
    
    # Get total counts for metadata
    count_query = """
    MATCH (g:GraphSpace {graph_id: $graph_id, tenant_id: $tenant_id})
    MATCH (c:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND COALESCE(c.is_merged, false) = false
    RETURN count(c) AS total_nodes
    """
    count_result = session.run(count_query, **params)
    total_nodes = count_result.single()["total_nodes"] if count_result.peek() else 0
    
    return {
        "nodes": nodes,
        "edges": edges,
        "meta": {
            "node_count": total_nodes,
            "edge_count": len(edges),
            "sampled": len(nodes) < total_nodes if total_nodes > 0 else False,
        }
    }


def get_all_relationships(
    session: Session,
    include_proposed: str = "auto",
    tenant_id: Optional[str] = None,
) -> List[dict]:
    """
    Returns all relationships between Concept nodes.
    Returns a list of dicts with source_id, target_id, predicate, status, confidence, and method.
    In demo mode, falls back to returning all relationships if GraphSpace structure is missing.
    
    Args:
        session: Neo4j session
        include_proposed: Visibility policy for proposed edges:
            - "auto" (default): ACCEPTED + PROPOSED with confidence >= threshold
            - "all": ACCEPTED + all PROPOSED
            - "none": Only ACCEPTED
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id, resolved_tenant_id = _get_tenant_scoped_graph_context(session, tenant_id=tenant_id)
    
    include_proposed = _normalize_include_proposed(include_proposed)
    edge_visibility_clause = _build_edge_visibility_where_clause(include_proposed)
    
    params = {
        "graph_id": graph_id,
        "branch_id": branch_id,
        "tenant_id": resolved_tenant_id,
        "include_proposed": include_proposed,
        "threshold": PROPOSED_VISIBILITY_THRESHOLD,
    }
    
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id, tenant_id: $tenant_id}})
    MATCH (s:Concept)-[:BELONGS_TO]->(g)
    MATCH (t:Concept)-[:BELONGS_TO]->(g)
    MATCH (s)-[r]->(t)
    WHERE r.graph_id = $graph_id
      AND $branch_id IN COALESCE(r.on_branches, [])
      AND $branch_id IN COALESCE(s.on_branches, [])
      AND $branch_id IN COALESCE(t.on_branches, [])
      AND {edge_visibility_clause}
    RETURN s.node_id AS source_id,
           t.node_id AS target_id,
           type(r) AS predicate,
           COALESCE(r.status, 'ACCEPTED') AS status,
           COALESCE(r.confidence, 0.0) AS confidence,
           COALESCE(r.method, 'unknown') AS method,
           r.rationale AS rationale,
           r.source_id AS relationship_source_id,
           r.chunk_id AS chunk_id
    """
    result = session.run(query, **params)
    relationships = [
        {
            "source_id": record.data()["source_id"],
            "target_id": record.data()["target_id"],
            "predicate": record.data()["predicate"],
            "status": record.data()["status"],
            "confidence": record.data()["confidence"],
            "method": record.data()["method"],
            "rationale": record.data()["rationale"],
            "relationship_source_id": record.data()["relationship_source_id"],
            "chunk_id": record.data()["chunk_id"],
        }
        for record in result
    ]
    
    return relationships


def create_relationship_by_ids(
    session: Session,
    source_id: str,
    target_id: str,
    predicate: str,
    status: str = "ACCEPTED",
    confidence: Optional[float] = None,
    method: Optional[str] = None,
    source_id_meta: Optional[str] = None,
    chunk_id: Optional[str] = None,
    claim_id: Optional[str] = None,
    rationale: Optional[str] = None,
    model_version: Optional[str] = None,
    ingestion_run_id: Optional[str] = None,
    tenant_id: Optional[str] = None,
) -> None:
    """
    Creates a relationship between two concepts by their node_ids.
    
    Args:
        session: Neo4j session
        source_id: Source concept node_id
        target_id: Target concept node_id
        predicate: Relationship type
        status: Relationship status ("PROPOSED", "ACCEPTED", "REJECTED"), default "ACCEPTED"
        confidence: Confidence score (0-1), optional
        method: Creation method ("schema", "rule", "llm", "heuristic", "human"), optional
        source_id_meta: Source identifier (lecture_key / notion page id / file id), optional
        chunk_id: SourceChunk.chunk_id, optional
        claim_id: Claim.claim_id, optional
        rationale: Short explanation string, optional
        model_version: Model version identifier, optional
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session, tenant_id=tenant_id)
    
    # Build SET clause for metadata
    set_clauses = [
        "r.graph_id = COALESCE(r.graph_id, $graph_id)",
        """r.on_branches = CASE
            WHEN r.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN r.on_branches THEN r.on_branches
            ELSE r.on_branches + $branch_id
        END""",
        "r.status = $status",
        "r.created_at = COALESCE(r.created_at, timestamp())",
        "r.updated_at = timestamp()"
    ]
    
    params = {
        "source_id": source_id,
        "target_id": target_id,
        "graph_id": graph_id,
        "branch_id": branch_id,
        "status": status,
    }
    
    if confidence is not None:
        set_clauses.append("r.confidence = $confidence")
        params["confidence"] = confidence
    
    if method is not None:
        set_clauses.append("r.method = $method")
        params["method"] = method
    
    if source_id_meta is not None:
        set_clauses.append("r.source_id = $source_id_meta")
        params["source_id_meta"] = source_id_meta
    
    if chunk_id is not None:
        set_clauses.append("r.chunk_id = $chunk_id")
        params["chunk_id"] = chunk_id
    
    if claim_id is not None:
        set_clauses.append("r.claim_id = $claim_id")
        params["claim_id"] = claim_id
    
    if rationale is not None:
        set_clauses.append("r.rationale = $rationale")
        params["rationale"] = rationale
    
    if model_version is not None:
        set_clauses.append("r.model_version = $model_version")
        params["model_version"] = model_version
    
    if ingestion_run_id is not None:
        set_clauses.append("r.ingestion_run_id = $ingestion_run_id")
        params["ingestion_run_id"] = ingestion_run_id
    
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MATCH (s:Concept {{node_id: $source_id}})-[:BELONGS_TO]->(g)
    MATCH (t:Concept {{node_id: $target_id}})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(s.on_branches, []) AND $branch_id IN COALESCE(t.on_branches, [])
    MERGE (s)-[r:`{predicate}`]->(t)
    SET {', '.join(set_clauses)}
    RETURN 1
    """
    
    session.run(query, **params)


def delete_concept(session: Session, node_id: str) -> bool:
    """
    Deletes a concept node and all its relationships.
    Returns True if deleted, False if not found.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (c:Concept {node_id: $node_id})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
    DETACH DELETE c
    RETURN count(c) as deleted
    """
    result = session.run(query, node_id=node_id, graph_id=graph_id, branch_id=branch_id)
    record = result.single()
    return record and record["deleted"] > 0


def create_or_update_proposed_relationship(
    session: Session,
    graph_id: str,
    src_node_id: str,
    dst_node_id: str,
    rel_type: str,
    meta: Dict[str, Any]
) -> None:
    """
    Create or update a proposed relationship with metadata.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        src_node_id: Source concept node_id
        dst_node_id: Destination concept node_id
        rel_type: Relationship type
        meta: Metadata dict with keys:
            - status: "PROPOSED" | "ACCEPTED" | "REJECTED" (default "PROPOSED")
            - confidence: float 0-1
            - method: "schema" | "rule" | "llm" | "heuristic" | "human"
            - source_id: string (lecture_key / notion page id / file id)
            - chunk_id: string (optional)
            - claim_id: string (optional)
            - rationale: string (optional)
            - model_version: string (optional)
    """
    ensure_graph_scoping_initialized(session)
    _, branch_id = get_active_graph_context(session)
    
    status = meta.get("status", "PROPOSED")
    confidence = meta.get("confidence")
    method = meta.get("method")
    source_id_meta = meta.get("source_id")
    chunk_id = meta.get("chunk_id")
    claim_id = meta.get("claim_id")
    rationale = meta.get("rationale")
    model_version = meta.get("model_version")
    
    # Build SET clause
    set_clauses = [
        "r.graph_id = COALESCE(r.graph_id, $graph_id)",
        """r.on_branches = CASE
            WHEN r.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN r.on_branches THEN r.on_branches
            ELSE r.on_branches + $branch_id
        END""",
        "r.status = $status",
        "r.updated_at = timestamp()"
    ]
    
    params = {
        "graph_id": graph_id,
        "branch_id": branch_id,
        "src_node_id": src_node_id,
        "dst_node_id": dst_node_id,
        "status": status,
    }
    
    # Only set created_at on CREATE
    set_clauses.append("r.created_at = COALESCE(r.created_at, timestamp())")
    
    if confidence is not None:
        set_clauses.append("r.confidence = $confidence")
        params["confidence"] = confidence
    
    if method is not None:
        set_clauses.append("r.method = $method")
        params["method"] = method
    
    if source_id_meta is not None:
        set_clauses.append("r.source_id = $source_id_meta")
        params["source_id_meta"] = source_id_meta
    
    if chunk_id is not None:
        set_clauses.append("r.chunk_id = $chunk_id")
        params["chunk_id"] = chunk_id
    
    if claim_id is not None:
        set_clauses.append("r.claim_id = $claim_id")
        params["claim_id"] = claim_id
    
    if rationale is not None:
        set_clauses.append("r.rationale = $rationale")
        params["rationale"] = rationale
    
    if model_version is not None:
        set_clauses.append("r.model_version = $model_version")
        params["model_version"] = model_version
    
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MATCH (s:Concept {{node_id: $src_node_id}})-[:BELONGS_TO]->(g)
    MATCH (t:Concept {{node_id: $dst_node_id}})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(s.on_branches, []) AND $branch_id IN COALESCE(t.on_branches, [])
    MERGE (s)-[r:`{rel_type}`]->(t)
    SET {', '.join(set_clauses)}
    RETURN 1
    """
    
    session.run(query, **params)


def relationship_exists(session: Session, source_id: str, target_id: str, predicate: str) -> bool:
    """
    Check if a relationship exists between two concepts with the given predicate.
    Returns True if relationship exists (ACCEPTED or PROPOSED), False otherwise.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (s:Concept {node_id: $source_id})-[:BELONGS_TO]->(g)
    MATCH (t:Concept {node_id: $target_id})-[:BELONGS_TO]->(g)
    MATCH (s)-[r]->(t)
    WHERE type(r) = $predicate
      AND r.graph_id = $graph_id
      AND $branch_id IN COALESCE(r.on_branches, [])
      AND COALESCE(r.status, 'ACCEPTED') IN ['ACCEPTED', 'PROPOSED']
    RETURN count(r) > 0 AS exists
    """
    result = session.run(query, source_id=source_id, target_id=target_id, predicate=predicate, graph_id=graph_id, branch_id=branch_id)
    record = result.single()
    return record and record["exists"]


def delete_relationship(session: Session, source_id: str, target_id: str, predicate: str) -> bool:
    """
    Deletes a specific relationship between two concepts.
    Returns True if deleted, False if not found.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (s:Concept {node_id: $source_id})-[:BELONGS_TO]->(g)
    MATCH (t:Concept {node_id: $target_id})-[:BELONGS_TO]->(g)
    MATCH (s)-[r]->(t)
    WHERE type(r) = $predicate
      AND r.graph_id = $graph_id
      AND $branch_id IN COALESCE(r.on_branches, [])
    WITH r, count(r) AS matched
    DELETE r
    RETURN matched as deleted
    """
    result = session.run(query, source_id=source_id, target_id=target_id, predicate=predicate, graph_id=graph_id, branch_id=branch_id)
    record = result.single()
    return record and record["deleted"] > 0


def delete_test_concepts(session: Session) -> int:
    """
    Deletes all test concepts (those with "Test" or "Isolated Concept" in name).
    Returns the number of deleted nodes.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (c:Concept)-[:BELONGS_TO]->(g)
    WHERE ($branch_id IN COALESCE(c.on_branches, []))
      AND (c.name CONTAINS 'Test' OR c.name CONTAINS 'Isolated Concept' OR c.domain = 'Testing')
    DETACH DELETE c
    RETURN count(c) as deleted
    """
    result = session.run(query, graph_id=graph_id, branch_id=branch_id)
    record = result.single()
    return record["deleted"] if record else 0


def get_nodes_missing_description(session: Session, limit: int = 3) -> List[Concept]:
    """
    Returns concepts that are missing descriptions.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (c:Concept)-[:BELONGS_TO]->(g)
    WHERE ($branch_id IN COALESCE(c.on_branches, []))
      AND (c.description IS NULL OR c.description = "")
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.description AS description,
           c.tags AS tags,
           c.notes_key AS notes_key,
           c.lecture_key AS lecture_key,
           c.url_slug AS url_slug,
           COALESCE(c.lecture_sources, []) AS lecture_sources,
           c.created_by AS created_by,
           c.last_updated_by AS last_updated_by
    LIMIT $limit
    """
    result = session.run(query, graph_id=graph_id, branch_id=branch_id, limit=limit)
    return [_normalize_concept_from_db(record.data()) for record in result]


def get_neighbors_for_nodes(session: Session, node_ids: List[str], include_proposed: str = "auto") -> dict:
    """
    Returns a mapping of node_id -> list of neighbor node_ids for building context.
    Properly scoped to graph, branch, excludes merged nodes, and respects visibility policy.
    
    Args:
        session: Neo4j session
        node_ids: List of concept node_ids
        include_proposed: Visibility policy for proposed edges:
            - "auto" (default): ACCEPTED + PROPOSED with confidence >= threshold
            - "all": ACCEPTED + all PROPOSED
            - "none": Only ACCEPTED
    """
    if not node_ids:
        return {}
    
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    include_proposed = _normalize_include_proposed(include_proposed)
    edge_visibility_clause = _build_edge_visibility_where_clause(include_proposed)
    
    params = {
        "node_ids": node_ids,
        "graph_id": graph_id,
        "branch_id": branch_id,
        "include_proposed": include_proposed,
        "threshold": PROPOSED_VISIBILITY_THRESHOLD,
    }
    
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MATCH (c:Concept {{graph_id: $graph_id}})-[:BELONGS_TO]->(g)
    WHERE c.node_id IN $node_ids
      AND $branch_id IN COALESCE(c.on_branches, [])
      AND COALESCE(c.is_merged, false) = false
    MATCH (c)-[r]-(n:Concept {{graph_id: $graph_id}})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(n.on_branches, [])
      AND $branch_id IN COALESCE(r.on_branches, [])
      AND COALESCE(n.is_merged, false) = false
      AND {edge_visibility_clause}
    RETURN c.node_id AS source_id, collect(DISTINCT n.node_id) AS neighbor_ids
    """
    result = session.run(query, **params)
    return {record["source_id"]: record["neighbor_ids"] for record in result}


def unlink_lecture(session: Session, lecture_id: str) -> dict:
    """
    Remove a lecture as a source from all nodes.
    
    Behavior:
    - For each Concept node that has lecture_id in lecture_sources:
        - If len(lecture_sources) == 1:
            - delete the node and all relationships connected to it
        - Else:
            - remove lecture_id from lecture_sources
            - if created_by == lecture_id:
                  - set created_by to some remaining source (e.g. first lecture_sources element)
            - if last_updated_by == lecture_id:
                  - set last_updated_by to the latest remaining source
    
    Args:
        session: Neo4j session
        lecture_id: Lecture ID to unlink
    
    Returns:
        Dictionary with stats: nodes_deleted, nodes_updated, relationships_deleted
    """
    stats = {
        "nodes_deleted": 0,
        "nodes_updated": 0,
        "relationships_deleted": 0
    }
    
    # Step 1: Find and delete concepts where lecture_id is the only source
    # Handle backward compatibility: also check lecture_key
    delete_query = """
    MATCH (c:Concept)
    WHERE (
      ($lecture_id IN COALESCE(c.lecture_sources, []) AND size(COALESCE(c.lecture_sources, [])) = 1)
      OR (c.lecture_key = $lecture_id AND (c.lecture_sources IS NULL OR size(COALESCE(c.lecture_sources, [])) = 0))
    )
    WITH c, size((c)--()) AS rel_count
    DETACH DELETE c
    RETURN count(c) AS deleted_count, sum(rel_count) AS deleted_rels
    """
    result = session.run(delete_query, lecture_id=lecture_id)
    record = result.single()
    if record:
        stats["nodes_deleted"] = record["deleted_count"] or 0
        stats["relationships_deleted"] = record["deleted_rels"] or 0
    
    # Step 2: Update concepts with multiple sources
    # First, get all concepts that need updating
    # Handle backward compatibility: also check lecture_key
    find_query = """
    MATCH (c:Concept)
    WHERE (
      ($lecture_id IN COALESCE(c.lecture_sources, []) AND size(COALESCE(c.lecture_sources, [])) > 1)
      OR (c.lecture_key = $lecture_id AND c.lecture_sources IS NOT NULL AND size(COALESCE(c.lecture_sources, [])) > 1)
    )
    RETURN c.node_id AS node_id,
           COALESCE(c.lecture_sources, CASE WHEN c.lecture_key = $lecture_id THEN [c.lecture_key] ELSE [] END) AS lecture_sources,
           COALESCE(c.created_by, c.lecture_key) AS created_by,
           COALESCE(c.last_updated_by, c.lecture_key) AS last_updated_by
    """
    result = session.run(find_query, lecture_id=lecture_id)
    nodes_to_update = [record.data() for record in result]
    
    # Update each node
    for node_data in nodes_to_update:
        node_id = node_data["node_id"]
        lecture_sources = node_data.get("lecture_sources") or []
        created_by = node_data.get("created_by")
        last_updated_by = node_data.get("last_updated_by")
        
        # Remove lecture_id from sources
        updated_sources = [s for s in lecture_sources if s != lecture_id]
        
        # Update created_by if it was the lecture_id
        updated_created_by = created_by
        if created_by == lecture_id and updated_sources:
            updated_created_by = updated_sources[0]  # Use first remaining source
        elif not updated_created_by and updated_sources:
            updated_created_by = updated_sources[0]  # Fallback if created_by was null
        
        # Update last_updated_by if it was the lecture_id
        updated_last_updated_by = last_updated_by
        if last_updated_by == lecture_id and updated_sources:
            updated_last_updated_by = updated_sources[-1]  # Use last remaining source
        elif not updated_last_updated_by and updated_sources:
            updated_last_updated_by = updated_sources[-1]  # Fallback if last_updated_by was null
        
        # Update the node
        update_query = """
        MATCH (c:Concept {node_id: $node_id})
        SET c.lecture_sources = $lecture_sources,
            c.created_by = $created_by,
            c.last_updated_by = $last_updated_by
        RETURN 1
        """
        session.run(
            update_query,
            node_id=node_id,
            lecture_sources=updated_sources,
            created_by=updated_created_by,
            last_updated_by=updated_last_updated_by
        )
        stats["nodes_updated"] += 1
    
    return stats


# ---------- Personalization Service Functions ----------

def get_response_style_profile(session: Session) -> ResponseStyleProfileWrapper:
    """
    Fetch the current response style profile from Neo4j.
    If none exists, return a sensible default.
    This profile shapes how Brain Web answers questions.
    """
    query = """
    MERGE (m:Meta {key: 'response_style_profile'})
    ON CREATE SET m.value = $default_value
    RETURN m.value AS value
    """
    default = {
        "tone": "intuitive, grounded, exploratory, conversational but technical",
        "teaching_style": "analogy-first, zoom-out then zoom-in, highlight big picture first",
        "sentence_structure": "short, minimal filler, no dramatic flourishes",
        "explanation_order": [
            "big picture",
            "core concept definition",
            "example/analogy",
            "connection to adjacent concepts",
            "common pitfalls",
            "summary"
        ],
        "forbidden_styles": ["overly formal", "glib", "generic", "high-level nothingness", "GPT-polish"],
    }
    # Serialize default to JSON string for Neo4j storage
    default_json = json.dumps(default)
    record = session.run(query, default_value=default_json).single()
    if record and record["value"]:
        # Deserialize JSON string back to dict
        value = record["value"]
        if isinstance(value, str):
            profile_dict = json.loads(value)
        else:
            profile_dict = value
        profile = ResponseStyleProfile(**profile_dict)
    else:
        profile = ResponseStyleProfile(**default)
    return ResponseStyleProfileWrapper(id="default", profile=profile)


def update_response_style_profile(session: Session, wrapper: ResponseStyleProfileWrapper) -> ResponseStyleProfileWrapper:
    """
    Update the response style profile in Neo4j.
    """
    query = """
    MERGE (m:Meta {key: 'response_style_profile'})
    SET m.value = $value
    RETURN m.value AS value
    """
    # Serialize to JSON string for Neo4j storage
    value_json = json.dumps(wrapper.profile.dict())
    record = session.run(query, value=value_json).single()
    # Deserialize JSON string back to dict
    value = record["value"]
    if isinstance(value, str):
        profile_dict = json.loads(value)
    else:
        profile_dict = value
    profile = ResponseStyleProfile(**profile_dict)
    return ResponseStyleProfileWrapper(id=wrapper.id, profile=profile)


def store_answer(session: Session, answer: AnswerRecord) -> None:
    """
    Store an answer record in Neo4j.
    """
    query = """
    CREATE (a:AnswerRecord {
        answer_id: $answer_id,
        question: $question,
        raw_answer: $raw_answer,
        used_node_ids: $used_node_ids,
        created_at: $created_at
    })
    """
    answer_dict = answer.dict()
    if isinstance(answer_dict.get('created_at'), datetime.datetime):
        answer_dict['created_at'] = answer_dict['created_at'].isoformat()
    session.run(query, **answer_dict)


def store_style_feedback(session: Session, fb) -> str:
    """
    Store structured style feedback for learning user preferences.
    Returns the feedback_id.
    """
    from models import StyleFeedbackRequest
    from datetime import datetime
    import uuid
    
    feedback_id = f"style_fb_{uuid.uuid4().hex[:12]}"
    query = """
    CREATE (sf:StyleFeedback {
        feedback_id: $feedback_id,
        answer_id: $answer_id,
        question: $question,
        original_response: $original_response,
        feedback_notes: $feedback_notes,
        user_rewritten_version: $user_rewritten_version,
        test_label: $test_label,
        verbosity: $verbosity,
        question_preference: $question_preference,
        humor_preference: $humor_preference,
        created_at: $created_at
    })
    RETURN sf.feedback_id AS feedback_id
    """
    
    fb_dict = fb.dict()
    if isinstance(fb_dict.get('created_at'), datetime):
        fb_dict['created_at'] = fb_dict['created_at'].isoformat()
    
    fb_dict['feedback_id'] = feedback_id
    result = session.run(query, **fb_dict).single()
    if result:
        return result["feedback_id"]
    return feedback_id


def get_style_feedback_examples(session: Session, limit: int = 10) -> List[Dict[str, Any]]:
    """
    Get recent style feedback examples for display and analysis.
    """
    query = """
    MATCH (sf:StyleFeedback)
    WITH sf
    ORDER BY sf.created_at DESC
    LIMIT $limit
    RETURN sf.feedback_id AS feedback_id,
           sf.answer_id AS answer_id,
           sf.question AS question,
           sf.original_response AS original_response,
           sf.feedback_notes AS feedback_notes,
           sf.user_rewritten_version AS user_rewritten_version,
           sf.test_label AS test_label,
           sf.verbosity AS verbosity,
           sf.question_preference AS question_preference,
           sf.humor_preference AS humor_preference,
           sf.created_at AS created_at
    """
    records = session.run(query, limit=limit)
    results = []
    for rec in records:
        results.append({
            "feedback_id": rec["feedback_id"],
            "answer_id": rec["answer_id"],
            "question": rec["question"],
            "original_response": rec["original_response"],
            "feedback_notes": rec["feedback_notes"],
            "user_rewritten_version": rec.get("user_rewritten_version"),
            "test_label": rec.get("test_label"),
            "verbosity": rec.get("verbosity"),
            "question_preference": rec.get("question_preference"),
            "humor_preference": rec.get("humor_preference"),
            "created_at": rec["created_at"],
        })
    return results


def store_revision(session: Session, revision: Revision) -> None:
    """
    Store a user-rewritten answer as a Revision node linked to the AnswerRecord.
    """
    query = """
    MATCH (a:AnswerRecord {answer_id: $answer_id})
    CREATE (r:Revision {
        answer_id: $answer_id,
        user_rewritten_answer: $user_rewritten_answer,
        created_at: $created_at
    })
    CREATE (a)-[:HAS_REVISION]->(r)
    """
    revision_dict = revision.dict()
    if isinstance(revision_dict.get('created_at'), datetime.datetime):
        revision_dict['created_at'] = revision_dict['created_at'].isoformat()
    session.run(query, **revision_dict)


def get_recent_answers(session: Session, limit: int = 10) -> List[Dict[str, Any]]:
    """
    Get recent answers with feedback and revision flags.
    """
    query = """
    MATCH (a:AnswerRecord)
    OPTIONAL MATCH (a)-[:HAS_REVISION]->(r:Revision)
    OPTIONAL MATCH (f:Feedback {answer_id: a.answer_id})
    WITH a, 
         COUNT(DISTINCT r) > 0 AS has_revision,
         COUNT(DISTINCT f) > 0 AS has_feedback
    ORDER BY a.created_at DESC
    LIMIT $limit
    RETURN a.answer_id AS answer_id,
           a.question AS question,
           a.raw_answer AS raw_answer,
           a.created_at AS created_at,
           has_feedback,
           has_revision
    """
    records = session.run(query, limit=limit)
    results = []
    for rec in records:
        results.append({
            "answer_id": rec["answer_id"],
            "question": rec["question"],
            "raw_answer": rec["raw_answer"],
            "created_at": rec["created_at"],
            "has_feedback": rec["has_feedback"],
            "has_revision": rec["has_revision"],
        })
    return results


def get_answer_detail(session: Session, answer_id: str) -> Optional[Dict[str, Any]]:
    """
    Get full answer details including feedback and revisions.
    """
    query = """
    MATCH (a:AnswerRecord {answer_id: $answer_id})
    OPTIONAL MATCH (f:Feedback {answer_id: $answer_id})
    OPTIONAL MATCH (a)-[:HAS_REVISION]->(r:Revision)
    RETURN a,
           collect(DISTINCT {rating: f.rating, reason: f.reasoning, created_at: f.created_at}) AS feedback,
           collect(DISTINCT {user_rewritten_answer: r.user_rewritten_answer, created_at: r.created_at}) AS revisions
    """
    record = session.run(query, answer_id=answer_id).single()
    if not record:
        return None
    
    a = record["a"]
    feedback = [f for f in record["feedback"] if f.get("rating") is not None]
    revisions = [r for r in record["revisions"] if r.get("user_rewritten_answer")]
    
    return {
        "answer": {
            "answer_id": a.get("answer_id"),
            "question": a.get("question"),
            "raw_answer": a.get("raw_answer"),
            "used_node_ids": a.get("used_node_ids", []),
            "created_at": a.get("created_at"),
        },
        "feedback": feedback,
        "revisions": revisions,
    }


def get_example_answers(session: Session, limit: int = 5) -> List[Dict[str, Any]]:
    """
    Get recent user-rewritten answers to use as style examples.
    Returns answers with their revisions for style guidance.
    """
    query = """
    MATCH (a:AnswerRecord)-[:HAS_REVISION]->(r:Revision)
    WITH a, r
    ORDER BY r.created_at DESC
    LIMIT $limit
    RETURN a.question AS question,
           r.user_rewritten_answer AS answer,
           a.answer_id AS answer_id
    """
    records = session.run(query, limit=limit)
    results = []
    for rec in records:
        results.append({
            "question": rec["question"],
            "answer": rec["answer"],
            "answer_id": rec["answer_id"],
        })
    return results


def store_feedback(session: Session, fb: ExplanationFeedback) -> None:
    """
    Store feedback as a node in Neo4j.
    Feedback is used to improve future responses through feedback loops.
    """
    query = """
    CREATE (f:Feedback {
        answer_id: $answer_id,
        question: $question,
        rating: $rating,
        reasoning: $reasoning,
        verbosity: $verbosity,
        question_preference: $question_preference,
        humor_preference: $humor_preference,
        created_at: $created_at
    })
    """
    # Convert datetime to ISO format string for Neo4j storage
    fb_dict = fb.dict()
    if isinstance(fb_dict.get('created_at'), datetime.datetime):
        fb_dict['created_at'] = fb_dict['created_at'].isoformat()
    session.run(query, **fb_dict)


def get_recent_feedback_summary(session: Session, limit: int = 50) -> FeedbackSummary:
    """
    Aggregate recent feedback to guide future responses.
    Returns a summary of positive/negative feedback and common reasons.
    """
    query = """
    MATCH (f:Feedback)
    WITH f
    ORDER BY f.created_at DESC
    LIMIT $limit
    RETURN collect(f) AS feedback
    """
    record = session.run(query, limit=limit).single()
    feedback_nodes = record["feedback"] if record and record["feedback"] else []

    total = len(feedback_nodes)
    positive = sum(1 for f in feedback_nodes if f.get("rating", 0) > 0)
    negative = sum(1 for f in feedback_nodes if f.get("rating", 0) < 0)
    reasons: Dict[str, int] = {}
    for f in feedback_nodes:
        reason = f.get("reasoning") or "unspecified"
        reasons[reason] = reasons.get(reason, 0) + 1

    return FeedbackSummary(
        total=total,
        positive=positive,
        negative=negative,
        common_reasons=reasons,
    )


def get_focus_areas(session: Session) -> List[FocusArea]:
    """
    Get all focus areas from Neo4j.
    Focus areas represent current learning themes that bias answers.
    """
    query = """
    MATCH (f:FocusArea)
    RETURN f
    """
    records = session.run(query)
    areas = []
    for rec in records:
        node = rec["f"]
        areas.append(FocusArea(
            id=node.get("id") or node.get("name", ""),
            name=node.get("name", ""),
            description=node.get("description"),
            active=node.get("active", True),
        ))
    return areas


def upsert_focus_area(session: Session, fa: FocusArea) -> FocusArea:
    """
    Create or update a focus area in Neo4j.
    """
    query = """
    MERGE (f:FocusArea {id: $id})
    SET f.name = $name,
        f.description = $description,
        f.active = $active
    RETURN f
    """
    rec = session.run(query, **fa.dict()).single()
    node = rec["f"]
    return FocusArea(
        id=node.get("id", fa.id),
        name=node.get("name", fa.name),
        description=node.get("description"),
        active=node.get("active", True),
    )


def set_focus_area_active(session: Session, focus_id: str, active: bool) -> FocusArea:
    """
    Toggle the active status of a focus area.
    """
    query = """
    MATCH (f:FocusArea {id: $focus_id})
    SET f.active = $active
    RETURN f
    """
    rec = session.run(query, focus_id=focus_id, active=active).single()
    if not rec:
        raise ValueError(f"Focus area with id {focus_id} not found")
    node = rec["f"]
    return FocusArea(
        id=node.get("id", focus_id),
        name=node.get("name", ""),
        description=node.get("description"),
        active=node.get("active", True),
    )


def get_user_profile(session: Session, user_id: str = "default") -> UserProfile:
    """
    Get the user profile from Neo4j, synced with Postgres user data.
    If none exists, create a default one.
    The profile encodes background, interests, weak spots, and learning preferences.
    """
    # Fetch from Postgres if real user
    postgres_user = None
    default_name = "Sanjay"
    default_email = None
    
    if user_id != "default":
        try:
            postgres_user = get_user_by_id(user_id)
        except Exception:
            # Best-effort: Postgres may be unavailable in dev/test/demo environments.
            postgres_user = None
        if postgres_user:
            default_name = postgres_user.get("full_name") or "User"
            default_email = postgres_user.get("email")

    query = """
    MERGE (u:UserProfile {id: $user_id})
    ON CREATE SET u.name = $default_name,
                  u.email = $default_email,
                  u.signup_date = datetime(),
                  u.background = [],
                  u.interests = [],
                  u.weak_spots = [],
                  u.learning_preferences = $empty_json
    RETURN u
    """
    # Use empty JSON object string for learning_preferences
    empty_json = json.dumps({})
    empty_static = json.dumps({"occupation": "", "core_skills": [], "learning_style": "", "verified_expertise": []})
    empty_episodic = json.dumps({"current_projects": [], "active_topics": [], "recent_searches": [], "last_updated": None})
    
    params = {
        "user_id": user_id,
        "default_name": default_name,
        "default_email": default_email,
        "empty_json": empty_json
    }
    
    rec = session.run(query, **params).single()
    u = rec["u"]
    
    # Deserialize JSON fields
    learning_prefs = u.get("learning_preferences", {})
    if isinstance(learning_prefs, str):
        learning_prefs = json.loads(learning_prefs)
    
    static_profile = u.get("static_profile", empty_static)
    if isinstance(static_profile, str):
        static_profile = json.loads(static_profile)
    elif static_profile is None:
        static_profile = json.loads(empty_static)
    
    episodic_context = u.get("episodic_context", empty_episodic)
    if isinstance(episodic_context, str):
        episodic_context = json.loads(episodic_context)
    elif episodic_context is None:
        episodic_context = json.loads(empty_episodic)
    
    # Prioritize Postgres data if available
    final_name = postgres_user.get("full_name") if postgres_user else u.get("name", "Sanjay")
    final_email = postgres_user.get("email") if postgres_user else u.get("email")
    
    return UserProfile(
        id=user_id,
        name=final_name or "User",
        email=final_email,
        signup_date=u.get("signup_date").to_native() if u.get("signup_date") and hasattr(u.get("signup_date"), "to_native") else u.get("signup_date"),
        background=u.get("background", []),
        interests=u.get("interests", []),
        weak_spots=u.get("weak_spots", []),
        learning_preferences=learning_prefs,
        static_profile=static_profile,
        episodic_context=episodic_context,
    )


def update_user_profile(session: Session, profile: UserProfile, user_id: str = "default") -> UserProfile:
    """
    Update the user profile in Neo4j and Postgres.
    """
    # Determine the target user ID
    target_id = user_id
    if target_id == "default" and profile.id and profile.id != "default":
        target_id = profile.id
    
    # Ensure profile ID matches target
    profile.id = target_id
    
    # Update Postgres if real user
    if target_id != "default":
        try:
            update_user(target_id, email=profile.email, full_name=profile.name)
        except Exception:
            # Best-effort: Postgres may be unavailable in dev/test/demo environments.
            pass
    query = """
    MERGE (u:UserProfile {id: $id})
    SET u.name = $name,
        u.email = $email,
        u.signup_date = $signup_date,
        u.background = $background,
        u.interests = $interests,
        u.weak_spots = $weak_spots,
        u.learning_preferences = $learning_preferences,
        u.static_profile = $static_profile,
        u.episodic_context = $episodic_context
    RETURN u
    """
    profile_dict = profile.dict()
    # Serialize JSON fields to strings
    profile_dict["learning_preferences"] = json.dumps(profile_dict["learning_preferences"])
    profile_dict["static_profile"] = json.dumps(profile_dict["static_profile"])
    profile_dict["episodic_context"] = json.dumps(profile_dict["episodic_context"])
    
    rec = session.run(query, **profile_dict).single()
    u = rec["u"]
    
    # Deserialize JSON fields
    learning_prefs = u.get("learning_preferences", {})
    if isinstance(learning_prefs, str):
        learning_prefs = json.loads(learning_prefs)
    
    static_profile = u.get("static_profile", {})
    if isinstance(static_profile, str):
        static_profile = json.loads(static_profile)
    
    episodic_context = u.get("episodic_context", {})
    if isinstance(episodic_context, str):
        episodic_context = json.loads(episodic_context)
    
    return UserProfile(
        id=u["id"],
        name=u["name"],
        email=u.get("email"),
        signup_date=u.get("signup_date").to_native() if u.get("signup_date") and hasattr(u.get("signup_date"), "to_native") else u.get("signup_date"),
        background=u.get("background", []),
        interests=u.get("interests", []),
        weak_spots=u.get("weak_spots", []),
        learning_preferences=learning_prefs,
        static_profile=static_profile,
        episodic_context=episodic_context
    )


def patch_user_profile(session: Session, updates: Dict[str, Any], user_id: str = "default") -> UserProfile:
    """
    Partial update of user profile. Merges lists and dicts safely.
    """
    current = get_user_profile(session, user_id=user_id)
    current_dict = current.dict()
    
    # Handle list merging
    for list_field in ["background", "interests", "weak_spots"]:
        if list_field in updates and isinstance(updates[list_field], list):
            # Combine and dedup
            combined = current_dict.get(list_field, []) + updates[list_field]
            current_dict[list_field] = list(dict.fromkeys(combined))
    
    # Handle dict merging
    for dict_field in ["learning_preferences", "static_profile", "episodic_context"]:
        if dict_field in updates and isinstance(updates[dict_field], dict):
            merged = current_dict.get(dict_field, {})
            merged.update(updates[dict_field])
            current_dict[dict_field] = merged
            
    # Handle name update
    if "name" in updates:
        current_dict["name"] = updates["name"]
        
    # Handle email update
    if "email" in updates:
        current_dict["email"] = updates["email"]
        
    updated_profile = UserProfile(**current_dict)
    return update_user_profile(session, updated_profile, user_id=user_id)


def update_episodic_context(session: Session) -> UserProfile:
    """
    Auto-update episodic context based on recent activity.
    Fetches recent learning topics and conversation summaries to populate:
    - current_projects
    - active_topics
    - recent_searches
    """
    import time
    
    # Get current profile
    profile = get_user_profile(session)
    
    # Get active learning topics (last 7 days)
    topics = get_active_learning_topics(session, limit=10)
    active_topics = [t.name for t in topics[:5]]  # Top 5 topics
    
    # Infer current projects from topics (heuristic: topics with high mention count)
    current_projects = [t.name for t in topics if t.mention_count >= 3][:3]
    
    # Get recent conversation summaries for search context
    summaries = get_recent_conversation_summaries(session, limit=5)
    recent_searches = [s.summary for s in summaries if s.summary][:3]
    
    # Update episodic context
    profile.episodic_context = {
        "current_projects": current_projects,
        "active_topics": active_topics,
        "recent_searches": recent_searches,
        "last_updated": int(time.time())
    }
    
    # Save updated profile
    return update_user_profile(session, profile)


def store_conversation_summary(
    session: Session,
    summary: ConversationSummary,
    *,
    user_id: str = "default",
    tenant_id: str = "default",
) -> ConversationSummary:
    """
    Store a conversation summary in Neo4j for long-term memory.
    """
    query = """
    MERGE (cs:ConversationSummary {id: $id})
    SET cs.timestamp = $timestamp,
        cs.question = $question,
        cs.answer = $answer,
        cs.topics = $topics,
        cs.summary = $summary,
        cs.user_id = $user_id,
        cs.tenant_id = $tenant_id
    RETURN cs
    """
    rec = session.run(query, **summary.dict(), user_id=user_id, tenant_id=tenant_id).single()
    cs = rec["cs"]
    return ConversationSummary(
        id=cs.get("id"),
        timestamp=cs.get("timestamp"),
        question=cs.get("question"),
        answer=cs.get("answer"),
        topics=cs.get("topics", []),
        summary=cs.get("summary", ""),
    )


def get_recent_conversation_summaries(
    session: Session,
    limit: int = 10,
    *,
    user_id: str = "default",
    tenant_id: str = "default",
) -> List[ConversationSummary]:
    """
    Get recent conversation summaries for context.
    """
    query = """
    MATCH (cs:ConversationSummary)
    WHERE (
      cs.user_id = $user_id
      AND (cs.tenant_id = $tenant_id OR cs.tenant_id IS NULL)
    ) OR (
      cs.user_id IS NULL
      AND cs.tenant_id IS NULL
      AND ($user_id = 'default' OR $user_id STARTS WITH 'dev-')
    )
    RETURN cs
    ORDER BY cs.timestamp DESC
    LIMIT $limit
    """
    results = session.run(query, limit=limit, user_id=user_id, tenant_id=tenant_id)
    summaries = []
    for rec in results:
        cs = rec["cs"]
        summaries.append(ConversationSummary(
            id=cs.get("id"),
            timestamp=cs.get("timestamp"),
            question=cs.get("question"),
            answer=cs.get("answer"),
            topics=cs.get("topics", []),
            summary=cs.get("summary", ""),
        ))
    return summaries


def upsert_learning_topic(session: Session, topic: LearningTopic) -> LearningTopic:
    """
    Create or update a learning topic. If topic exists, increment mention count and update last_mentioned.
    """
    from models import LearningTopic
    query = """
    MERGE (lt:LearningTopic {id: $id})
    ON CREATE SET lt.name = $name,
                  lt.first_mentioned = $first_mentioned,
                  lt.last_mentioned = $last_mentioned,
                  lt.mention_count = 1,
                  lt.related_topics = $related_topics,
                  lt.notes = $notes
    ON MATCH SET lt.last_mentioned = $last_mentioned,
                 lt.mention_count = lt.mention_count + 1,
                 lt.related_topics = CASE 
                     WHEN $related_topics IS NOT NULL AND size($related_topics) > 0 
                     THEN $related_topics 
                     ELSE lt.related_topics 
                 END,
                 lt.notes = CASE 
                     WHEN $notes IS NOT NULL AND $notes <> '' 
                     THEN $notes 
                     ELSE lt.notes 
                 END
    RETURN lt
    """
    rec = session.run(query, **topic.dict()).single()
    lt = rec["lt"]
    return LearningTopic(
        id=lt.get("id"),
        name=lt.get("name"),
        first_mentioned=lt.get("first_mentioned"),
        last_mentioned=lt.get("last_mentioned"),
        mention_count=lt.get("mention_count", 1),
        related_topics=lt.get("related_topics", []),
        notes=lt.get("notes", ""),
    )


def get_active_learning_topics(session: Session, limit: int = 20) -> List[LearningTopic]:
    """
    Get active learning topics (recently mentioned).
    """
    # Get topics mentioned in the last 30 days
    thirty_days_ago = int(time.time()) - (30 * 24 * 60 * 60)
    query = """
    MATCH (lt:LearningTopic)
    WHERE lt.last_mentioned >= $thirty_days_ago
    RETURN lt
    ORDER BY lt.last_mentioned DESC, lt.mention_count DESC
    LIMIT $limit
    """
    results = session.run(query, thirty_days_ago=thirty_days_ago, limit=limit)
    topics = []
    for rec in results:
        lt = rec["lt"]
        topics.append(LearningTopic(
            id=lt.get("id"),
            name=lt.get("name"),
            first_mentioned=lt.get("first_mentioned"),
            last_mentioned=lt.get("last_mentioned"),
            mention_count=lt.get("mention_count", 1),
            related_topics=lt.get("related_topics", []),
            notes=lt.get("notes", ""),
        ))
    return topics


def find_concept_gaps(session: Session, limit: int = 5) -> List[str]:
    """
    Find concept gaps in the knowledge graph.
    Very simple heuristic for now:
    - Concepts with very short descriptions
    - Concepts with very low degree (few relationships)
    
    Returns a list of concept names that represent gaps.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (c:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
    OPTIONAL MATCH (c)-[r]-(:Concept)-[:BELONGS_TO]->(g)
    WITH c, count(r) AS degree
    WHERE (c.description IS NULL OR size(c.description) < 60) OR degree < 2
    RETURN c.name AS name
    LIMIT $limit
    """
    records = session.run(query, graph_id=graph_id, branch_id=branch_id, limit=limit)
    return [r["name"] for r in records]


def get_notion_config(session: Session) -> NotionConfig:
    """
    Get the Notion sync configuration from Neo4j.
    If none exists, return a default configuration.
    """
    query = """
    MERGE (m:Meta {key: 'notion_config'})
    ON CREATE SET m.value = $default_value
    RETURN m.value AS value
    """
    default = {
        "database_ids": [],
        "enable_auto_sync": False
    }
    default_json = json.dumps(default)
    record = session.run(query, default_value=default_json).single()
    value = record["value"]
    if isinstance(value, str):
        config_dict = json.loads(value)
    else:
        config_dict = value
    return NotionConfig(**config_dict)


def update_notion_config(session: Session, config: NotionConfig) -> NotionConfig:
    """
    Update the Notion sync configuration in Neo4j.
    """
    query = """
    MERGE (m:Meta {key: 'notion_config'})
    SET m.value = $value
    RETURN m.value AS value
    """
    # Serialize to JSON string for Neo4j storage
    value_json = json.dumps(config.dict())
    record = session.run(query, value=value_json).single()
    # Deserialize JSON string back to dict
    value = record["value"]
    if isinstance(value, str):
        config_dict = json.loads(value)
    else:
        config_dict = value
    return NotionConfig(**config_dict)


def get_ui_preferences(session: Session) -> UIPreferences:
    """
    Get UI preferences (lens system, etc.) from Neo4j.
    If none exists, return default preferences.
    """
    query = """
    MERGE (m:Meta {key: 'ui_preferences'})
    ON CREATE SET m.value = $default_value
    RETURN m.value AS value
    """
    default = {
        "active_lens": "NONE"
    }
    default_json = json.dumps(default)
    record = session.run(query, default_value=default_json).single()
    if record and record["value"]:
        value = record["value"]
        if isinstance(value, str):
            prefs_dict = json.loads(value)
        else:
            prefs_dict = value
        return UIPreferences(**prefs_dict)
    else:
        return UIPreferences(**default)


def update_ui_preferences(session: Session, prefs: UIPreferences) -> UIPreferences:
    """
    Update UI preferences (lens system, etc.) in Neo4j.
    """
    query = """
    MERGE (m:Meta {key: 'ui_preferences'})
    SET m.value = $value
    RETURN m.value AS value
    """
    # Serialize to JSON string for Neo4j storage
    value_json = json.dumps(prefs.dict())
    record = session.run(query, value=value_json).single()
    # Deserialize JSON string back to dict
    value = record["value"]
    if isinstance(value, str):
        prefs_dict = json.loads(value)
    else:
        prefs_dict = value
    return UIPreferences(**prefs_dict)


# ---------- Lecture Segment and Analogy Functions ----------

def get_or_create_analogy(
    session: Session,
    label: str,
    description: Optional[str] = None,
    tags: Optional[List[str]] = None,
    tenant_id: Optional[str] = None,
) -> dict:
    """
    Get or create an Analogy node by label (case-insensitive).
    Returns: dict with analogy_id, label, description, tags.
    """
    from uuid import uuid4
    
    tags = tags or []
    analogy_id = f"ANALOGY_{uuid4().hex[:8]}"

    # Merge tags: combine existing and new tags, removing duplicates
    # SCOPED BY TENANT_ID to prevent leaks
    query = """
    MERGE (a:Analogy {label_lower: toLower($label), tenant_id: $tenant_id})
      ON CREATE SET a.analogy_id = $analogy_id,
                    a.label = $label,
                    a.label_lower = toLower($label),
                    a.description = $description,
                    a.tags = $tags,
                    a.created_at = datetime(),
                    a.tenant_id = $tenant_id
      ON MATCH SET a.description = coalesce(a.description, $description),
                   a.tags = CASE 
                     WHEN $tags IS NULL OR size($tags) = 0 THEN a.tags
                     ELSE [tag IN a.tags WHERE tag IS NOT NULL] + 
                          [tag IN $tags WHERE tag IS NOT NULL AND NOT tag IN a.tags]
                   END
    RETURN a.analogy_id AS analogy_id,
           a.label        AS label,
           a.description  AS description,
           COALESCE(a.tags, []) AS tags
    """
    result = session.run(
        query,
        label=label,
        analogy_id=analogy_id,
        description=description,
        tags=tags,
        tenant_id=tenant_id
    )
    record = result.single()
    if not record:
        # Fallback: create with provided data
        return {
            "analogy_id": analogy_id,
            "label": label,
            "description": description,
            "tags": tags,
        }
    return record.data()


def create_lecture_segment(
    session: Session,
    lecture_id: str,
    segment_index: int,
    text: str,
    summary: Optional[str],
    start_time_sec: Optional[float],
    end_time_sec: Optional[float],
    style_tags: Optional[List[str]] = None,
    ink_url: Optional[str] = None,
    tenant_id: Optional[str] = None,
) -> dict:
    """
    Create a LectureSegment node and attach it to the Lecture node.
    Returns: dict with segment_id and basic fields.
    """
    from uuid import uuid4
    
    segment_id = f"SEG_{uuid4().hex[:10]}"
    style_tags = style_tags or []

    query = """
    MATCH (lec:Lecture {lecture_id: $lecture_id})
    MERGE (seg:LectureSegment {segment_id: $segment_id})
      ON CREATE SET seg.lecture_id     = $lecture_id,
                    seg.segment_index  = $segment_index,
                    seg.text           = $text,
                    seg.summary        = $summary,
                    seg.start_time_sec = $start_time_sec,
                    seg.end_time_sec   = $end_time_sec,
                    seg.style_tags     = $style_tags,
                    seg.ink_url        = $ink_url,
                    seg.created_at     = datetime()
      ON MATCH SET  seg.text           = $text,
                    seg.summary        = $summary,
                    seg.start_time_sec = $start_time_sec,
                    seg.end_time_sec   = $end_time_sec,
                    seg.style_tags     = $style_tags,
                    seg.ink_url        = $ink_url,
                    seg.updated_at     = datetime()
    MERGE (lec)-[:HAS_SEGMENT]->(seg)
    RETURN seg.segment_id AS segment_id,
           seg.lecture_id AS lecture_id,
           seg.segment_index AS segment_index
    """
    result = session.run(
        query,
        lecture_id=lecture_id,
        segment_id=segment_id,
        segment_index=segment_index,
        text=text,
        summary=summary,
        start_time_sec=start_time_sec,
        end_time_sec=end_time_sec,
        style_tags=style_tags,
        ink_url=ink_url,
    )
    return result.single().data()


def update_lecture_segment(
    session: Session,
    segment_id: str,
    text: Optional[str] = None,
    summary: Optional[str] = None,
    start_time_sec: Optional[float] = None,
    end_time_sec: Optional[float] = None,
    style_tags: Optional[List[str]] = None,
) -> Optional[dict]:
    """
    Update a LectureSegment node by segment_id.
    Returns: dict with segment_id and updated fields, or None if not found.
    """
    # Build SET clauses dynamically
    set_clauses = []
    params = {
        "segment_id": segment_id,
    }

    if text is not None:
        set_clauses.append("seg.text = $text")
        params["text"] = text

    if summary is not None:
        set_clauses.append("seg.summary = $summary")
        params["summary"] = summary

    if start_time_sec is not None:
        set_clauses.append("seg.start_time_sec = $start_time_sec")
        params["start_time_sec"] = start_time_sec

    if end_time_sec is not None:
        set_clauses.append("seg.end_time_sec = $end_time_sec")
        params["end_time_sec"] = end_time_sec

    if style_tags is not None:
        set_clauses.append("seg.style_tags = $style_tags")
        params["style_tags"] = style_tags

    if not set_clauses:
        # Nothing to update
        return None

    # Always update the updated_at timestamp
    set_clauses.append("seg.updated_at = datetime()")

    query = f"""
    MATCH (seg:LectureSegment {{segment_id: $segment_id}})
    SET {', '.join(set_clauses)}
    RETURN seg.segment_id AS segment_id,
           seg.lecture_id AS lecture_id,
           seg.segment_index AS segment_index,
           seg.text AS text,
           seg.summary AS summary,
           seg.start_time_sec AS start_time_sec,
           seg.end_time_sec AS end_time_sec,
           seg.style_tags AS style_tags
    LIMIT 1
    """
    result = session.run(query, **params)
    record = result.single()
    if not record:
        return None
    return record.data()


def link_segment_to_concept(
    session: Session,
    segment_id: str,
    concept_id: str,
    tenant_id: Optional[str] = None,
) -> None:
    """
    Create (Segment)-[:COVERS]->(Concept).
    """
    query = """
    MATCH (seg:LectureSegment {segment_id: $segment_id})
    WHERE seg.tenant_id = $tenant_id OR ($tenant_id IS NULL AND seg.tenant_id IS NULL)
    MATCH (c:Concept {node_id: $concept_id})
    MERGE (seg)-[:COVERS]->(c)
    """
    session.run(query, segment_id=segment_id, concept_id=concept_id, tenant_id=tenant_id)


def link_segment_to_analogy(
    session: Session,
    segment_id: str,
    analogy_id: str,
    tenant_id: Optional[str] = None,
) -> None:
    """
    Create (Segment)-[:USES_ANALOGY]->(Analogy).
    """
    query = """
    MATCH (seg:LectureSegment {segment_id: $segment_id})
    WHERE seg.tenant_id = $tenant_id OR ($tenant_id IS NULL AND seg.tenant_id IS NULL)
    MATCH (a:Analogy {analogy_id: $analogy_id})
    MERGE (seg)-[:USES_ANALOGY]->(a)
    """
    session.run(query, segment_id=segment_id, analogy_id=analogy_id, tenant_id=tenant_id)


# ---------- GraphRAG Functions ----------

def upsert_source_chunk(
    session: Session,
    graph_id: str,
    branch_id: str,
    chunk_id: str,
    source_id: str,
    chunk_index: int,
    text: str,
    metadata: Optional[Dict[str, Any]] = None
) -> dict:
    """
    Create or update a SourceChunk node.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        branch_id: Branch ID for scoping
        chunk_id: Unique chunk identifier
        source_id: Source identifier (e.g., lecture_id)
        chunk_index: Index of chunk within source
        text: Chunk text content
        metadata: Optional metadata dict (will be JSON stringified)
    
    Returns:
        dict with chunk_id and basic fields
    """
    ensure_graph_scoping_initialized(session)
    
    metadata_str = json.dumps(metadata) if metadata else None
    
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MERGE (s:SourceChunk {graph_id: $graph_id, chunk_id: $chunk_id})
    ON CREATE SET
        s.source_id = $source_id,
        s.chunk_index = $chunk_index,
        s.text = $text,
        s.metadata = $metadata,
        s.on_branches = [$branch_id],
        s.created_at = timestamp()
    ON MATCH SET
        s.source_id = $source_id,
        s.chunk_index = $chunk_index,
        s.text = $text,
        s.metadata = $metadata,
        s.on_branches = CASE
            WHEN s.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN s.on_branches THEN s.on_branches
            ELSE s.on_branches + $branch_id
        END,
        s.updated_at = timestamp()
    MERGE (s)-[:BELONGS_TO]->(g)
    WITH s, g
    // Create FROM_DOCUMENT relationship if source_id matches a SourceDocument
    OPTIONAL MATCH (d:SourceDocument {graph_id: $graph_id, doc_id: $source_id})
    WITH s, g, d
    FOREACH (x IN CASE WHEN d IS NOT NULL THEN [1] ELSE [] END |
        MERGE (s)-[:FROM_DOCUMENT]->(d)
    )
    RETURN s.chunk_id AS chunk_id,
           s.source_id AS source_id,
           s.chunk_index AS chunk_index
    """
    result = session.run(
        query,
        graph_id=graph_id,
        branch_id=branch_id,
        chunk_id=chunk_id,
        source_id=source_id,
        chunk_index=chunk_index,
        text=text,
        metadata=metadata_str
    )
    record = result.single()
    if not record:
        raise ValueError(f"Failed to create/update SourceChunk {chunk_id}")
    return record.data()


def upsert_claim(
    session: Session,
    graph_id: str,
    branch_id: str,
    claim_id: str,
    text: str,
    confidence: float,
    method: str,
    source_id: str,
    source_span: str,
    chunk_id: str,
    embedding: Optional[List[float]] = None,
    ingestion_run_id: Optional[str] = None,
    status: Optional[str] = None,
    evidence_ids: Optional[List[str]] = None,
    session_id: Optional[str] = None,
) -> dict:
    """
    Create or update a Claim node and link it to SourceChunk.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        branch_id: Branch ID for scoping
        claim_id: Unique claim identifier
        text: Claim text
        confidence: Confidence score (0-1)
        method: Extraction method (e.g., "llm", "manual")
        source_id: Source identifier
        source_span: Source span description
        chunk_id: Chunk ID this claim is supported by
        embedding: Optional embedding vector
        ingestion_run_id: Optional ingestion run ID that created this claim
        status: Claim status ("PROPOSED", "VERIFIED", "REJECTED"). Defaults to "PROPOSED"
        evidence_ids: Optional list of evidence IDs (quote_ids, chunk_ids, etc.)
    
    Returns:
        dict with claim_id and basic fields
    """
    ensure_graph_scoping_initialized(session)
    
    # Default status to PROPOSED if not provided
    claim_status = status or "PROPOSED"
    
    # Build evidence_ids array (include chunk_id and any additional evidence)
    evidence_list = [chunk_id]
    if evidence_ids:
        evidence_list.extend(evidence_ids)
    # Deduplicate
    evidence_list = list(dict.fromkeys(evidence_list))  # Preserves order while deduplicating
    
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MERGE (c:Claim {graph_id: $graph_id, claim_id: $claim_id})
    ON CREATE SET
        c.text = $text,
        c.confidence = $confidence,
        c.method = $method,
        c.source_id = $source_id,
        c.source_span = $source_span,
        c.embedding = $embedding,
        c.ingestion_run_id = $ingestion_run_id,
        c.status = $status,
        c.evidence_ids = $evidence_ids,
        c.on_branches = [$branch_id],
        c.created_at = timestamp()
    ON MATCH SET
        c.text = $text,
        c.confidence = $confidence,
        c.method = $method,
        c.source_id = $source_id,
        c.source_span = $source_span,
        c.embedding = $embedding,
        c.ingestion_run_id = COALESCE(c.ingestion_run_id, $ingestion_run_id),
        c.status = COALESCE(c.status, $status),
        c.evidence_ids = CASE
            WHEN $evidence_ids IS NOT NULL THEN $evidence_ids
            WHEN c.evidence_ids IS NULL THEN $evidence_ids
            ELSE c.evidence_ids
        END,
        c.on_branches = CASE
            WHEN c.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN c.on_branches THEN c.on_branches
            ELSE c.on_branches + $branch_id
        END,
        c.updated_at = timestamp()
    MERGE (c)-[:BELONGS_TO]->(g)
    WITH c, g
    MATCH (s:SourceChunk {graph_id: $graph_id, chunk_id: $chunk_id})
    MERGE (c)-[:SUPPORTED_BY]->(s)
    RETURN c.claim_id AS claim_id,
           c.text AS text,
           c.confidence AS confidence,
           c.status AS status,
           c.evidence_ids AS evidence_ids
    """
    result = session.run(
        query,
        graph_id=graph_id,
        branch_id=branch_id,
        claim_id=claim_id,
        text=text,
        confidence=confidence,
        method=method,
        source_id=source_id,
        source_span=source_span,
        chunk_id=chunk_id,
        embedding=embedding,
        ingestion_run_id=ingestion_run_id,
        status=claim_status,
        evidence_ids=evidence_list,
    )
    record = result.single()
    if not record:
        raise ValueError(f"Failed to create/update Claim {claim_id}")
    
    # Emit event for claim upsert
    try:
        from events.emitter import emit_event
        from events.schema import EventType, ObjectRef
        from projectors.session_context import SessionContextProjector
        
        # Use provided session_id or fallback
        event_session_id = session_id or getattr(session, '_session_id', None) or "unknown"
        
        # Emit event
        emit_event(
            event_type=EventType.CLAIM_UPSERTED,
            session_id=event_session_id,
            object_ref=ObjectRef(type="claim", id=claim_id),
            payload={
                "claim_id": claim_id,
                "text": text[:200],  # Truncate for payload
                "confidence": confidence,
                "method": method,
                "source_id": source_id,
                "concept_ids": [],  # Could be extracted from claim mentions if needed
            },
        )
        
        # Projection is now handled asynchronously via background task queue
        # No need to update synchronously here
    except Exception:
        pass  # Don't fail on event emission
    
    return record.data()


def link_claim_mentions(
    session: Session,
    graph_id: str,
    claim_id: str,
    mentioned_node_ids: List[str]
) -> None:
    """
    Link a Claim to Concept nodes it mentions.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        claim_id: Claim identifier
        mentioned_node_ids: List of Concept node_ids
    """
    if not mentioned_node_ids:
        return
    
    ensure_graph_scoping_initialized(session)
    
    query = """
    MATCH (c:Claim {graph_id: $graph_id, claim_id: $claim_id})
    UNWIND $mentioned_node_ids AS nid
    MATCH (x:Concept {graph_id: $graph_id, node_id: nid})
    MERGE (c)-[:MENTIONS]->(x)
    """
    session.run(
        query,
        graph_id=graph_id,
        claim_id=claim_id,
        mentioned_node_ids=mentioned_node_ids
    )


def upsert_quote(
    session: Session,
    graph_id: str,
    branch_id: str,
    quote_id: str,
    text: str,
    anchor: Dict[str, Any],
    source_doc_id: str,
    user_note: Optional[str] = None,
    tags: Optional[List[str]] = None,
    captured_at: Optional[int] = None
) -> dict:
    """
    Create or update a Quote node and link it to SourceDocument.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        branch_id: Branch ID for scoping
        quote_id: Unique quote identifier
        text: Quote text content
        anchor: Anchor data (dict, stored as Neo4j map, not JSON string)
        source_doc_id: SourceDocument doc_id
        user_note: Optional user annotation
        tags: Optional tags list (stored as list[str], not JSON string)
        captured_at: Optional capture timestamp (defaults to now, Unix timestamp in ms)
    
    Returns:
        dict with quote_id, text, and captured_at
    """
    ensure_graph_scoping_initialized(session)
    
    if captured_at is None:
        captured_at = int(datetime.utcnow().timestamp() * 1000)  # milliseconds
    
    # Store anchor as Neo4j map (not JSON string)
    # Store tags as list[str] (not JSON string)
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MERGE (q:Quote {graph_id: $graph_id, quote_id: $quote_id})
    ON CREATE SET
        q.text = $text,
        q.anchor = $anchor,
        q.captured_at = $captured_at,
        q.user_note = $user_note,
        q.tags = $tags,
        q.on_branches = [$branch_id],
        q.created_at = timestamp()
    ON MATCH SET
        q.text = $text,
        q.anchor = $anchor,
        q.user_note = $user_note,
        q.tags = $tags,
        q.on_branches = CASE
            WHEN q.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN q.on_branches THEN q.on_branches
            ELSE q.on_branches + $branch_id
        END,
        q.updated_at = timestamp()
    MERGE (q)-[:BELONGS_TO]->(g)
    WITH q, g
    MATCH (d:SourceDocument {graph_id: $graph_id, doc_id: $source_doc_id})
    MERGE (q)-[:QUOTED_FROM]->(d)
    RETURN q.quote_id AS quote_id,
           q.text AS text,
           q.captured_at AS captured_at
    """
    result = session.run(
        query,
        graph_id=graph_id,
        branch_id=branch_id,
        quote_id=quote_id,
        text=text,
        anchor=anchor,  # Pass as dict, Neo4j driver will convert to map
        source_doc_id=source_doc_id,
        user_note=user_note,
        tags=tags,  # Pass as list, Neo4j driver will convert to list
        captured_at=captured_at
    )
    record = result.single()
    if not record:
        raise ValueError(f"Failed to create/update Quote {quote_id}")
    return record.data()


def link_concept_has_quote(
    session: Session,
    graph_id: str,
    branch_id: str,
    concept_id: str,
    quote_id: str
) -> None:
    """
    Create (Concept)-[:HAS_QUOTE]->(Quote) relationship.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        branch_id: Branch ID for scoping
        concept_id: Concept node_id
        quote_id: Quote quote_id
    """
    ensure_graph_scoping_initialized(session)
    
    query = """
    MATCH (c:Concept {graph_id: $graph_id, node_id: $concept_id})
    MATCH (q:Quote {graph_id: $graph_id, quote_id: $quote_id})
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND $branch_id IN COALESCE(q.on_branches, [])
    MERGE (c)-[:HAS_QUOTE]->(q)
    """
    session.run(query, graph_id=graph_id, branch_id=branch_id, concept_id=concept_id, quote_id=quote_id)


def link_concept_supported_by_claim(
    session: Session,
    graph_id: str,
    branch_id: str,
    concept_id: str,
    claim_id: str
) -> None:
    """
    Create (Concept)-[:SUPPORTED_BY]->(Claim) relationship.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        branch_id: Branch ID for scoping
        concept_id: Concept node_id
        claim_id: Claim claim_id
    """
    ensure_graph_scoping_initialized(session)
    
    query = """
    MATCH (c:Concept {graph_id: $graph_id, node_id: $concept_id})
    MATCH (cl:Claim {graph_id: $graph_id, claim_id: $claim_id})
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND $branch_id IN COALESCE(cl.on_branches, [])
    MERGE (c)-[:SUPPORTED_BY]->(cl)
    """
    session.run(query, graph_id=graph_id, branch_id=branch_id, concept_id=concept_id, claim_id=claim_id)


def link_claim_evidenced_by_quote(
    session: Session,
    graph_id: str,
    branch_id: str,
    claim_id: str,
    quote_id: str
) -> None:
    """
    Create (Claim)-[:EVIDENCED_BY]->(Quote) relationship and update evidence_ids.
    
    This is a required path for claim verification - quotes are the strongest evidence unit.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        branch_id: Branch ID for scoping
        claim_id: Claim claim_id
        quote_id: Quote quote_id
    """
    ensure_graph_scoping_initialized(session)
    
    query = """
    MATCH (cl:Claim {graph_id: $graph_id, claim_id: $claim_id})
    MATCH (q:Quote {graph_id: $graph_id, quote_id: $quote_id})
    WHERE $branch_id IN COALESCE(cl.on_branches, [])
      AND $branch_id IN COALESCE(q.on_branches, [])
    MERGE (cl)-[:EVIDENCED_BY]->(q)
    WITH cl
    SET cl.evidence_ids = CASE
        WHEN cl.evidence_ids IS NULL THEN [$quote_id]
        WHEN $quote_id IN cl.evidence_ids THEN cl.evidence_ids
        ELSE cl.evidence_ids + $quote_id
    END
    """
    session.run(query, graph_id=graph_id, branch_id=branch_id, claim_id=claim_id, quote_id=quote_id)


def upsert_community(
    session: Session,
    graph_id: str,
    community_id: str,
    name: str,
    summary: Optional[str] = None,
    summary_embedding: Optional[List[float]] = None,
    build_version: Optional[str] = None
) -> dict:
    """
    Create or update a Community node.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        community_id: Unique community identifier
        name: Community name
        summary: Optional summary text
        summary_embedding: Optional summary embedding
        build_version: Optional build version identifier
    
    Returns:
        dict with community_id and basic fields
    """
    ensure_graph_scoping_initialized(session)
    
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MERGE (k:Community {graph_id: $graph_id, community_id: $community_id})
    ON CREATE SET
        k.name = $name,
        k.summary = $summary,
        k.summary_embedding = $summary_embedding,
        k.build_version = $build_version,
        k.created_at = timestamp()
    ON MATCH SET
        k.name = $name,
        k.summary = $summary,
        k.summary_embedding = $summary_embedding,
        k.build_version = $build_version,
        k.updated_at = timestamp()
    MERGE (k)-[:BELONGS_TO]->(g)
    RETURN k.community_id AS community_id,
           k.name AS name,
           k.summary AS summary
    """
    result = session.run(
        query,
        graph_id=graph_id,
        community_id=community_id,
        name=name,
        summary=summary,
        summary_embedding=summary_embedding,
        build_version=build_version
    )
    record = result.single()
    if not record:
        raise ValueError(f"Failed to create/update Community {community_id}")
    return record.data()


def set_concept_community_memberships(
    session: Session,
    graph_id: str,
    community_id: str,
    concept_node_ids: List[str]
) -> None:
    """
    Set community memberships for concepts, removing prior memberships within this graph.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        community_id: Community identifier
        concept_node_ids: List of Concept node_ids to assign to this community
    """
    if not concept_node_ids:
        return
    
    ensure_graph_scoping_initialized(session)
    
    # First, remove existing IN_COMMUNITY relationships for these concepts within this graph
    query_remove = """
    MATCH (c:Concept {graph_id: $graph_id, node_id: $nid})-[r:IN_COMMUNITY]->(:Community {graph_id: $graph_id})
    DELETE r
    """
    
    # Then, add new memberships
    query_add = """
    MATCH (c:Concept {graph_id: $graph_id, node_id: $nid})
    MATCH (k:Community {graph_id: $graph_id, community_id: $community_id})
    MERGE (c)-[:IN_COMMUNITY]->(k)
    """
    
    for nid in concept_node_ids:
        session.run(query_remove, graph_id=graph_id, nid=nid)
        session.run(query_add, graph_id=graph_id, community_id=community_id, nid=nid)


def get_claims_for_communities(
    session: Session,
    graph_id: str,
    community_ids: List[str],
    limit_per_comm: int = 30,
    ingestion_run_id: Optional[Any] = None
) -> Dict[str, List[dict]]:
    """
    Get claims that mention concepts in each community, ordered by confidence.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        community_ids: List of community IDs
        limit_per_comm: Maximum claims per community
        ingestion_run_id: Optional ingestion run ID or list of IDs to filter claims
    
    Returns:
        Dict mapping community_id to list of claim dicts
    """
    ensure_graph_scoping_initialized(session)
    _, branch_id = get_active_graph_context(session)
    
    if not community_ids:
        return {}
    
    # Normalize ingestion_run_id to a list for Cypher IN operator
    run_ids = None
    if ingestion_run_id:
        run_ids = ingestion_run_id if isinstance(ingestion_run_id, list) else [ingestion_run_id]
    
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (k:Community {graph_id: $graph_id, community_id: $comm_id})-[:BELONGS_TO]->(g)
    MATCH (c:Concept {graph_id: $graph_id})-[:IN_COMMUNITY]->(k)
    MATCH (claim:Claim {graph_id: $graph_id})-[:MENTIONS]->(c)
    WHERE $branch_id IN COALESCE(claim.on_branches, [])
      AND ($run_ids IS NULL OR claim.ingestion_run_id IN $run_ids)
    WITH k.community_id AS comm_id, claim
    ORDER BY claim.confidence DESC
    WITH comm_id, collect(claim)[0..$limit] AS claims
    RETURN comm_id, claims
    """
    
    results = {}
    
    for comm_id in community_ids:
        params = {
            "graph_id": graph_id,
            "comm_id": comm_id,
            "branch_id": branch_id,
            "run_ids": run_ids,
            "limit": limit_per_comm
        }
        res = session.run(query, **params)
        record = res.single()
        if record:
            results[comm_id] = [_normalize_claim_from_db(c) for c in record["claims"]]
        else:
            results[comm_id] = []
            
    return results

def _normalize_claim_from_db(record_data):
    """Internal helper to normalize claim record data."""
    props = dict(record_data)
    # Ensure graph_id is present
    return props
    return props


def get_evidence_subgraph(
    session: Session,
    graph_id: str,
    claim_ids: List[str],
    max_concepts: int = 40,
    include_proposed: str = "auto"
) -> dict:
    """
    Get evidence subgraph: mentioned concepts + 1-hop neighbors.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        claim_ids: List of claim IDs
        max_concepts: Maximum concepts to return
        include_proposed: Visibility policy for proposed edges:
            - "auto" (default): ACCEPTED + PROPOSED with confidence >= threshold
            - "all": ACCEPTED + all PROPOSED
            - "none": Only ACCEPTED
    
    Returns:
        dict with 'concepts' (list of Concept dicts) and 'edges' (list of relationship dicts)
    """
    ensure_graph_scoping_initialized(session)
    _, branch_id = get_active_graph_context(session)
    
    if not claim_ids:
        return {"concepts": [], "edges": []}
    
    include_proposed = _normalize_include_proposed(include_proposed)
    edge_visibility_clause = _build_edge_visibility_where_clause(include_proposed)
    
    params_base = {
        "graph_id": graph_id,
        "branch_id": branch_id,
        "include_proposed": include_proposed,
        "threshold": PROPOSED_VISIBILITY_THRESHOLD,
    }
    
    # Get mentioned concepts
    query_concepts = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (claim:Claim {graph_id: $graph_id})-[:MENTIONS]->(c:Concept)-[:BELONGS_TO]->(g)
    WHERE claim.claim_id IN $claim_ids
      AND $branch_id IN COALESCE(c.on_branches, [])
      AND COALESCE(c.is_merged, false) = false
    WITH DISTINCT c
    LIMIT $max_concepts
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.description AS description,
           c.tags AS tags
    """
    
    # Get 1-hop neighbors
    query_neighbors = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MATCH (claim:Claim {{graph_id: $graph_id}})-[:MENTIONS]->(c:Concept)-[:BELONGS_TO]->(g)
    WHERE claim.claim_id IN $claim_ids
      AND $branch_id IN COALESCE(c.on_branches, [])
      AND COALESCE(c.is_merged, false) = false
    MATCH (c)-[r]-(n:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(n.on_branches, [])
      AND $branch_id IN COALESCE(r.on_branches, [])
      AND COALESCE(n.is_merged, false) = false
      AND {edge_visibility_clause}
    WITH DISTINCT n, r, c
    LIMIT $max_concepts
    RETURN n.node_id AS node_id,
           n.name AS name,
           n.domain AS domain,
           n.type AS type,
           n.description AS description,
           n.tags AS tags,
           type(r) AS predicate,
           startNode(r).node_id = c.node_id AS is_outgoing
    """
    
    # Get mentioned concepts
    concept_result = session.run(
        query_concepts,
        **params_base,
        claim_ids=claim_ids,
        max_concepts=max_concepts
    )
    
    concepts = []
    concept_ids_seen = set()
    for record in concept_result:
        concept_ids_seen.add(record["node_id"])
        concepts.append({
            "node_id": record["node_id"],
            "name": record["name"],
            "domain": record["domain"],
            "type": record["type"],
            "description": record["description"],
            "tags": record["tags"],
        })
    
    # Get neighbors (only if we haven't hit the limit)
    if len(concepts) < max_concepts:
        neighbor_result = session.run(
            query_neighbors,
            **params_base,
            claim_ids=claim_ids,
            max_concepts=max_concepts - len(concepts)
        )
        
        for record in neighbor_result:
            node_id = record["node_id"]
            if node_id not in concept_ids_seen and len(concepts) < max_concepts:
                concept_ids_seen.add(node_id)
                concepts.append({
                    "node_id": node_id,
                    "name": record["name"],
                    "domain": record["domain"],
                    "type": record["type"],
                    "description": record["description"],
                    "tags": record["tags"],
                })
    
    # Get edges between mentioned concepts
    query_edges = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MATCH (s:Concept {{graph_id: $graph_id}})-[:BELONGS_TO]->(g)
    MATCH (t:Concept {{graph_id: $graph_id}})-[:BELONGS_TO]->(g)
    MATCH (s)-[r]->(t)
    WHERE s.node_id IN $concept_ids
      AND t.node_id IN $concept_ids
      AND r.graph_id = $graph_id
      AND $branch_id IN COALESCE(r.on_branches, [])
      AND COALESCE(s.is_merged, false) = false
      AND COALESCE(t.is_merged, false) = false
      AND {edge_visibility_clause}
    RETURN s.node_id AS source_id,
           t.node_id AS target_id,
           type(r) AS predicate
    LIMIT 50
    """
    
    edge_result = session.run(
        query_edges,
        **params_base,
        concept_ids=list(concept_ids_seen)
    )
    
    edges = []
    for record in edge_result:
        edges.append({
            "source_id": record["source_id"],
            "target_id": record["target_id"],
            "predicate": record["predicate"],
        })
    
    return {
        "concepts": concepts,
        "edges": edges
    }


# ---------- Relationship Review Functions ----------

def get_proposed_relationships(
    session: Session,
    graph_id: str,
    status: str = "PROPOSED",
    limit: int = 50,
    offset: int = 0,
    ingestion_run_id: Optional[str] = None,
    include_archived: bool = False
) -> List[dict]:
    """
    Get relationships for review, filtered by status and optionally by ingestion_run_id.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        status: Status filter ("PROPOSED", "ACCEPTED", "REJECTED")
        limit: Maximum number of relationships to return
        offset: Offset for pagination
        ingestion_run_id: Optional ingestion run ID to filter by
        include_archived: Whether to include archived relationships
    
    Returns:
        List of relationship dicts with full metadata
    """
    ensure_graph_scoping_initialized(session)
    _, branch_id = get_active_graph_context(session)
    
    where_clauses = [
        "r.graph_id = $graph_id",
        "$branch_id IN COALESCE(r.on_branches, [])",
        "$branch_id IN COALESCE(s.on_branches, [])",
        "$branch_id IN COALESCE(t.on_branches, [])",
        "COALESCE(r.status, 'ACCEPTED') = $status"
    ]
    
    if not include_archived:
        where_clauses.append("COALESCE(r.archived, false) = false")
        where_clauses.append("COALESCE(s.archived, false) = false")
        where_clauses.append("COALESCE(t.archived, false) = false")
    
    params = {
        "graph_id": graph_id,
        "branch_id": branch_id,
        "status": status,
        "offset": offset,
        "limit": limit
    }
    
    if ingestion_run_id:
        where_clauses.append("r.ingestion_run_id = $ingestion_run_id")
        params["ingestion_run_id"] = ingestion_run_id
    
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MATCH (s:Concept)-[:BELONGS_TO]->(g)
    MATCH (t:Concept)-[:BELONGS_TO]->(g)
    MATCH (s)-[r]->(t)
    WHERE {' AND '.join(where_clauses)}
    RETURN s.node_id AS src_node_id,
           s.name AS src_name,
           t.node_id AS dst_node_id,
           t.name AS dst_name,
           type(r) AS rel_type,
           COALESCE(r.confidence, 0.5) AS confidence,
           COALESCE(r.method, 'unknown') AS method,
           r.rationale AS rationale,
           r.source_id AS source_id,
           r.chunk_id AS chunk_id,
           r.claim_id AS claim_id,
           r.model_version AS model_version,
           r.created_at AS created_at,
           r.updated_at AS updated_at,
           r.reviewed_at AS reviewed_at,
           r.reviewed_by AS reviewed_by
    ORDER BY r.created_at DESC
    SKIP $offset
    LIMIT $limit
    """
    
    result = session.run(query, **params)
    
    relationships = []
    for record in result:
        relationships.append({
            "src_node_id": record["src_node_id"],
            "src_name": record["src_name"],
            "dst_node_id": record["dst_node_id"],
            "dst_name": record["dst_name"],
            "rel_type": record["rel_type"],
            "confidence": record["confidence"],
            "method": record["method"],
            "rationale": record["rationale"],
            "source_id": record["source_id"],
            "chunk_id": record["chunk_id"],
            "claim_id": record["claim_id"],
            "model_version": record["model_version"],
            "created_at": record["created_at"],
            "updated_at": record["updated_at"],
            "reviewed_at": record["reviewed_at"],
            "reviewed_by": record["reviewed_by"],
        })
    
    return relationships


def accept_relationships(
    session: Session,
    graph_id: str,
    edges: List[dict],
    reviewed_by: Optional[str] = None
) -> int:
    """
    Accept one or more relationships by setting status to ACCEPTED.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        edges: List of edge dicts with keys: src_node_id, dst_node_id, rel_type
        reviewed_by: Reviewer identifier (optional)
    
    Returns:
        Number of relationships accepted
    """
    ensure_graph_scoping_initialized(session)
    _, branch_id = get_active_graph_context(session)
    
    if not edges:
        return 0
    
    accepted_count = 0
    current_timestamp = int(datetime.datetime.now().timestamp() * 1000)  # milliseconds
    
    for edge in edges:
        query = """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MATCH (s:Concept {node_id: $src_node_id})-[:BELONGS_TO]->(g)
        MATCH (t:Concept {node_id: $dst_node_id})-[:BELONGS_TO]->(g)
        MATCH (s)-[r]->(t)
        WHERE type(r) = $rel_type
          AND r.graph_id = $graph_id
          AND $branch_id IN COALESCE(r.on_branches, [])
        SET r.status = 'ACCEPTED',
            r.reviewed_at = $reviewed_at,
            r.updated_at = $reviewed_at
        """
        
        params = {
            "graph_id": graph_id,
            "branch_id": branch_id,
            "src_node_id": edge["src_node_id"],
            "dst_node_id": edge["dst_node_id"],
            "rel_type": edge["rel_type"],
            "reviewed_at": current_timestamp,
        }
        
        if reviewed_by:
            query = query.rstrip() + ",\n            r.reviewed_by = $reviewed_by"
            params["reviewed_by"] = reviewed_by
        
        query = query + "\n        RETURN count(r) AS updated"
        
        result = session.run(query, **params)
        record = result.single()
        if record and record["updated"] > 0:
            accepted_count += 1
    
    return accepted_count


def reject_relationships(
    session: Session,
    graph_id: str,
    edges: List[dict],
    reviewed_by: Optional[str] = None
) -> int:
    """
    Reject one or more relationships by setting status to REJECTED.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        edges: List of edge dicts with keys: src_node_id, dst_node_id, rel_type
        reviewed_by: Reviewer identifier (optional)
    
    Returns:
        Number of relationships rejected
    """
    ensure_graph_scoping_initialized(session)
    _, branch_id = get_active_graph_context(session)
    
    if not edges:
        return 0
    
    rejected_count = 0
    current_timestamp = int(datetime.datetime.now().timestamp() * 1000)  # milliseconds
    
    for edge in edges:
        query = """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MATCH (s:Concept {node_id: $src_node_id})-[:BELONGS_TO]->(g)
        MATCH (t:Concept {node_id: $dst_node_id})-[:BELONGS_TO]->(g)
        MATCH (s)-[r]->(t)
        WHERE type(r) = $rel_type
          AND r.graph_id = $graph_id
          AND $branch_id IN COALESCE(r.on_branches, [])
        SET r.status = 'REJECTED',
            r.reviewed_at = $reviewed_at,
            r.updated_at = $reviewed_at
        """
        
        params = {
            "graph_id": graph_id,
            "branch_id": branch_id,
            "src_node_id": edge["src_node_id"],
            "dst_node_id": edge["dst_node_id"],
            "rel_type": edge["rel_type"],
            "reviewed_at": current_timestamp,
        }
        
        if reviewed_by:
            query = query.rstrip() + ",\n            r.reviewed_by = $reviewed_by"
            params["reviewed_by"] = reviewed_by
        
        query = query + "\n        RETURN count(r) AS updated"
        
        result = session.run(query, **params)
        record = result.single()
        if record and record["updated"] > 0:
            rejected_count += 1
    
    return rejected_count


def edit_relationship(
    session: Session,
    graph_id: str,
    src_node_id: str,
    dst_node_id: str,
    old_rel_type: str,
    new_rel_type: str,
    reviewed_by: Optional[str] = None
) -> bool:
    """
    Edit a relationship by changing its type.
    
    Marks the old relationship as REJECTED and creates a new one with the new type.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        src_node_id: Source concept node_id
        dst_node_id: Destination concept node_id
        old_rel_type: Current relationship type
        new_rel_type: New relationship type
        reviewed_by: Reviewer identifier (optional)
    
    Returns:
        True if edit was successful, False otherwise
    """
    ensure_graph_scoping_initialized(session)
    _, branch_id = get_active_graph_context(session)
    
    # First, mark old relationship as REJECTED
    current_timestamp = int(datetime.datetime.now().timestamp() * 1000)  # milliseconds
    
    reject_query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (s:Concept {node_id: $src_node_id})-[:BELONGS_TO]->(g)
    MATCH (t:Concept {node_id: $dst_node_id})-[:BELONGS_TO]->(g)
    MATCH (s)-[r]->(t)
    WHERE type(r) = $old_rel_type
      AND r.graph_id = $graph_id
      AND $branch_id IN COALESCE(r.on_branches, [])
    SET r.status = 'REJECTED',
        r.reviewed_at = $reviewed_at,
        r.updated_at = $reviewed_at
    """
    
    reject_params = {
        "graph_id": graph_id,
        "branch_id": branch_id,
        "src_node_id": src_node_id,
        "dst_node_id": dst_node_id,
        "old_rel_type": old_rel_type,
        "reviewed_at": current_timestamp,
    }
    
    if reviewed_by:
        reject_query = reject_query.rstrip() + ",\n        r.reviewed_by = $reviewed_by"
        reject_params["reviewed_by"] = reviewed_by
    
    reject_query = reject_query + "\n    RETURN r"
    
    # Get the old relationship's metadata before rejecting it
    old_rel_result = session.run(reject_query, **reject_params)
    old_rel_record = old_rel_result.single()
    
    if not old_rel_record:
        return False
    
    old_rel = old_rel_record["r"]
    
    # Create new relationship with new type, preserving metadata
    create_query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MATCH (s:Concept {{node_id: $src_node_id}})-[:BELONGS_TO]->(g)
    MATCH (t:Concept {{node_id: $dst_node_id}})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(s.on_branches, []) AND $branch_id IN COALESCE(t.on_branches, [])
    MERGE (s)-[r:`{new_rel_type}`]->(t)
    SET r.graph_id = $graph_id,
        r.on_branches = CASE
            WHEN r.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN r.on_branches THEN r.on_branches
            ELSE r.on_branches + $branch_id
        END,
        r.status = 'ACCEPTED',
        r.method = 'human',
        r.created_at = timestamp(),
        r.updated_at = timestamp(),
        r.reviewed_at = $reviewed_at
    """
    
    create_params = {
        "graph_id": graph_id,
        "branch_id": branch_id,
        "src_node_id": src_node_id,
        "dst_node_id": dst_node_id,
        "reviewed_at": current_timestamp,
    }
    
    # Preserve metadata from old relationship
    if old_rel.get("confidence") is not None:
        create_query = create_query.rstrip() + ",\n        r.confidence = $confidence"
        create_params["confidence"] = old_rel.get("confidence")
    
    if old_rel.get("source_id"):
        create_query = create_query.rstrip() + ",\n        r.source_id = $source_id"
        create_params["source_id"] = old_rel.get("source_id")
    
    if old_rel.get("chunk_id"):
        create_query = create_query.rstrip() + ",\n        r.chunk_id = $chunk_id"
        create_params["chunk_id"] = old_rel.get("chunk_id")
    
    if old_rel.get("claim_id"):
        create_query = create_query.rstrip() + ",\n        r.claim_id = $claim_id"
        create_params["claim_id"] = old_rel.get("claim_id")
    
    if old_rel.get("rationale"):
        create_query = create_query.rstrip() + ",\n        r.rationale = $rationale"
        create_params["rationale"] = old_rel.get("rationale")
    
    if reviewed_by:
        create_query = create_query.rstrip() + ",\n        r.reviewed_by = $reviewed_by"
        create_params["reviewed_by"] = reviewed_by
    
    # Add supersedes_rel_type to track the original relationship
    create_query = create_query.rstrip() + ",\n        r.supersedes_rel_type = $old_rel_type"
    create_params["old_rel_type"] = old_rel_type
    
    create_query = create_query + "\n    RETURN 1"
    
    session.run(create_query, **create_params)
    
    return True


# ---------- Merge Candidate Functions ----------

def upsert_merge_candidate(
    session: Session,
    graph_id: str,
    candidate_id: str,
    src_node_id: str,
    dst_node_id: str,
    score: float,
    method: str,
    rationale: str,
    status: str = "PROPOSED"
) -> None:
    """
    Create or update a MergeCandidate node.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        candidate_id: Deterministic candidate identifier
        src_node_id: Source Concept node_id
        dst_node_id: Destination Concept node_id
        score: Similarity score (0-1)
        method: Detection method ("string" | "embedding" | "llm" | "hybrid")
        rationale: Short explanation text
        status: Status ("PROPOSED" | "ACCEPTED" | "REJECTED")
    """
    ensure_graph_scoping_initialized(session)
    
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (a:Concept {graph_id: $graph_id, node_id: $src_node_id})
    MATCH (b:Concept {graph_id: $graph_id, node_id: $dst_node_id})
    MERGE (m:MergeCandidate {graph_id: $graph_id, candidate_id: $candidate_id})
    ON CREATE SET
        m.src_node_id = $src_node_id,
        m.dst_node_id = $dst_node_id,
        m.score = $score,
        m.method = $method,
        m.rationale = $rationale,
        m.status = $status,
        m.created_at = timestamp()
    ON MATCH SET
        m.src_node_id = $src_node_id,
        m.dst_node_id = $dst_node_id,
        m.score = $score,
        m.method = $method,
        m.rationale = $rationale,
        m.status = $status,
        m.updated_at = timestamp()
    MERGE (m)-[:BELONGS_TO]->(g)
    MERGE (m)-[:MERGE_SRC]->(a)
    MERGE (m)-[:MERGE_DST]->(b)
    RETURN 1
    """
    
    session.run(
        query,
        graph_id=graph_id,
        candidate_id=candidate_id,
        src_node_id=src_node_id,
        dst_node_id=dst_node_id,
        score=score,
        method=method,
        rationale=rationale,
        status=status
    )


def list_merge_candidates(
    session: Session,
    graph_id: str,
    status: str = "PROPOSED",
    limit: int = 50,
    offset: int = 0
) -> List[dict]:
    """
    List merge candidates for review.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        status: Status filter ("PROPOSED", "ACCEPTED", "REJECTED")
        limit: Maximum number of candidates to return
        offset: Offset for pagination
    
    Returns:
        List of candidate dicts with full concept details
    """
    ensure_graph_scoping_initialized(session)
    
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (m:MergeCandidate {graph_id: $graph_id, status: $status})-[:BELONGS_TO]->(g)
    MATCH (m)-[:MERGE_SRC]->(src:Concept {graph_id: $graph_id})
    MATCH (m)-[:MERGE_DST]->(dst:Concept {graph_id: $graph_id})
    RETURN m.candidate_id AS candidate_id,
           m.score AS score,
           m.method AS method,
           m.rationale AS rationale,
           m.status AS status,
           m.created_at AS created_at,
           m.updated_at AS updated_at,
           m.reviewed_at AS reviewed_at,
           m.reviewed_by AS reviewed_by,
           src.node_id AS src_node_id,
           src.name AS src_name,
           src.description AS src_description,
           src.tags AS src_tags,
           dst.node_id AS dst_node_id,
           dst.name AS dst_name,
           dst.description AS dst_description,
           dst.tags AS dst_tags
    ORDER BY m.score DESC, m.created_at DESC
    SKIP $offset
    LIMIT $limit
    """
    
    result = session.run(
        query,
        graph_id=graph_id,
        status=status,
        offset=offset,
        limit=limit
    )
    
    candidates = []
    for record in result:
        candidates.append({
            "candidate_id": record["candidate_id"],
            "score": record["score"],
            "method": record["method"],
            "rationale": record["rationale"],
            "status": record["status"],
            "created_at": record["created_at"],
            "updated_at": record["updated_at"],
            "reviewed_at": record["reviewed_at"],
            "reviewed_by": record["reviewed_by"],
            "src_concept": {
                "node_id": record["src_node_id"],
                "name": record["src_name"],
                "description": record["src_description"],
                "tags": record["src_tags"] or [],
            },
            "dst_concept": {
                "node_id": record["dst_node_id"],
                "name": record["dst_name"],
                "description": record["dst_description"],
                "tags": record["dst_tags"] or [],
            },
        })
    
    return candidates


def set_merge_candidate_status(
    session: Session,
    graph_id: str,
    candidate_ids: List[str],
    status: str,
    reviewed_by: Optional[str] = None
) -> int:
    """
    Update status of one or more merge candidates.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        candidate_ids: List of candidate IDs to update
        status: New status ("PROPOSED" | "ACCEPTED" | "REJECTED")
        reviewed_by: Reviewer identifier (optional)
    
    Returns:
        Number of candidates updated
    """
    if not candidate_ids:
        return 0
    
    ensure_graph_scoping_initialized(session)
    
    current_timestamp = int(datetime.datetime.now().timestamp() * 1000)  # milliseconds
    
    set_clauses = [
        "m.status = $status",
        "m.updated_at = $updated_at",
        "m.reviewed_at = $updated_at"
    ]
    
    params = {
        "graph_id": graph_id,
        "candidate_ids": candidate_ids,
        "status": status,
        "updated_at": current_timestamp,
    }
    
    if reviewed_by:
        set_clauses.append("m.reviewed_by = $reviewed_by")
        params["reviewed_by"] = reviewed_by
    
    query = f"""
    MATCH (m:MergeCandidate {{graph_id: $graph_id, candidate_id: $candidate_id}})
    SET {', '.join(set_clauses)}
    RETURN count(m) AS updated
    """
    
    updated_count = 0
    for candidate_id in candidate_ids:
        result = session.run(
            query,
            graph_id=graph_id,
            candidate_id=candidate_id,
            **{k: v for k, v in params.items() if k != "candidate_ids"}
        )
        record = result.single()
        if record and record["updated"] > 0:
            updated_count += 1
    
    return updated_count


def get_cross_graph_instances(session: Session, node_id: str) -> Dict[str, Any]:
    """
    Find all instances of a concept across all graphs by matching the concept name.
    Returns instances from all graphs where a concept with the same name exists.
    
    Args:
        session: Neo4j session
        node_id: The node_id of the concept to find cross-graph instances for
    
    Returns:
        Dict with concept_name and list of instances across graphs
    """
    # First, get the concept name from the given node_id
    query_get_name = """
    MATCH (c:Concept {node_id: $node_id})
    RETURN c.name AS name
    LIMIT 1
    """
    result = session.run(query_get_name, node_id=node_id)
    record = result.single()
    if not record:
        return {"concept_name": "", "instances": [], "total_instances": 0}
    
    concept_name = record["name"]
    
    # Now find all instances with the same name across all graphs
    query_find_instances = """
    MATCH (c:Concept {name: $concept_name})
    MATCH (c)-[:BELONGS_TO]->(g:GraphSpace)
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.description AS description,
           c.graph_id AS graph_id,
           g.name AS graph_name,
           c.created_by AS created_by,
           c.last_updated_by AS last_updated_by
    ORDER BY g.name, c.node_id
    """
    
    result = session.run(query_find_instances, concept_name=concept_name)
    instances = []
    for record in result:
        instances.append({
            "node_id": record["node_id"],
            "name": record["name"],
            "domain": record["domain"],
            "type": record["type"],
            "description": record["description"],
            "graph_id": record["graph_id"],
            "graph_name": record["graph_name"] or record["graph_id"],
            "created_by": record["created_by"],
            "last_updated_by": record["last_updated_by"],
        })
    
    return {
        "concept_name": concept_name,
        "instances": instances,
        "total_instances": len(instances)
    }


def link_cross_graph_instances(
    session: Session,
    source_node_id: str,
    target_node_id: str,
    link_type: str = "user_linked",
    linked_by: Optional[str] = None
) -> Dict[str, Any]:
    """
    Create a bidirectional CROSS_GRAPH_LINK relationship between two concept instances
    in different graphs. This allows users to explicitly link related concepts across graphs.
    
    Args:
        session: Neo4j session
        source_node_id: Node ID of first concept instance
        target_node_id: Node ID of second concept instance
        link_type: Type of link ("user_linked", "manual_merge", "auto_detected")
        linked_by: User identifier who created the link
    
    Returns:
        Dict with link information
    """
    from datetime import datetime
    
    # Verify both nodes exist and are in different graphs
    query_verify = """
    MATCH (c1:Concept {node_id: $source_node_id})
    MATCH (c2:Concept {node_id: $target_node_id})
    RETURN c1.graph_id AS source_graph_id,
           c2.graph_id AS target_graph_id,
           c1.name AS source_name,
           c2.name AS target_name
    """
    result = session.run(query_verify, source_node_id=source_node_id, target_node_id=target_node_id)
    record = result.single()
    
    if not record:
        raise ValueError("One or both concepts not found")
    
    if record["source_graph_id"] == record["target_graph_id"]:
        raise ValueError("Cannot link concepts in the same graph")
    
    if record["source_name"] != record["target_name"]:
        raise ValueError("Cannot link concepts with different names")
    
    # Create bidirectional CROSS_GRAPH_LINK relationship
    query_link = """
    MATCH (c1:Concept {node_id: $source_node_id})
    MATCH (c2:Concept {node_id: $target_node_id})
    MERGE (c1)-[r:CROSS_GRAPH_LINK]-(c2)
    SET r.link_type = $link_type,
        r.linked_at = $linked_at,
        r.linked_by = $linked_by
    RETURN r
    """
    
    linked_at = datetime.utcnow().isoformat()
    session.run(
        query_link,
        source_node_id=source_node_id,
        target_node_id=target_node_id,
        link_type=link_type,
        linked_at=linked_at,
        linked_by=linked_by or "system"
    )
    
    return {
        "source_node_id": source_node_id,
        "target_node_id": target_node_id,
        "source_graph_id": record["source_graph_id"],
        "target_graph_id": record["target_graph_id"],
        "link_type": link_type,
        "linked_at": linked_at,
        "linked_by": linked_by or "system"
    }


def get_linked_cross_graph_instances(session: Session, node_id: str) -> List[Dict[str, Any]]:
    """
    Get all cross-graph instances that are explicitly linked via CROSS_GRAPH_LINK relationships.
    
    Args:
        session: Neo4j session
        node_id: Node ID to find linked instances for
    
    Returns:
        List of linked instances with link metadata
    """
    query = """
    MATCH (c:Concept {node_id: $node_id})-[r:CROSS_GRAPH_LINK]-(linked:Concept)
    MATCH (linked)-[:BELONGS_TO]->(g:GraphSpace)
    RETURN linked.node_id AS node_id,
           linked.name AS name,
           linked.domain AS domain,
           linked.type AS type,
           linked.description AS description,
           linked.graph_id AS graph_id,
           g.name AS graph_name,
           r.link_type AS link_type,
           r.linked_at AS linked_at,
           r.linked_by AS linked_by
    ORDER BY g.name
    """
    
    result = session.run(query, node_id=node_id)
    instances = []
    for record in result:
        instances.append({
            "node_id": record["node_id"],
            "name": record["name"],
            "domain": record["domain"],
            "type": record["type"],
            "description": record["description"],
            "graph_id": record["graph_id"],
            "graph_name": record["graph_name"] or record["graph_id"],
            "link_type": record["link_type"],
            "linked_at": record["linked_at"],
            "linked_by": record["linked_by"],
        })
    
    return instances


def update_concept_mastery(
    session: Session,
    graph_id: str,
    node_id: str,
    mastery_level: int
) -> bool:
    """
    Update the mastery level for a concept.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID
        node_id: Concept node ID
        mastery_level: New mastery level (0-100)
    
    Returns:
        True if updated, False otherwise
    """
    ensure_graph_scoping_initialized(session)
    
    now_ts = int(datetime.utcnow().timestamp() * 1000)
    
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (n:Concept {graph_id: $graph_id})-[:BELONGS_TO]->(g)
    WHERE n.node_id = $node_id
    SET n.mastery_level = $mastery_level,
        n.last_assessed = $now_ts
    RETURN count(n) AS count
    """
    
    result = session.run(
        query,
        graph_id=graph_id,
        node_id=node_id,
        mastery_level=mastery_level,
        now_ts=now_ts
    )
    
    record = result.single()
    return record["count"] > 0 if record else False


def get_concept_mastery(session: Session, graph_id: str, concept_name: str) -> int:
    """
    Fetch the current mastery score for a concept by name.
    """
    query = """
    MATCH (g:GraphSpace {id: $graph_id})-[:CONTAINS]->(c:Concept)
    WHERE toLower(c.name) = toLower($name)
    RETURN c.mastery_score as score
    LIMIT 1
    """
    result = session.run(query, graph_id=graph_id, name=concept_name).single()
    
    if result and result["score"] is not None:
        return int(result["score"])
    return 0
