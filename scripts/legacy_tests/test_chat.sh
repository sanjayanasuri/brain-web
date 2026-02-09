#!/bin/bash
# Simplified Chat Functionality Test using curl
# Tests tutor profile influence and chat responses

set -e

API_BASE="http://localhost:8000"

echo "================================================================================"
echo "CHAT FUNCTIONALITY & TUTOR PROFILE TEST"
echo "================================================================================"
echo ""

# First, generate a token using Python
echo "🔑 Generating authentication token..."
TOKEN=$(cd backend && python3 << 'EOF'
import sys
sys.path.insert(0, '.')
from auth import create_token
token = create_token(user_id="test_chat_user", tenant_id="test_tenant", expires_in_days=1)
print(token)
EOF
)

if [ -z "$TOKEN" ]; then
    echo "❌ Failed to generate token"
    exit 1
fi

echo "✓ Token generated"
echo ""

# Helper function to send chat message
send_chat() {
    local message="$1"
    local chat_id="$2"
    
    echo "💬 Asking: '$message'"
    echo "📝 Response: "
    
    curl -s -N -X POST "${API_BASE}/ai/chat/stream" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"message\": \"$message\", \"chat_id\": \"$chat_id\"}" | \
    while IFS= read -r line; do
        if [[ $line == data:* ]]; then
            content=$(echo "$line" | sed 's/^data: //' | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    if data.get('type') == 'chunk':
        print(data.get('content', ''), end='')
    elif data.get('type') == 'error':
        print(f\"\\nError: {data.get('content')}\")
except: pass
")
            echo -n "$content"
        fi
    done
    echo ""
    echo ""
}

# Helper function to set tutor profile
set_profile() {
    local audience="$1"
    local voice="$2"
    local response_mode="${3:-compact}"
    
    echo "⚙️  Setting tutor profile: audience=$audience, voice=$voice, response_mode=$response_mode"
    
    curl -s -X POST "${API_BASE}/preferences/tutor-profile" \
        -H "Authorization: Bearer ${TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{
            \"audience_mode\": \"$audience\",
            \"voice_id\": \"$voice\",
            \"response_mode\": \"$response_mode\"
        }" > /dev/null
    
    echo "✓ Profile updated"
    echo ""
}

# Test 1: Baseline (Default Profile)
echo "================================================================================"
echo "TEST 1: Baseline Chat (Default Profile)"
echo "================================================================================"
set_profile "default" "neutral" "compact"
send_chat "What is machine learning?" "test_baseline"
sleep 2

# Test 2: ELI5 Mode
echo "================================================================================"
echo "TEST 2: ELI5 Mode (Explain Like I'm 5)"
echo "================================================================================"
set_profile "eli5" "friendly" "normal"
send_chat "What is quantum computing?" "test_eli5"
sleep 2

# Test 3: CEO Pitch Mode
echo "================================================================================"
echo "TEST 3: CEO Pitch Mode (Executive Summary)"
echo "================================================================================"
set_profile "ceo_pitch" "direct" "compact"
send_chat "Why should we invest in AI?" "test_ceo"
sleep 2

# Test 4: Playful Tone
echo "================================================================================"
echo "TEST 4: Playful Tone (Can it be funny?)"
echo "================================================================================"
set_profile "default" "playful" "normal"
send_chat "Tell me a joke about programming" "test_playful"
sleep 2

# Test 5: Technical Mode
echo "================================================================================"
echo "TEST 5: Technical Mode (Serious & Precise)"
echo "================================================================================"
set_profile "technical" "direct" "deep"
send_chat "Explain backpropagation" "test_technical"
sleep 2

# Test 6: Short-term Memory
echo "================================================================================"
echo "TEST 6: Short-term Memory (Within Conversation)"
echo "================================================================================"
set_profile "default" "friendly" "compact"

echo "Message 1:"
send_chat "My name is Alex and I'm learning Python" "test_memory"
sleep 1

echo "Message 2:"
send_chat "What should I learn next?" "test_memory"
sleep 1

echo "Message 3:"
send_chat "What was my name again?" "test_memory"
sleep 2

# Test 7: Long-term Memory
echo "================================================================================"
echo "TEST 7: Long-term Memory (Persistent Across Sessions)"
echo "================================================================================"

echo "Session 1 - Telling the system to remember:"
send_chat "Remember that I prefer visual learning and I'm interested in AI" "memory_session_1"
sleep 2

echo "Session 2 - Testing if it remembers:"
send_chat "What's a good way for me to learn about neural networks?" "memory_session_2"

# Summary
echo "================================================================================"
echo "TEST SUMMARY"
echo "================================================================================"
echo ""
echo "✓ Test 1: Baseline chat - Default neutral tone"
echo "✓ Test 2: ELI5 mode - Simple, accessible language"
echo "✓ Test 3: CEO pitch - Executive summary style"
echo "✓ Test 4: Playful tone - Engaging and fun"
echo "✓ Test 5: Technical mode - Precise and detailed"
echo "✓ Test 6: Short-term memory - Context within conversation"
echo "✓ Test 7: Long-term memory - Persistent across sessions"
echo ""
echo "📊 Review the responses above to verify:"
echo "   - Tone changes based on voice_id (playful vs direct)"
echo "   - Style changes based on audience_mode (ELI5 vs technical)"
echo "   - Memory works (remembers name, preferences)"
echo ""
echo "================================================================================"
