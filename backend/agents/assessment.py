from typing import List, Dict, Any, Optional
import json
import os
import requests
from pydantic import BaseModel

class AssessmentResult(BaseModel):
    mastery_score: int  # 0-100
    feedback: str
    next_question: Optional[str] = None
    concepts_discussed: List[str] = []

class AssessmentAgent:
    def __init__(self, api_key: str = None):
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        self.model = "gpt-4o"  # Use capable model for assessment

    def generate_probe(self, concept_name: str, current_mastery: int, conversation_history: List[Dict]) -> str:
        """
        Generate a probing question to assess/refine mastery of a concept.
        """
        prompt = f"""
        You are an Assessment Agent. Your goal is to accurately calibrate the user's mastery of '{concept_name}'.
        Current estimated mastery: {current_mastery}/100.
        
        Generate a single, direct, probing question that tests deep understanding suitable for this level.
        - If mastery is low (0-30): Ask for basic definitions or core concepts.
        - If mastery is medium (30-70): Ask about relationships, trade-offs, or comparisons.
        - If mastery is high (70-100): Ask for edge cases, novel applications, or critiques.
        
        DO NOT offer help. DO NOT be enthusiastic. Just ask the question directly.
        """
        
        return self._call_llm(prompt, conversation_history)

    def contextual_probe(self, text_selection: str, context: str, current_mastery: int) -> str:
        """
        Generate a Socratic probing question based on highlighted text and its context.
        STRICT SOCRATIC MODE: No praise, no glazing. Direct questions only.
        """
        prompt = f"""
        You are a Socratic Tutor. The user is writing notes and has highlighted a concept to be quizzed on.
        
        Selected Text: "{text_selection}"
        Context: "{context}"
        Current Mastery: {current_mastery}/100 (Estimate)
        
        Goal:
        1. Identify the core concept in the selection.
        2. Generate a Socratic question that validates their understanding OR pushes them deeper.
        
        Rules:
        - STRICT SOCRATIC MODE.
        - DO NOT start with "Great job" or "You're right".
        - DO NOT explain the concept immediately.
        - If the text is vague, ask for a definition.
        - If the text is correct, ask for a consequence, relation, or edge case.
        - Keep it short (1 sentence ideal).
        
        Example outputs:
        - "You mentioned backpropagation minimizes loss. How exactly is the chain rule involved in that process?"
        - "What happens to these gradients if we use a Sigmoid activation function in a deep network?" (Pushing deeper)
        """
        return self._call_llm(prompt, [])

    def evaluate_response(self, concept_name: str, question: str, user_answer: str, current_mastery: int) -> AssessmentResult:
        """
        Evaluate the user's answer and determine the new mastery score.
        """
        prompt = f"""
        You are an Assessment Agent.
        Concept: {concept_name}
        Current Mastery: {current_mastery}/100
        Question: {question}
        User Answer: {user_answer}
        
        Task:
        1. Evaluate the correctness and depth of the answer.
        2. Identify specifically what was missing or wrong.
        3. Determine a NEW mastery score (0-100). Be strict. 
           - Vague/hand-wavy answers -> Low score.
           - Specific/technical answers -> High score.
        4. Provide DIRECT feedback. "You missed X." "Your explanation of Y was imprecise."
        
        Return JSON:
        {{
            "mastery_score": int,
            "feedback": "string",
            "next_question": "optional follow-up string"
        }}
        """
        
        response = self._call_llm(prompt, [], json_mode=True)
        try:
            data = json.loads(response)
            return AssessmentResult(**data)
        except Exception as e:
            # Fallback
            return AssessmentResult(mastery_score=current_mastery, feedback="Could not evaluate. Please try again.")

    def _call_llm(self, system_prompt: str, messages: List[Dict], json_mode: bool = False) -> str:
        headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer {self.api_key}`
        }
        
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                *messages[-5:] # Context window
            ],
            "temperature": 0.2
        }
        
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
            
        try:
            response = requests.post("https://api.openai.com/v1/chat/completions", headers=headers, json=payload)
            response.raise_for_status()
            return response.json()["choices"][0]["message"]["content"]
        except Exception as e:
            print(f"[AssessmentAgent] Error: {e}")
            return ""
