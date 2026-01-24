#!/bin/bash
# Comprehensive test runner for Brain Web
# Runs all tests (frontend + backend) and reports results

set -e

echo "🧪 Brain Web Test Suite"
echo "========================"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track test results
FRONTEND_UNIT_PASSED=true
FRONTEND_E2E_PASSED=true
BACKEND_PASSED=true

# Frontend Unit Tests (Jest)
echo -e "${YELLOW}Running Frontend Unit Tests (Jest)...${NC}"
cd frontend
if npm test -- --passWithNoTests 2>&1; then
    echo -e "${GREEN}✓ Frontend unit tests passed${NC}"
else
    echo -e "${RED}✗ Frontend unit tests failed${NC}"
    FRONTEND_UNIT_PASSED=false
fi
cd ..

echo ""

# Frontend E2E Tests (Playwright)
echo -e "${YELLOW}Running Frontend E2E Tests (Playwright)...${NC}"
cd frontend
if npm run test:e2e 2>&1; then
    echo -e "${GREEN}✓ Frontend E2E tests passed${NC}"
else
    echo -e "${RED}✗ Frontend E2E tests failed${NC}"
    FRONTEND_E2E_PASSED=false
fi
cd ..

echo ""

# Backend Tests (pytest)
echo -e "${YELLOW}Running Backend Tests (pytest)...${NC}"
cd backend
if python -m pytest tests/test_contextual_branches*.py -v 2>&1; then
    echo -e "${GREEN}✓ Backend tests passed${NC}"
else
    echo -e "${RED}✗ Backend tests failed${NC}"
    BACKEND_PASSED=false
fi
cd ..

echo ""
echo "========================"
echo "Test Summary:"
echo "========================"

if [ "$FRONTEND_UNIT_PASSED" = true ]; then
    echo -e "${GREEN}✓ Frontend Unit Tests${NC}"
else
    echo -e "${RED}✗ Frontend Unit Tests${NC}"
fi

if [ "$FRONTEND_E2E_PASSED" = true ]; then
    echo -e "${GREEN}✓ Frontend E2E Tests${NC}"
else
    echo -e "${RED}✗ Frontend E2E Tests${NC}"
fi

if [ "$BACKEND_PASSED" = true ]; then
    echo -e "${GREEN}✓ Backend Tests${NC}"
else
    echo -e "${RED}✗ Backend Tests${NC}"
fi

echo ""

if [ "$FRONTEND_UNIT_PASSED" = true ] && [ "$FRONTEND_E2E_PASSED" = true ] && [ "$BACKEND_PASSED" = true ]; then
    echo -e "${GREEN}🎉 All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some tests failed. Check output above.${NC}"
    exit 1
fi
