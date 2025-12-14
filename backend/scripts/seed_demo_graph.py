"""
Operator-only script (NOT an API endpoint):
Seed/refresh the curated demo dataset into Neo4j Aura (or any Neo4j).

Design goals:
- Safe by default (requires explicit confirmation)
- Repeatable (idempotent-ish via demo tenant namespace)
- Fast hot-swap (point to a new dataset version and run again)

Expected dataset inputs:
- nodes CSV: node_id,name,domain[,type][,description] (extra columns ignored)
- edges CSV: source_id,target_id,(predicate|type) (extra columns ignored)

This script intentionally does not touch Notion/OpenAI.
"""

import argparse
import csv
import os
import sys
from pathlib import Path
from typing import Dict, Iterable, Tuple

from neo4j import GraphDatabase  # type: ignore


def _require_confirm() -> None:
    if os.getenv("DEMO_SEED_CONFIRM", "") != "YES":
        raise SystemExit(
            "Refusing to run. Set DEMO_SEED_CONFIRM=YES to confirm you want to modify the target Neo4j database."
        )


def _read_csv(path: Path) -> Iterable[Dict[str, str]]:
    with path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        yield from reader


def _seed_nodes(tx, graph_id: str, rows: Iterable[Dict[str, str]]) -> None:
    # Ensure GraphSpace exists
    tx.run(
        """
        MERGE (g:GraphSpace {graph_id: $graph_id})
        ON CREATE SET g.name = $graph_id,
                      g.created_at = datetime(),
                      g.updated_at = datetime()
        """,
        graph_id=graph_id,
    )
    
    # Ensure Main branch exists
    tx.run(
        """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MERGE (b:Branch {graph_id: $graph_id, branch_id: 'main'})
        ON CREATE SET b.name = 'Main',
                      b.created_at = datetime(),
                      b.updated_at = datetime()
        """,
        graph_id=graph_id,
    )
    
    for r in rows:
        node_id = (r.get("node_id") or "").strip()
        if not node_id:
            continue
        # Create concept and link to GraphSpace
        tx.run(
            """
            MATCH (g:GraphSpace {graph_id: $graph_id})
            MERGE (c:Concept {node_id: $node_id})
            SET c.name = $name,
                c.description = $description,
                c.domain = $domain,
                c.type = $type,
                c.graph_id = $graph_id,
                c.on_branches = ['main']
            MERGE (c)-[:BELONGS_TO]->(g)
            """,
            graph_id=graph_id,
            node_id=node_id,
            name=(r.get("name") or "").strip(),
            description=(r.get("description") or "").strip(),
            domain=(r.get("domain") or "").strip(),
            type=(r.get("type") or "").strip(),
        )


def _seed_edges(tx, graph_id: str, rows: Iterable[Dict[str, str]]) -> None:
    for r in rows:
        s = (r.get("source_id") or "").strip()
        t = (r.get("target_id") or "").strip()
        rel_type = (r.get("predicate") or r.get("type") or "RELATED_TO").strip().upper()
        if not s or not t:
            continue
        # Relationship type cannot be parameterized in Cypher; validate + interpolate safely.
        if not rel_type.replace("_", "").isalnum():
            raise ValueError(f"Invalid relationship type: {rel_type}")
        tx.run(
            f"""
            MATCH (a:Concept {{node_id:$s, graph_id:$graph_id}})
            MATCH (b:Concept {{node_id:$t, graph_id:$graph_id}})
            MERGE (a)-[r:{rel_type}]->(b)
            SET r.graph_id = $graph_id,
                r.on_branches = ['main']
            """,
            graph_id=graph_id,
            s=s,
            t=t,
        )


def _delete_demo_graph(tx, graph_id: str) -> None:
    # Delete all concepts in the demo graph
    tx.run(
        """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        OPTIONAL MATCH (c:Concept)-[:BELONGS_TO]->(g)
        DETACH DELETE c
        WITH g
        OPTIONAL MATCH (b:Branch {graph_id: $graph_id})
        DETACH DELETE b
        WITH g
        DETACH DELETE g
        """,
        graph_id=graph_id,
    )


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--neo4j-uri", default=os.getenv("NEO4J_URI", "bolt://localhost:7687"))
    parser.add_argument("--neo4j-user", default=os.getenv("NEO4J_USER", "neo4j"))
    parser.add_argument("--neo4j-password", default=os.getenv("NEO4J_PASSWORD", ""))
    parser.add_argument("--graph-id", default=os.getenv("DEMO_GRAPH_ID", "demo"))
    # Defaults point to curated demo dataset outputs (safe). You can override explicitly.
    # graph/ folder is at repo root, so go up from backend/scripts/ to find it
    # __file__ is: backend/scripts/seed_demo_graph.py
    # parent is: backend/scripts
    # parent.parent is: backend
    # parent.parent.parent is: repo root (brain-web)
    script_file = Path(__file__).resolve()
    repo_root = script_file.parent.parent.parent
    graph_dir = repo_root / "graph"
    default_nodes = str(graph_dir / "demo_nodes.csv")
    default_edges = str(graph_dir / "demo_edges.csv")
    parser.add_argument("--nodes", default=default_nodes)
    parser.add_argument("--edges", default=default_edges)
    parser.add_argument("--reset", action="store_true", help="Delete all existing nodes in this graph_id first.")
    args = parser.parse_args(list(argv) if argv is not None else None)

    if not args.neo4j_password:
        print("NEO4J_PASSWORD is required", file=sys.stderr)
        return 2

    _require_confirm()

    nodes_path = Path(args.nodes)
    edges_path = Path(args.edges)
    if not nodes_path.exists():
        print(f"Nodes CSV not found: {nodes_path}", file=sys.stderr)
        return 2
    if not edges_path.exists():
        print(f"Edges CSV not found: {edges_path}", file=sys.stderr)
        return 2

    driver = GraphDatabase.driver(args.neo4j_uri, auth=(args.neo4j_user, args.neo4j_password))
    with driver:
        with driver.session() as session:
            if args.reset:
                session.execute_write(_delete_demo_graph, args.graph_id)
            session.execute_write(_seed_nodes, args.graph_id, _read_csv(nodes_path))
            session.execute_write(_seed_edges, args.graph_id, _read_csv(edges_path))

    print(f"Seed complete for graph_id={args.graph_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


