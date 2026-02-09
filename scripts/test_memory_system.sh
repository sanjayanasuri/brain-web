#!/bin/bash

# Comprehensive Three-Tier Memory System Test

set -e

BASE_URL="http://localhost:8000"
TOKEN="test-token-12345"

echo "=========================================="
echo "THREE-TIER MEMORY SYSTEM TEST"
echo "=========================================="
echo ""
echo "Testing:"
echo "1. Short-term memory (Redis chat history)"
echo "2. Long-term memory (Neo4j user facts)"
echo "3. Cross-session recall"
echo ""

# Generate unique chat IDs
CHAT_1="memory-test-$(date +%s)-1"
CHAT_2="memory-test-$(date +%s)-2"
CHAT_3="memory-test-$(date +%s)-3"

echo "=== PHASE 1: Teaching Facts ==="
echo ""

echo "1a. Introducing myself"
echo "Message: 'My name is Sarah and I'm a computer science student at MIT'"
curl -s -X POST "$BASE_URL/ai/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"My name is Sarah and I'm a computer science student at MIT\",
    \"chat_id\": \"$CHAT_1\"
  }" | grep -o '"content":"[^"]*"' | sed 's/"content":"//;s/"//' | tr -d '\n'

echo -e "\n\n"

echo "1b. Sharing interests"
echo "Message: 'I love machine learning and want to specialize in computer vision'"
curl -s -X POST "$BASE_URL/ai/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"I love machine learning and want to specialize in computer vision\",
    \"chat_id\": \"$CHAT_1\"
  }" | grep -o '"content":"[^"]*"' | sed 's/"content":"//;s/"//' | tr -d '\n'

echo -e "\n\n"

echo "1c. Expressing confusion"
echo "Message: 'I'm really struggling with understanding backpropagation'"
curl -s -X POST "$BASE_URL/ai/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"I'm really struggling with understanding backpropagation\",
    \"chat_id\": \"$CHAT_1\"
  }" | grep -o '"content":"[^"]*"' | sed 's/"content":"//;s/"//' | tr -d '\n'

echo -e "\n\n"

echo "Waiting 5 seconds for fact extraction..."
sleep 5

echo ""
echo "=== PHASE 2: Short-Term Memory (Same Chat) ==="
echo ""

echo "2a. Testing pronoun resolution"
echo "Message: 'Can you explain it to me?'"
curl -s -X POST "$BASE_URL/ai/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"Can you explain it to me?\",
    \"chat_id\": \"$CHAT_1\"
  }" | grep -o '"content":"[^"]*"' | sed 's/"content":"//;s/"//' | tr -d '\n'

echo -e "\n\n"

echo ""
echo "=== PHASE 3: Long-Term Memory (New Chat) ==="
echo ""

echo "3a. New chat - asking about name"
echo "Message: 'What's my name?'"
curl -s -X POST "$BASE_URL/ai/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"What's my name?\",
    \"chat_id\": \"$CHAT_2\"
  }" | grep -o '"content":"[^"]*"' | sed 's/"content":"//;s/"//' | tr -d '\n'

echo -e "\n\n"

echo "3b. Asking about school"
echo "Message: 'Where do I go to school?'"
curl -s -X POST "$BASE_URL/ai/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"Where do I go to school?\",
    \"chat_id\": \"$CHAT_2\"
  }" | grep -o '"content":"[^"]*"' | sed 's/"content":"//;s/"//' | tr -d '\n'

echo -e "\n\n"

echo "3c. Asking about interests"
echo "Message: 'What do I want to specialize in?'"
curl -s -X POST "$BASE_URL/ai/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"What do I want to specialize in?\",
    \"chat_id\": \"$CHAT_2\"
  }" | grep -o '"content":"[^"]*"' | sed 's/"content":"//;s/"//' | tr -d '\n'

echo -e "\n\n"

echo "3d. Asking about confusions"
echo "Message: 'What concepts am I struggling with?'"
curl -s -X POST "$BASE_URL/ai/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"What concepts am I struggling with?\",
    \"chat_id\": \"$CHAT_2\"
  }" | grep -o '"content":"[^"]*"' | sed 's/"content":"//;s/"//' | tr -d '\n'

echo -e "\n\n"

echo ""
echo "=== PHASE 4: Redis Cache Performance ==="
echo ""

echo "4a. First message in new chat (cache miss)"
START_TIME=$(date +%s%N)
curl -s -X POST "$BASE_URL/ai/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"Hello!\",
    \"chat_id\": \"$CHAT_3\"
  }" > /dev/null
END_TIME=$(date +%s%N)
MISS_TIME=$(( ($END_TIME - $START_TIME) / 1000000 ))
echo "Cache miss time: ${MISS_TIME}ms"

echo ""
echo "4b. Second message in same chat (cache hit)"
START_TIME=$(date +%s%N)
curl -s -X POST "$BASE_URL/ai/chat/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"How are you?\",
    \"chat_id\": \"$CHAT_3\"
  }" > /dev/null
END_TIME=$(date +%s%N)
HIT_TIME=$(( ($END_TIME - $START_TIME) / 1000000 ))
echo "Cache hit time: ${HIT_TIME}ms"

echo ""
echo "=========================================="
echo "TEST RESULTS"
echo "=========================================="
echo ""
echo "✅ Expected Results:"
echo "  - Phase 2a: Should explain backpropagation (pronoun 'it' resolved)"
echo "  - Phase 3a: Should recall 'Sarah'"
echo "  - Phase 3b: Should recall 'MIT'"
echo "  - Phase 3c: Should mention 'computer vision'"
echo "  - Phase 3d: Should mention 'backpropagation'"
echo "  - Phase 4: Cache hit should be faster than cache miss"
echo ""
echo "📊 Performance:"
echo "  - Cache miss: ${MISS_TIME}ms"
echo "  - Cache hit:  ${HIT_TIME}ms"
if [ $HIT_TIME -lt $MISS_TIME ]; then
    echo "  ✅ Redis cache is working! (${HIT_TIME}ms < ${MISS_TIME}ms)"
else
    echo "  ⚠️  Cache performance unclear"
fi
echo ""
echo "If all facts are recalled correctly, the three-tier memory system is working!"
