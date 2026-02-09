#!/usr/bin/env python3
"""
Delete the duplicate 'Machine Learning' concept that's blocking chat.
"""
from neo4j import GraphDatabase
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv('.env.local')

NEO4J_URI = os.getenv('NEO4J_URI', 'neo4j://127.0.0.1:7687')
NEO4J_USER = os.getenv('NEO4J_USER', 'neo4j')
NEO4J_PASSWORD = os.getenv('NEO4J_PASSWORD')

print(f"Connecting to Neo4j at {NEO4J_URI}...")
driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))

with driver.session() as session:
    # Find all Machine Learning concepts
    result = session.run("""
        MATCH (c:Concept {name: "Machine Learning", graph_id: "default"})
        RETURN id(c) AS internal_id, c.node_id AS node_id, c.name AS name
    """)
    
    concepts = list(result)
    print(f"\nFound {len(concepts)} 'Machine Learning' concept(s):")
    for concept in concepts:
        print(f"  - Internal ID: {concept['internal_id']}, Node ID: {concept['node_id']}")
    
    if len(concepts) > 1:
        print(f"\n⚠️  Found {len(concepts)} duplicate concepts! Keeping the first one and deleting the rest...")
        
        # Keep the first one, delete the rest
        for i, concept in enumerate(concepts[1:], start=1):
            internal_id = concept['internal_id']
            print(f"  Deleting duplicate #{i} (internal ID: {internal_id})...")
            session.run("""
                MATCH (c:Concept)
                WHERE id(c) = $internal_id
                DETACH DELETE c
            """, internal_id=internal_id)
        
        print("\n✅ Duplicates deleted!")
    elif len(concepts) == 1:
        print("\n✅ Only one 'Machine Learning' concept found - no duplicates to delete.")
    else:
        print("\n⚠️  No 'Machine Learning' concepts found.")

driver.close()
print("\nDone!")
