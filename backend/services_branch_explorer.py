# services_branch_explorer.py
from __future__ import annotations

import datetime
import json
import logging
from contextvars import ContextVar, Token
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from neo4j import Session

logger = logging.getLogger("brain_web")


DEFAULT_GRAPH_ID = "default"
DEFAULT_BRANCH_ID = "main"

_REQUEST_GRAPH_USER_ID: ContextVar[Optional[str]] = ContextVar("bw_request_graph_user_id", default=None)
_REQUEST_GRAPH_TENANT_ID: ContextVar[Optional[str]] = ContextVar("bw_request_graph_tenant_id", default=None)

# Best-effort schema init (constraints/migrations). We keep this here because
# this module is already the "graph/branch context" entry point used by most
# graph operations.
_SCHEMA_INITIALIZED = False


def set_request_graph_identity(user_id: Optional[str], tenant_id: Optional[str]) -> Tuple[Token, Token]:
    """
    Set request-scoped graph identity for downstream service calls that do not
    explicitly pass user_id/tenant_id.
    """
    user_token = _REQUEST_GRAPH_USER_ID.set(str(user_id).strip() if user_id else None)
    tenant_token = _REQUEST_GRAPH_TENANT_ID.set(str(tenant_id).strip() if tenant_id else None)
    return user_token, tenant_token


def reset_request_graph_identity(tokens: Tuple[Token, Token]) -> None:
    """Reset request-scoped graph identity."""
    user_token, tenant_token = tokens
    _REQUEST_GRAPH_USER_ID.reset(user_token)
    _REQUEST_GRAPH_TENANT_ID.reset(tenant_token)


def get_request_graph_identity() -> Tuple[Optional[str], Optional[str]]:
    """Get request-scoped graph identity (user_id, tenant_id)."""
    return _REQUEST_GRAPH_USER_ID.get(), _REQUEST_GRAPH_TENANT_ID.get()


def ensure_schema_constraints(session: Session) -> None:
    """
    Ensure Neo4j constraints match the Branch Explorer model.

    Key requirements:
    - Concept names must be unique *per graph*, not globally.
      Enforced via NODE KEY on (graph_id, name).
    - Concept node_id must be globally unique.
    - GraphSpace graph_id must be globally unique.
    - Lecture lecture_id must be globally unique.

    Also drops any legacy global uniqueness constraint on (:Concept {name}).
    """
    global _SCHEMA_INITIALIZED
    if _SCHEMA_INITIALIZED:
        return

    try:
        constraints = session.run("SHOW CONSTRAINTS").data()

        def _labels(c):
            return [str(x) for x in (c.get("labelsOrTypes") or [])]

        def _props(c):
            return [str(x) for x in (c.get("properties") or [])]

        def _type(c):
            return str(c.get("type") or "").upper()

        def _has(label: str, props: List[str], type_substr: str) -> bool:
            want_props = list(props)
            for c in constraints:
                if label in _labels(c) and _props(c) == want_props and type_substr in _type(c):
                    return True
            return False

        # Drop any existing uniqueness constraint on Concept.name (global uniqueness).
        # This would incorrectly prevent the same name from existing in multiple graphs.
        for c in constraints:
            name = c.get("name")
            if (
                name
                and "CONCEPT" in [x.upper() for x in _labels(c)]
                and _props(c) == ["name"]
                and "UNIQUENESS" in _type(c)
            ):
                session.run(f"DROP CONSTRAINT {name} IF EXISTS").consume()

        # --- Core constraints ---
        if not _has("Concept", ["node_id"], "UNIQUENESS"):
            session.run(
                "CREATE CONSTRAINT concept_node_id_unique IF NOT EXISTS "
                "FOR (c:Concept) REQUIRE c.node_id IS UNIQUE"
            ).consume()

        if not _has("Concept", ["graph_id", "name"], "NODE_KEY"):
            session.run(
                "CREATE CONSTRAINT concept_graph_name_node_key IF NOT EXISTS "
                "FOR (c:Concept) REQUIRE (c.graph_id, c.name) IS NODE KEY"
            ).consume()

        if not _has("GraphSpace", ["graph_id"], "UNIQUENESS"):
            session.run(
                "CREATE CONSTRAINT graphspace_id_unique IF NOT EXISTS "
                "FOR (g:GraphSpace) REQUIRE g.graph_id IS UNIQUE"
            ).consume()

        if not _has("Lecture", ["lecture_id"], "UNIQUENESS"):
            session.run(
                "CREATE CONSTRAINT lecture_id_unique IF NOT EXISTS "
                "FOR (l:Lecture) REQUIRE l.lecture_id IS UNIQUE"
            ).consume()

        if not _has("MergeCandidate", ["graph_id", "candidate_id"], "NODE_KEY"):
            session.run(
                "CREATE CONSTRAINT merge_candidate_graph_candidate_node_key IF NOT EXISTS "
                "FOR (m:MergeCandidate) REQUIRE (m.graph_id, m.candidate_id) IS NODE KEY"
            ).consume()

        if not _has("Artifact", ["graph_id", "url", "content_hash"], "NODE_KEY"):
            session.run(
                "CREATE CONSTRAINT artifact_graph_url_hash_node_key IF NOT EXISTS "
                "FOR (a:Artifact) REQUIRE (a.graph_id, a.url, a.content_hash) IS NODE KEY"
            ).consume()

        if not _has("Event", ["event_id"], "UNIQUENESS"):
            session.run(
                "CREATE CONSTRAINT bw_event_id_unique IF NOT EXISTS "
                "FOR (e:Event) REQUIRE e.event_id IS UNIQUE"
            ).consume()

        # --- Graph-scoped node keys (domain entities) ---
        if not _has("Quote", ["graph_id", "quote_id"], "NODE_KEY"):
            session.run(
                "CREATE CONSTRAINT quote_graph_quote_id_node_key IF NOT EXISTS "
                "FOR (q:Quote) REQUIRE (q.graph_id, q.quote_id) IS NODE KEY"
            ).consume()

        if not _has("Claim", ["graph_id", "claim_id"], "NODE_KEY"):
            session.run(
                "CREATE CONSTRAINT claim_graph_claim_id_node_key IF NOT EXISTS "
                "FOR (c:Claim) REQUIRE (c.graph_id, c.claim_id) IS NODE KEY"
            ).consume()

        if not _has("SourceChunk", ["graph_id", "chunk_id"], "NODE_KEY"):
            session.run(
                "CREATE CONSTRAINT chunk_graph_chunk_id_node_key IF NOT EXISTS "
                "FOR (s:SourceChunk) REQUIRE (s.graph_id, s.chunk_id) IS NODE KEY"
            ).consume()

        # Create indexes for performance (bootstrap queries)
        # Check existing indexes first
        try:
            existing_indexes = session.run("SHOW INDEXES").data()
            index_names = [idx.get("name", "") for idx in existing_indexes]
            
            # Index on Artifact.captured_at for sorting (composite with graph_id)
            if "artifact_captured_at_index" not in index_names:
                try:
                    session.run(
                        "CREATE INDEX artifact_captured_at_index IF NOT EXISTS "
                        "FOR (a:Artifact) ON (a.graph_id, a.captured_at)"
                    ).consume()
                except Exception as e:
                    logger.warning(f"Could not create artifact_captured_at_index: {e}")

            # Index on Concept.updated_at for sorting
            if "concept_updated_at_index" not in index_names:
                try:
                    session.run(
                        "CREATE INDEX concept_updated_at_index IF NOT EXISTS "
                        "FOR (c:Concept) ON (c.graph_id, c.updated_at)"
                    ).consume()
                except Exception as e:
                    logger.warning(f"Could not create concept_updated_at_index: {e}")

            # Index on Concept.created_at for sorting
            if "concept_created_at_index" not in index_names:
                try:
                    session.run(
                        "CREATE INDEX concept_created_at_index IF NOT EXISTS "
                        "FOR (c:Concept) ON (c.graph_id, c.created_at)"
                    ).consume()
                except Exception as e:
                    logger.warning(f"Could not create concept_created_at_index: {e}")
        except Exception as e:
            logger.warning(f"Could not check/create indexes: {e}")

        if not _has("SourceDocument", ["graph_id", "doc_id"], "NODE_KEY"):
            session.run(
                "CREATE CONSTRAINT sourcedoc_graph_doc_id_node_key IF NOT EXISTS "
                "FOR (d:SourceDocument) REQUIRE (d.graph_id, d.doc_id) IS NODE KEY"
            ).consume()

        if not _has("Community", ["graph_id", "community_id"], "NODE_KEY"):
            session.run(
                "CREATE CONSTRAINT community_graph_comm_id_node_key IF NOT EXISTS "
                "FOR (k:Community) REQUIRE (k.graph_id, k.community_id) IS NODE KEY"
            ).consume()

        if not _has("Branch", ["graph_id", "branch_id"], "NODE_KEY"):
            session.run(
                "CREATE CONSTRAINT branch_graph_branch_id_node_key IF NOT EXISTS "
                "FOR (b:Branch) REQUIRE (b.graph_id, b.branch_id) IS NODE KEY"
            ).consume()

        if not _has("Trail", ["graph_id", "trail_id"], "NODE_KEY"):
            session.run(
                "CREATE CONSTRAINT trail_graph_trail_id_node_key IF NOT EXISTS "
                "FOR (t:Trail) REQUIRE (t.graph_id, t.trail_id) IS NODE KEY"
            ).consume()

        if not _has("TrailStep", ["graph_id", "step_id"], "NODE_KEY"):
            session.run(
                "CREATE CONSTRAINT trailstep_graph_step_id_node_key IF NOT EXISTS "
                "FOR (s:TrailStep) REQUIRE (s.graph_id, s.step_id) IS NODE KEY"
            ).consume()

        if not _has("Snapshot", ["graph_id", "snapshot_id"], "NODE_KEY"):
            session.run(
                "CREATE CONSTRAINT snapshot_graph_snapshot_id_node_key IF NOT EXISTS "
                "FOR (s:Snapshot) REQUIRE (s.graph_id, s.snapshot_id) IS NODE KEY"
            ).consume()

        if not _has("Resource", ["graph_id", "resource_id"], "NODE_KEY"):
            session.run(
                "CREATE CONSTRAINT resource_graph_resource_id_node_key IF NOT EXISTS "
                "FOR (r:Resource) REQUIRE (r.graph_id, r.resource_id) IS NODE KEY"
            ).consume()

        # --- Idempotency for offline sync ---
        if not _has("ClientEvent", ["graph_id", "event_id"], "NODE_KEY"):
            session.run(
                "CREATE CONSTRAINT client_event_graph_event_node_key IF NOT EXISTS "
                "FOR (e:ClientEvent) REQUIRE (e.graph_id, e.event_id) IS NODE KEY"
            ).consume()

        _SCHEMA_INITIALIZED = True

    except Exception:
        # Best-effort only. If Neo4j is temporarily unavailable or the user
        # doesn't have permissions to manage constraints, we don't want to break
        # core reads/writes; the request will fail later with a clearer error.
        return


def _now_iso() -> str:
    return datetime.datetime.utcnow().replace(tzinfo=datetime.timezone.utc).isoformat()


def ensure_graphspace_exists(
    session: Session,
    graph_id: str,
    name: Optional[str] = None,
    tenant_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Ensure a GraphSpace exists; returns its properties.
    
    Args:
        session: Neo4j session
        graph_id: Graph identifier
        name: Optional graph name
        tenant_id: Optional tenant identifier for multi-tenant isolation
    """
    if tenant_id:
        tenant_check = session.run(
            """
            MATCH (g:GraphSpace {graph_id: $graph_id})
            RETURN g.tenant_id AS tenant_id
            LIMIT 1
            """,
            graph_id=graph_id,
        ).single()
        if tenant_check and tenant_check.get("tenant_id") not in (None, tenant_id):
            raise ValueError("Graph belongs to a different tenant")

    query = """
    MERGE (g:GraphSpace {graph_id: $graph_id})
    ON CREATE SET g.name = COALESCE($name, $graph_id),
                  g.created_at = $now,
                  g.updated_at = $now,
                  g.tenant_id = $tenant_id
    ON MATCH SET g.updated_at = $now,
                 g.tenant_id = COALESCE(g.tenant_id, $tenant_id)
    RETURN g
    """
    rec = session.run(query, graph_id=graph_id, name=name, tenant_id=tenant_id, now=_now_iso()).single()
    if rec is None:
        raise RuntimeError(f"Failed to create or retrieve GraphSpace with graph_id={graph_id}. Database query returned no result.")
    g = rec["g"]
    return {
        "graph_id": g.get("graph_id"),
        "name": g.get("name"),
        "created_at": g.get("created_at"),
        "updated_at": g.get("updated_at"),
        "tenant_id": g.get("tenant_id"),
    }


def ensure_branch_exists(session: Session, graph_id: str, branch_id: str, name: Optional[str] = None) -> Dict[str, Any]:
    """Ensure a Branch exists for a GraphSpace."""
    query = """
    MERGE (g:GraphSpace {graph_id: $graph_id})
    ON CREATE SET g.name = COALESCE($name, $graph_id),
                  g.created_at = $now,
                  g.updated_at = $now
    WITH g
    MERGE (b:Branch {branch_id: $branch_id, graph_id: $graph_id})
    ON CREATE SET b.name = COALESCE($name, $branch_id),
                  b.created_at = $now,
                  b.updated_at = $now
    ON MATCH SET b.updated_at = $now
    MERGE (b)-[:BRANCH_OF]->(g)
    RETURN b
    """
    rec = session.run(
        query,
        graph_id=graph_id,
        branch_id=branch_id,
        name=name,
        now=_now_iso(),
    ).single()
    if rec is None:
        raise RuntimeError(f"Failed to create or retrieve Branch with graph_id={graph_id}, branch_id={branch_id}. Database query returned no result.")
    b = rec["b"]
    return {
        "branch_id": b.get("branch_id"),
        "graph_id": b.get("graph_id"),
        "name": b.get("name"),
        "created_at": b.get("created_at"),
        "updated_at": b.get("updated_at"),
    }


def ensure_default_context(session: Session) -> Tuple[str, str]:
    ensure_schema_constraints(session)
    ensure_graphspace_exists(session, DEFAULT_GRAPH_ID, name="Default")
    ensure_branch_exists(session, DEFAULT_GRAPH_ID, DEFAULT_BRANCH_ID, name="Main")
    return DEFAULT_GRAPH_ID, DEFAULT_BRANCH_ID


def _sanitize_identity(value: str) -> str:
    cleaned = "".join(ch if (ch.isalnum() or ch in "-_.") else "_" for ch in value)
    return cleaned[:96] if cleaned else "default"


def _resolve_graph_identity(
    *,
    user_id: Optional[str] = None,
    tenant_id: Optional[str] = None,
) -> Tuple[Optional[str], Optional[str]]:
    req_user_id = _REQUEST_GRAPH_USER_ID.get()
    req_tenant_id = _REQUEST_GRAPH_TENANT_ID.get()

    resolved_user_id = (str(user_id).strip() if user_id else str(req_user_id).strip() if req_user_id else None)
    resolved_tenant_id = (str(tenant_id).strip() if tenant_id else str(req_tenant_id).strip() if req_tenant_id else None)

    return resolved_user_id or None, resolved_tenant_id or None


def _graph_context_profile_id(user_id: Optional[str], tenant_id: Optional[str]) -> str:
    if user_id and tenant_id:
        return f"graphctx:{_sanitize_identity(tenant_id)}:{_sanitize_identity(user_id)}"
    if tenant_id:
        return f"graphctx:{_sanitize_identity(tenant_id)}:__tenant__"
    if user_id:
        return f"graphctx:__user__:{_sanitize_identity(user_id)}"
    return "graphctx:default:default"


def _tenant_default_graph_id(tenant_id: Optional[str]) -> str:
    if not tenant_id:
        return DEFAULT_GRAPH_ID
    return f"{DEFAULT_GRAPH_ID}_{_sanitize_identity(tenant_id)[:16]}"


def _get_user_learning_prefs(
    session: Session,
    *,
    user_id: Optional[str] = None,
    tenant_id: Optional[str] = None,
) -> Dict[str, Any]:
    resolved_user_id, resolved_tenant_id = _resolve_graph_identity(user_id=user_id, tenant_id=tenant_id)
    profile_id = _graph_context_profile_id(resolved_user_id, resolved_tenant_id)

    query = """
    MERGE (u:UserProfile {id: $profile_id})
    ON CREATE SET u.name = 'Sanjay',
                  u.background = [],
                  u.interests = [],
                  u.weak_spots = [],
                  u.user_id = $user_id,
                  u.tenant_id = $tenant_id,
                  u.context_kind = 'graph_context',
                  u.learning_preferences = $empty_json
    ON MATCH SET u.user_id = COALESCE(u.user_id, $user_id),
                 u.tenant_id = COALESCE(u.tenant_id, $tenant_id),
                 u.context_kind = COALESCE(u.context_kind, 'graph_context')
    RETURN u.learning_preferences AS learning_preferences
    """
    empty_json = json.dumps({})
    rec = session.run(
        query,
        profile_id=profile_id,
        user_id=resolved_user_id,
        tenant_id=resolved_tenant_id,
        empty_json=empty_json,
    ).single()
    lp = rec["learning_preferences"] if rec else "{}"

    if isinstance(lp, str):
        try:
            return json.loads(lp)
        except Exception:
            return {}
    if isinstance(lp, dict):
        return lp
    return {}


def _set_user_learning_prefs(
    session: Session,
    prefs: Dict[str, Any],
    *,
    user_id: Optional[str] = None,
    tenant_id: Optional[str] = None,
) -> None:
    resolved_user_id, resolved_tenant_id = _resolve_graph_identity(user_id=user_id, tenant_id=tenant_id)
    profile_id = _graph_context_profile_id(resolved_user_id, resolved_tenant_id)

    query = """
    MERGE (u:UserProfile {id: $profile_id})
    SET u.learning_preferences = $learning_preferences,
        u.user_id = COALESCE(u.user_id, $user_id),
        u.tenant_id = COALESCE(u.tenant_id, $tenant_id),
        u.context_kind = COALESCE(u.context_kind, 'graph_context')
    RETURN u
    """
    session.run(
        query,
        profile_id=profile_id,
        learning_preferences=json.dumps(prefs),
        user_id=resolved_user_id,
        tenant_id=resolved_tenant_id,
    ).consume()


def get_active_graph_context(
    session: Session,
    tenant_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> Tuple[str, str]:
    """
    Returns (graph_id, branch_id). Ensures defaults exist.
    
    Args:
        session: Neo4j session
        tenant_id: Optional tenant_id for multi-tenant isolation. If provided,
                   ensures graph belongs to this tenant.
    """
    resolved_user_id, resolved_tenant_id = _resolve_graph_identity(user_id=user_id, tenant_id=tenant_id)

    ensure_default_context(session)
    default_graph_id = _tenant_default_graph_id(resolved_tenant_id)
    if resolved_tenant_id:
        ensure_graphspace_exists(session, default_graph_id, name="Default", tenant_id=resolved_tenant_id)
        ensure_branch_exists(session, default_graph_id, DEFAULT_BRANCH_ID, name="Main")

    prefs = _get_user_learning_prefs(session, user_id=resolved_user_id, tenant_id=resolved_tenant_id)
    graph_id = prefs.get("active_graph_id") or default_graph_id
    branch_id = prefs.get("active_branch_id") or DEFAULT_BRANCH_ID

    # If tenant_id is provided, verify the graph belongs to this tenant.
    if resolved_tenant_id:
        query = """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        WHERE g.tenant_id = $tenant_id
        RETURN g
        """
        rec = session.run(query, graph_id=graph_id, tenant_id=resolved_tenant_id).single()
        if not rec:
            # Graph doesn't exist or doesn't belong to tenant, use default
            graph_id = default_graph_id
            branch_id = DEFAULT_BRANCH_ID

    ensure_graphspace_exists(session, graph_id, tenant_id=resolved_tenant_id)
    ensure_branch_exists(session, graph_id, branch_id)

    return graph_id, branch_id


def set_active_graph(
    session: Session,
    graph_id: str,
    *,
    tenant_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> Tuple[str, str]:
    ensure_schema_constraints(session)
    resolved_user_id, resolved_tenant_id = _resolve_graph_identity(user_id=user_id, tenant_id=tenant_id)

    if resolved_tenant_id:
        rec = session.run(
            """
            MATCH (g:GraphSpace {graph_id: $graph_id})
            WHERE g.tenant_id = $tenant_id
            RETURN g
            """,
            graph_id=graph_id,
            tenant_id=resolved_tenant_id,
        ).single()
        if not rec:
            raise ValueError("Graph not found in tenant scope")
    else:
        ensure_graphspace_exists(session, graph_id)

    # When switching graphs, default to its main branch.
    ensure_branch_exists(session, graph_id, DEFAULT_BRANCH_ID, name="Main")

    prefs = _get_user_learning_prefs(session, user_id=resolved_user_id, tenant_id=resolved_tenant_id)
    prefs["active_graph_id"] = graph_id
    prefs["active_branch_id"] = DEFAULT_BRANCH_ID
    _set_user_learning_prefs(
        session,
        prefs,
        user_id=resolved_user_id,
        tenant_id=resolved_tenant_id,
    )

    return graph_id, DEFAULT_BRANCH_ID


def set_active_branch(
    session: Session,
    branch_id: str,
    *,
    tenant_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> Tuple[str, str]:
    resolved_user_id, resolved_tenant_id = _resolve_graph_identity(user_id=user_id, tenant_id=tenant_id)
    graph_id, _ = get_active_graph_context(session, tenant_id=resolved_tenant_id, user_id=resolved_user_id)
    ensure_schema_constraints(session)
    ensure_branch_exists(session, graph_id, branch_id)

    prefs = _get_user_learning_prefs(session, user_id=resolved_user_id, tenant_id=resolved_tenant_id)
    prefs["active_graph_id"] = graph_id
    prefs["active_branch_id"] = branch_id
    _set_user_learning_prefs(
        session,
        prefs,
        user_id=resolved_user_id,
        tenant_id=resolved_tenant_id,
    )

    return graph_id, branch_id


def list_all_graphs(session: Session) -> List[Dict[str, Any]]:
    """
    List all graphs across all tenants. For admin and script use only.
    Normal app code should use list_graphs(session, tenant_id=...).
    """
    return _list_graphs_impl(session, tenant_id=None)


def list_graphs(session: Session, tenant_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    List graphs for the given tenant. tenant_id is required for multi-tenant isolation.
    Resolved from request context if not provided. Use list_all_graphs() only for admin/scripts.
    """
    resolved = str(tenant_id).strip() if tenant_id else (str(_REQUEST_GRAPH_TENANT_ID.get()).strip() if _REQUEST_GRAPH_TENANT_ID.get() else None)
    if not resolved:
        raise ValueError("tenant_id is required for list_graphs; use list_all_graphs() for admin/script use only.")
    return _list_graphs_impl(session, tenant_id=resolved)


def _list_graphs_impl(session: Session, tenant_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Internal: run the list query with optional tenant filter."""
    ensure_default_context(session)
    if tenant_id:
        ensure_graphspace_exists(session, _tenant_default_graph_id(tenant_id), name="Default", tenant_id=tenant_id)

    where_clause = ""
    params: Dict[str, Any] = {}
    if tenant_id:
        where_clause = "WHERE g.tenant_id = $tenant_id"
        params["tenant_id"] = tenant_id

    query = f"""
    MATCH (g:GraphSpace)
    {where_clause}
    OPTIONAL MATCH (c:Concept)-[:BELONGS_TO]->(g)
    OPTIONAL MATCH (s:Concept)-[r]->(t:Concept)
    WHERE s.graph_id = g.graph_id AND t.graph_id = g.graph_id
    WITH g,
         count(DISTINCT c) AS node_count,
         count(DISTINCT r) AS edge_count
    RETURN g, node_count, edge_count
    ORDER BY g.created_at ASC
    """
    out: List[Dict[str, Any]] = []
    for rec in session.run(query, **params):
        g = rec["g"]
        node_count = rec["node_count"] or 0
        edge_count = rec["edge_count"] or 0

        created_at = g.get("created_at")
        updated_at = g.get("updated_at")

        if created_at:
            if hasattr(created_at, "to_native"):
                created_at = created_at.to_native().isoformat()
            else:
                created_at = str(created_at)
        if updated_at:
            if hasattr(updated_at, "to_native"):
                updated_at = updated_at.to_native().isoformat()
            else:
                updated_at = str(updated_at)

        out.append(
            {
                "graph_id": g.get("graph_id"),
                "name": g.get("name"),
                "description": g.get("description"),
                "created_at": created_at,
                "updated_at": updated_at,
                "node_count": node_count,
                "edge_count": edge_count,
                "template_id": g.get("template_id"),
                "template_label": g.get("template_label"),
                "template_description": g.get("template_description"),
                "template_tags": g.get("template_tags"),
                "intent": g.get("intent"),
                "tenant_id": g.get("tenant_id"),
            }
        )
    return out


def create_graph(
    session: Session,
    name: str,
    template_id: Optional[str] = None,
    template_label: Optional[str] = None,
    template_description: Optional[str] = None,
    template_tags: Optional[List[str]] = None,
    intent: Optional[str] = None,
    tenant_id: Optional[str] = None,
) -> Dict[str, Any]:
    ensure_schema_constraints(session)
    graph_id = f"G{uuid4().hex[:8].upper()}"
    g = ensure_graphspace_exists(session, graph_id, name=name, tenant_id=tenant_id)

    if template_id or template_label or template_description or template_tags or intent:
        query = """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        SET g.template_id = COALESCE($template_id, g.template_id),
            g.template_label = COALESCE($template_label, g.template_label),
            g.template_description = COALESCE($template_description, g.template_description),
            g.template_tags = CASE
                WHEN $template_tags IS NULL THEN g.template_tags
                ELSE $template_tags
            END,
            g.intent = COALESCE($intent, g.intent),
            g.updated_at = $now
        RETURN g
        """
        rec = session.run(
            query,
            graph_id=graph_id,
            template_id=template_id,
            template_label=template_label,
            template_description=template_description,
            template_tags=template_tags,
            intent=intent,
            now=_now_iso(),
        ).single()
        if rec:
            g = rec["g"]

    ensure_branch_exists(session, graph_id, DEFAULT_BRANCH_ID, name="Main")
    return {
        "graph_id": g.get("graph_id"),
        "name": g.get("name"),
        "created_at": g.get("created_at"),
        "updated_at": g.get("updated_at"),
        "template_id": g.get("template_id"),
        "template_label": g.get("template_label"),
        "template_description": g.get("template_description"),
        "template_tags": g.get("template_tags"),
        "intent": g.get("intent"),
    }


def rename_graph(
    session: Session,
    graph_id: str,
    name: str,
    *,
    tenant_id: Optional[str] = None,
) -> Dict[str, Any]:
    ensure_schema_constraints(session)
    tenant_where = "WHERE g.tenant_id = $tenant_id" if tenant_id else ""
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    {tenant_where}
    SET g.name = $name,
        g.updated_at = $now
    RETURN g
    """
    rec = session.run(
        query,
        graph_id=graph_id,
        tenant_id=tenant_id,
        name=name,
        now=_now_iso(),
    ).single()
    if not rec:
        raise ValueError("Graph not found")
    g = rec["g"]
    return {
        "graph_id": g.get("graph_id"),
        "name": g.get("name"),
        "created_at": g.get("created_at"),
        "updated_at": g.get("updated_at"),
        "tenant_id": g.get("tenant_id"),
    }


def delete_graph(
    session: Session,
    graph_id: str,
    *,
    tenant_id: Optional[str] = None,
) -> None:
    ensure_schema_constraints(session)
    if graph_id == DEFAULT_GRAPH_ID or graph_id.startswith(f"{DEFAULT_GRAPH_ID}_"):
        raise ValueError("Cannot delete default graph")

    tenant_where = "WHERE g.tenant_id = $tenant_id" if tenant_id else ""
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    {tenant_where}
    OPTIONAL MATCH (c:Concept)-[:BELONGS_TO]->(g)
    DETACH DELETE c
    WITH g
    OPTIONAL MATCH (b:Branch {{graph_id: $graph_id}})
    DETACH DELETE b
    WITH g
    OPTIONAL MATCH (s:Snapshot {{graph_id: $graph_id}})
    DETACH DELETE s
    WITH g
    DETACH DELETE g
    """
    result = session.run(query, graph_id=graph_id, tenant_id=tenant_id)
    summary = result.consume()
    if summary.counters.nodes_deleted == 0:
        raise ValueError("Graph not found")


_SCOPING_INITIALIZED = False


def ensure_graph_scoping_initialized(session: Session) -> None:
    """Backfill legacy data into the default graph and main branch.

    This is intentionally conservative:
    - Only touches Concepts that do not already belong to a GraphSpace
    - Only touches relationships that do not already have graph_id/on_branches
    - Best-effort backfill for Resources + HAS_RESOURCE scoping
    """
    global _SCOPING_INITIALIZED
    if _SCOPING_INITIALIZED:
        return

    ensure_schema_constraints(session)
    ensure_default_context(session)

    # Backfill Concepts that aren't scoped.
    query_nodes = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (c:Concept)
    WHERE NOT (c)-[:BELONGS_TO]->(:GraphSpace)
    MERGE (c)-[:BELONGS_TO]->(g)
    SET c.graph_id = $graph_id,
        c.on_branches = COALESCE(c.on_branches, [$branch_id])
    RETURN count(c) AS updated
    """
    session.run(query_nodes, graph_id=DEFAULT_GRAPH_ID, branch_id=DEFAULT_BRANCH_ID).consume()

    # Ensure existing Concepts have on_branches.
    query_branches = """
    MATCH (c:Concept)
    WHERE c.on_branches IS NULL
    SET c.on_branches = [$branch_id]
    RETURN count(c) AS updated
    """
    session.run(query_branches, branch_id=DEFAULT_BRANCH_ID).consume()

    # Backfill relationships between Concepts.
    query_rels = """
    MATCH (s:Concept)-[r]->(t:Concept)
    WHERE r.graph_id IS NULL
    SET r.graph_id = COALESCE(s.graph_id, $graph_id),
        r.on_branches = COALESCE(r.on_branches, [$branch_id])
    RETURN count(r) AS updated
    """
    session.run(query_rels, graph_id=DEFAULT_GRAPH_ID, branch_id=DEFAULT_BRANCH_ID).consume()

    query_rels_branches = """
    MATCH (s:Concept)-[r]->(t:Concept)
    WHERE r.on_branches IS NULL
    SET r.on_branches = [$branch_id]
    RETURN count(r) AS updated
    """
    session.run(query_rels_branches, branch_id=DEFAULT_BRANCH_ID).consume()

    # Backfill Resources that aren't scoped.
    session.run(
        """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MATCH (r:Resource)
        WHERE r.graph_id IS NULL OR NOT (r)-[:BELONGS_TO]->(:GraphSpace)
        MERGE (r)-[:BELONGS_TO]->(g)
        SET r.graph_id = $graph_id
        """,
        graph_id=DEFAULT_GRAPH_ID,
    ).consume()

    # Backfill HAS_RESOURCE relationship scoping.
    session.run(
        """
        MATCH (c:Concept)-[rel:HAS_RESOURCE]->(r:Resource)
        WHERE rel.graph_id IS NULL
        SET rel.graph_id = COALESCE(c.graph_id, $graph_id),
            rel.on_branches = COALESCE(rel.on_branches, [$branch_id])
        """,
        graph_id=DEFAULT_GRAPH_ID,
        branch_id=DEFAULT_BRANCH_ID,
    ).consume()

    _SCOPING_INITIALIZED = True
