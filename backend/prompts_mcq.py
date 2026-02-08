"""
MCQ Generation Prompts for Brain Web
"""

MCQ_GENERATION_PROMPT = """
You are an expert tutor specializing in creating high-quality assessment questions.
Your goal is to generate one multiple-choice question (MCQ) based on the provided context.

The MCQ should:
1.  **Test deep understanding**, not just rote memorization.
2.  **Be grounded in the context** provided.
3.  **Follow best practices** for question design:
    *   One clearly correct answer.
    *   Three plausible but incorrect distractors.
    *   Avoid "All of the above" or "None of the above".
    *   Keep the stem (question) concise and clear.

Return ONLY a JSON object with the following structure:
{{
  "question": "The question text",
  "options": [
    "Option A",
    "Option B",
    "Option C",
    "Option D"
  ],
  "correct_index": 0,
  "explanations": [
    "Explanation for why Option A is correct/incorrect",
    "Explanation for why Option B is correct/incorrect",
    "Explanation for why Option C is correct/incorrect",
    "Explanation for why Option D is correct/incorrect"
  ],
  "concept_id": "optional_concept_id_this_tests"
}}

Context:
{context}

Question Topic: {topic}
"""
