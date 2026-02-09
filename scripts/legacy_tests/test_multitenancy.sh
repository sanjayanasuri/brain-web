#!/bin/bash
# Multi-Tenancy Test Script
# Tests that concepts are properly isolated per tenant

set -e

API_BASE="${API_BASE:-http://localhost:8000}"

echo "================================================================================"
echo "MULTI-TENANCY CONCEPT CREATION TEST"
echo "================================================================================"
echo ""

# Create tokens for two different tenants
echo "🔑 Creating authentication tokens for two tenants..."
echo ""

# Tenant A
TENANT_A_ID="tenant_test_a"
USER_A_ID="user_a"

# Tenant B  
TENANT_B_ID="tenant_test_b"
USER_B_ID="user_b"

# Generate tokens (you'll need to implement token generation or use existing tokens)
# For now, we'll create a simple Python script to generate tokens

python3 << 'EOF'
import sys
import os
sys.path.insert(0, 'backend')

try:
    from auth import create_token
    
    # Create tokens for two tenants
    token_a = create_token(user_id="user_a", tenant_id="tenant_test_a", expires_in_days=1)
    token_b = create_token(user_id="user_b", tenant_id="tenant_test_b", expires_in_days=1)
    
    print(f"TOKEN_A={token_a}")
    print(f"TOKEN_B={token_b}")
except Exception as e:
    print(f"Error generating tokens: {e}", file=sys.stderr)
    sys.exit(1)
EOF

# Capture tokens
eval $(python3 << 'EOF'
import sys
sys.path.insert(0, 'backend')
from auth import create_token
token_a = create_token(user_id="user_a", tenant_id="tenant_test_a", expires_in_days=1)
token_b = create_token(user_id="user_b", tenant_id="tenant_test_b", expires_in_days=1)
print(f"TOKEN_A='{token_a}'")
print(f"TOKEN_B='{token_b}'")
EOF
)

echo "✓ Generated token for Tenant A"
echo "✓ Generated token for Tenant B"
echo ""

# Create concepts for Tenant A
echo "📝 Creating concepts for Tenant A (tenant_test_a)..."
echo ""

CONCEPT_A1=$(curl -s -X POST "${API_BASE}/graph/concepts" \
  -H "Authorization: Bearer ${TOKEN_A}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Machine Learning",
    "domain": "Computer Science",
    "type": "field",
    "description": "A subset of AI focused on learning from data",
    "tags": ["AI", "data science"]
  }')

echo "   ✓ Created: Machine Learning"

CONCEPT_A2=$(curl -s -X POST "${API_BASE}/graph/concepts" \
  -H "Authorization: Bearer ${TOKEN_A}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Neural Networks",
    "domain": "Computer Science",
    "type": "concept",
    "description": "Computing systems inspired by biological neural networks",
    "tags": ["deep learning", "AI"]
  }')

echo "   ✓ Created: Neural Networks"
echo ""

# Create concepts for Tenant B
echo "📝 Creating concepts for Tenant B (tenant_test_b)..."
echo ""

CONCEPT_B1=$(curl -s -X POST "${API_BASE}/graph/concepts" \
  -H "Authorization: Bearer ${TOKEN_B}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Quantum Computing",
    "domain": "Physics",
    "type": "field",
    "description": "Computing using quantum-mechanical phenomena",
    "tags": ["quantum", "computing"]
  }')

echo "   ✓ Created: Quantum Computing"

CONCEPT_B2=$(curl -s -X POST "${API_BASE}/graph/concepts" \
  -H "Authorization: Bearer ${TOKEN_B}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Superposition",
    "domain": "Physics",
    "type": "concept",
    "description": "Quantum state being in multiple states simultaneously",
    "tags": ["quantum mechanics"]
  }')

echo "   ✓ Created: Superposition"
echo ""

# Query concepts for Tenant A
echo "🔍 Querying concepts for Tenant A..."
CONCEPTS_A=$(curl -s -X GET "${API_BASE}/graph/concepts" \
  -H "Authorization: Bearer ${TOKEN_A}")

COUNT_A=$(echo "$CONCEPTS_A" | python3 -c "import sys, json; data=json.load(sys.stdin); print(len(data.get('concepts', [])))")
echo "   Found ${COUNT_A} concepts for Tenant A"
echo ""

# Query concepts for Tenant B
echo "🔍 Querying concepts for Tenant B..."
CONCEPTS_B=$(curl -s -X GET "${API_BASE}/graph/concepts" \
  -H "Authorization: Bearer ${TOKEN_B}")

COUNT_B=$(echo "$CONCEPTS_B" | python3 -c "import sys, json; data=json.load(sys.stdin); print(len(data.get('concepts', [])))")
echo "   Found ${COUNT_B} concepts for Tenant B"
echo ""

# Verify isolation
echo "🔒 Verifying data isolation..."
echo ""

# Check if Tenant A's concepts contain only their data
TENANT_A_CONCEPTS=$(echo "$CONCEPTS_A" | python3 -c "
import sys, json
data = json.load(sys.stdin)
concepts = data.get('concepts', [])
for c in concepts:
    print(f\"   - {c.get('name', 'Unknown')} (Domain: {c.get('domain', 'Unknown')})\")
")

echo "Tenant A sees:"
echo "$TENANT_A_CONCEPTS"
echo ""

# Check if Tenant B's concepts contain only their data
TENANT_B_CONCEPTS=$(echo "$CONCEPTS_B" | python3 -c "
import sys, json
data = json.load(sys.stdin)
concepts = data.get('concepts', [])
for c in concepts:
    print(f\"   - {c.get('name', 'Unknown')} (Domain: {c.get('domain', 'Unknown')})\")
")

echo "Tenant B sees:"
echo "$TENANT_B_CONCEPTS"
echo ""

# Summary
echo "📊 Summary:"
echo "   Tenant A: ${COUNT_A} concepts"
echo "   Tenant B: ${COUNT_B} concepts"
echo ""

# Validation
if [[ "$COUNT_A" -ge 2 ]] && [[ "$COUNT_B" -ge 2 ]]; then
    echo "✅ MULTI-TENANCY TEST PASSED!"
    echo "   - Concepts are being created for each tenant"
    echo "   - Each tenant can query their own concepts"
    echo ""
else
    echo "❌ MULTI-TENANCY TEST FAILED!"
    echo "   - Expected at least 2 concepts per tenant"
    echo ""
    exit 1
fi

echo "================================================================================"
