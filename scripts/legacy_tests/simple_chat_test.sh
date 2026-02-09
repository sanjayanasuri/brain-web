#!/bin/bash
# Simple Chat Test - Avoids concept creation issues

export TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoidGVzdCIsInRlbmFudF9pZCI6InRlc3QiLCJleHAiOjE3NzA3MDI4MzksImlhdCI6MTc3MDYxNjQzOX0.3ynTxR6n-j-g_S6iYgIjVKTKIy9U2vYydJorESutnA4"

echo "=== TEST 1: ELI5 MODE (Simple Explanations) ==="
curl -X POST http://localhost:8000/preferences/tutor-profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"audience_mode": "eli5", "voice_id": "friendly"}' 2>/dev/null

echo -e "\nAsking: 'Explain how a computer works'\n"
curl -N -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Explain how a computer works", "chat_id": "simple_test1"}' 2>/dev/null | grep -o '"content":"[^"]*"' | sed 's/"content":"//;s/"$//' | tr -d '\n'

echo -e "\n\n"

echo "=== TEST 2: PLAYFUL MODE (Funny) ==="
curl -X POST http://localhost:8000/preferences/tutor-profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"audience_mode": "default", "voice_id": "playful"}' 2>/dev/null

echo -e "\nAsking: 'Why do programmers prefer dark mode?'\n"
curl -N -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Why do programmers prefer dark mode?", "chat_id": "simple_test2"}' 2>/dev/null | grep -o '"content":"[^"]*"' | sed 's/"content":"//;s/"$//' | tr -d '\n'

echo -e "\n\n"

echo "=== TEST 3: TECHNICAL MODE (Serious) ==="
curl -X POST http://localhost:8000/preferences/tutor-profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"audience_mode": "technical", "voice_id": "direct"}' 2>/dev/null

echo -e "\nAsking: 'What is time complexity?'\n"
curl -N -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is time complexity?", "chat_id": "simple_test3"}' 2>/dev/null | grep -o '"content":"[^"]*"' | sed 's/"content":"//;s/"$//' | tr -d '\n'

echo -e "\n\n"

echo "=== TEST 4: MEMORY TEST ==="
curl -X POST http://localhost:8000/preferences/tutor-profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"audience_mode": "default", "voice_id": "friendly"}' 2>/dev/null

echo -e "\nMessage 1: 'My favorite color is blue'\n"
curl -N -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "My favorite color is blue", "chat_id": "memory_test"}' 2>/dev/null | grep -o '"content":"[^"]*"' | sed 's/"content":"//;s/"$//' | tr -d '\n'

echo -e "\n\nMessage 2: 'What is my favorite color?'\n"
curl -N -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is my favorite color?", "chat_id": "memory_test"}' 2>/dev/null | grep -o '"content":"[^"]*"' | sed 's/"content":"//;s/"$//' | tr -d '\n'

echo -e "\n\n=== TESTS COMPLETE ===\n"
