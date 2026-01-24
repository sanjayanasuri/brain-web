#!/bin/bash
# Quick test runner for Contextual Branching feature
# Run this to verify the feature works end-to-end

set -e

echo "🧪 Testing Contextual Branching Feature"
echo "======================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Frontend Unit Tests
echo -e "${YELLOW}1. Running Frontend Unit Tests...${NC}"
cd frontend
if npm test -- --testPathPattern='branch|SelectableText|BranchChip' --passWithNoTests 2>&1 | tee /tmp/frontend-unit.log; then
    echo -e "${GREEN}✓ Frontend unit tests passed${NC}"
else
    echo -e "${RED}✗ Frontend unit tests failed${NC}"
    echo "Check /tmp/frontend-unit.log for details"
    exit 1
fi
cd ..

# Backend Tests
echo ""
echo -e "${YELLOW}2. Running Backend Tests...${NC}"
cd backend
if python -m pytest tests/test_contextual_branches*.py -v 2>&1 | tee /tmp/backend-tests.log; then
    echo -e "${GREEN}✓ Backend tests passed${NC}"
else
    echo -e "${RED}✗ Backend tests failed${NC}"
    echo "Check /tmp/backend-tests.log for details"
    exit 1
fi
cd ..

echo ""
echo -e "${GREEN}🎉 All Contextual Branching tests passed!${NC}"
echo ""
echo "To run E2E tests, use:"
echo "  cd frontend && npm run test:e2e:branching"
