import csv
import sys
from pathlib import Path
from typing import Dict, Set

# Add parent directory to path so we can import backend modules
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from neo4j import Session

# Reuse the existing Neo4j driver configuration
# Backward compatible: try get_driver first, fall back to driver if needed
try:
    from db_neo4j import get_driver
    driver_getter = get_driver
except ImportError:
    # Fallback for older code
    from db_neo4j import driver
    driver_getter = lambda: driver


# --------- CONFIG ---------

# Relative to this script:
BASE_DIR = Path(__file__).resolve().parent.parent  # /backend
GRAPH_DIR = BASE_DIR.parent / "graph"              # /graph

NODES_FILE = GRAPH_DIR / "nodes_semantic.csv"
EDGES_FILE = GRAPH_DIR / "edges_semantic.csv"
LECTURE_COVERS_FILE = GRAPH_DIR / "lecture_covers_L001.csv"


# --------- HELPERS ---------

def run_in_session(fn):
    """
    Decorator-style helper: open a session, run fn(session), close session.
    """
    def wrapper(*args, **kwargs):
        driver = driver_getter()
        with driver.session() as session:
            return fn(session, *args, **kwargs)
    return wrapper


@run_in_session
def create_constraints(session: Session):
    """
    Create basic uniqueness constraints. Safe to run multiple times.
    """
    # --- Branch Explorer upgrade ---
    # We want Concept names to be unique *per graph*, not globally.
    #
    # Old behavior (global):  (:Concept) REQUIRE name IS UNIQUE
    # New behavior (scoped):  (:Concept) REQUIRE (graph_id, name) IS NODE KEY
    #
    # Because older constraints may exist without explicit names, we:
    # 1) backfill missing graph scoping to default graph
    # 2) drop any Concept(name) uniqueness constraints we can find
    # 3) create the new constraints with explicit names

    # Ensure default graph/branch scoping exists before creating NODE KEY constraint.
    session.run(
        """
        MERGE (g:GraphSpace {graph_id: 'default'})
        ON CREATE SET g.name = 'Default'
        WITH g
        MATCH (c:Concept)
        WHERE c.graph_id IS NULL
        SET c.graph_id = 'default'
        """
    )
    session.run(
        """
        MATCH (g:GraphSpace {graph_id: 'default'})
        MATCH (c:Concept)
        WHERE NOT (c)-[:BELONGS_TO]->(:GraphSpace)
        MERGE (c)-[:BELONGS_TO]->(g)
        """
    )
    session.run(
        """
        MATCH (c:Concept)
        WHERE c.on_branches IS NULL
        SET c.on_branches = ['main']
        """
    )
    session.run(
        """
        MATCH (:Concept)-[r]->(:Concept)
        WHERE r.graph_id IS NULL
        SET r.graph_id = 'default'
        """
    )
    session.run(
        """
        MATCH (:Concept)-[r]->(:Concept)
        WHERE r.on_branches IS NULL
        SET r.on_branches = ['main']
        """
    )

    # Drop any existing uniqueness constraint on Concept.name (global uniqueness).
    try:
        constraints = session.run("SHOW CONSTRAINTS").data()
        for c in constraints:
            labels = c.get("labelsOrTypes") or []
            props = c.get("properties") or []
            ctype = (c.get("type") or "").upper()
            name = c.get("name")
            if name and "CONCEPT" in [str(x).upper() for x in labels] and props == ["name"] and "UNIQUENESS" in ctype:
                session.run(f"DROP CONSTRAINT {name} IF EXISTS")
    except Exception:
        # Best-effort only; if we can't drop, the new constraint will still be created
        # but duplicate names across graphs will continue to error until old constraint is removed.
        pass

    queries = [
        "CREATE CONSTRAINT concept_node_id_unique IF NOT EXISTS FOR (c:Concept) REQUIRE c.node_id IS UNIQUE",
        "CREATE CONSTRAINT concept_graph_name_node_key IF NOT EXISTS FOR (c:Concept) REQUIRE (c.graph_id, c.name) IS NODE KEY",
        "CREATE CONSTRAINT lecture_id_unique IF NOT EXISTS FOR (l:Lecture) REQUIRE l.lecture_id IS UNIQUE",
        "CREATE CONSTRAINT graphspace_id_unique IF NOT EXISTS FOR (g:GraphSpace) REQUIRE g.graph_id IS UNIQUE",
    ]
    for q in queries:
        session.run(q)
    print("[OK] Constraints ensured.")


@run_in_session
def import_nodes(session: Session, file_path: Path):
    """
    Import Concept nodes from nodes_semantic.csv
    """
    if not file_path.exists():
        raise FileNotFoundError(f"Nodes file not found: {file_path}")

    with file_path.open() as f:
        reader = csv.DictReader(f)
        count = 0
        for row in reader:
            params = {
                "node_id": row["node_id"],
                "name": row["name"],
                "domain": row["domain"],
                "type": row["type"],
                "notes_key": row.get("notes_key") or None,
                "lecture_key": row.get("lecture_key") or None,
                "url_slug": row.get("url_slug") or None,
            }
            # IMPORTANT (Branch Explorer):
            # Concepts are unique per graph by (graph_id, name).
            # When importing seed CSV, we treat the name as canonical and ensure the node_id matches the CSV.
            # If a duplicate node with the same node_id exists, we delete it (seed import is the source of truth).
            query = """
            MERGE (g:GraphSpace {graph_id: 'default'})
            ON CREATE SET g.name = 'Default'
            // Delete any existing node with this node_id first (before MERGE to avoid constraint violation)
            WITH g
            OPTIONAL MATCH (dup:Concept {node_id: $node_id})
            FOREACH (_ IN CASE WHEN dup IS NULL THEN [] ELSE [1] END | DETACH DELETE dup)
            WITH g
            MERGE (c:Concept {graph_id: 'default', name: $name})
            ON CREATE SET
                c.node_id = $node_id,
                c.domain = $domain,
                c.type = $type,
                c.notes_key = $notes_key,
                c.lecture_key = $lecture_key,
                c.url_slug = $url_slug,
                c.on_branches = ['main']
            ON MATCH SET
                c.node_id = $node_id,
                c.domain = $domain,
                c.type = $type,
                c.notes_key = $notes_key,
                c.lecture_key = $lecture_key,
                c.url_slug = $url_slug,
                c.on_branches = COALESCE(c.on_branches, ['main']),
                c.graph_id = 'default'
            MERGE (c)-[:BELONGS_TO]->(g)
            """
            session.run(query, **params)
            count += 1

    print(f"[OK] Imported {count} Concept nodes from {file_path.name}.")


@run_in_session
def import_edges(session: Session, file_path: Path):
    """
    Import relationships from edges_semantic.csv.
    Relationship type is the predicate string.
    """
    if not file_path.exists():
        raise FileNotFoundError(f"Edges file not found: {file_path}")

    with file_path.open() as f:
        reader = csv.DictReader(f)
        count = 0
        missing_nodes: Set[str] = set()

        for row in reader:
            source_id = row["source_id"]
            predicate = row["predicate"]
            target_id = row["target_id"]

            # Quick sanity: skip incomplete rows
            if not source_id or not target_id or not predicate:
                continue

            # Build Cypher with dynamic relationship type
            query = f"""
            MATCH (s:Concept {{node_id: $source_id}})
            MATCH (t:Concept {{node_id: $target_id}})
            MERGE (s)-[r:`{predicate}`]->(t)
            SET r.graph_id = COALESCE(r.graph_id, 'default'),
                r.on_branches = COALESCE(r.on_branches, ['main'])
            """
            result = session.run(query, source_id=source_id, target_id=target_id)
            # We don't care about the result, just that it ran
            count += 1

        print(f"[OK] Imported {count} edges from {file_path.name}.")


@run_in_session
def import_lecture_covers(session: Session, file_path: Path):
    """
    Import a lecture and its COVERS relationships from lecture_covers_L001.csv.
    If the Lecture node does not exist, it is created with minimal metadata.
    """
    if not file_path.exists():
        raise FileNotFoundError(f"Lecture covers file not found: {file_path}")

    with file_path.open() as f:
        reader = csv.DictReader(f)

        # Keep track of which lectures we've already ensured exist
        seen_lectures: Dict[str, bool] = {}
        count_edges = 0

        for row in reader:
            lecture_id = row["lecture_id"]
            predicate = row["predicate"]
            concept_id = row["concept_id"]
            step_order = int(row["step_order"])

            if not lecture_id or not predicate or not concept_id:
                continue

            # Ensure lecture node exists (with minimal properties)
            if lecture_id not in seen_lectures:
                query_lecture = """
                MERGE (l:Lecture {lecture_id: $lecture_id})
                ON CREATE SET
                    l.title = $title,
                    l.description = $description
                """
                session.run(
                    query_lecture,
                    lecture_id=lecture_id,
                    title="Intro to Software Architecture",
                    description="Seed lecture imported from CSV.",
                )
                seen_lectures[lecture_id] = True

            # Create COVERS relationship with step_order
            query_covers = """
            MATCH (l:Lecture {lecture_id: $lecture_id})
            MATCH (c:Concept {node_id: $concept_id})
            MERGE (l)-[r:COVERS]->(c)
            SET r.step_order = $step_order
            """
            session.run(
                query_covers,
                lecture_id=lecture_id,
                concept_id=concept_id,
                step_order=step_order,
            )
            count_edges += 1

    print(f"[OK] Imported {count_edges} COVERS edges from {file_path.name}.")


def main():
    print(f"Using GRAPH_DIR = {GRAPH_DIR}")

    create_constraints()
    import_nodes(NODES_FILE)
    import_edges(EDGES_FILE)
    import_lecture_covers(LECTURE_COVERS_FILE)

    print("[DONE] CSV import complete.")


if __name__ == "__main__":
    main()
