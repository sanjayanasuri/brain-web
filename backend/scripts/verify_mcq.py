"""
Verification script for MCQ generation.
Run with: python backend/verify_mcq.py
"""
import sys
import os
import asyncio
import json

# Add backend to path
sys.path.append(os.path.join(os.path.dirname(__file__), "backend"))

async def test_mcq_generation():
    print("--- Testing MCQ Generation ---")
    
    # Mocking session for testing as we don't need real DB for this part of verification
    session = None
    topic = "Quantum Computing Concepts"
    
    try:
        from services_mcq_generation import generate_mcq_for_topic
        
        print(f"Generating MCQ for topic: {topic}...")
        task_spec = await generate_mcq_for_topic(session, topic)
        
        print("\nGenerated MCQ Task Spec:")
        print(json.dumps(task_spec, indent=2))
        
        rubric = task_spec.get("rubric_json", {})
        print(f"\nQuestion: {rubric.get('question')}")
        print("Options:")
        for i, opt in enumerate(rubric.get("options", [])):
            print(f"  {chr(65+i)}. {opt}")
        print(f"Correct Index: {rubric.get('correct_index')}")
        print(f"Explanations: {len(rubric.get('explanations', []))} found.")
        
        print("\n--- Verification Successful ---")
        
    except Exception as e:
        print(f"\n--- Verification Failed ---")
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_mcq_generation())
