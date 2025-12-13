#!/usr/bin/env python3
"""Quick test script to verify Neo4j connection"""

from db_neo4j import driver

try:
    with driver.session() as session:
        result = session.run("RETURN 1 as test")
        record = result.single()
        print("✅ Neo4j connection successful!")
        print(f"   Test result: {record['test']}")
except Exception as e:
    print(f"❌ Connection failed: {e}")
finally:
    driver.close()

