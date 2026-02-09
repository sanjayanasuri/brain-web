#!/bin/bash
# Simple Chat Test - Uses pre-generated token
# Run this after backend is running

set -e

API_BASE="http://localhost:8000"

# You'll need to generate a token first by running this in backend/:
# python3 -c "from auth import create_token; print(create_token(user_id='test', tenant_id='test', expires_in_days=1))"

echo "================================================================================"
echo "CHAT FUNCTIONALITY TEST"
echo "================================================================================"
echo ""

# For now, let's test if the server is responding
echo "🔍 Checking if server is running..."
if curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo "✓ Server is running!"
else
    echo "❌ Server is not running. Please start it first:"
    echo "   cd backend && uvicorn main:app --reload"
    exit 1
fi

echo ""
echo "📝 To run full chat tests, you need to:"
echo "1. Generate a token by running in backend/:"
echo "   python3 -c \"from auth import create_token; print(create_token(user_id='test', tenant_id='test', expires_in_days=1))\""
echo ""
echo "2. Export the token:"
echo "   export TEST_TOKEN='<your_token_here>'"
echo ""
echo "3. Test chat with different profiles:"
echo ""
echo "# Set ELI5 profile"
echo "curl -X POST http://localhost:8000/preferences/tutor-profile \\"
echo "  -H \"Authorization: Bearer \$TEST_TOKEN\" \\"
echo "  -H \"Content-Type: application/json\" \\"
echo "  -d '{\"audience_mode\": \"eli5\", \"voice_id\": \"friendly\"}'"
echo ""
echo "# Send a chat message"
echo "curl -X POST http://localhost:8000/ai/chat/stream \\"
echo "  -H \"Authorization: Bearer \$TEST_TOKEN\" \\"
echo "  -H \"Content-Type: application/json\" \\"
echo "  -d '{\"message\": \"What is quantum computing?\", \"chat_id\": \"test1\"}'"
echo ""
echo "================================================================================"
