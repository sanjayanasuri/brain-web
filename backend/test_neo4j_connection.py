#!/usr/bin/env python3
"""Test Neo4j connection"""
import sys
import os
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent))

from config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, NEO4J_DATABASE
from neo4j import GraphDatabase

print("Neo4j Configuration:")
print(f"  URI: {NEO4J_URI}")
print(f"  User: {NEO4J_USER}")
print(f"  Database: {NEO4J_DATABASE}")
print(f"  Password: {'*' * len(NEO4J_PASSWORD) if NEO4J_PASSWORD else 'NOT SET'}")
print()

try:
    print("Attempting to connect...")
    driver = GraphDatabase.driver(
        NEO4J_URI,
        auth=(NEO4J_USER, NEO4J_PASSWORD) if NEO4J_PASSWORD else None
    )
    
    # Test connection
    driver.verify_connectivity()
    print("✅ Connection successful!")
    
    # Test a simple query
    with driver.session(database=NEO4J_DATABASE) as session:
        result = session.run("RETURN 1 as test")
        record = result.single()
        if record and record["test"] == 1:
            print("✅ Query test successful!")
        
        # Check if we can read from the database
        result = session.run("CALL db.schema.visualization() YIELD nodes RETURN count(nodes) as node_count")
        record = result.single()
        if record:
            print(f"✅ Database accessible (schema check passed)")
    
    driver.close()
    print("\n✅ Neo4j connection is working correctly!")
    
except Exception as e:
    print(f"❌ Connection failed: {e}")
    print(f"\nError type: {type(e).__name__}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

