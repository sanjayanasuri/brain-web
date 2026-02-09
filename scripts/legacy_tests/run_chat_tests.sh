#!/bin/bash
# Ready-to-Run Chat Test Commands
# Copy and paste these into your terminal

# STEP 1: Set the correct token (use the actual token value!)
export TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoidGVzdCIsInRlbmFudF9pZCI6InRlc3QiLCJleHAiOjE3NzA3MDI4MzksImlhdCI6MTc3MDYxNjQzOX0.3ynTxR6n-j-g_S6iYgIjVKTKIy9U2vYydJorESutnA4"

# STEP 2: Test ELI5 Mode (Simple Explanations)
echo "=== TEST 1: ELI5 MODE ==="
curl -X POST http://localhost:8000/preferences/tutor-profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"audience_mode": "eli5", "voice_id": "friendly"}'

curl -N -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is quantum computing?", "chat_id": "test1"}'

echo -e "\n\n"

# STEP 3: Test Playful Mode (Funny)
echo "=== TEST 2: PLAYFUL MODE ==="
curl -X POST http://localhost:8000/preferences/tutor-profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"audience_mode": "default", "voice_id": "playful"}'

curl -N -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Tell me a joke about programming", "chat_id": "test2"}'

echo -e "\n\n"

# STEP 4: Test Technical Mode (Serious)
echo "=== TEST 3: TECHNICAL MODE ==="
curl -X POST http://localhost:8000/preferences/tutor-profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"audience_mode": "technical", "voice_id": "direct"}'

curl -N -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Explain backpropagation", "chat_id": "test3"}'

echo -e "\n\n"

# STEP 5: Test Short-term Memory
echo "=== TEST 4: SHORT-TERM MEMORY ==="
curl -X POST http://localhost:8000/preferences/tutor-profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"audience_mode": "default", "voice_id": "friendly"}'

echo "Message 1: Introduce yourself"
curl -N -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "My name is Alex and I am learning Python", "chat_id": "memory_test"}'

echo -e "\n\nMessage 2: Ask follow-up"
curl -N -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "What should I learn next?", "chat_id": "memory_test"}'

echo -e "\n\nMessage 3: Test name recall"
curl -N -X POST http://localhost:8000/ai/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "What was my name?", "chat_id": "memory_test"}'

echo -e "\n\n=== TESTS COMPLETE ==="
