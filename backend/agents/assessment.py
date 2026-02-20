"""
Assessment Agent — generates probing questions, contextual Socratic prompts,
and evaluates user responses.

Uses model_router so the model is swappable via MODEL_CHAT_SMART env var.
"""
import json
import logging
from typing import List, Dict, Any, Optional

from pydantic import BaseModel

logger = logging.getLogger("brain_web")


class AssessmentResult(BaseModel):
    mastery_score: int  # 0-100
    feedback: str
    next_question: Optional[str] = None
    concepts_discussed: List[str] = []


class AssessmentAgent:
    def generate_probe(
        self, concept_name: str, current_mastery: int, conversation_history: List[Dict]
    ) -> str:
        """Generate a probing question to assess / refine mastery of a concept."""
        prompt = f"""You are an Assessment Agent. Your goal is to accurately calibrate the user's mastery of '{concept_name}'.
Current estimated mastery: {current_mastery}/100.

Generate a single, direct, probing question that tests deep understanding suitable for this level.
- If mastery is low (0-30): Ask for basic definitions or core concepts.
- If mastery is medium (30-70): Ask about relationships, trade-offs, or comparisons.
- If mastery is high (70-100): Ask for edge cases, novel applications, or critiques.

DO NOT offer help. DO NOT be enthusiastic. Just ask the question directly."""
        return self._call_llm(prompt, conversation_history)

    def contextual_probe(
        self, text_selection: str, context: str, current_mastery: int
    ) -> str:
        """
        Generate a Socratic probing question based on highlighted text.
        STRICT SOCRATIC MODE: No praise, no glazing. Direct questions only.
        """
        prompt = f"""You are a Socratic Tutor. The user highlighted a concept to be quizzed on.

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
- Keep it short (1 sentence ideal)."""
        return self._call_llm(prompt, [])

    def evaluate_response(
        self,
        concept_name: str,
        question: str,
        user_answer: str,
        current_mastery: int,
    ) -> AssessmentResult:
        """Evaluate the user's answer and determine the new mastery score."""
        prompt = f"""You are an Assessment Agent.
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
}}"""
        response = self._call_llm(prompt, [], json_mode=True)
        try:
            data = json.loads(response)
            return AssessmentResult(**data)
        except Exception:
            return AssessmentResult(
                mastery_score=current_mastery,
                feedback="Could not evaluate. Please try again.",
            )

    def _call_llm(
        self, system_prompt: str, messages: List[Dict], json_mode: bool = False
    ) -> str:
        """Route through model_router using TASK_CHAT_SMART (env-configurable)."""
        from services_model_router import model_router, TASK_CHAT_SMART

        call_messages = [
            {"role": "system", "content": system_prompt},
            *messages[-5:],  # last 5 turns for context window
        ]
        kwargs: Dict[str, Any] = {}
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}

        try:
            return model_router.completion(
                task_type=TASK_CHAT_SMART,
                messages=call_messages,
                temperature=0.2,
                **kwargs,
            ) or ""
        except Exception as e:
            logger.error(f"[assessment_agent] LLM call failed: {e}")
            return ""
