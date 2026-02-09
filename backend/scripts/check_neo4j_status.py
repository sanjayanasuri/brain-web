#!/usr/bin/env python3
"""Quick script to check Neo4j connection and database status"""
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent))

try:
    from db_neo4j import get_driver
    from config import NEO4J_URI, NEO4J_USER, NEO4J_DATABASE
    
    print(f"Neo4j Configuration:")
    print(f"  URI: {NEO4J_URI}")
    print(f"  User: {NEO4J_USER}")
    print(f"  Database: {NEO4J_DATABASE}")
    print()
    
    driver = get_driver()
    print("✓ Driver created successfully")
    
    # Test connection
    driver.verify_connectivity()
    print("✓ Connection verified")
    
    # Check database stats
    with driver.session(database=NEO4J_DATABASE) as session:
        # Count nodes
        result = session.run("MATCH (n) RETURN count(n) as count")
        total_nodes = result.single()["count"]
        print(f"✓ Total nodes in database: {total_nodes}")
        
        # Count by label (without APOC)
        print("\nNodes by label:")
        labels = ["Concept", "Artifact", "Trail", "GraphSpace", "Quote", "Claim", "SourceChunk", "Lecture"]
        for label in labels:
            try:
                result = session.run(f"MATCH (n:{label}) RETURN count(n) as count")
                count = result.single()["count"]
                if count > 0:
                    print(f"  {label}: {count}")
            except Exception:
                pass  # Label might not exist
        
        # Check for default graph
        result = session.run("MATCH (g:GraphSpace {graph_id: 'default'}) RETURN count(g) as count")
        default_graph_exists = result.single()["count"] > 0
        print(f"\n✓ Default graph exists: {default_graph_exists}")
        
        if total_nodes == 0:
            print("\n⚠ WARNING: Database appears to be empty!")
            print("  You may need to:")
            print("  1. Import data using /admin/import endpoint")
            print("  2. Run seed_demo_graph.py script")
            print("  3. Ingest some PDFs or web pages")
        else:
            print(f"\n✓ Database has {total_nodes} nodes - looks good!")
    
    driver.close()
    print("\n✅ Neo4j is live and accessible!")
    
except Exception as e:
    print(f"\n❌ ERROR: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
