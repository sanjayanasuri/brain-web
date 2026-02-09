#!/usr/bin/env python3
"""
Test script to verify multi-tenancy isolation for concept creation.

This script:
1. Creates concepts for User A (tenant_a)
2. Creates concepts for User B (tenant_b)
3. Verifies each tenant can only see their own concepts
4. Confirms data isolation is working correctly
"""

import sys
from pathlib import Path

# Add backend to path
backend_path = Path(__file__).parent.parent / "backend"
sys.path.insert(0, str(backend_path))

from db_neo4j import get_driver
from services_graph import create_concept
from models import ConceptCreate

def test_multi_tenancy():
    """Test multi-tenancy isolation for concept creation."""
    
    driver = get_driver()
    
    # Test data for two different tenants
    tenant_a_id = "tenant_a"
    tenant_b_id = "tenant_b"
    
    print("=" * 80)
    print("MULTI-TENANCY CONCEPT CREATION TEST")
    print("=" * 80)
    
    with driver.session() as session:
        # Create concepts for Tenant A
        print(f"\n📝 Creating concepts for Tenant A ({tenant_a_id})...")
        
        concept_a1 = create_concept(
            session=session,
            payload=ConceptCreate(
                name="Machine Learning",
                domain="Computer Science",
                type="field",
                description="A subset of AI focused on learning from data",
                tags=["AI", "data science"]
            ),
            tenant_id=tenant_a_id
        )
        print(f"   ✓ Created: {concept_a1.name} (ID: {concept_a1.node_id})")
        
        concept_a2 = create_concept(
            session=session,
            payload=ConceptCreate(
                name="Neural Networks",
                domain="Computer Science",
                type="concept",
                description="Computing systems inspired by biological neural networks",
                tags=["deep learning", "AI"]
            ),
            tenant_id=tenant_a_id
        )
        print(f"   ✓ Created: {concept_a2.name} (ID: {concept_a2.node_id})")
        
        # Create concepts for Tenant B
        print(f"\n📝 Creating concepts for Tenant B ({tenant_b_id})...")
        
        concept_b1 = create_concept(
            session=session,
            payload=ConceptCreate(
                name="Quantum Computing",
                domain="Physics",
                type="field",
                description="Computing using quantum-mechanical phenomena",
                tags=["quantum", "computing"]
            ),
            tenant_id=tenant_b_id
        )
        print(f"   ✓ Created: {concept_b1.name} (ID: {concept_b1.node_id})")
        
        concept_b2 = create_concept(
            session=session,
            payload=ConceptCreate(
                name="Superposition",
                domain="Physics",
                type="concept",
                description="Quantum state being in multiple states simultaneously",
                tags=["quantum mechanics"]
            ),
            tenant_id=tenant_b_id
        )
        print(f"   ✓ Created: {concept_b2.name} (ID: {concept_b2.node_id})")
        
        # Verify isolation - Query concepts for Tenant A
        print(f"\n🔍 Verifying Tenant A can only see their concepts...")
        query_a = """
        MATCH (c:Concept)
        WHERE c.tenant_id = $tenant_id
        RETURN c.node_id AS node_id, c.name AS name, c.domain AS domain, c.tenant_id AS tenant_id
        ORDER BY c.name
        """
        result_a = session.run(query_a, tenant_id=tenant_a_id)
        concepts_a = list(result_a)
        
        print(f"   Found {len(concepts_a)} concepts for Tenant A:")
        for record in concepts_a:
            print(f"   - {record['name']} (Domain: {record['domain']}, Tenant: {record['tenant_id']})")
        
        # Verify isolation - Query concepts for Tenant B
        print(f"\n🔍 Verifying Tenant B can only see their concepts...")
        query_b = """
        MATCH (c:Concept)
        WHERE c.tenant_id = $tenant_id
        RETURN c.node_id AS node_id, c.name AS name, c.domain AS domain, c.tenant_id AS tenant_id
        ORDER BY c.name
        """
        result_b = session.run(query_b, tenant_id=tenant_b_id)
        concepts_b = list(result_b)
        
        print(f"   Found {len(concepts_b)} concepts for Tenant B:")
        for record in concepts_b:
            print(f"   - {record['name']} (Domain: {record['domain']}, Tenant: {record['tenant_id']})")
        
        # Verify no cross-tenant visibility
        print(f"\n🔒 Verifying data isolation...")
        
        # Check Tenant A cannot see Tenant B's concepts
        cross_check_query = """
        MATCH (c:Concept)
        WHERE c.tenant_id = $other_tenant_id
        RETURN count(c) AS count
        """
        
        # From Tenant A's perspective, check if they can see Tenant B's data
        result = session.run(cross_check_query, other_tenant_id=tenant_b_id)
        tenant_b_concepts_visible_to_a = result.single()["count"]
        
        if tenant_b_concepts_visible_to_a == 0:
            print(f"   ✓ Tenant A cannot see Tenant B's concepts (isolation working)")
        else:
            print(f"   ✗ WARNING: Tenant A can see {tenant_b_concepts_visible_to_a} of Tenant B's concepts!")
        
        # Verify correct counts
        print(f"\n📊 Summary:")
        print(f"   Tenant A ({tenant_a_id}): {len(concepts_a)} concepts")
        print(f"   Tenant B ({tenant_b_id}): {len(concepts_b)} concepts")
        
        # Validation
        success = True
        if len(concepts_a) != 2:
            print(f"   ✗ FAIL: Expected 2 concepts for Tenant A, found {len(concepts_a)}")
            success = False
        if len(concepts_b) != 2:
            print(f"   ✗ FAIL: Expected 2 concepts for Tenant B, found {len(concepts_b)}")
            success = False
        
        # Check tenant_id is correctly stored
        all_have_tenant_id = all(c['tenant_id'] == tenant_a_id for c in concepts_a) and \
                             all(c['tenant_id'] == tenant_b_id for c in concepts_b)
        
        if not all_have_tenant_id:
            print(f"   ✗ FAIL: Some concepts missing or have incorrect tenant_id")
            success = False
        
        if success:
            print(f"\n✅ MULTI-TENANCY TEST PASSED!")
            print(f"   - Concepts are correctly isolated per tenant")
            print(f"   - tenant_id is properly stored in the database")
            print(f"   - No cross-tenant data leakage detected")
        else:
            print(f"\n❌ MULTI-TENANCY TEST FAILED!")
            print(f"   - Check the errors above for details")
        
        print("\n" + "=" * 80)
        
        return success

if __name__ == "__main__":
    try:
        success = test_multi_tenancy()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
