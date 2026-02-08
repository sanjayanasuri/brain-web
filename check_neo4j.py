import os
from neo4j import GraphDatabase
from dotenv import load_dotenv

# Path to .env (adjust if needed)
load_dotenv()

uri = os.getenv("NEO4J_URI", "bolt://127.0.0.1:7687")
user = os.getenv("NEO4J_USER", "neo4j")
password = os.getenv("NEO4J_PASSWORD")

print(f"Connecting to {uri} as {user}...")

driver = GraphDatabase.driver(uri, auth=(user, password))
try:
    with driver.session() as session:
        print("Checking constraints...")
        constraints = session.run("SHOW CONSTRAINTS").data()
        print(f"Found {len(constraints)} constraints.")
        
        print("Checking lecture counts...")
        count = session.run("MATCH (l:Lecture) RETURN count(l) AS c").single()["c"]
        print(f"Total lectures in DB: {count}")
        
        print("Checking graph spaces...")
        graphs = session.run("MATCH (g:GraphSpace) RETURN g.graph_id AS id, g.name AS name").data()
        for g in graphs:
            print(f"Graph: {g['name']} ({g['id']})")

finally:
    driver.close()
