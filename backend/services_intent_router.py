"""
Intent router for AI-first query classification.

Uses LLM classification first, then keyword-based fallback if LLM fails.
This ensures better intent detection for natural language queries.
"""
from typing import Dict, List, Tuple, Optional
from models import Intent, IntentResult
import re
from pydantic import BaseModel

# Intent priority order (higher priority first) - used for fallback only
INTENT_PRIORITY = {
    Intent.EVIDENCE_CHECK: 8,
    Intent.WHAT_CHANGED: 7,
    Intent.CAUSAL_CHAIN: 6,
    Intent.TIMELINE: 5,
    Intent.COMPARE: 4,
    Intent.WHO_NETWORK: 3,
    Intent.EXPLORE_NEXT: 2,
    Intent.SELF_KNOWLEDGE: 1.5,
    Intent.DEFINITION_OVERVIEW: 1,
}

# Keyword patterns for each intent - used as fallback only
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
    Intent.SELF_KNOWLEDGE: [
        "what do i know", "my notes", "my graph", "personal knowledge",
        "have i learned", "in my brain", "my research", "what did i say"
    ],
}

# All available intents for LLM classification
ALL_INTENTS = [
    Intent.EVIDENCE_CHECK.value,
    Intent.WHAT_CHANGED.value,
    Intent.CAUSAL_CHAIN.value,
    Intent.TIMELINE.value,
    Intent.COMPARE.value,
    Intent.WHO_NETWORK.value,
    Intent.EXPLORE_NEXT.value,
    Intent.DEFINITION_OVERVIEW.value,
]


def classify_intent(query: str, use_llm_fallback: bool = True) -> IntentResult:
    """
    Classify query into an intent using AI-first approach (LLM first, keywords as fallback).
    
    Args:
        query: User query string
        use_llm_fallback: Whether to use keyword fallback if LLM fails (default: True)
    
    Returns:
        IntentResult with intent, confidence, and reasoning
    """
    # AI-FIRST: Try LLM classification first
    if use_llm_fallback:  # This flag now means "use LLM" (AI-first)
        llm_result = _llm_classify_intent(query)
        if llm_result and llm_result.confidence >= 0.7:
            return llm_result
    
    # FALLBACK: Use keyword-based classification if LLM failed or unavailable
    return _keyword_classify_intent(query)


def _llm_classify_intent(query: str) -> Optional[IntentResult]:
    """
    Use LLM to classify intent (AI-first approach).
    
    Args:
        query: User query
    
    Returns:
        IntentResult if successful, None if LLM fails
    """
    try:
        from openai import OpenAI
        from config import OPENAI_API_KEY
        import json
        
        if not OPENAI_API_KEY:
            return None
        
        client = OpenAI(api_key=OPENAI_API_KEY)
        
        prompt = f"""Classify this query into exactly one of these intents: {', '.join(ALL_INTENTS)}

Query: "{query}"

Available intents:
- EVIDENCE_CHECK: Asking for sources, citations, proof, evidence
- WHAT_CHANGED: Asking about recent changes, updates, new information
- CAUSAL_CHAIN: Asking about causes, effects, why something happened
- TIMELINE: Asking about when, sequence, chronological order
- COMPARE: Asking to compare, contrast, differences, similarities
- WHO_NETWORK: Asking about people, connections, relationships, networks
- EXPLORE_NEXT: Asking what to explore next, related topics, rabbit holes
- SELF_KNOWLEDGE: Asking about what the user already knows, their own notes, or their personal knowledge graph (e.g., 'What do I know about X?', 'Show me my notes on Y')
- DEFINITION_OVERVIEW: General definition, explanation, overview questions

Return ONLY a JSON object:
{{
  "intent": "INTENT_NAME",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}}"""
        
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are an intent classifier. Return only valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,
            max_tokens=200,
            response_format={"type": "json_object"}
        )
        
        result_text = response.choices[0].message.content.strip()
        result = json.loads(result_text)
        
        intent_str = result.get("intent", "").upper()
        confidence = float(result.get("confidence", 0.7))
        reasoning = result.get("reasoning", "LLM classification")
        
        # Validate intent
        if intent_str in ALL_INTENTS:
            return IntentResult(
                intent=intent_str,
                confidence=confidence,
                reasoning=f"AI-first classification: {reasoning}"
            )
        else:
            print(f"[Intent Router] LLM returned invalid intent '{intent_str}'")
            return None
    
    except Exception as e:
        print(f"[Intent Router] LLM classification failed: {e}")
        return None


def _keyword_classify_intent(query: str) -> IntentResult:
    """
    Fallback keyword-based classification (used only if LLM fails).
    
    Args:
        query: User query string
    
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
            reasoning="No keyword matches found, defaulting to DEFINITION_OVERVIEW (keyword fallback)"
        )
    
    # If single match, use it
    if len(intent_scores) == 1:
        intent = list(intent_scores.keys())[0]
        return IntentResult(
            intent=intent.value,
            confidence=0.7,
            reasoning=f"Single keyword match: {intent.value} (keyword fallback)"
        )
    
    # Multiple matches: use priority
    sorted_intents = sorted(
        intent_scores.items(),
        key=lambda x: (INTENT_PRIORITY.get(x[0], 0), x[1]),
        reverse=True
    )
    
    top_intent = sorted_intents[0][0]
    top_score = sorted_intents[0][1]
    
    return IntentResult(
        intent=top_intent.value,
        confidence=0.65,
        reasoning=f"Selected by priority: {top_intent.value} (score: {top_score}, keyword fallback)"
    )
