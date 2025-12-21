"""
Intent router for deterministic query classification.

Uses keyword rules first, then LLM fallback if ambiguous.
"""
from typing import Dict, List, Tuple
from models import Intent, IntentResult
import re
from pydantic import BaseModel

# Intent priority order (higher priority first)
INTENT_PRIORITY = {
    Intent.EVIDENCE_CHECK: 8,
    Intent.WHAT_CHANGED: 7,
    Intent.CAUSAL_CHAIN: 6,
    Intent.TIMELINE: 5,
    Intent.COMPARE: 4,
    Intent.WHO_NETWORK: 3,
    Intent.EXPLORE_NEXT: 2,
    Intent.DEFINITION_OVERVIEW: 1,
}

# Keyword patterns for each intent
INTENT_KEYWORDS = {
    Intent.TIMELINE: [
        "timeline", "when", "sequence", "chronology", "chronological",
        "order", "before", "after", "then", "first", "last", "earlier", "later",
        "date", "year", "month", "day", "january", "february", "march", "april",
        "may", "june", "july", "august", "september", "october", "november", "december",
        "2020", "2021", "2022", "2023", "2024", "2025"
    ],
    Intent.CAUSAL_CHAIN: [
        "cause", "led to", "why did", "resulted in", "chain", "influence",
        "because", "due to", "as a result", "consequence", "effect",
        "triggered", "brought about", "stemmed from", "originated from"
    ],
    Intent.COMPARE: [
        "compare", "vs", "versus", "difference", "similar", "contrast",
        "versus", "against", "better", "worse", "different", "same",
        "alike", "unlike", "distinguish", "distinction"
    ],
    Intent.WHO_NETWORK: [
        "who", "connected", "network", "associates", "relationships",
        "people", "person", "team", "group", "organization", "company",
        "collaborated", "worked with", "related to", "linked to"
    ],
    Intent.EVIDENCE_CHECK: [
        "source", "evidence", "cite", "is this true", "prove", "citation",
        "reference", "support", "backup", "verify", "validate", "confirm",
        "show me", "where does", "how do we know"
    ],
    Intent.WHAT_CHANGED: [
        "what changed", "since", "recent", "new", "updated", "latest",
        "change", "changes", "recently", "lately", "newest", "update"
    ],
    Intent.EXPLORE_NEXT: [
        "rabbit hole", "what next", "explore", "related topics", "related",
        "similar", "next", "continue", "dive deeper", "learn more",
        "what else", "other", "additional"
    ],
}


def classify_intent(query: str, use_llm_fallback: bool = True) -> IntentResult:
    """
    Classify query into an intent using deterministic rules + optional LLM fallback.
    
    Args:
        query: User query string
        use_llm_fallback: Whether to use LLM if rules are ambiguous
    
    Returns:
        IntentResult with intent, confidence, and reasoning
    """
    query_lower = query.lower()
    
    # Count keyword matches for each intent
    intent_scores: Dict[Intent, int] = {}
    for intent, keywords in INTENT_KEYWORDS.items():
        score = 0
        for keyword in keywords:
            if keyword in query_lower:
                score += 1
        if score > 0:
            intent_scores[intent] = score
    
    # If no matches, default to DEFINITION_OVERVIEW
    if not intent_scores:
        return IntentResult(
            intent=Intent.DEFINITION_OVERVIEW.value,
            confidence=0.5,
            reasoning="No keyword matches found, defaulting to DEFINITION_OVERVIEW"
        )
    
    # If single match, use it
    if len(intent_scores) == 1:
        intent = list(intent_scores.keys())[0]
        return IntentResult(
            intent=intent.value,
            confidence=0.9,
            reasoning=f"Single keyword match: {intent.value}"
        )
    
    # Multiple matches: use priority
    # Sort by priority (higher first), then by score
    sorted_intents = sorted(
        intent_scores.items(),
        key=lambda x: (INTENT_PRIORITY.get(x[0], 0), x[1]),
        reverse=True
    )
    
    top_intent = sorted_intents[0][0]
    top_score = sorted_intents[0][1]
    second_score = sorted_intents[1][1] if len(sorted_intents) > 1 else 0
    
    # If top intent has significantly higher score, use it
    if top_score >= second_score * 1.5:
        return IntentResult(
            intent=top_intent.value,
            confidence=0.85,
            reasoning=f"Highest priority intent with {top_score} keyword matches"
        )
    
    # If scores are close and we have LLM fallback, use it
    if use_llm_fallback and top_score == second_score:
        return _llm_classify_intent(query, [intent.value for intent, _ in sorted_intents[:3]])
    
    # Otherwise, use priority-based selection
    return IntentResult(
        intent=top_intent.value,
        confidence=0.75,
        reasoning=f"Selected by priority: {top_intent.value} (score: {top_score})"
    )


def _llm_classify_intent(query: str, candidate_intents: List[str]) -> IntentResult:
    """
    Use LLM to classify intent when rules are ambiguous.
    
    Args:
        query: User query
        candidate_intents: List of candidate intent strings
    
    Returns:
        IntentResult
    """
    try:
        from openai import OpenAI
        from config import OPENAI_API_KEY
        
        if not OPENAI_API_KEY:
            # Fallback to highest priority candidate
            return IntentResult(
                intent=candidate_intents[0],
                confidence=0.6,
                reasoning="LLM unavailable, using highest priority candidate"
            )
        
        client = OpenAI(api_key=OPENAI_API_KEY)
        
        prompt = f"""Classify this query into exactly one of these intents: {', '.join(candidate_intents)}

Query: "{query}"

Respond with ONLY the intent name (one word, exactly as shown above)."""
        
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are an intent classifier. Respond with only the intent name."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.0,
            max_tokens=20
        )
        
        intent_str = response.choices[0].message.content.strip().upper()
        
        # Validate response
        if intent_str in candidate_intents:
            return IntentResult(
                intent=intent_str,
                confidence=0.8,
                reasoning=f"LLM classification from candidates: {', '.join(candidate_intents)}"
            )
        else:
            # Fallback to first candidate
            return IntentResult(
                intent=candidate_intents[0],
                confidence=0.65,
                reasoning=f"LLM returned invalid intent '{intent_str}', using fallback"
            )
    
    except Exception as e:
        print(f"[Intent Router] LLM fallback failed: {e}")
        # Fallback to highest priority candidate
        return IntentResult(
            intent=candidate_intents[0],
            confidence=0.6,
            reasoning=f"LLM fallback error: {str(e)}, using highest priority candidate"
        )
