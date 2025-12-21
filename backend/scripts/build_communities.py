#!/usr/bin/env python3
"""
Build communities using Leiden community detection on concept-to-concept edges.

Usage:
    python backend/scripts/build_communities.py --graph-id <graph_id> --branch-id <branch_id> --build-version v1 [--resolution 0.6] [--unweighted]
"""
import argparse
import hashlib
from pathlib import Path
from typing import List, Dict, Any

# Add parent directory to path for imports
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from neo4j import Session
from db_neo4j import get_driver
from services_graph import upsert_community, set_concept_community_memberships
from services_branch_explorer import ensure_graph_scoping_initialized, ensure_graphspace_exists, ensure_branch_exists

# Relationship weight mapping
REL_WEIGHTS = {
    "PREREQUISITE_FOR": 2.0,
    "DEPENDS_ON": 2.0,
    "BUILDS_ON": 1.5,
    "IMPLEMENTS": 1.2,
    "RELATED_TO": 1.0,
}
DEFAULT_REL_WEIGHT = 1.0


def fetch_concepts(session: Session, graph_id: str) -> Dict[str, Dict[str, Any]]:
    """
    Fetch all concept nodes for a given graph_id.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID
    
    Returns:
        Dict mapping node_id to concept dict with node_id and name
    """
    query = """
    MATCH (c:Concept {graph_id: $graph_id})
    RETURN c.node_id AS node_id, c.name AS name
    """
    rows = session.run(query, graph_id=graph_id)
    concepts = {}
    for r in rows:
        concepts[r["node_id"]] = {"node_id": r["node_id"], "name": r["name"]}
    return concepts


def fetch_concept_edges(session: Session, graph_id: str) -> List[Dict[str, str]]:
    """
    Fetch all concept-to-concept edges (excluding BELONGS_TO relationships).
    Treats edges as undirected.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID
    
    Returns:
        List of edge dicts with src, dst, and rel fields
    """
    query = """
    MATCH (a:Concept {graph_id: $graph_id})-[r]->(b:Concept {graph_id: $graph_id})
    WHERE type(r) <> "BELONGS_TO"
    RETURN a.node_id AS src, b.node_id AS dst, type(r) AS rel
    """
    rows = session.run(query, graph_id=graph_id)
    edges = []
    for r in rows:
        src = r["src"]
        dst = r["dst"]
        if not src or not dst or src == dst:
            continue
        edges.append({"src": src, "dst": dst, "rel": r["rel"]})
    return edges


def build_igraph(concepts: Dict[str, Dict[str, Any]], edges: List[Dict[str, str]]):
    """
    Build an igraph Graph from concepts and edges.
    
    Args:
        concepts: Dict mapping node_id to concept dict
        edges: List of edge dicts with src, dst, rel
    
    Returns:
        Tuple of (igraph Graph, list of node_ids in order)
    """
    import igraph as ig
    
    node_ids = list(concepts.keys())
    id_to_idx = {nid: i for i, nid in enumerate(node_ids)}
    
    # Undirected edge deduplication
    seen = set()
    ig_edges = []
    weights = []
    
    for e in edges:
        s = e["src"]
        d = e["dst"]
        if s not in id_to_idx or d not in id_to_idx:
            continue
        a = id_to_idx[s]
        b = id_to_idx[d]
        u, v = (a, b) if a < b else (b, a)
        key = (u, v, e["rel"])  # Keep rel in key so multi-typed edges can add weight
        if key in seen:
            continue
        seen.add(key)
        ig_edges.append((u, v))
        w = REL_WEIGHTS.get(e["rel"], DEFAULT_REL_WEIGHT)
        weights.append(float(w))
    
    g = ig.Graph()
    g.add_vertices(len(node_ids))
    if ig_edges:
        g.add_edges(ig_edges)
        g.es["weight"] = weights
    return g, node_ids


def deterministic_community_id(graph_id: str, build_version: str, member_node_ids: List[str]) -> str:
    """
    Generate a deterministic community ID based on membership.
    Stable across runs when memberships are stable.
    
    Args:
        graph_id: Graph ID
        build_version: Build version
        member_node_ids: List of concept node_ids in the community
    
    Returns:
        Community ID string
    """
    sample = ",".join(sorted(member_node_ids)[:50])
    h = hashlib.sha256(f"{graph_id}|{build_version}|{sample}".encode()).hexdigest()[:16]
    return f"COMM_{h.upper()}"


def community_name_from_subgraph(g, node_ids: List[str], member_indices: List[int], concepts: Dict[str, Dict[str, Any]]) -> str:
    """
    Generate community name from top concepts by degree in the subgraph.
    
    Args:
        g: igraph Graph
        node_ids: List of node_ids in order of graph vertices
        member_indices: List of vertex indices in the community
        concepts: Dict mapping node_id to concept dict
    
    Returns:
        Community name string
    """
    if not member_indices:
        return "Community"
    
    sub = g.subgraph(member_indices)
    deg = sub.degree()
    # Map back to original vertex index -> degree
    pairs = list(zip(member_indices, deg))
    pairs.sort(key=lambda x: x[1], reverse=True)
    top = pairs[:3]
    top_names = []
    for vidx, _ in top:
        nid = node_ids[vidx]
        top_names.append(concepts[nid]["name"])
    return ", ".join(top_names) if top_names else "Community"


def build_communities(
    session: Session,
    graph_id: str,
    branch_id: str,
    build_version: str,
    resolution: float = 0.6,
    unweighted: bool = False
) -> None:
    """
    Build communities using Leiden community detection on concept-to-concept edges.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID
        branch_id: Branch ID
        build_version: Build version identifier
        resolution: Resolution parameter for Leiden algorithm (default 0.6)
        unweighted: If True, ignore edge weights
    """
    print(f"[Build Communities] Starting community build for graph_id={graph_id}, branch_id={branch_id}, version={build_version}")
    print(f"[Build Communities] Resolution={resolution}, Unweighted={unweighted}")
    
    # Ensure graph and branch exist
    ensure_graphspace_exists(session, graph_id)
    ensure_branch_exists(session, graph_id, branch_id)
    ensure_graph_scoping_initialized(session)
    
    # Fetch concepts and edges
    concepts = fetch_concepts(session, graph_id)
    print(f"[Build Communities] Found {len(concepts)} concepts")
    
    edges = fetch_concept_edges(session, graph_id)
    print(f"[Build Communities] Found {len(edges)} concept-to-concept edges")
    
    if len(concepts) == 0:
        print(f"[Build Communities] No concepts found, exiting")
        return
    
    # Handle empty edges case: create one community with all concepts
    if len(edges) == 0:
        print(f"[Build Communities] No edges found, creating single community with all concepts")
        member_node_ids = list(concepts.keys())
        community_id = deterministic_community_id(graph_id, build_version, member_node_ids)
        community_name = ", ".join([concepts[nid]["name"] for nid in member_node_ids[:3]])
        
        try:
            upsert_community(
                session=session,
                graph_id=graph_id,
                community_id=community_id,
                name=community_name,
                summary=None,
                summary_embedding=None,
                build_version=build_version
            )
            set_concept_community_memberships(
                session=session,
                graph_id=graph_id,
                community_id=community_id,
                concept_node_ids=member_node_ids
            )
            print(f"[Build Communities] Created single community: {community_name} ({community_id}) with {len(member_node_ids)} concepts")
        except Exception as e:
            print(f"[Build Communities] ERROR: Failed to create community: {e}")
        return
    
    # Build igraph and run Leiden
    try:
        import igraph as ig
        import leidenalg
    except ImportError as e:
        print(f"[Build Communities] ERROR: Required packages not installed: {e}")
        print("[Build Communities] Install with: pip install python-igraph leidenalg")
        return
    
    print(f"[Build Communities] Building igraph graph...")
    g, node_ids = build_igraph(concepts, edges)
    
    print(f"[Build Communities] Running Leiden community detection...")
    partition = leidenalg.find_partition(
        g,
        leidenalg.CPMVertexPartition,
        weights=None if unweighted else g.es["weight"],
        resolution_parameter=resolution,
    )
    
    communities = list(partition)
    print(f"[Build Communities] Detected {len(communities)} communities")
    
    # Print top 10 community sizes
    community_sizes = sorted([len(c) for c in communities], reverse=True)
    print(f"[Build Communities] Top 10 community sizes: {community_sizes[:10]}")
    
    # Create Community nodes and assign concepts
    for community_indices in communities:
        # Map vertex indices to node_ids
        member_node_ids = [node_ids[vidx] for vidx in community_indices]
        
        # Generate deterministic community_id
        community_id = deterministic_community_id(graph_id, build_version, member_node_ids)
        
        # Generate community name from subgraph degrees
        community_name = community_name_from_subgraph(g, node_ids, community_indices, concepts)
        
        # Create Community node
        try:
            upsert_community(
                session=session,
                graph_id=graph_id,
                community_id=community_id,
                name=community_name,
                summary=None,  # Will be filled by summarize_communities.py
                summary_embedding=None,
                build_version=build_version
            )
            print(f"[Build Communities] Created community: {community_name} ({community_id}) with {len(member_node_ids)} concepts")
        except Exception as e:
            print(f"[Build Communities] ERROR: Failed to create community {community_id}: {e}")
            continue
        
        # Assign concepts to community
        try:
            set_concept_community_memberships(
                session=session,
                graph_id=graph_id,
                community_id=community_id,
                concept_node_ids=member_node_ids
            )
        except Exception as e:
            print(f"[Build Communities] ERROR: Failed to assign concepts to community {community_id}: {e}")
            continue
    
    print(f"[Build Communities] Completed: created {len(communities)} communities")


def main():
    parser = argparse.ArgumentParser(description="Build communities using Leiden community detection")
    parser.add_argument("--graph-id", required=True, help="Graph ID")
    parser.add_argument("--branch-id", required=True, help="Branch ID")
    parser.add_argument("--build-version", default="v1", help="Build version identifier")
    parser.add_argument("--resolution", type=float, default=0.6, help="Resolution parameter for Leiden algorithm (default: 0.6)")
    parser.add_argument("--unweighted", action="store_true", help="Ignore edge weights in community detection")
    
    args = parser.parse_args()
    
    driver = get_driver()
    with driver.session() as session:
        build_communities(
            session=session,
            graph_id=args.graph_id,
            branch_id=args.branch_id,
            build_version=args.build_version,
            resolution=args.resolution,
            unweighted=args.unweighted
        )


if __name__ == "__main__":
    main()
