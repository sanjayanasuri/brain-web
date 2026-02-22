from __future__ import annotations

import datetime
from typing import Any, Dict, List, Tuple
from uuid import uuid4

from neo4j import Session

from services_branch_explorer import get_active_graph_context, ensure_graph_scoping_initialized, ensure_branch_exists


def _now_iso() -> str:
    return datetime.datetime.utcnow().replace(tzinfo=datetime.timezone.utc).isoformat()


def list_branches(session: Session, *, tenant_id: str, user_id: str) -> List[Dict[str, Any]]:
    graph_id, _ = get_active_graph_context(session, tenant_id=tenant_id, user_id=user_id)
    ensure_graph_scoping_initialized(session)

    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id, tenant_id: $tenant_id})
    MATCH (b:Branch {graph_id: $graph_id})-[:BRANCH_OF]->(g)
    RETURN b
    ORDER BY b.created_at ASC
    """
    out: List[Dict[str, Any]] = []
    for rec in session.run(query, graph_id=graph_id, tenant_id=tenant_id):
        b = rec["b"]
        out.append(
            {
                "branch_id": b.get("branch_id"),
                "graph_id": b.get("graph_id"),
                "name": b.get("name"),
                "created_at": b.get("created_at"),
                "updated_at": b.get("updated_at"),
                "source_node_id": b.get("source_node_id"),
            }
        )
    return out


def create_branch(session: Session, name: str, *, tenant_id: str, user_id: str) -> Dict[str, Any]:
    graph_id, _ = get_active_graph_context(session, tenant_id=tenant_id, user_id=user_id)
    ensure_graph_scoping_initialized(session)

    branch_id = f"B{uuid4().hex[:8].upper()}"

    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id, tenant_id: $tenant_id})
    CREATE (b:Branch {
      branch_id: $branch_id,
      graph_id: $graph_id,
      name: $name,
      created_at: $now,
      updated_at: $now
    })
    CREATE (b)-[:BRANCH_OF]->(g)
    RETURN b
    """

    rec = session.run(
        query,
        graph_id=graph_id,
        branch_id=branch_id,
        name=name,
        now=_now_iso(),
        tenant_id=tenant_id,
    ).single()
    b = rec["b"]
    return {
        "branch_id": b.get("branch_id"),
        "graph_id": b.get("graph_id"),
        "name": b.get("name"),
        "created_at": b.get("created_at"),
        "updated_at": b.get("updated_at"),
        "source_node_id": b.get("source_node_id"),
    }


def fork_branch_from_node(
    session: Session,
    branch_id: str,
    node_id: str,
    depth: int = 2,
    *,
    tenant_id: str,
    user_id: str,
) -> Dict[str, Any]:
    """Fork by labeling nodes/edges within N hops as belonging to the branch.

    This is an MVP implementation: it does not duplicate nodes; it scopes branch views via `on_branches` arrays.
    """
    graph_id, _ = get_active_graph_context(session, tenant_id=tenant_id, user_id=user_id)
    ensure_graph_scoping_initialized(session)

    ensure_branch_exists(session, graph_id, branch_id)

    # Store origin.
    session.run(
        """
        MATCH (b:Branch {graph_id: $graph_id, branch_id: $branch_id})
        SET b.source_node_id = $node_id,
            b.updated_at = $now
        """,
        graph_id=graph_id,
        branch_id=branch_id,
        node_id=node_id,
        now=_now_iso(),
    ).consume()

    # Expand from node within the current graph and mark nodes/relationships.
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id, tenant_id: $tenant_id})
    MATCH (start:Concept {node_id: $node_id})-[:BELONGS_TO]->(g)
    CALL {
      WITH start, g
      MATCH p=(start)-[*0..$depth]-(n:Concept)-[:BELONGS_TO]->(g)
      WITH collect(DISTINCT n) AS nodes, collect(DISTINCT relationships(p)) AS rel_lists
      RETURN nodes, rel_lists
    }
    WITH nodes, reduce(acc = [], rs IN rel_lists | acc + rs) AS rels
    FOREACH (n IN nodes |
      SET n.on_branches = CASE
        WHEN n.on_branches IS NULL THEN [$branch_id]
        WHEN $branch_id IN n.on_branches THEN n.on_branches
        ELSE n.on_branches + $branch_id
      END
    )
    FOREACH (r IN rels |
      SET r.graph_id = COALESCE(r.graph_id, $graph_id),
          r.on_branches = CASE
            WHEN r.on_branches IS NULL THEN [$branch_id]
            WHEN $branch_id IN r.on_branches THEN r.on_branches
            ELSE r.on_branches + $branch_id
          END
    )
    RETURN size(nodes) AS nodes_tagged, size(rels) AS rels_tagged
    """

    rec = session.run(
        query,
        graph_id=graph_id,
        branch_id=branch_id,
        node_id=node_id,
        depth=max(0, min(depth, 6)),
        tenant_id=tenant_id,
    ).single()
    return {
        "graph_id": graph_id,
        "branch_id": branch_id,
        "source_node_id": node_id,
        "depth": depth,
        "nodes_tagged": rec["nodes_tagged"] if rec else 0,
        "rels_tagged": rec["rels_tagged"] if rec else 0,
    }


def get_branch_graph(session: Session, branch_id: str, *, tenant_id: str, user_id: str) -> Dict[str, Any]:
    graph_id, _ = get_active_graph_context(session, tenant_id=tenant_id, user_id=user_id)
    ensure_graph_scoping_initialized(session)

    # Nodes
    nodes_query = """
    MATCH (g:GraphSpace {graph_id: $graph_id, tenant_id: $tenant_id})
    MATCH (c:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
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
    ORDER BY c.node_id
    """

    # Links
    links_query = """
    MATCH (g:GraphSpace {graph_id: $graph_id, tenant_id: $tenant_id})
    MATCH (s:Concept)-[:BELONGS_TO]->(g)
    MATCH (t:Concept)-[:BELONGS_TO]->(g)
    MATCH (s)-[r]->(t)
    WHERE r.graph_id = $graph_id
      AND $branch_id IN COALESCE(r.on_branches, [])
      AND $branch_id IN COALESCE(s.on_branches, [])
      AND $branch_id IN COALESCE(t.on_branches, [])
    RETURN s.node_id AS source_id,
           t.node_id AS target_id,
           type(r) AS predicate
    """

    nodes = [
        dict(rec.data())
        for rec in session.run(nodes_query, graph_id=graph_id, branch_id=branch_id, tenant_id=tenant_id)
    ]
    links = [
        dict(rec.data())
        for rec in session.run(links_query, graph_id=graph_id, branch_id=branch_id, tenant_id=tenant_id)
    ]

    return {"graph_id": graph_id, "branch_id": branch_id, "nodes": nodes, "links": links}


def compare_branches(
    session: Session,
    branch_id: str,
    other_branch_id: str,
    *,
    tenant_id: str,
    user_id: str,
) -> Dict[str, Any]:
    a = get_branch_graph(session, branch_id, tenant_id=tenant_id, user_id=user_id)
    b = get_branch_graph(session, other_branch_id, tenant_id=tenant_id, user_id=user_id)

    a_nodes = {n["node_id"] for n in a["nodes"]}
    b_nodes = {n["node_id"] for n in b["nodes"]}

    def link_key(link: Dict[str, Any]) -> Tuple[str, str, str]:
        return (link["source_id"], link["predicate"], link["target_id"])

    a_links = {link_key(l) for l in a["links"]}
    b_links = {link_key(l) for l in b["links"]}

    only_a_links = [
        {"source_id": s, "predicate": p, "target_id": t}
        for (s, p, t) in sorted(a_links - b_links)
    ]
    only_b_links = [
        {"source_id": s, "predicate": p, "target_id": t}
        for (s, p, t) in sorted(b_links - a_links)
    ]

    return {
        "graph_id": a["graph_id"],
        "branch_id": branch_id,
        "other_branch_id": other_branch_id,
        "node_ids_only_in_branch": sorted(a_nodes - b_nodes),
        "node_ids_only_in_other": sorted(b_nodes - a_nodes),
        "links_only_in_branch": only_a_links,
        "links_only_in_other": only_b_links,
    }
