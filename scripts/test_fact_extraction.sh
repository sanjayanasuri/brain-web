#!/bin/bash

# Test Fact Extraction and Cross-Session Memory

set -e

BASE_URL="http://localhost:8000"
TOKEN="test-token-12345"

echo "=========================================="
echo "FACT EXTRACTION & CROSS-SESSION MEMORY TEST"
echo "=========================================="

# Generate unique chat IDs for isolation
CHAT_1="test-chat-facts-$(date +%s)-1"
CHAT_2="test-chat-facts-$(date +%s)-2"

echo ""
echo "=== TEST 1: Fact Extraction ==="
echo ""
echo "1a. Teaching the AI personal facts"
echo "Message: 'My name is Alex and I love studying neural networks'"
curl -s -X POST "$BASE_URL/ai/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"My name is Alex and I love studying neural networks\",
    \"chat_id\": \"$CHAT_1\"
  }" | grep -o '"content":"[^"]*"' | sed 's/"content":"//;s/"//' | tr -d '\n'

echo -e "\n\n"

# Wait for background fact extraction
echo "Waiting 3 seconds for fact extraction..."
sleep 3

echo ""
echo "=== TEST 2: Cross-Session Memory (Same User, Different Chat) ==="
echo ""
echo "2a. New chat session - asking about name"
echo "Message: 'What's my name?'"
curl -s -X POST "$BASE_URL/ai/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"What's my name?\",
    \"chat_id\": \"$CHAT_2\"
  }" | grep -o '"content":"[^"]*"' | sed 's/"content":"//;s/"//' | tr -d '\n'

echo -e "\n\n"

echo "2b. Asking about interests"
echo "Message: 'What do I like to study?'"
curl -s -X POST "$BASE_URL/ai/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"What do I like to study?\",
    \"chat_id\": \"$CHAT_2\"
  }" | grep -o '"content":"[^"]*"' | sed 's/"content":"//;s/"//' | tr -d '\n'

echo -e "\n\n"

echo ""
echo "=== TEST 3: Learning Goals ==="
echo ""
echo "3a. Expressing a goal"
echo "Message: 'I want to build a transformer model from scratch'"
curl -s -X POST "$BASE_URL/ai/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"I want to build a transformer model from scratch\",
    \"chat_id\": \"$CHAT_1\"
  }" | grep -o '"content":"[^"]*"' | sed 's/"content":"//;s/"//' | tr -d '\n'

echo -e "\n\n"

# Wait for fact extraction
sleep 3

echo "3b. New chat - asking about goals"
echo "Message: 'What are my learning goals?'"
CHAT_3="test-chat-facts-$(date +%s)-3"
curl -s -X POST "$BASE_URL/ai/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"What are my learning goals?\",
    \"chat_id\": \"$CHAT_3\"
  }" | grep -o '"content":"[^"]*"' | sed 's/"content":"//;s/"//' | tr -d '\n'

echo -e "\n\n"

echo "=========================================="
echo "FACT EXTRACTION TESTS COMPLETE"
echo "=========================================="
echo ""
echo "Expected Results:"
echo "- Test 2a should recall 'Alex'"
echo "- Test 2b should mention 'neural networks'"
echo "- Test 3b should mention 'transformer model'"
echo ""
echo "If the AI remembers these facts across different chat sessions,"
echo "the cross-session memory system is working!"
