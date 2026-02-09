from neo4j import GraphDatabase
import os
from dotenv import load_dotenv
from pathlib import Path

repo_root = Path(__file__).parent.parent
load_dotenv(repo_root / ".env.local")
load_dotenv(repo_root / ".env")

uri = os.getenv("NEO4J_URI", "bolt://localhost:7687")
user = os.getenv("NEO4J_USER", "neo4j")
password = os.getenv("NEO4J_PASSWORD")

if not password:
    print("NEO4J_PASSWORD still not found")
    exit(1)

driver = GraphDatabase.driver(uri, auth=(user, password))
try:
    with driver.session() as session:
        result = session.run("MATCH (u:UserProfile) RETURN u LIMIT 5")
        print(f"UserProfiles: {result.data()}")
        
        result = session.run("MATCH (g:GraphSpace) RETURN g LIMIT 5")
        print(f"GraphSpaces: {result.data()}")
finally:
    driver.close()
