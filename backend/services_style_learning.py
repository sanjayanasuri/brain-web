"""
Service for learning user style preferences from structured feedback.

This module analyzes style feedback to automatically refine the style guide.
It's like "machine learning on yourself" - learning from your own feedback patterns.
"""

from typing import List, Dict, Any, Optional
from neo4j import Session
from models import StyleFeedbackRequest


def analyze_style_feedback_patterns(session: Session, limit: int = 20) -> Dict[str, Any]:
    """
    Analyze recent style feedback to extract patterns.
    Returns insights that can be used to refine the style guide.
    """
    query = """
    MATCH (sf:StyleFeedback)
    WITH sf
    ORDER BY sf.created_at DESC
    LIMIT $limit
    RETURN collect(sf) AS feedbacks
    """
    record = session.run(query, limit=limit).single()
    feedbacks = record["feedbacks"] if record and record["feedbacks"] else []
    
    if not feedbacks:
        return {
            "total_feedbacks": 0,
            "patterns": {},
            "recommendations": []
        }
    
    # Analyze patterns
    patterns = {
        "common_complaints": {},  # What user dislikes
        "common_praises": {},  # What user likes
        "transition_issues": 0,  # Count of "Now, zooming out" type complaints
        "header_issues": 0,  # Count of formal header complaints
        "analogy_issues": 0,  # Count of disconnected analogy complaints
        "example_issues": 0,  # Count of list vs expanded example complaints
        "technical_term_issues": 0,  # Count of ambiguous term complaints
    }
    
    for fb in feedbacks:
        notes = (fb.get("feedback_notes") or "").lower()
        
        # Count common complaint patterns
        if "don't like" in notes or "dislike" in notes or "hate" in notes:
            # Extract what they don't like
            if "transition" in notes or "zooming out" in notes or "take a step back" in notes:
                patterns["transition_issues"] += 1
            if "header" in notes or "big picture" in notes or "section" in notes:
                patterns["header_issues"] += 1
            if "analogy" in notes or "paragraph break" in notes or "disconnected" in notes:
                patterns["analogy_issues"] += 1
            if "example" in notes or "list" in notes:
                patterns["example_issues"] += 1
            if "virtual dom" in notes or "state" in notes or "ambiguous" in notes or "unclear" in notes:
                patterns["technical_term_issues"] += 1
        
        # Count common praise patterns
        if "like" in notes and ("don't" not in notes and "dislike" not in notes):
            if "direct" in notes or "conversational" in notes:
                patterns["common_praises"]["direct_conversational"] = patterns["common_praises"].get("direct_conversational", 0) + 1
            if "integrated" in notes or "flow" in notes:
                patterns["common_praises"]["integrated_flow"] = patterns["common_praises"].get("integrated_flow", 0) + 1
            if "concise" in notes or "brief" in notes:
                patterns["common_praises"]["concise"] = patterns["common_praises"].get("concise", 0) + 1
    
    # Generate recommendations
    recommendations = []
    if patterns["transition_issues"] > 2:
        recommendations.append("Strongly avoid unnecessary transitions like 'Now, zooming out' or 'Let's take a step back'")
    if patterns["header_issues"] > 2:
        recommendations.append("Never use formal section headers like **Big Picture:** or **Core Concept Definition:**")
    if patterns["analogy_issues"] > 2:
        recommendations.append("Integrate analogies naturally into the flow, don't break paragraphs unnecessarily")
    if patterns["example_issues"] > 2:
        recommendations.append("Use one expanded example rather than lists of examples")
    if patterns["technical_term_issues"] > 2:
        recommendations.append("Avoid ambiguous technical terms or explain them simply")
    
    return {
        "total_feedbacks": len(feedbacks),
        "patterns": patterns,
        "recommendations": recommendations
    }


def get_style_feedback_for_prompt(session: Session, limit: int = 5) -> str:
    """
    Get recent style feedback formatted for inclusion in prompts.
    Returns a string that can be added to the system prompt.
    """
    query = """
    MATCH (sf:StyleFeedback)
    WITH sf
    ORDER BY sf.created_at DESC
    LIMIT $limit
    RETURN sf.original_response AS original,
           sf.feedback_notes AS feedback,
           sf.user_rewritten_version AS rewritten
    """
    records = session.run(query, limit=limit)
    
    examples = []
    for rec in records:
        original = rec.get("original") or ""
        feedback = rec.get("feedback") or ""
        rewritten = rec.get("rewritten")
        
        example = f"ORIGINAL: {original[:200]}...\nFEEDBACK: {feedback[:200]}..."
        if rewritten:
            example += f"\nREWRITTEN: {rewritten[:200]}..."
        examples.append(example)
    
    if not examples:
        return ""
    
    return f"""
RECENT STYLE FEEDBACK EXAMPLES (learn from these):
{chr(10).join(f"{i+1}. {ex}" for i, ex in enumerate(examples))}

Use these examples to refine your responses. Pay attention to what the user liked and disliked.
"""

