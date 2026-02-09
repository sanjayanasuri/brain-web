#!/bin/bash
# Comprehensive Chat Features Test

export TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoidGVzdCIsInRlbmFudF9pZCI6InRlc3QiLCJleHAiOjE3NzA3MDI4MzksImlhdCI6MTc3MDYxNjQzOX0.3ynTxR6n-j-g_S6iYgIjVKTKIy9U2vYydJorESutnA4"

# Function to extract chat response
extract_response() {
    python3 -c "
import sys, json
for line in sys.stdin:
    if line.startswith('data: '):
        try:
            data = json.loads(line[6:])
            if data.get('type') == 'chunk':
                print(data.get('content', ''), end='', flush=True)
        except: pass
print()
"
}

echo "=========================================="
echo "CHAT FEATURES COMPREHENSIVE TEST"
echo "=========================================="
echo ""

# ==================== TEST 1: Response Modes ====================
echo "=== TEST 1: Response Modes ==="
echo ""

echo "1a. COMPACT mode (brief, concise)"
curl -s -X POST http://localhost:8000/preferences/tutor-profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"response_mode": "compact", "custom_instructions": null, "audience_mode": "default"}' > /dev/null

echo "Question: 'What is machine learning?'"
echo -n "Response: "
curl -N -s -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is machine learning?", "chat_id": "chat_features_test"}' | extract_response
echo -e "\n"

echo "1b. DEEP mode (detailed, comprehensive)"
curl -s -X POST http://localhost:8000/preferences/tutor-profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"response_mode": "deep"}' > /dev/null

echo "Question: 'What is machine learning?'"
echo -n "Response: "
curl -N -s -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is machine learning?", "chat_id": "chat_features_test"}' | extract_response
echo -e "\n"

# ==================== TEST 2: Question Policies ====================
echo "=== TEST 2: Question Policies ==="
echo ""

echo "2a. NEVER ask questions"
curl -s -X POST http://localhost:8000/preferences/tutor-profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ask_question_policy": "never", "response_mode": "compact"}' > /dev/null

echo "Statement: 'I learned about neural networks today'"
echo -n "Response: "
curl -N -s -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "I learned about neural networks today", "chat_id": "chat_features_test"}' | extract_response
echo -e "\n"

echo "2b. OK to ask questions"
curl -s -X POST http://localhost:8000/preferences/tutor-profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ask_question_policy": "ok"}' > /dev/null

echo "Statement: 'I learned about neural networks today'"
echo -n "Response: "
curl -N -s -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "I learned about neural networks today", "chat_id": "chat_features_test"}' | extract_response
echo -e "\n"

# ==================== TEST 3: Memory & Context ====================
echo "=== TEST 3: Memory & Context ==="
echo ""

# Reset to default settings
curl -s -X POST http://localhost:8000/preferences/tutor-profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"response_mode": "compact", "ask_question_policy": "at_most_one", "custom_instructions": null}' > /dev/null

echo "3a. Teaching the AI a fact"
echo "Message: 'My name is Alex and I am studying computer science'"
echo -n "Response: "
curl -N -s -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "My name is Alex and I am studying computer science", "chat_id": "memory_test"}' | extract_response
echo -e "\n"

echo "3b. Testing short-term memory (same chat)"
echo "Message: 'What am I studying?'"
echo -n "Response: "
curl -N -s -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "What am I studying?", "chat_id": "memory_test"}' | extract_response
echo -e "\n"

echo "3c. Testing context switch (different chat)"
echo "Message: 'What is my name?'"
echo -n "Response: "
curl -N -s -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is my name?", "chat_id": "different_chat"}' | extract_response
echo -e "\n"

# ==================== TEST 4: No Glazing (Directness) ====================
echo "=== TEST 4: No Glazing (Directness) ==="
echo ""

echo "4a. Supportive mode (glazing = false)"
curl -s -X POST http://localhost:8000/preferences/tutor-profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"no_glazing": false}' > /dev/null

echo "Statement: 'I think 2+2=5'"
echo -n "Response: "
curl -N -s -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "I think 2+2=5", "chat_id": "glazing_test"}' | extract_response
echo -e "\n"

echo "4b. Direct mode (no_glazing = true)"
curl -s -X POST http://localhost:8000/preferences/tutor-profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"no_glazing": true}' > /dev/null

echo "Statement: 'I think 2+2=5'"
echo -n "Response: "
curl -N -s -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "I think 2+2=5", "chat_id": "glazing_test"}' | extract_response
echo -e "\n"

# ==================== TEST 5: Combined Settings ====================
echo "=== TEST 5: Combined Settings ==="
echo ""

curl -s -X POST http://localhost:8000/preferences/tutor-profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "custom_instructions": "You are a motivational coach who uses sports metaphors",
    "response_mode": "compact",
    "ask_question_policy": "ok",
    "no_glazing": true
  }' > /dev/null

echo "Custom + Settings: Motivational coach + compact + questions OK + direct"
echo "Question: 'How do I get better at programming?'"
echo -n "Response: "
curl -N -s -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "How do I get better at programming?", "chat_id": "combined_test"}' | extract_response

echo -e "\n=========================================="
echo "CHAT FEATURES TESTS COMPLETE"
echo "=========================================="
