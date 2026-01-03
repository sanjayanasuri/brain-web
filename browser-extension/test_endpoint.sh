#!/bin/bash
# Quick test script to verify the capture-selection endpoint is working

API_BASE="${1:-http://localhost:8000}"

echo "Testing Brain Web capture-selection endpoint..."
echo "API Base: $API_BASE"
echo ""

curl -X POST "$API_BASE/sync/capture-selection" \
  -H "Content-Type: application/json" \
  -H "x-session-id: test-session-123" \
  -d '{
    "selected_text": "This is a test quote",
    "page_url": "https://example.com/test",
    "page_title": "Test Page",
    "context_before": "Some context before",
    "context_after": "Some context after"
  }' \
  -v

echo ""
echo ""
echo "If you see a 200 OK response with quote_id and artifact_id, the endpoint is working!"

