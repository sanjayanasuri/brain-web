import asyncio
import os
import sys
import uuid
from datetime import datetime

# Add current directory to path
sys.path.append(os.path.join(os.getcwd(), "backend"))

from services_voice_agent import VoiceAgentOrchestrator
from db_neo4j import neo4j_session
from services_tutor_profile import patch_tutor_profile, TutorProfilePatch

async def test_voice_memory():
    print("=== VOICE MEMORY & PACING TEST ===")
    
    user_id = str(uuid.uuid4())
    tenant_id = str(uuid.uuid4())
    graph_id = "test-graph-" + str(uuid.uuid4())[:8]
    branch_id = "main"
    
    orchestrator = VoiceAgentOrchestrator(user_id, tenant_id)
    
    # 1. Start session
    print(f"\n1. Starting voice session for user: {user_id}")
    session_data = await orchestrator.start_session(graph_id, branch_id)
    session_id = session_data["session_id"]
    print(f"   Session ID: {session_id}")
    
    # 2. Tell the voice agent a fact
    print("\n2. Telling agent a fact...")
    transcript = "Hi there, I'm Alex. I'm studying Biology and I want to become a doctor."
    print(f"   User: {transcript}")
    
    result = await orchestrator.get_interaction_context(
        graph_id=graph_id,
        branch_id=branch_id,
        last_transcript=transcript,
        session_id=session_id
    )
    
    print(f"   Agent: {result['agent_response']}")
    
    # Wait for background fact extraction to complete
    print("\n   Waiting 10 seconds for fact extraction to complete in background...")
    await asyncio.sleep(10)
    
    # 3. Start a NEW session and check recall
    print("\n3. Starting a NEW voice session (Fresh Context)")
    new_session_data = await orchestrator.start_session(graph_id, branch_id)
    new_session_id = new_session_data["session_id"]
    
    print("\n4. Asking about name in new session...")
    recall_transcript = "Do you remember who I am?"
    print(f"   User: {recall_transcript}")
    
    recall_result = await orchestrator.get_interaction_context(
        graph_id=graph_id,
        branch_id=branch_id,
        last_transcript=recall_transcript,
        session_id=new_session_id
    )
    
    print(f"   Agent: {recall_result['agent_response']}")
    
    if "Alex" in recall_result['agent_response'] or "Biology" in recall_result['agent_response']:
        print("\n   ✅ SUCCESS: Voice agent recalled the name/subject across sessions!")
    else:
        print("\n   ❌ FAILURE: Voice agent forgot the fact.")

    # 5. Test Pacing (Slow Down)
    print("\n5. Testing Pacing (Slow Down)")
    
    # Set tutor profile to slow pacing
    with neo4j_session() as session:
        patch = TutorProfilePatch(pacing="slow")
        patch_tutor_profile(session, user_id, patch) # Correct order: session, user_id, patch
        print(f"   Set tutor profile pacing to 'slow' for user {user_id}")
    
    # Start third session to pick up profile changes
    pacing_session_data = await orchestrator.start_session(graph_id, branch_id)
    pacing_session_id = pacing_session_data["session_id"]
    
    pacing_result = await orchestrator.get_interaction_context(
        graph_id=graph_id,
        branch_id=branch_id,
        last_transcript="Tell me one thing about Biology.",
        session_id=pacing_session_id
    )
    
    print(f"   Agent (Slow): {pacing_result['agent_response']}")
    print(f"   Speech Rate: {pacing_result['speech_rate']}")
    
    if pacing_result['speech_rate'] < 1.0:
        print("\n   ✅ SUCCESS: Voice agent applied slow speech rate!")
    else:
        print("\n   ❌ FAILURE: Speech rate remained normal.")

if __name__ == "__main__":
    asyncio.run(test_voice_memory())
