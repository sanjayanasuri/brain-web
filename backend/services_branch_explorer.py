from __future__ import annotations

import datetime
import json
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from neo4j import Session
from config import DEMO_MODE, DEMO_ALLOW_WRITES, DEMO_GRAPH_ID


DEFAULT_GRAPH_ID = "default"
DEFAULT_BRANCH_ID = "main"

# Best-effort schema init (constraints/migrations). We keep this here because
# this module is already the "graph/branch context" entry point used by most
# graph operations.
_SCHEMA_INITIALIZED = False


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

        # Create constraints if missing (by schema, not by name).
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

        _SCHEMA_INITIALIZED = True
    except Exception:
        # Best-effort only. If Neo4j is temporarily unavailable or the user
        # doesn't have permissions to manage constraints, we don't want to break
        # core reads/writes; the request will fail later with a clearer error.
        return


def _now_iso() -> str:
    return datetime.datetime.utcnow().replace(tzinfo=datetime.timezone.utc).isoformat()


def ensure_graphspace_exists(session: Session, graph_id: str, name: Optional[str] = None) -> Dict[str, Any]:
    """Ensure a GraphSpace exists; returns its properties."""
    # In read-only demo mode, just check if it exists
    if DEMO_MODE and not DEMO_ALLOW_WRITES:
        query = """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        RETURN g
        """
        rec = session.run(query, graph_id=graph_id).single()
        if rec:
            g = rec["g"]
            return {
                "graph_id": g.get("graph_id"),
                "name": g.get("name"),
                "created_at": g.get("created_at"),
                "updated_at": g.get("updated_at"),
            }
        # If it doesn't exist in read-only mode, return defaults
        return {
            "graph_id": graph_id,
            "name": name or graph_id,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        }
    
    query = """
    MERGE (g:GraphSpace {graph_id: $graph_id})
    ON CREATE SET g.name = COALESCE($name, $graph_id),
                  g.created_at = $now,
                  g.updated_at = $now
    ON MATCH SET g.updated_at = $now
    RETURN g
    """
    rec = session.run(query, graph_id=graph_id, name=name, now=_now_iso()).single()
    g = rec["g"]
    return {
        "graph_id": g.get("graph_id"),
        "name": g.get("name"),
        "created_at": g.get("created_at"),
        "updated_at": g.get("updated_at"),
    }


def ensure_branch_exists(session: Session, graph_id: str, branch_id: str, name: Optional[str] = None) -> Dict[str, Any]:
    """Ensure a Branch exists for a GraphSpace."""
    # In read-only demo mode, just check if it exists
    if DEMO_MODE and not DEMO_ALLOW_WRITES:
        query = """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MATCH (b:Branch {branch_id: $branch_id, graph_id: $graph_id})
        RETURN b
        """
        rec = session.run(query, graph_id=graph_id, branch_id=branch_id).single()
        if rec:
            b = rec["b"]
            return {
                "branch_id": b.get("branch_id"),
                "graph_id": b.get("graph_id"),
                "name": b.get("name"),
                "created_at": b.get("created_at"),
                "updated_at": b.get("updated_at"),
            }
        # If it doesn't exist in read-only mode, return defaults
        return {
            "branch_id": branch_id,
            "graph_id": graph_id,
            "name": name or branch_id,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        }
    
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
    # In demo mode, ensure demo graph exists instead of default
    if DEMO_MODE:
        graph_id = DEMO_GRAPH_ID
        ensure_graphspace_exists(session, graph_id, name="Demo")
        ensure_branch_exists(session, graph_id, DEFAULT_BRANCH_ID, name="Main")
        return graph_id, DEFAULT_BRANCH_ID
    ensure_graphspace_exists(session, DEFAULT_GRAPH_ID, name="Default")
    ensure_branch_exists(session, DEFAULT_GRAPH_ID, DEFAULT_BRANCH_ID, name="Main")
    return DEFAULT_GRAPH_ID, DEFAULT_BRANCH_ID


def _get_user_learning_prefs(session: Session) -> Dict[str, Any]:
    # In read-only demo mode, just read if it exists
    if DEMO_MODE and not DEMO_ALLOW_WRITES:
        query = """
        MATCH (u:UserProfile {id: 'default'})
        RETURN u.learning_preferences AS learning_preferences
        """
        rec = session.run(query).single()
        if rec:
            lp = rec["learning_preferences"]
            if isinstance(lp, str):
                try:
                    return json.loads(lp)
                except Exception:
                    return {}
            if isinstance(lp, dict):
                return lp
        return {}
    
    query = """
    MERGE (u:UserProfile {id: 'default'})
    ON CREATE SET u.name = 'Sanjay',
                  u.background = [],
                  u.interests = [],
                  u.weak_spots = [],
                  u.learning_preferences = $empty_json
    RETURN u.learning_preferences AS learning_preferences
    """
    empty_json = json.dumps({})
    rec = session.run(query, empty_json=empty_json).single()
    lp = rec["learning_preferences"] if rec else "{}"
    if isinstance(lp, str):
        try:
            return json.loads(lp)
        except Exception:
            return {}
    if isinstance(lp, dict):
        return lp
    return {}


def _set_user_learning_prefs(session: Session, prefs: Dict[str, Any]) -> None:
    query = """
    MERGE (u:UserProfile {id: 'default'})
    SET u.learning_preferences = $learning_preferences
    RETURN u
    """
    session.run(query, learning_preferences=json.dumps(prefs)).consume()


def get_active_graph_context(session: Session) -> Tuple[str, str]:
    """Returns (graph_id, branch_id). Ensures defaults exist."""
    ensure_default_context(session)

    # In demo mode, force demo graph_id to isolate from personal data
    if DEMO_MODE:
        graph_id = DEMO_GRAPH_ID
        branch_id = DEFAULT_BRANCH_ID
    else:
        prefs = _get_user_learning_prefs(session)
        graph_id = prefs.get("active_graph_id") or DEFAULT_GRAPH_ID
        branch_id = prefs.get("active_branch_id") or DEFAULT_BRANCH_ID


    ensure_graphspace_exists(session, graph_id)
    ensure_branch_exists(session, graph_id, branch_id)

    return graph_id, branch_id


def set_active_graph(session: Session, graph_id: str) -> Tuple[str, str]:
    ensure_schema_constraints(session)
    ensure_graphspace_exists(session, graph_id)
    # When switching graphs, default to its main branch.
    ensure_branch_exists(session, graph_id, DEFAULT_BRANCH_ID, name="Main")

    prefs = _get_user_learning_prefs(session)
    prefs["active_graph_id"] = graph_id
    prefs["active_branch_id"] = DEFAULT_BRANCH_ID
    _set_user_learning_prefs(session, prefs)

    return graph_id, DEFAULT_BRANCH_ID


def set_active_branch(session: Session, branch_id: str) -> Tuple[str, str]:
    graph_id, _ = get_active_graph_context(session)
    ensure_schema_constraints(session)
    ensure_branch_exists(session, graph_id, branch_id)

    prefs = _get_user_learning_prefs(session)
    prefs["active_graph_id"] = graph_id
    prefs["active_branch_id"] = branch_id
    _set_user_learning_prefs(session, prefs)

    return graph_id, branch_id


def list_graphs(session: Session) -> List[Dict[str, Any]]:
    ensure_default_context(session)
    query = """
    MATCH (g:GraphSpace)
    OPTIONAL MATCH (c:Concept)-[:BELONGS_TO]->(g)
    OPTIONAL MATCH (s:Concept)-[r]->(t:Concept)
    WHERE r.graph_id = g.graph_id
    WITH g, 
         count(DISTINCT c) AS node_count,
         count(DISTINCT r) AS edge_count
    RETURN g, node_count, edge_count
    ORDER BY g.created_at ASC
    """
    out: List[Dict[str, Any]] = []
    for rec in session.run(query):
        g = rec["g"]
        node_count = rec["node_count"] or 0
        edge_count = rec["edge_count"] or 0
        # Convert Neo4j DateTime objects to ISO format strings
        created_at = g.get("created_at")
        updated_at = g.get("updated_at")
        # Neo4j DateTime objects can be converted using to_native() or str()
        if created_at:
            if hasattr(created_at, 'to_native'):
                # Convert Neo4j DateTime to Python datetime, then to ISO string
                created_at = created_at.to_native().isoformat()
            else:
                created_at = str(created_at)
        if updated_at:
            if hasattr(updated_at, 'to_native'):
                # Convert Neo4j DateTime to Python datetime, then to ISO string
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
            }
        )
    return out


def create_graph(session: Session, name: str) -> Dict[str, Any]:
    ensure_schema_constraints(session)
    graph_id = f"G{uuid4().hex[:8].upper()}"
    g = ensure_graphspace_exists(session, graph_id, name=name)
    ensure_branch_exists(session, graph_id, DEFAULT_BRANCH_ID, name="Main")
    return g


def rename_graph(session: Session, graph_id: str, name: str) -> Dict[str, Any]:
    ensure_schema_constraints(session)
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    SET g.name = $name,
        g.updated_at = $now
    RETURN g
    """
    rec = session.run(query, graph_id=graph_id, name=name, now=_now_iso()).single()
    if not rec:
        raise ValueError("Graph not found")
    g = rec["g"]
    return {
        "graph_id": g.get("graph_id"),
        "name": g.get("name"),
        "created_at": g.get("created_at"),
        "updated_at": g.get("updated_at"),
    }


def delete_graph(session: Session, graph_id: str) -> None:
    ensure_schema_constraints(session)
    if graph_id == DEFAULT_GRAPH_ID:
        raise ValueError("Cannot delete default graph")

    # Delete concepts in this graph; relationships between them are removed by DETACH.
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    OPTIONAL MATCH (c:Concept)-[:BELONGS_TO]->(g)
    DETACH DELETE c
    WITH g
    OPTIONAL MATCH (b:Branch {graph_id: $graph_id})
    DETACH DELETE b
    WITH g
    OPTIONAL MATCH (s:Snapshot {graph_id: $graph_id})
    DETACH DELETE s
    WITH g
    DETACH DELETE g
    """
    session.run(query, graph_id=graph_id).consume()


def ensure_graph_scoping_initialized(session: Session) -> None:
    """Backfill legacy data into the default graph and main branch.

    This is intentionally conservative:
    - Only touches Concepts that do not already belong to a GraphSpace
    - Only touches relationships that do not already have graph_id/on_branches
    """
    # Skip write operations in read-only demo mode
    if DEMO_MODE and not DEMO_ALLOW_WRITES:
        # Just ensure default context exists (read-only check)
        try:
            ensure_default_context(session)
        except Exception:
            # If it doesn't exist, that's okay in read-only mode
            pass
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
