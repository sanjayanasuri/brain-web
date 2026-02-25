"""
Neo4j schema contract for the unified content pipeline.

Phase 0 goal: define a minimal, consistent node/edge model so that any ingested
ContentItem (articles, social posts/comments, snippets, transcripts) can be
linked to topics/entities, and transcript-derived thoughts can link to topics.

Nodes:
- (:Topic {id, name, canonical_key, tenant_id?})
- (:Entity {id, name, type, tenant_id?})
- (:Content {id, type, created_at, tenant_id?})
- (:Thought {id, user_id?, created_at, tenant_id?})  (optional, but supported)

Edges:
- (Content)-[:MENTIONS_TOPIC]->(Topic)
- (Content)-[:MENTIONS_ENTITY]->(Entity)
- (Thought)-[:ABOUT_TOPIC]->(Topic)
- (Topic)-[:RELATED_TO]->(Topic)  (later/optional)

Notes:
- We include `tenant_id` in node keys for safety. If you truly want a single-user
  system, you can store a constant tenant_id (e.g. the user's tenant_id).
- This module only ensures schema/constraints; upsert logic comes in later phases.
"""

from __future__ import annotations

import logging

from neo4j import Session

logger = logging.getLogger("brain_web")

_CONTENT_GRAPH_SCHEMA_INITIALIZED = False


def ensure_content_graph_schema_initialized(session: Session) -> None:
    """
    Best-effort Neo4j schema init for content pipeline labels.

    This is safe to call repeatedly; it caches per-process and uses IF NOT EXISTS.
    """
    global _CONTENT_GRAPH_SCHEMA_INITIALIZED
    if _CONTENT_GRAPH_SCHEMA_INITIALIZED:
        return

    try:
        session.run(
            "CREATE CONSTRAINT bw_topic_tenant_canonical_key IF NOT EXISTS "
            "FOR (t:Topic) REQUIRE (t.tenant_id, t.canonical_key) IS NODE KEY"
        ).consume()
        session.run(
            "CREATE CONSTRAINT bw_entity_tenant_type_name IF NOT EXISTS "
            "FOR (e:Entity) REQUIRE (e.tenant_id, e.type, e.name) IS NODE KEY"
        ).consume()
        session.run(
            "CREATE CONSTRAINT bw_content_id_unique IF NOT EXISTS "
            "FOR (c:Content) REQUIRE c.id IS UNIQUE"
        ).consume()
        session.run(
            "CREATE CONSTRAINT bw_thought_id_unique IF NOT EXISTS "
            "FOR (t:Thought) REQUIRE t.id IS UNIQUE"
        ).consume()

        _CONTENT_GRAPH_SCHEMA_INITIALIZED = True
    except Exception as e:
        logger.warning(f"[content_graph_schema] Failed to ensure Neo4j schema: {e}")

