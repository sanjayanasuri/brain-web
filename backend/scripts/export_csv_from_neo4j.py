import csv
import sys
from pathlib import Path

# Add parent directory to path so we can import backend modules
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from neo4j import Session

# Backward compatible: try get_driver first, fall back to driver if needed
try:
    from db_neo4j import get_driver
    driver_getter = get_driver
except ImportError:
    # Fallback for older code
    from db_neo4j import driver
    driver_getter = lambda: driver

# --------- CONFIG ---------

BASE_DIR = Path(__file__).resolve().parent.parent  # /backend
GRAPH_DIR = BASE_DIR.parent / "graph"              # /graph

# Export to the same files that import reads from, for bidirectional sync
NODES_OUT = GRAPH_DIR / "nodes_semantic.csv"
EDGES_OUT = GRAPH_DIR / "edges_semantic.csv"
LECTURE_COVERS_OUT = GRAPH_DIR / "lecture_covers_export.csv"


def run_in_session(fn):
    """
    Helper: open a session, run fn(session, ...), close session.
    """
    def wrapper(*args, **kwargs):
        driver = driver_getter()
        with driver.session() as session:
            return fn(session, *args, **kwargs)
    return wrapper


@run_in_session
def export_nodes(session: Session, outfile: Path, graph_id: str = None):
    """
    Export Concept nodes to CSV.
    If graph_id is provided, only exports nodes from that graph.
    Otherwise, exports all nodes with their graph_id.
    """
    if graph_id:
        query = """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MATCH (c:Concept)-[:BELONGS_TO]->(g)
        RETURN c.node_id AS node_id,
               c.name AS name,
               c.domain AS domain,
               c.type AS type,
               c.notes_key AS notes_key,
               c.lecture_key AS lecture_key,
               c.url_slug AS url_slug,
               c.graph_id AS graph_id
        ORDER BY c.node_id
        """
        params = {"graph_id": graph_id}
    else:
        query = """
        MATCH (c:Concept)
        RETURN c.node_id AS node_id,
               c.name AS name,
               c.domain AS domain,
               c.type AS type,
               c.notes_key AS notes_key,
               c.lecture_key AS lecture_key,
               c.url_slug AS url_slug,
               COALESCE(c.graph_id, 'default') AS graph_id
        ORDER BY c.graph_id, c.node_id
        """
        params = {}

    result = session.run(query, **params)

    outfile.parent.mkdir(parents=True, exist_ok=True)
    with outfile.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["node_id", "name", "domain", "type",
                         "notes_key", "lecture_key", "url_slug", "graph_id"])
        count = 0
        for record in result:
            writer.writerow([
                record["node_id"],
                record["name"],
                record["domain"],
                record["type"],
                record["notes_key"] or "",
                record["lecture_key"] or "",
                record["url_slug"] or "",
                record["graph_id"] or "default",
            ])
            count += 1

    print(f"[OK] Exported {count} Concept nodes to {outfile.name}.")


@run_in_session
def export_edges(session: Session, outfile: Path, graph_id: str = None):
    """
    Export relationships between Concept nodes to CSV.
    If graph_id is provided, only exports edges from that graph.
    Otherwise, exports all edges with their graph_id.
    """
    if graph_id:
        query = """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MATCH (s:Concept)-[:BELONGS_TO]->(g)
        MATCH (t:Concept)-[:BELONGS_TO]->(g)
        MATCH (s)-[r]->(t)
        WHERE r.graph_id = $graph_id
        RETURN s.node_id AS source_id,
               type(r) AS predicate,
               t.node_id AS target_id,
               r.graph_id AS graph_id
        ORDER BY source_id, predicate, target_id
        """
        params = {"graph_id": graph_id}
    else:
        query = """
        MATCH (s:Concept)-[r]->(t:Concept)
        RETURN s.node_id AS source_id,
               type(r) AS predicate,
               t.node_id AS target_id,
               COALESCE(r.graph_id, 'default') AS graph_id
        ORDER BY r.graph_id, source_id, predicate, target_id
        """
        params = {}

    result = session.run(query, **params)

    outfile.parent.mkdir(parents=True, exist_ok=True)
    with outfile.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["source_id", "predicate", "target_id", "relation_notes_key", "graph_id"])
        count = 0
        for record in result:
            writer.writerow([
                record["source_id"],
                record["predicate"],
                record["target_id"],
                "",
                record["graph_id"] or "default",
            ])
            count += 1

    print(f"[OK] Exported {count} edges to {outfile.name}.")


@run_in_session
def export_lecture_covers(session: Session, outfile: Path):
    """
    Export all Lecture -> Concept COVERS edges to CSV.
    """
    query = """
    MATCH (l:Lecture)-[r:COVERS]->(c:Concept)
    RETURN l.lecture_id AS lecture_id,
           'COVERS' AS predicate,
           c.node_id AS concept_id,
           r.step_order AS step_order
    ORDER BY lecture_id, step_order
    """

    result = session.run(query)

    outfile.parent.mkdir(parents=True, exist_ok=True)
    with outfile.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["lecture_id", "predicate", "concept_id", "step_order"])
        count = 0
        for record in result:
            writer.writerow([
                record["lecture_id"],
                record["predicate"],
                record["concept_id"],
                record["step_order"] if record["step_order"] is not None else "",
            ])
            count += 1

    print(f"[OK] Exported {count} COVERS edges to {outfile.name}.")


def main(graph_id: str = None, export_per_graph: bool = True):
    """
    Export graph data to CSV files.
    
    Args:
        graph_id: If provided, only export data from this graph.
                  If None, export all graphs (with graph_id column).
        export_per_graph: If True, also export separate CSV files for each graph.
                         Files will be named like nodes_G{graph_id}.csv
    """
    print(f"Using GRAPH_DIR = {GRAPH_DIR}")
    if graph_id:
        print(f"Exporting graph: {graph_id}")
    else:
        print("Exporting all graphs")

    # Always export combined files (for backward compatibility)
    export_nodes(NODES_OUT, graph_id=graph_id)
    export_edges(EDGES_OUT, graph_id=graph_id)
    export_lecture_covers(LECTURE_COVERS_OUT)

    # If exporting all graphs and per-graph export is enabled, export each graph separately
    if not graph_id and export_per_graph:
        from services_branch_explorer import list_graphs
        
        try:
            # Get list of graphs (this will create its own session via the decorator)
            # We need to call it in a way that gets the graphs list
            driver = driver_getter()
            with driver.session() as session:
                graphs = list_graphs(session)
            
            print(f"\n[PER-GRAPH] Exporting {len(graphs)} individual graphs...")
            for graph in graphs:
                gid = graph.get("graph_id")
                if not gid:
                    continue
                
                # Export to per-graph files: nodes_G{graph_id}.csv, edges_G{graph_id}.csv
                # These functions will create their own sessions via @run_in_session decorator
                per_graph_nodes = GRAPH_DIR / f"nodes_G{gid}.csv"
                per_graph_edges = GRAPH_DIR / f"edges_G{gid}.csv"
                
                export_nodes(per_graph_nodes, graph_id=gid)
                export_edges(per_graph_edges, graph_id=gid)
                print(f"[PER-GRAPH] ✓ Exported graph {gid} ({graph.get('name', 'Unnamed')})")
        except Exception as e:
            print(f"[PER-GRAPH] ⚠ Warning: Could not export per-graph files: {e}")
            # Don't fail the whole export if per-graph export fails

    print("[DONE] CSV export complete.")


if __name__ == "__main__":
    main()
