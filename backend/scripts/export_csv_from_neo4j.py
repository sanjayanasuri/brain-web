import csv
import sys
from pathlib import Path

# Add parent directory to path so we can import backend modules
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from neo4j import Session

from db_neo4j import get_driver

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
        driver = get_driver()
        with driver.session() as session:
            return fn(session, *args, **kwargs)
    return wrapper


@run_in_session
def export_nodes(session: Session, outfile: Path):
    """
    Export all Concept nodes to CSV.
    """
    query = """
    MATCH (c:Concept)
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.notes_key AS notes_key,
           c.lecture_key AS lecture_key,
           c.url_slug AS url_slug
    ORDER BY c.node_id
    """

    result = session.run(query)

    outfile.parent.mkdir(parents=True, exist_ok=True)
    with outfile.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["node_id", "name", "domain", "type",
                         "notes_key", "lecture_key", "url_slug"])
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
            ])
            count += 1

    print(f"[OK] Exported {count} Concept nodes to {outfile.name}.")


@run_in_session
def export_edges(session: Session, outfile: Path):
    """
    Export all relationships between Concept nodes to CSV.
    """
    query = """
    MATCH (s:Concept)-[r]->(t:Concept)
    RETURN s.node_id AS source_id,
           type(r) AS predicate,
           t.node_id AS target_id
    ORDER BY source_id, predicate, target_id
    """

    result = session.run(query)

    outfile.parent.mkdir(parents=True, exist_ok=True)
    with outfile.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["source_id", "predicate", "target_id", "relation_notes_key"])
        count = 0
        for record in result:
            writer.writerow([
                record["source_id"],
                record["predicate"],
                record["target_id"],
                "",
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


def main():
    print(f"Using GRAPH_DIR = {GRAPH_DIR}")

    export_nodes(NODES_OUT)
    export_edges(EDGES_OUT)
    export_lecture_covers(LECTURE_COVERS_OUT)

    print("[DONE] CSV export complete.")


if __name__ == "__main__":
    main()
