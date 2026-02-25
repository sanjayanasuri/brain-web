# backend/services/evaluator.py
"""
Evaluator service for adaptive learning system.
Scores user attempts across 5 dimensions using LLM-based evaluation.
"""

import os
import json
from typing import Dict, Any, List
from models.study import TaskSpec, EvaluationResult
from services_model_router import model_router, TASK_CHAT_FAST


def evaluate_attempt(
    task_spec: TaskSpec,
    response_text: str,
    user_id: str = None,  # NEW: For concept tracking
    tenant_id: str = None  # NEW: For concept tracking
) -> EvaluationResult:
    """
    Evaluate a user's attempt at a task using LLM-based scoring.
    
    Args:
        task_spec: The task specification with prompt and rubric
        response_text: User's response text
        user_id: User ID for concept tracking (optional)
        tenant_id: Tenant ID for concept tracking (optional)
    
    Returns:
        EvaluationResult with scores, feedback, and gap concepts
    """
    
    api_key = None  # model_router handles key management
    if not model_router.client:
        # Fallback to simple heuristic scoring
        return _heuristic_evaluation(task_spec, response_text)
    
    # Build evaluation prompt
    rubric_text = _format_rubric(task_spec.rubric_json)
    context_text = "\n\n".join([
        f"[{e.source_type.upper()}] {e.content[:200]}..."
        for e in task_spec.context_pack.excerpts[:3]
    ])
    
    eval_prompt = f"""You are an expert teacher evaluating a student's response to a learning task.

TASK PROMPT:
{task_spec.prompt}

STUDENT RESPONSE:
{response_text}

GRADING RUBRIC:
{rubric_text}

CONTEXT (for grounding check):
{context_text}

Evaluate the response across all dimensions and return a JSON object with:
1. "scores": object with keys {list(task_spec.rubric_json.keys())} (each 0.0-1.0)
2. "feedback": Natural, direct coaching feedback (2-3 sentences). Address the student directly ("Your response..."). Be specific about what was missed or what was good. Do not mention "scores" or "rubrics". IMPORTANT: If you mention specific concepts that serve as navigation points, wrap them in double brackets like [[Concept Name]].
3. "gap_concepts": array of objects with structure {"name": "Concept Name", "definition": "Brief 1-sentence definition of this concept in this context"}.

Return ONLY valid JSON, no other text."""
    
    try:
        # Call LLM via model_router
        result_text = model_router.completion(
            task_type=TASK_CHAT_FAST,
            messages=[
                {"role": "system", "content": "You are an expert teacher providing fair, constructive evaluation."},
                {"role": "user", "content": eval_prompt},
            ],
            temperature=0.2,
            max_tokens=500,
        ) or "{}"
        
        # Parse JSON response
        try:
            result = json.loads(result_text)
        except json.JSONDecodeError:
            # Try to extract JSON from response
            start = result_text.find("{")
            end = result_text.rfind("}") + 1
            if start != -1 and end > start:
                result = json.loads(result_text[start:end])
            else:
                raise ValueError("Could not parse LLM response as JSON")
        
        # Extract scores
        scores = result.get("scores", {})
        
        # Calculate composite score using rubric weights
        composite = 0.0
        for dimension, score in scores.items():
            weight = task_spec.rubric_json.get(dimension, {}).get("weight", 0.0)
            composite += score * weight
        
        # Build evaluation result
        evaluation = EvaluationResult(
            score_json=scores,
            composite_score=round(composite, 3),
            feedback_text=result.get("feedback", "Good effort!"),
            gap_concepts=result.get("gap_concepts", [])
        )
        
        # Track concept mastery (Phase 4)
        _track_concept_mastery(task_spec, evaluation, user_id, tenant_id)
        
        return evaluation
        
    except Exception as e:
        print(f"[Evaluator] LLM evaluation failed: {e}")
        # Fallback to heuristic
        return _heuristic_evaluation(task_spec, response_text)


def _track_concept_mastery(
    task_spec: TaskSpec, 
    evaluation: EvaluationResult,
    user_id: str = None,
    tenant_id: str = None
):
    """
    Track concept mastery after evaluation (Phase 4).
    Updates concept_mastery table for analytics.
    """
    # Skip if user context not provided
    if not user_id or not tenant_id:
        return
    
    try:
        from services.analytics import update_concept_mastery
        
        # Determine success (score >= 0.7)
        success = evaluation.composite_score >= 0.7
        
        # Update mastery for all concepts in context
        for concept in task_spec.context_pack.concepts:
            try:
                update_concept_mastery(user_id, tenant_id, concept, success)
            except Exception as e:
                print(f"[Evaluator] Failed to update concept mastery for {concept}: {e}")
                
    except (ImportError, Exception) as e:
        # Analytics not available, skip tracking
        print(f"[Evaluator] Concept tracking unavailable: {e}")


def _format_rubric(rubric_json: Dict[str, Any]) -> str:
    """Format rubric JSON into readable text."""
    lines = []
    for dimension, spec in rubric_json.items():
        weight = spec.get("weight", 0.0)
        desc = spec.get("description", "")
        lines.append(f"- {dimension.upper()} ({weight*100:.0f}%): {desc}")
    return "\n".join(lines)


def _heuristic_evaluation(task_spec: TaskSpec, response_text: str) -> EvaluationResult:
    """
    Fallback heuristic evaluation when LLM is unavailable.
    Uses simple rules based on response length and keyword matching.
    """
    
    response_len = len(response_text.strip())
    word_count = len(response_text.split())
    
    # Base scores
    scores = {}
    
    for dimension in task_spec.rubric_json.keys():
        if dimension == "effort":
            # Effort based on length
            if word_count < 20:
                scores[dimension] = 0.3
            elif word_count < 50:
                scores[dimension] = 0.6
            else:
                scores[dimension] = 0.8
        
        elif dimension == "grounding":
            # Check if response mentions context excerpts
            context_keywords = set()
            for excerpt in task_spec.context_pack.excerpts[:3]:
                # Extract key terms (simple: words > 5 chars)
                words = [w.lower() for w in excerpt.content.split() if len(w) > 5]
                context_keywords.update(words[:10])
            
            response_lower = response_text.lower()
            matches = sum(1 for kw in context_keywords if kw in response_lower)
            scores[dimension] = min(0.9, matches / max(len(context_keywords), 1) * 2)
        
        elif dimension == "completeness":
            # Completeness based on word count relative to prompt
            prompt_words = len(task_spec.prompt.split())
            ratio = word_count / max(prompt_words, 1)
            scores[dimension] = min(0.9, ratio * 0.5)
        
        else:
            # Default moderate score for other dimensions
            scores[dimension] = 0.6
    
    # Calculate composite
    composite = 0.0
    for dimension, score in scores.items():
        weight = task_spec.rubric_json.get(dimension, {}).get("weight", 0.0)
        composite += score * weight
    
    # Generate contextual feedback
    if composite < 0.4:
        feedback = "Your answer needs more depth. Try to explain the core ideas in your own words and connect them to specific examples. "
        if word_count < 20:
            feedback += "A more detailed response would help demonstrate your understanding."
        else:
            feedback += "Focus on the key concepts and how they relate to each other."
    elif composite < 0.6:
        feedback = "You're on the right track! Your answer covers some key points. "
        feedback += "To improve, try to be more specific — mention exact terms, definitions, or examples from what you've studied."
    elif composite < 0.8:
        feedback = "Good work! You've shown solid understanding of the material. "
        feedback += "To reach mastery, try explaining how this connects to related topics or apply it to a new scenario."
    else:
        feedback = "Excellent response! You've demonstrated strong understanding with clear explanations and good detail."

    # Extract gap concepts from context
    gap_concepts = []
    for concept_name in task_spec.context_pack.concepts[:3]:
        if concept_name.lower() not in response_text.lower():
            gap_concepts.append({
                "name": concept_name,
                "definition": f"A key concept related to this topic that wasn't addressed in your response."
            })

    return EvaluationResult(
        score_json=scores,
        composite_score=round(composite, 3),
        feedback_text=feedback,
        gap_concepts=gap_concepts
    )
