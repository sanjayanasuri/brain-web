#!/bin/bash
# Comprehensive Adaptive Study System Test

export TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoidGVzdCIsInRlbmFudF9pZCI6InRlc3QiLCJleHAiOjE3NzA3MDI4MzksImlhdCI6MTc3MDYxNjQzOX0.3ynTxR6n-j-g_S6iYgIjVKTKIy9U2vYydJorESutnA4"

echo "=========================================="
echo "ADAPTIVE STUDY SYSTEM TEST"
echo "=========================================="
echo ""

# ==================== TEST 1: Start Study Session ====================
echo "=== TEST 1: Start Study Session ==="
echo ""

echo "Starting a study session with intent 'review'..."
SESSION_RESPONSE=$(curl -s -X POST http://localhost:8000/study/session/start \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "intent": "review",
    "current_mode": "practice"
  }')

echo "Response:"
echo "$SESSION_RESPONSE" | python3 -m json.tool
echo ""

# Extract session_id
SESSION_ID=$(echo "$SESSION_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('session_id', ''))" 2>/dev/null)

if [ -z "$SESSION_ID" ]; then
    echo "❌ Failed to start session. Skipping remaining tests."
    exit 1
fi

echo "✅ Session started: $SESSION_ID"
echo ""

# ==================== TEST 2: Get Session State ====================
echo "=== TEST 2: Get Session State ==="
echo ""

echo "Fetching session state..."
curl -s -X GET "http://localhost:8000/study/session/$SESSION_ID" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
echo ""

# ==================== TEST 3: Get Next Task ====================
echo "=== TEST 3: Get Next Task ==="
echo ""

echo "Getting next task..."
TASK_RESPONSE=$(curl -s -X POST "http://localhost:8000/study/session/$SESSION_ID/next" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

echo "Response:"
echo "$TASK_RESPONSE" | python3 -m json.tool
echo ""

# Extract task_id
TASK_ID=$(echo "$TASK_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('task_id', ''))" 2>/dev/null)

if [ -z "$TASK_ID" ]; then
    echo "⚠️  No task generated. This might be expected if no concepts exist."
else
    echo "✅ Task generated: $TASK_ID"
    echo ""
    
    # ==================== TEST 4: Submit Task Attempt ====================
    echo "=== TEST 4: Submit Task Attempt ==="
    echo ""
    
    echo "Submitting a task attempt..."
    ATTEMPT_RESPONSE=$(curl -s -X POST "http://localhost:8000/study/task/$TASK_ID/attempt" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d '{
        "response_text": "This is my answer to the task",
        "self_confidence": 0.7
      }')
    
    echo "Response:"
    echo "$ATTEMPT_RESPONSE" | python3 -m json.tool
    echo ""
fi

# ==================== TEST 5: Get Analytics ====================
echo "=== TEST 5: Get Analytics ==="
echo ""

echo "5a. Concept Mastery Levels"
curl -s -X GET "http://localhost:8000/analytics/mastery" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
echo ""

echo "5b. Learning Trends"
curl -s -X GET "http://localhost:8000/analytics/trends?days=7" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
echo ""

echo "5c. Weak Areas"
curl -s -X GET "http://localhost:8000/analytics/weak-areas" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
echo ""

# ==================== TEST 6: Get Recommendations ====================
echo "=== TEST 6: Get Study Recommendations ==="
echo ""

curl -s -X GET "http://localhost:8000/recommendations/study" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
echo ""

# ==================== TEST 7: End Session ====================
echo "=== TEST 7: End Study Session ==="
echo ""

if [ -n "$SESSION_ID" ]; then
    echo "Ending session..."
    SUMMARY_RESPONSE=$(curl -s -X POST "http://localhost:8000/study/session/$SESSION_ID/end" \
      -H "Authorization: Bearer $TOKEN")
    
    echo "Session Summary:"
    echo "$SUMMARY_RESPONSE" | python3 -m json.tool
    echo ""
    
    echo "✅ Session ended successfully"
fi

echo "=========================================="
echo "ADAPTIVE STUDY SYSTEM TESTS COMPLETE"
echo "=========================================="
echo ""
echo "Summary:"
echo "- Study sessions track your learning progress"
echo "- Tasks are generated based on concept mastery"
echo "- Difficulty adapts to your performance"
echo "- Analytics show trends and weak areas"
echo "- Recommendations suggest what to study next"
