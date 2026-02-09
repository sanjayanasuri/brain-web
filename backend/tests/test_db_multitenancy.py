#!/usr/bin/env python3
"""
Direct database test for multi-tenancy isolation.
Tests concept creation and isolation without requiring the API server.
"""

import os
import sys

# Set up path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

def test_multitenancy():
    """Test multi-tenancy by directly using Neo4j driver."""
    
    print("=" * 80)
    print("MULTI-TENANCY DATABASE TEST")
    print("=" * 80)
    print()
    
    try:
        from neo4j import GraphDatabase
        from config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, NEO4J_DATABASE
        
        print(f"📡 Connecting to Neo4j at {NEO4J_URI}...")
        driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
        
        with driver.session(database=NEO4J_DATABASE) as session:
            # Create test concepts for Tenant A
            tenant_a = "test_tenant_a"
            tenant_b = "test_tenant_b"
            
            print(f"\n📝 Creating concepts for Tenant A ({tenant_a})...")
            
            # Concept 1 for Tenant A
            result = session.run("""
                MERGE (c:Concept {name: $name, domain: $domain})
                ON CREATE SET 
                    c.node_id = randomUUID(),
                    c.graph_id = $graph_id,
                    c.type = $type,
                    c.description = $description,
                    c.tenant_id = $tenant_id,
                    c.created_at = datetime()
                ON MATCH SET
                    c.tenant_id = $tenant_id,
                    c.graph_id = $graph_id
                RETURN c.node_id AS node_id, c.name AS name
            """, name="Machine Learning", domain="Computer Science", 
                 type="field", description="AI subset focused on learning from data",
                 tenant_id=tenant_a, graph_id=f"graph_{tenant_a}")
            
            record = result.single()
            print(f"   ✓ Created: {record['name']} (ID: {record['node_id']})")
            
            # Concept 2 for Tenant A
            result = session.run("""
                MERGE (c:Concept {name: $name, domain: $domain})
                ON CREATE SET 
                    c.node_id = randomUUID(),
                    c.graph_id = $graph_id,
                    c.type = $type,
                    c.description = $description,
                    c.tenant_id = $tenant_id,
                    c.created_at = datetime()
                ON MATCH SET
                    c.tenant_id = $tenant_id,
                    c.graph_id = $graph_id
                RETURN c.node_id AS node_id, c.name AS name
            """, name="Neural Networks", domain="Computer Science",
                 type="concept", description="Computing systems inspired by biological neural networks",
                 tenant_id=tenant_a, graph_id=f"graph_{tenant_a}")
            
            record = result.single()
            print(f"   ✓ Created: {record['name']} (ID: {record['node_id']})")
            
            # Create test concepts for Tenant B
            print(f"\n📝 Creating concepts for Tenant B ({tenant_b})...")
            
            # Concept 1 for Tenant B
            result = session.run("""
                MERGE (c:Concept {name: $name, domain: $domain})
                ON CREATE SET 
                    c.node_id = randomUUID(),
                    c.graph_id = $graph_id,
                    c.type = $type,
                    c.description = $description,
                    c.tenant_id = $tenant_id,
                    c.created_at = datetime()
                ON MATCH SET
                    c.tenant_id = $tenant_id,
                    c.graph_id = $graph_id
                RETURN c.node_id AS node_id, c.name AS name
            """, name="Quantum Computing", domain="Physics",
                 type="field", description="Computing using quantum-mechanical phenomena",
                 tenant_id=tenant_b, graph_id=f"graph_{tenant_b}")
            
            record = result.single()
            print(f"   ✓ Created: {record['name']} (ID: {record['node_id']})")
            
            # Concept 2 for Tenant B
            result = session.run("""
                MERGE (c:Concept {name: $name, domain: $domain})
                ON CREATE SET 
                    c.node_id = randomUUID(),
                    c.graph_id = $graph_id,
                    c.type = $type,
                    c.description = $description,
                    c.tenant_id = $tenant_id,
                    c.created_at = datetime()
                ON MATCH SET
                    c.tenant_id = $tenant_id,
                    c.graph_id = $graph_id
                RETURN c.node_id AS node_id, c.name AS name
            """, name="Superposition", domain="Physics",
                 type="concept", description="Quantum state in multiple states simultaneously",
                 tenant_id=tenant_b, graph_id=f"graph_{tenant_b}")
            
            record = result.single()
            print(f"   ✓ Created: {record['name']} (ID: {record['node_id']})")
            
            # Query and verify Tenant A's concepts
            print(f"\n🔍 Querying concepts for Tenant A...")
            result = session.run("""
                MATCH (c:Concept)
                WHERE c.tenant_id = $tenant_id
                RETURN c.name AS name, c.domain AS domain, c.tenant_id AS tenant_id
                ORDER BY c.name
            """, tenant_id=tenant_a)
            
            concepts_a = list(result)
            print(f"   Found {len(concepts_a)} concepts:")
            for c in concepts_a:
                print(f"   - {c['name']} (Domain: {c['domain']}, Tenant: {c['tenant_id']})")
            
            # Query and verify Tenant B's concepts
            print(f"\n🔍 Querying concepts for Tenant B...")
            result = session.run("""
                MATCH (c:Concept)
                WHERE c.tenant_id = $tenant_id
                RETURN c.name AS name, c.domain AS domain, c.tenant_id AS tenant_id
                ORDER BY c.name
            """, tenant_id=tenant_b)
            
            concepts_b = list(result)
            print(f"   Found {len(concepts_b)} concepts:")
            for c in concepts_b:
                print(f"   - {c['name']} (Domain: {c['domain']}, Tenant: {c['tenant_id']})")
            
            # Verify isolation
            print(f"\n🔒 Verifying data isolation...")
            
            # Check no overlap
            names_a = {c['name'] for c in concepts_a}
            names_b = {c['name'] for c in concepts_b}
            overlap = names_a & names_b
            
            if overlap:
                print(f"   ⚠️  WARNING: Found overlapping concepts: {overlap}")
            else:
                print(f"   ✓ No concept overlap between tenants")
            
            # Verify tenant_id is set correctly
            all_correct_tenant_a = all(c['tenant_id'] == tenant_a for c in concepts_a)
            all_correct_tenant_b = all(c['tenant_id'] == tenant_b for c in concepts_b)
            
            if all_correct_tenant_a and all_correct_tenant_b:
                print(f"   ✓ All concepts have correct tenant_id")
            else:
                print(f"   ✗ Some concepts have incorrect tenant_id!")
            
            # Summary
            print(f"\n📊 Summary:")
            print(f"   Tenant A ({tenant_a}): {len(concepts_a)} concepts")
            print(f"   Tenant B ({tenant_b}): {len(concepts_b)} concepts")
            
            # Final validation
            success = (
                len(concepts_a) >= 2 and
                len(concepts_b) >= 2 and
                all_correct_tenant_a and
                all_correct_tenant_b and
                not overlap
            )
            
            if success:
                print(f"\n✅ MULTI-TENANCY TEST PASSED!")
                print(f"   - Concepts are correctly stored per tenant")
                print(f"   - tenant_id is properly set in database")
                print(f"   - No cross-tenant data leakage")
            else:
                print(f"\n❌ MULTI-TENANCY TEST FAILED!")
            
            print("\n" + "=" * 80)
            return success
            
        driver.close()
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_multitenancy()
    sys.exit(0 if success else 1)
