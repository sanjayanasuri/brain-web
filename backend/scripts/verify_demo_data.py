#!/usr/bin/env python3
"""
Script to verify and optionally fix demo data structure in Neo4j Aura.

This script checks if:
1. GraphSpace exists for the demo graph
2. Concepts have BELONGS_TO relationships to GraphSpace
3. Concepts have on_branches property set
4. Relationships have graph_id and on_branches properties

Usage:
    python scripts/verify_demo_data.py [--fix]
    
    --fix: Attempt to fix missing structure (only works if DEMO_ALLOW_WRITES=true)
"""

import argparse
import sys
from pathlib import Path

# Add backend to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from db_neo4j import get_neo4j_session
from config import DEMO_MODE, DEMO_GRAPH_ID, DEMO_ALLOW_WRITES
from services_branch_explorer import ensure_graphspace_exists, ensure_branch_exists, ensure_schema_constraints


def check_graphspace(session, graph_id: str) -> bool:
    """Check if GraphSpace exists."""
    query = "MATCH (g:GraphSpace {graph_id: $graph_id}) RETURN g"
    result = session.run(query, graph_id=graph_id)
    return result.single() is not None


def check_concepts_with_belongs_to(session, graph_id: str) -> tuple[int, int]:
    """Check how many concepts have BELONGS_TO relationship."""
    query = """
    MATCH (c:Concept)
    OPTIONAL MATCH (c)-[:BELONGS_TO]->(g:GraphSpace {graph_id: $graph_id})
    RETURN count(c) AS total, count(g) AS with_belongs_to
    """
    result = session.run(query, graph_id=graph_id)
    record = result.single()
    return record["total"], record["with_belongs_to"]


def check_concepts_with_branches(session) -> tuple[int, int]:
    """Check how many concepts have on_branches property."""
    query = """
    MATCH (c:Concept)
    RETURN count(c) AS total, 
           count(CASE WHEN c.on_branches IS NOT NULL THEN 1 END) AS with_branches
    """
    result = session.run(query)
    record = result.single()
    return record["total"], record["with_branches"]


def check_relationships_with_graph_id(session, graph_id: str) -> tuple[int, int]:
    """Check how many relationships have graph_id property."""
    query = """
    MATCH (s:Concept)-[r]->(t:Concept)
    RETURN count(r) AS total,
           count(CASE WHEN r.graph_id = $graph_id THEN 1 END) AS with_graph_id
    """
    result = session.run(query, graph_id=graph_id)
    record = result.single()
    return record["total"], record["with_graph_id"]


def fix_graphspace(session, graph_id: str):
    """Create GraphSpace if it doesn't exist."""
    if not check_graphspace(session, graph_id):
        print(f"Creating GraphSpace for graph_id: {graph_id}")
        ensure_graphspace_exists(session, graph_id, name="Demo")
        print("✓ GraphSpace created")
    else:
        print("✓ GraphSpace already exists")


def fix_concepts(session, graph_id: str, branch_id: str):
    """Fix concepts to have BELONGS_TO relationships and on_branches."""
    # First, ensure GraphSpace exists
    ensure_graphspace_exists(session, graph_id)
    
    # Backfill Concepts that aren't scoped
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (c:Concept)
    WHERE NOT (c)-[:BELONGS_TO]->(:GraphSpace)
    MERGE (c)-[:BELONGS_TO]->(g)
    SET c.graph_id = $graph_id,
        c.on_branches = COALESCE(c.on_branches, [$branch_id])
    RETURN count(c) AS updated
    """
    result = session.run(query, graph_id=graph_id, branch_id=branch_id)
    updated = result.single()["updated"]
    if updated > 0:
        print(f"✓ Created BELONGS_TO relationships for {updated} concepts")
    
    # Ensure existing Concepts have on_branches
    query = """
    MATCH (c:Concept)
    WHERE c.on_branches IS NULL
    SET c.on_branches = [$branch_id]
    RETURN count(c) AS updated
    """
    result = session.run(query, branch_id=branch_id)
    updated = result.single()["updated"]
    if updated > 0:
        print(f"✓ Set on_branches for {updated} concepts")


def fix_relationships(session, graph_id: str, branch_id: str):
    """Fix relationships to have graph_id and on_branches."""
    # Backfill relationships
    query = """
    MATCH (s:Concept)-[r]->(t:Concept)
    WHERE r.graph_id IS NULL
    SET r.graph_id = COALESCE(s.graph_id, $graph_id),
        r.on_branches = COALESCE(r.on_branches, [$branch_id])
    RETURN count(r) AS updated
    """
    result = session.run(query, graph_id=graph_id, branch_id=branch_id)
    updated = result.single()["updated"]
    if updated > 0:
        print(f"✓ Set graph_id for {updated} relationships")
    
    # Ensure relationships have on_branches
    query = """
    MATCH (s:Concept)-[r]->(t:Concept)
    WHERE r.on_branches IS NULL
    SET r.on_branches = [$branch_id]
    RETURN count(r) AS updated
    """
    result = session.run(query, branch_id=branch_id)
    updated = result.single()["updated"]
    if updated > 0:
        print(f"✓ Set on_branches for {updated} relationships")


def main():
    parser = argparse.ArgumentParser(description="Verify and fix demo data structure")
    parser.add_argument("--fix", action="store_true", help="Attempt to fix missing structure")
    args = parser.parse_args()
    
    graph_id = DEMO_GRAPH_ID if DEMO_MODE else "default"
    branch_id = "main"
    
    print(f"Verifying demo data structure for graph_id: {graph_id}")
    print(f"DEMO_MODE: {DEMO_MODE}, DEMO_ALLOW_WRITES: {DEMO_ALLOW_WRITES}")
    print()
    
    session_gen = get_neo4j_session()
    session = next(session_gen)
    
    try:
        ensure_schema_constraints(session)
        
        # Check GraphSpace
        has_graphspace = check_graphspace(session, graph_id)
        print(f"GraphSpace exists: {has_graphspace}")
        
        # Check concepts
        total_concepts, concepts_with_belongs_to = check_concepts_with_belongs_to(session, graph_id)
        print(f"Concepts: {total_concepts} total, {concepts_with_belongs_to} with BELONGS_TO")
        
        total_concepts2, concepts_with_branches = check_concepts_with_branches(session)
        print(f"Concepts: {concepts_with_branches} with on_branches property")
        
        # Check relationships
        total_rels, rels_with_graph_id = check_relationships_with_graph_id(session, graph_id)
        print(f"Relationships: {total_rels} total, {rels_with_graph_id} with graph_id={graph_id}")
        
        print()
        
        # Determine if fixes are needed
        needs_fix = (
            not has_graphspace or
            concepts_with_belongs_to < total_concepts or
            concepts_with_branches < total_concepts2 or
            rels_with_graph_id < total_rels
        )
        
        if needs_fix:
            print("⚠ Issues detected!")
            if args.fix:
                if DEMO_MODE and not DEMO_ALLOW_WRITES:
                    print("❌ Cannot fix: DEMO_MODE=true and DEMO_ALLOW_WRITES=false")
                    print("   Set DEMO_ALLOW_WRITES=true to enable fixes")
                    return 1
                
                print("\nAttempting to fix...")
                fix_graphspace(session, graph_id)
                ensure_branch_exists(session, graph_id, branch_id)
                fix_concepts(session, graph_id, branch_id)
                fix_relationships(session, graph_id, branch_id)
                print("\n✓ Fix complete! Re-run without --fix to verify.")
            else:
                print("Run with --fix to attempt automatic fixes")
                return 1
        else:
            print("✓ All checks passed!")
        
        return 0
        
    except Exception as e:
        print(f"❌ Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1
    finally:
        session.close()


if __name__ == "__main__":
    sys.exit(main())



