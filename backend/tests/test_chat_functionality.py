#!/usr/bin/env python3
"""
Chat Functionality Test Script

Tests:
1. Tutor Profile influence on responses
2. Tone adaptation (playful, serious, technical)
3. Short-term memory (within conversation)
4. Long-term memory (persistent across sessions)
"""

import requests
import json
import time
import sys
import os

# Add backend to path for auth token generation
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

API_BASE = "http://localhost:8000"

def generate_test_token():
    """Generate authentication token for testing."""
    from auth import create_token
    return create_token(user_id="test_chat_user", tenant_id="test_tenant", expires_in_days=1)

def set_tutor_profile(token, profile_settings):
    """Set tutor profile for the test user."""
    response = requests.post(
        f"{API_BASE}/preferences/tutor-profile",
        headers={"Authorization": f"Bearer {token}"},
        json=profile_settings
    )
    if response.status_code == 200:
        return response.json()
    else:
        print(f"Failed to set tutor profile: {response.status_code} - {response.text}")
        return None

def send_chat_message(token, message, chat_id="test_session"):
    """Send a chat message and collect the streaming response."""
    response = requests.post(
        f"{API_BASE}/ai/chat/stream",
        headers={"Authorization": f"Bearer {token}"},
        json={"message": message, "chat_id": chat_id},
        stream=True
    )
    
    full_response = ""
    for line in response.iter_lines():
        if line:
            line_str = line.decode('utf-8')
            if line_str.startswith('data: '):
                data_str = line_str[6:]  # Remove 'data: ' prefix
                try:
                    data = json.loads(data_str)
                    if data.get('type') == 'chunk':
                        content = data.get('content', '')
                        full_response += content
                        print(content, end='', flush=True)
                    elif data.get('type') == 'error':
                        print(f"\nError: {data.get('content')}")
                        return None
                    elif data.get('type') == 'done':
                        print()  # New line after response
                        break
                except json.JSONDecodeError:
                    pass
    
    return full_response

def run_tests():
    """Run all chat functionality tests."""
    print("=" * 80)
    print("CHAT FUNCTIONALITY & TUTOR PROFILE TEST")
    print("=" * 80)
    print()
    
    # Generate token
    print("🔑 Generating authentication token...")
    token = generate_test_token()
    print(f"✓ Token generated")
    print()
    
    # Test 1: Baseline (Default Profile)
    print("=" * 80)
    print("TEST 1: Baseline Chat (Default Profile)")
    print("=" * 80)
    print("Setting default profile...")
    set_tutor_profile(token, {
        "audience_mode": "default",
        "voice_id": "neutral",
        "response_mode": "compact"
    })
    print("\nAsking: 'What is machine learning?'")
    print("Response: ", end='')
    response1 = send_chat_message(token, "What is machine learning?", "test_baseline")
    print()
    
    time.sleep(2)
    
    # Test 2: ELI5 Mode
    print("=" * 80)
    print("TEST 2: ELI5 Mode (Explain Like I'm 5)")
    print("=" * 80)
    print("Setting ELI5 profile...")
    set_tutor_profile(token, {
        "audience_mode": "eli5",
        "voice_id": "friendly",
        "response_mode": "normal"
    })
    print("\nAsking: 'What is quantum computing?'")
    print("Response: ", end='')
    response2 = send_chat_message(token, "What is quantum computing?", "test_eli5")
    print()
    
    time.sleep(2)
    
    # Test 3: CEO Pitch Mode
    print("=" * 80)
    print("TEST 3: CEO Pitch Mode (Executive Summary)")
    print("=" * 80)
    print("Setting CEO pitch profile...")
    set_tutor_profile(token, {
        "audience_mode": "ceo_pitch",
        "voice_id": "direct",
        "response_mode": "compact"
    })
    print("\nAsking: 'Why should we invest in AI?'")
    print("Response: ", end='')
    response3 = send_chat_message(token, "Why should we invest in AI?", "test_ceo")
    print()
    
    time.sleep(2)
    
    # Test 4: Playful Tone
    print("=" * 80)
    print("TEST 4: Playful Tone (Can it be funny?)")
    print("=" * 80)
    print("Setting playful profile...")
    set_tutor_profile(token, {
        "audience_mode": "default",
        "voice_id": "playful",
        "response_mode": "normal"
    })
    print("\nAsking: 'Tell me a joke about programming'")
    print("Response: ", end='')
    response4 = send_chat_message(token, "Tell me a joke about programming", "test_playful")
    print()
    
    time.sleep(2)
    
    # Test 5: Technical Mode
    print("=" * 80)
    print("TEST 5: Technical Mode (Serious & Precise)")
    print("=" * 80)
    print("Setting technical profile...")
    set_tutor_profile(token, {
        "audience_mode": "technical",
        "voice_id": "direct",
        "response_mode": "deep"
    })
    print("\nAsking: 'Explain backpropagation'")
    print("Response: ", end='')
    response5 = send_chat_message(token, "Explain backpropagation", "test_technical")
    print()
    
    time.sleep(2)
    
    # Test 6: Short-term Memory (Within Session)
    print("=" * 80)
    print("TEST 6: Short-term Memory (Within Conversation)")
    print("=" * 80)
    print("Setting default profile...")
    set_tutor_profile(token, {
        "audience_mode": "default",
        "voice_id": "friendly",
        "response_mode": "compact"
    })
    
    session_id = "test_memory_session"
    
    print("\nMessage 1: 'My name is Alex and I'm learning Python'")
    print("Response: ", end='')
    send_chat_message(token, "My name is Alex and I'm learning Python", session_id)
    
    time.sleep(1)
    
    print("\nMessage 2: 'What should I learn next?'")
    print("Response: ", end='')
    send_chat_message(token, "What should I learn next?", session_id)
    
    time.sleep(1)
    
    print("\nMessage 3: 'What was my name again?'")
    print("Response: ", end='')
    send_chat_message(token, "What was my name again?", session_id)
    print()
    
    time.sleep(2)
    
    # Test 7: Long-term Memory (Agent Memory)
    print("=" * 80)
    print("TEST 7: Long-term Memory (Persistent Across Sessions)")
    print("=" * 80)
    print("\nSession 1 - Telling the system to remember something:")
    print("Message: 'Remember that I prefer visual learning and I'm interested in AI'")
    print("Response: ", end='')
    send_chat_message(token, "Remember that I prefer visual learning and I'm interested in AI", "memory_session_1")
    
    time.sleep(2)
    
    print("\nSession 2 - Testing if it remembers:")
    print("Message: 'What's a good way for me to learn about neural networks?'")
    print("Response: ", end='')
    send_chat_message(token, "What's a good way for me to learn about neural networks?", "memory_session_2")
    print()
    
    # Summary
    print("=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print()
    print("✓ Test 1: Baseline chat - Default neutral tone")
    print("✓ Test 2: ELI5 mode - Simple, accessible language")
    print("✓ Test 3: CEO pitch - Executive summary style")
    print("✓ Test 4: Playful tone - Engaging and fun")
    print("✓ Test 5: Technical mode - Precise and detailed")
    print("✓ Test 6: Short-term memory - Context within conversation")
    print("✓ Test 7: Long-term memory - Persistent across sessions")
    print()
    print("📊 Review the responses above to verify:")
    print("   - Tone changes based on voice_id (playful vs direct)")
    print("   - Style changes based on audience_mode (ELI5 vs technical)")
    print("   - Memory works (remembers name, preferences)")
    print()
    print("=" * 80)

if __name__ == "__main__":
    try:
        run_tests()
    except KeyboardInterrupt:
        print("\n\nTest interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ Test failed with error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
