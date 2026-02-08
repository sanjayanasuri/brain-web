"""
Service functions for Resource persistence and linking in Neo4j.

Resources represent media attachments (images, PDFs, audio, links, etc.)
that can be associated with concepts via HAS_RESOURCE relationships.

Scoping rules (Brain Web):
- Resources are scoped to a single GraphSpace via r.graph_id and (r)-[:BELONGS_TO]->(g)
- Relationships are scoped via rel.graph_id and rel.on_branches
- All reads/writes default to the active (graph_id, branch_id) from UserProfile
"""

from typing import List, Optional, Dict, Any
from neo4j import Session
from uuid import uuid4
from datetime import datetime
import json

from models import Resource
from services_branch_explorer import get_active_graph_context, ensure_graph_scoping_initialized

RESOURCE_LABEL = "Resource"


def _to_iso(dt_val: Any) -> Optional[str]:
    if not dt_val:
        return None
    if hasattr(dt_val, "to_native"):
        return dt_val.to_native().isoformat()
    if isinstance(dt_val, datetime):
        return dt_val.isoformat()
    if isinstance(dt_val, str):
        return dt_val
    return str(dt_val)


def _parse_metadata(node: Any) -> Optional[Dict[str, Any]]:
    raw = node.get("metadata_json")
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def create_resource(
    session: Session,
    *,
    kind: str,
    url: str,
    title: Optional[str] = None,
    mime_type: Optional[str] = None,
    caption: Optional[str] = None,
    source: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    ingestion_run_id: Optional[str] = None,
) -> Resource:
    """
    Create a Resource node scoped to the active graph + branch.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)

    resource_id = f"R{uuid4().hex[:8].upper()}"
    created_at = datetime.utcnow().isoformat()
    metadata_json = json.dumps(metadata) if metadata else None

    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    CREATE (r:{RESOURCE_LABEL} {{
        resource_id: $resource_id,
        graph_id: $graph_id,
        on_branches: [$branch_id],
        kind: $kind,
        url: $url,
        title: $title,
        mime_type: $mime_type,
        caption: $caption,
        source: $source,
        metadata_json: $metadata_json,
        created_at: $created_at,
        ingestion_run_id: $ingestion_run_id
    }})
    MERGE (r)-[:BELONGS_TO]->(g)
    RETURN r
    """

    record = session.run(
        query,
        graph_id=graph_id,
        branch_id=branch_id,
        resource_id=resource_id,
        kind=kind,
        url=url,
        title=title,
        mime_type=mime_type,
        caption=caption,
        source=source,
        metadata_json=metadata_json,
        created_at=created_at,
        ingestion_run_id=ingestion_run_id,
    ).single()

    if not record:
        raise ValueError("Failed to create resource")

    node = record["r"]
    return Resource(
        resource_id=node["resource_id"],
        kind=node["kind"],
        url=node["url"],
        title=node.get("title"),
        mime_type=node.get("mime_type"),
        caption=node.get("caption"),
        source=node.get("source"),
        metadata=_parse_metadata(node),
        created_at=_to_iso(node.get("created_at")),
        ingestion_run_id=node.get("ingestion_run_id"),
    )


def get_resource_by_id(session: Session, resource_id: str, include_archived: bool = False) -> Optional[Resource]:
    """
    Fetch a Resource by id in the active graph + branch.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)

    archived_clause = ""
    if not include_archived:
        archived_clause = "AND COALESCE(r.archived, false) = false"

    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MATCH (r:{RESOURCE_LABEL} {{resource_id: $resource_id, graph_id: $graph_id}})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(r.on_branches, [])
    {archived_clause}
    RETURN r
    LIMIT 1
    """
    rec = session.run(
        query,
        graph_id=graph_id,
        branch_id=branch_id,
        resource_id=resource_id,
    ).single()

    if not rec:
        return None

    node = rec["r"]
    return Resource(
        resource_id=node["resource_id"],
        kind=node["kind"],
        url=node["url"],
        title=node.get("title"),
        mime_type=node.get("mime_type"),
        caption=node.get("caption"),
        source=node.get("source"),
        metadata=_parse_metadata(node),
        created_at=_to_iso(node.get("created_at")),
        ingestion_run_id=node.get("ingestion_run_id"),
    )


def link_resource_to_concept(
    session: Session,
    *,
    concept_id: str,
    resource_id: str,
) -> None:
    """
    Create a HAS_RESOURCE relationship between a Concept and Resource in the active graph + branch.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)

    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MERGE (c:Concept {{node_id: $concept_id, graph_id: $graph_id}})
    MERGE (c)-[:BELONGS_TO]->(g)
    MATCH (r:{RESOURCE_LABEL} {{resource_id: $resource_id, graph_id: $graph_id}})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(r.on_branches, [])
    MERGE (c)-[rel:HAS_RESOURCE {{graph_id: $graph_id}}]->(r)
    SET rel.on_branches = CASE
      WHEN rel.on_branches IS NULL THEN [$branch_id]
      WHEN $branch_id IN rel.on_branches THEN rel.on_branches
      ELSE rel.on_branches + $branch_id
    END
    SET c.on_branches = CASE
      WHEN c.on_branches IS NULL THEN [$branch_id]
      WHEN $branch_id IN c.on_branches THEN c.on_branches
      ELSE c.on_branches + $branch_id
    END
    """
    session.run(
        query,
        graph_id=graph_id,
        branch_id=branch_id,
        concept_id=concept_id,
        resource_id=resource_id,
    ).consume()


def get_resources_for_concept(
    session: Session,
    concept_id: str,
    include_archived: bool = False,
) -> List[Resource]:
    """
    Return all resources attached to a concept in the active graph + branch.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)

    archived_clause = ""
    if not include_archived:
        archived_clause = "AND COALESCE(r.archived, false) = false"

    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MATCH (c:Concept {{node_id: $concept_id, graph_id: $graph_id}})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
    MATCH (c)-[rel:HAS_RESOURCE]->(r:{RESOURCE_LABEL} {{graph_id: $graph_id}})-[:BELONGS_TO]->(g)
    WHERE rel.graph_id = $graph_id
      AND $branch_id IN COALESCE(rel.on_branches, [])
      AND $branch_id IN COALESCE(r.on_branches, [])
      {archived_clause}
    RETURN r
    ORDER BY COALESCE(r.title, r.url) ASC
    """

    out: List[Resource] = []
    for rec in session.run(query, graph_id=graph_id, branch_id=branch_id, concept_id=concept_id):
        node = rec["r"]
        out.append(
            Resource(
                resource_id=node["resource_id"],
                kind=node["kind"],
                url=node["url"],
                title=node.get("title"),
                mime_type=node.get("mime_type"),
                caption=node.get("caption"),
                source=node.get("source"),
                metadata=_parse_metadata(node),
                created_at=_to_iso(node.get("created_at")),
                ingestion_run_id=node.get("ingestion_run_id"),
            )
        )
    return out


def search_resources(
    session: Session,
    query: str,
    limit: int = 20,
    include_archived: bool = False,
) -> List[Resource]:
    """
    Search resources in the active graph + branch by title or caption.

    IMPORTANT:
    - This function does NOT mutate active graph context.
    - Scopes strictly by r.graph_id and r.on_branches.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)

    archived_clause = ""
    if not include_archived:
        archived_clause = "AND COALESCE(r.archived, false) = false"

    q = (query or "").strip().lower()
    if not q:
        return []

    cypher = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MATCH (r:{RESOURCE_LABEL} {{graph_id: $graph_id}})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(r.on_branches, [])
      {archived_clause}
      AND (
        toLower(COALESCE(r.title, '')) CONTAINS $q OR
        toLower(COALESCE(r.caption, '')) CONTAINS $q OR
        toLower(COALESCE(r.url, '')) CONTAINS $q
      )
    RETURN r
    ORDER BY COALESCE(r.title, r.url) ASC
    LIMIT $limit
    """

    out: List[Resource] = []
    for rec in session.run(cypher, graph_id=graph_id, branch_id=branch_id, q=q, limit=limit):
        node = rec["r"]
        out.append(
            Resource(
                resource_id=node["resource_id"],
                kind=node["kind"],
                url=node["url"],
                title=node.get("title"),
                mime_type=node.get("mime_type"),
                caption=node.get("caption"),
                source=node.get("source"),
                metadata=_parse_metadata(node),
                created_at=_to_iso(node.get("created_at")),
                ingestion_run_id=node.get("ingestion_run_id"),
            )
        )
    return out
