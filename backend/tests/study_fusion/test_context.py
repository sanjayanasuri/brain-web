import os
import sys
import json
import uuid
import logging

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from services_memory_orchestrator import get_study_context, get_unified_context

def test_study_context_structure():
    print("--- Testing Study Context Structure ---")
    user_id = "test-user-fused"
    tenant_id = "test-tenant"
    
    try:
        context = get_study_context(user_id, tenant_id)
        print(f"Study Context: {json.dumps(context, indent=2)}")
        assert isinstance(context, dict)
        # Even if DB is empty, it should return a dict with these keys
        assert "difficulty" in context
        assert "performance" in context
        assert "gap_concepts" in context
        print("✅ Study context structure verified.")
    except Exception as e:
        print(f"❌ Study context structure check failed: {e}")

def test_unified_context_integration():
    print("\n--- Testing Unified Context Integration ---")
    user_id = "test-user-fused"
    tenant_id = "test-tenant"
    chat_id = str(uuid.uuid4())
    
    try:
        context = get_unified_context(
            user_id=user_id,
            tenant_id=tenant_id,
            chat_id=chat_id,
            query="Testing fusion",
            session=None,
            include_study_context=True
        )
        assert "study_context" in context
        print("✅ Unified context returned study_context.")
        print(f"Unified Context Keys: {list(context.keys())}")
    except Exception as e:
        print(f"❌ Unified context integration test failed: {e}")

if __name__ == "__main__":
    test_study_context_structure()
    test_unified_context_integration()
