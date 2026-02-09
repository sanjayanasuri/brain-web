#!/bin/bash
# Test Custom Tutor Instructions

export TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoidGVzdCIsInRlbmFudF9pZCI6InRlc3QiLCJleHAiOjE3NzA3MDI4MzksImlhdCI6MTc3MDYxNjQzOX0.3ynTxR6n-j-g_S6iYgIjVKTKIy9U2vYydJorESutnA4"

# Function to extract and display chat response
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
echo "CUSTOM TUTOR INSTRUCTIONS TEST"
echo "=========================================="
echo ""

# Test 1: Socratic Tutor
echo "=== TEST 1: Socratic Tutor ==="
echo "Setting custom instructions..."
curl -s -X POST http://localhost:8000/preferences/tutor-profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "custom_instructions": "You are a Socratic tutor. Never give direct answers. Instead, ask probing questions that guide the student to discover the answer themselves. Be patient and encouraging."
  }' > /dev/null

echo "Question: 'What is recursion?'"
echo -n "Response: "
curl -N -s -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is recursion?", "chat_id": "custom_test1"}' | extract_response

echo -e "\n"

# Test 2: Pirate Tutor
echo "=== TEST 2: Pirate Tutor ==="
echo "Setting custom instructions..."
curl -s -X POST http://localhost:8000/preferences/tutor-profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "custom_instructions": "You are a pirate tutor. Explain concepts using nautical metaphors and pirate slang. Say '\''Arrr!'\'' occasionally. Make learning an adventure on the high seas!"
  }' > /dev/null

echo "Question: 'Explain how databases work'"
echo -n "Response: "
curl -N -s -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Explain how databases work", "chat_id": "custom_test2"}' | extract_response

echo -e "\n"

# Test 3: Zen Master
echo "=== TEST 3: Zen Master ==="
echo "Setting custom instructions..."
curl -s -X POST http://localhost:8000/preferences/tutor-profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "custom_instructions": "You are a Zen master teaching through koans and paradoxes. Speak in calm, contemplative tones. Use metaphors from nature. Help students find insight through reflection."
  }' > /dev/null

echo "Question: 'What is the purpose of testing?'"
echo -n "Response: "
curl -N -s -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the purpose of testing?", "chat_id": "custom_test3"}' | extract_response

echo -e "\n"

# Test 4: Back to predefined mode
echo "=== TEST 4: Back to Predefined Mode (ELI5) ==="
echo "Clearing custom instructions and using predefined mode..."
curl -s -X POST http://localhost:8000/preferences/tutor-profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "custom_instructions": null,
    "audience_mode": "eli5",
    "voice_id": "friendly"
  }' > /dev/null

echo "Question: 'What is an API?'"
echo -n "Response: "
curl -N -s -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is an API?", "chat_id": "custom_test4"}' | extract_response

echo -e "\n=========================================="
echo "TESTS COMPLETE"
echo "=========================================="
