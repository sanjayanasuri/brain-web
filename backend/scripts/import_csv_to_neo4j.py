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
    Now respects graph_id column if present, otherwise defaults to 'default'
    """
    if not file_path.exists():
        raise FileNotFoundError(f"Nodes file not found: {file_path}")

    import time
    from neo4j.exceptions import TransientError
    
    with file_path.open() as f:
        reader = csv.DictReader(f)
        count = 0
        errors = 0
        for row in reader:
            # Get graph_id from CSV if present, otherwise default to 'default'
            graph_id = row.get("graph_id") or "default"
            
            params = {
                "node_id": row["node_id"],
                "name": row["name"],
                "domain": row["domain"],
                "type": row["type"],
                "notes_key": row.get("notes_key") or None,
                "lecture_key": row.get("lecture_key") or None,
                "url_slug": row.get("url_slug") or None,
                "graph_id": graph_id,
            }
            # IMPORTANT (Branch Explorer):
            # Concepts are unique per graph by (graph_id, name).
            # When importing seed CSV, we treat the name as canonical and ensure the node_id matches the CSV.
            # Use MERGE instead of DELETE to avoid deadlocks - MERGE will update existing nodes safely.
            query = """
            MERGE (g:GraphSpace {graph_id: $graph_id})
            ON CREATE SET g.name = COALESCE($graph_id, 'Default')
            WITH g
            // First, try to find existing node by node_id and update it if it exists in a different graph
            OPTIONAL MATCH (existing:Concept {node_id: $node_id})
            WITH g, existing
            // If node exists but in wrong graph, we'll update it via MERGE below
            // MERGE on (graph_id, name) will create or update safely
            MERGE (c:Concept {graph_id: $graph_id, name: $name})
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
                c.graph_id = $graph_id
            MERGE (c)-[:BELONGS_TO]->(g)
            """
            
            # Retry logic for transient errors (deadlocks)
            max_retries = 3
            retry_delay = 0.1
            for attempt in range(max_retries):
                try:
                    session.run(query, **params)
                    count += 1
                    break
                except TransientError as e:
                    if attempt < max_retries - 1:
                        time.sleep(retry_delay * (2 ** attempt))  # Exponential backoff
                        continue
                    else:
                        print(f"[WARN] Failed to import node {row['node_id']} after {max_retries} attempts: {e}")
                        errors += 1
                except Exception as e:
                    print(f"[WARN] Error importing node {row['node_id']}: {e}")
                    errors += 1
                    break

    status = f"[OK] Imported {count} Concept nodes from {file_path.name}."
    if errors > 0:
        status += f" ({errors} errors)"
    print(status)


@run_in_session
def import_edges(session: Session, file_path: Path):
    """
    Import relationships from edges_semantic.csv.
    Relationship type is the predicate string.
    Now respects graph_id column if present, otherwise defaults to 'default'
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
            # Get graph_id from CSV if present, otherwise default to 'default'
            graph_id = row.get("graph_id") or "default"

            # Quick sanity: skip incomplete rows
            if not source_id or not target_id or not predicate:
                continue

            # Build Cypher with dynamic relationship type
            query = f"""
            MATCH (s:Concept {{node_id: $source_id}})
            MATCH (t:Concept {{node_id: $target_id}})
            MERGE (s)-[r:`{predicate}`]->(t)
            SET r.graph_id = $graph_id,
                r.on_branches = COALESCE(r.on_branches, ['main'])
            """
            result = session.run(query, source_id=source_id, target_id=target_id, graph_id=graph_id)
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
    
    # TEMPORARY: Only import personal finance graph for testing
    # Skip all legacy files and other graphs to speed up testing
    FINANCE_GRAPH_ID = "G0F87FFD7"
    finance_nodes_file = GRAPH_DIR / f"nodes_G{FINANCE_GRAPH_ID}.csv"
    finance_edges_file = GRAPH_DIR / f"edges_G{FINANCE_GRAPH_ID}.csv"
    
    print(f"\n[TEST MODE] Only importing personal finance graph: {FINANCE_GRAPH_ID}")
    print(f"[SKIPPING] Legacy files and other graphs for faster testing\n")
    
    # Import finance nodes
    if finance_nodes_file.exists():
        print(f"[Importing finance nodes: {finance_nodes_file.name}]")
        try:
            import_nodes(finance_nodes_file)
        except Exception as e:
            print(f"[ERROR] Failed to import {finance_nodes_file.name}: {e}")
    else:
        print(f"[WARNING] Finance nodes file not found: {finance_nodes_file.name}")
    
    # Import finance edges (may be empty, that's OK)
    if finance_edges_file.exists():
        print(f"\n[Importing finance edges: {finance_edges_file.name}]")
        try:
            import_edges(finance_edges_file)
        except Exception as e:
            print(f"[ERROR] Failed to import {finance_edges_file.name}: {e}")
    else:
        print(f"[INFO] Finance edges file not found (this is OK if you have no relationships yet): {finance_edges_file.name}")
    
    # SKIP legacy files for now (comment out to re-enable)
    # if NODES_FILE.exists():
    #     print(f"\n[Importing legacy nodes file: {NODES_FILE.name}]")
    #     import_nodes(NODES_FILE)
    # if EDGES_FILE.exists():
    #     print(f"\n[Importing legacy edges file: {EDGES_FILE.name}]")
    #     import_edges(EDGES_FILE)
    # if LECTURE_COVERS_FILE.exists():
    #     print(f"\n[Importing lecture covers file: {LECTURE_COVERS_FILE.name}]")
    #     import_lecture_covers(LECTURE_COVERS_FILE)
    
    # SKIP other graph files for now (comment out to re-enable)
    # nodes_files = sorted(GRAPH_DIR.glob("nodes_*.csv"))
    # edges_files = sorted(GRAPH_DIR.glob("edges_*.csv"))
    # nodes_files = [f for f in nodes_files if f != NODES_FILE and f != finance_nodes_file]
    # edges_files = [f for f in edges_files if f != EDGES_FILE and f != finance_edges_file]
    # for nodes_file in nodes_files:
    #     print(f"\n[Importing nodes file: {nodes_file.name}]")
    #     try:
    #         import_nodes(nodes_file)
    #     except Exception as e:
    #         print(f"[ERROR] Failed to import {nodes_file.name}: {e}")
    # for edges_file in edges_files:
    #     print(f"\n[Importing edges file: {edges_file.name}]")
    #     try:
    #         import_edges(edges_file)
    #     except Exception as e:
    #         print(f"[ERROR] Failed to import {edges_file.name}: {e}")

    # Post-import verification: ensure all nodes have BELONGS_TO relationships and on_branches
    @run_in_session
    def verify_import(session: Session):
        """Verify that all imported nodes have proper relationships and branch assignments"""
        # Fix any nodes missing BELONGS_TO relationships
        fix_query = """
        MATCH (c:Concept)
        WHERE c.graph_id IS NOT NULL AND NOT (c)-[:BELONGS_TO]->(:GraphSpace)
        MATCH (g:GraphSpace {graph_id: c.graph_id})
        MERGE (c)-[:BELONGS_TO]->(g)
        RETURN count(c) AS fixed
        """
        result = session.run(fix_query)
        fixed = result.single()["fixed"] if result.peek() else 0
        if fixed > 0:
            print(f"[VERIFY] Fixed {fixed} nodes missing BELONGS_TO relationships")
        
        # Ensure all nodes have on_branches set
        fix_branches_query = """
        MATCH (c:Concept)
        WHERE c.on_branches IS NULL OR c.on_branches = []
        SET c.on_branches = ['main']
        RETURN count(c) AS fixed
        """
        result = session.run(fix_branches_query)
        fixed_branches = result.single()["fixed"] if result.peek() else 0
        if fixed_branches > 0:
            print(f"[VERIFY] Fixed {fixed_branches} nodes missing on_branches")
        
        # Report node counts per graph
        count_query = """
        MATCH (g:GraphSpace)
        OPTIONAL MATCH (c:Concept)-[:BELONGS_TO]->(g)
        RETURN g.graph_id AS graph_id, count(c) AS node_count
        ORDER BY graph_id
        """
        result = session.run(count_query)
        print("\n[VERIFY] Node counts per graph:")
        for record in result:
            print(f"  Graph {record['graph_id']}: {record['node_count']} nodes")
    
    verify_import()
    print("\n[DONE] CSV import complete.")


if __name__ == "__main__":
    main()
