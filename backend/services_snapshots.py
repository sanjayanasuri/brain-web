from __future__ import annotations

import datetime
import json
from typing import Any, Dict, List, Optional
from uuid import uuid4

from neo4j import Session

from services_branch_explorer import get_active_graph_context, ensure_graph_scoping_initialized, ensure_branch_exists


def _now_iso() -> str:
    return datetime.datetime.utcnow().replace(tzinfo=datetime.timezone.utc).isoformat()


def _snapshot_id() -> str:
    return f"S{uuid4().hex[:10].upper()}"


def create_snapshot(
    session: Session,
    *,
    name: str,
    focused_node_id: Optional[str] = None,
    layout: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    graph_id, branch_id = get_active_graph_context(session)
    ensure_graph_scoping_initialized(session)

    # Snapshot payload = graph data for the active graph + branch.
    nodes_query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (c:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
    RETURN properties(c) AS props
    """

    links_query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (s:Concept)-[:BELONGS_TO]->(g)
    MATCH (t:Concept)-[:BELONGS_TO]->(g)
    MATCH (s)-[r]->(t)
    WHERE r.graph_id = $graph_id
      AND $branch_id IN COALESCE(r.on_branches, [])
      AND $branch_id IN COALESCE(s.on_branches, [])
      AND $branch_id IN COALESCE(t.on_branches, [])
    RETURN {
      source_id: s.node_id,
      target_id: t.node_id,
      predicate: type(r)
    } AS link
    """

    nodes = [rec["props"] for rec in session.run(nodes_query, graph_id=graph_id, branch_id=branch_id)]
    links = [rec["link"] for rec in session.run(links_query, graph_id=graph_id, branch_id=branch_id)]

    payload = {
        "graph_id": graph_id,
        "branch_id": branch_id,
        "focused_node_id": focused_node_id,
        "nodes": nodes,
        "links": links,
        "layout": layout or None,
    }

    sid = _snapshot_id()
    query = """
    CREATE (s:Snapshot {
      snapshot_id: $snapshot_id,
      graph_id: $graph_id,
      branch_id: $branch_id,
      name: $name,
      created_at: $now,
      focused_node_id: $focused_node_id,
      payload_json: $payload_json
    })
    RETURN s
    """

    rec = session.run(
        query,
        snapshot_id=sid,
        graph_id=graph_id,
        branch_id=branch_id,
        name=name,
        now=_now_iso(),
        focused_node_id=focused_node_id,
        payload_json=json.dumps(payload),
    ).single()

    s = rec["s"]
    return {
        "snapshot_id": s.get("snapshot_id"),
        "graph_id": s.get("graph_id"),
        "branch_id": s.get("branch_id"),
        "name": s.get("name"),
        "created_at": s.get("created_at"),
        "focused_node_id": s.get("focused_node_id"),
    }


def list_snapshots(session: Session, limit: int = 50) -> List[Dict[str, Any]]:
    graph_id, branch_id = get_active_graph_context(session)
    ensure_graph_scoping_initialized(session)

    query = """
    MATCH (s:Snapshot {graph_id: $graph_id, branch_id: $branch_id})
    RETURN s
    ORDER BY s.created_at DESC
    LIMIT $limit
    """
    out: List[Dict[str, Any]] = []
    for rec in session.run(query, graph_id=graph_id, branch_id=branch_id, limit=limit):
        s = rec["s"]
        out.append(
            {
                "snapshot_id": s.get("snapshot_id"),
                "graph_id": s.get("graph_id"),
                "branch_id": s.get("branch_id"),
                "name": s.get("name"),
                "created_at": s.get("created_at"),
                "focused_node_id": s.get("focused_node_id"),
            }
        )
    return out


def restore_snapshot(session: Session, snapshot_id: str) -> Dict[str, Any]:
    """Safe restore semantics (MVP):

    - Does NOT delete existing graph data.
    - Creates a new branch and tags the snapshot's nodes/links onto that branch.

    This gives you a true "restore" experience without risking data loss.
    """
    ensure_graph_scoping_initialized(session)

    snap_rec = session.run(
        """
        MATCH (s:Snapshot {snapshot_id: $snapshot_id})
        RETURN s
        """,
        snapshot_id=snapshot_id,
    ).single()
    if not snap_rec:
        raise ValueError("Snapshot not found")

    s = snap_rec["s"]
    graph_id = s.get("graph_id")
    source_branch_id = s.get("branch_id")
    payload_json = s.get("payload_json")
    if not payload_json:
        raise ValueError("Snapshot payload missing")

    payload = json.loads(payload_json)

    restored_branch_id = f"restore_{snapshot_id.lower()}"
    ensure_branch_exists(session, graph_id, restored_branch_id, name=f"Restored: {s.get('name')}")

    # Tag nodes and relationships from payload onto restored branch.
    node_ids = [n.get("node_id") for n in payload.get("nodes", []) if isinstance(n, dict) and n.get("node_id")]

    if node_ids:
        session.run(
            """
            MATCH (g:GraphSpace {graph_id: $graph_id})
            MATCH (c:Concept)-[:BELONGS_TO]->(g)
            WHERE c.node_id IN $node_ids
            SET c.on_branches = CASE
              WHEN c.on_branches IS NULL THEN [$branch_id]
              WHEN $branch_id IN c.on_branches THEN c.on_branches
              ELSE c.on_branches + $branch_id
            END
            """,
            graph_id=graph_id,
            node_ids=node_ids,
            branch_id=restored_branch_id,
        ).consume()

        session.run(
            """
            MATCH (g:GraphSpace {graph_id: $graph_id})
            MATCH (s:Concept)-[:BELONGS_TO]->(g)
            MATCH (t:Concept)-[:BELONGS_TO]->(g)
            MATCH (s)-[r]->(t)
            WHERE r.graph_id = $graph_id
              AND s.node_id IN $node_ids
              AND t.node_id IN $node_ids
            SET r.on_branches = CASE
              WHEN r.on_branches IS NULL THEN [$branch_id]
              WHEN $branch_id IN r.on_branches THEN r.on_branches
              ELSE r.on_branches + $branch_id
            END
            """,
            graph_id=graph_id,
            node_ids=node_ids,
            branch_id=restored_branch_id,
        ).consume()

    return {
        "status": "ok",
        "graph_id": graph_id,
        "snapshot_id": snapshot_id,
        "restored_branch_id": restored_branch_id,
        "source_branch_id": source_branch_id,
    }
