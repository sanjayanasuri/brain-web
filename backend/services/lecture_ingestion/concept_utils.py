"""
Concept lookup and update helpers for lecture ingestion (by name/domain, description, tags).
"""
from typing import Optional, List

from neo4j import Session

from models import Concept
from services.graph.concepts import _normalize_concept_from_db

from .chunking import normalize_name


def find_concept_by_name_and_domain(
    session: Session, name: str, domain: Optional[str], tenant_id: Optional[str] = None
) -> Optional[Concept]:
    """
    Find a concept by name (case-insensitive) and optionally domain.
    If domain is None, matches any domain.
    """
    normalized_name = normalize_name(name)

    if domain:
        query = """
        MATCH (c:Concept)
        WHERE (toLower(trim(c.name)) = $normalized_name
               OR $normalized_name IN [alias IN COALESCE(c.aliases, []) | toLower(trim(alias))])
          AND c.domain = $domain
          AND (c.tenant_id = $tenant_id OR ($tenant_id IS NULL AND c.tenant_id IS NULL))
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
        result = session.run(query, normalized_name=normalized_name, domain=domain, tenant_id=tenant_id)
        record = result.single()
        if record:
            return _normalize_concept_from_db(record.data())

    query = """
    MATCH (c:Concept)
    WHERE (toLower(trim(c.name)) = $normalized_name
           OR $normalized_name IN [alias IN COALESCE(c.aliases, []) | toLower(trim(alias))])
      AND (c.tenant_id = $tenant_id OR ($tenant_id IS NULL AND c.tenant_id IS NULL))
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
    result = session.run(query, normalized_name=normalized_name, tenant_id=tenant_id)
    record = result.single()
    if record:
        return _normalize_concept_from_db(record.data())
    return None


def update_concept_description_if_better(
    session: Session, concept: Concept, new_description: Optional[str]
) -> Concept:
    """
    Update concept description only if new one is longer/more detailed.
    Returns the updated concept.
    """
    if not new_description:
        return concept

    current_desc = concept.description or ""
    if len(new_description) > len(current_desc):
        query = """
        MATCH (c:Concept {node_id: $node_id})
        SET c.description = $description
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
        result = session.run(query, node_id=concept.node_id, description=new_description)
        record = result.single()
        if record:
            return _normalize_concept_from_db(record.data())
    return concept


def merge_tags(existing_tags: Optional[List[str]], new_tags: List[str]) -> List[str]:
    """Merge new tags with existing tags, avoiding duplicates"""
    existing = set(existing_tags or [])
    new = set(new_tags or [])
    merged = existing | new
    return sorted(list(merged))


def update_concept_tags(session: Session, concept: Concept, new_tags: List[str]) -> Concept:
    """Update concept tags by merging with existing tags"""
    merged_tags = merge_tags(concept.tags, new_tags)
    query = """
    MATCH (c:Concept {node_id: $node_id})
    SET c.tags = $tags
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
    result = session.run(query, node_id=concept.node_id, tags=merged_tags)
    record = result.single()
    if record:
        return _normalize_concept_from_db(record.data())
    return concept
