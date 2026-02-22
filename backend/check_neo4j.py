from neo4j import GraphDatabase
import os
from dotenv import load_dotenv

load_dotenv()

uri = os.getenv("NEO4J_URI", "bolt://127.0.0.1:7687")
user = os.getenv("NEO4J_USER", "neo4j")
password = os.getenv("NEO4J_PASSWORD", "Speedracer123$")

try:
    driver = GraphDatabase.driver(uri, auth=(user, password))
    with driver.session() as session:
        result = session.run("MATCH (a:Artifact) WHERE a.url CONTAINS 'wikipedia' RETURN a.url, a.title, a.created_at ORDER BY a.created_at DESC LIMIT 5")
        records = list(result)
        if not records:
            print("No Wikipedia artifacts found in Neo4j.")
        for record in records:
            print(f"URL: {record['a.url']}, Title: {record['a.title']}, Created At: {record['a.created_at']}")
    driver.close()
except Exception as e:
    print(f"Failed to connect to Neo4j: {e}")
