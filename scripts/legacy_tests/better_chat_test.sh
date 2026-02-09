#!/bin/bash
# Better Chat Test - Shows actual responses

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

echo "=== TEST 1: ELI5 MODE (Simple Explanations) ==="
curl -s -X POST http://localhost:8000/preferences/tutor-profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"audience_mode": "eli5", "voice_id": "friendly"}' > /dev/null

echo "Question: 'Explain how a computer works'"
echo -n "Response: "
curl -N -s -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Explain how a computer works", "chat_id": "test1"}' | extract_response

echo -e "\n"

echo "=== TEST 2: PLAYFUL MODE (Funny) ==="
curl -s -X POST http://localhost:8000/preferences/tutor-profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"audience_mode": "default", "voice_id": "playful"}' > /dev/null

echo "Question: 'Why do programmers prefer dark mode?'"
echo -n "Response: "
curl -N -s -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Why do programmers prefer dark mode?", "chat_id": "test2"}' | extract_response

echo -e "\n"

echo "=== TEST 3: TECHNICAL MODE (Serious) ==="
curl -s -X POST http://localhost:8000/preferences/tutor-profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"audience_mode": "technical", "voice_id": "direct"}' > /dev/null

echo "Question: 'What is time complexity?'"
echo -n "Response: "
curl -N -s -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is time complexity?", "chat_id": "test3"}' | extract_response

echo -e "\n=== TESTS COMPLETE ===\n"
