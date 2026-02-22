"""
Service for extracting claims from text chunks using LLM.
"""
import json
import logging
import re
from typing import List, Dict, Any, Optional

from services_model_router import model_router, TASK_EXTRACT

logger = logging.getLogger("brain_web")


CLAIM_EXTRACTION_PROMPT = """You are a claim extraction system. Extract factual claims from the given text chunk.

A claim is a specific, verifiable statement that can be supported by evidence. Examples:
- "Neural networks use backpropagation to update weights"
- "Python is dynamically typed"
- "REST APIs use HTTP methods like GET, POST, PUT, DELETE"

Return a JSON array of claims, each with:
- claim_text: The exact claim statement (string)
- mentioned_concept_names: List of concept names mentioned in this claim (strings, case-insensitive match)
- confidence: Confidence score 0-1 (float)
- source_span: Description of where in the source this claim appears (e.g., "sentence 2-3", "first paragraph")

IMPORTANT:
- Only extract claims that are factual and specific
- Match concept names exactly as they appear in the known_concepts list (case-insensitive)
- If a concept is mentioned but not in known_concepts, still include it in mentioned_concept_names but note it may not link
- Keep confidence scores realistic (0.5-1.0 for clear claims, lower for uncertain ones)
- Return valid JSON only, no markdown formatting

Example output:
[
  {
    "claim_text": "Neural networks learn by adjusting weights through backpropagation",
    "mentioned_concept_names": ["Neural Networks", "Backpropagation"],
    "confidence": 0.9,
    "source_span": "sentence 1"
  }
]"""


def normalize_claim_text(text: str) -> str:
    """
    Normalize claim text for deterministic hashing.
    Lowercase, strip, collapse whitespace.
    """
    return " ".join(text.lower().strip().split())


def extract_claims_from_chunk(
    text: str,
    known_concepts: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Extract claims from a text chunk using LLM.

    Args:
        text: Chunk text content
        known_concepts: List of concept dicts with at least 'name' field

    Returns:
        List of claim dicts with:
        - claim_text: str
        - mentioned_concept_names: List[str]
        - confidence: float
        - source_span: str
    """
    if not model_router.client:
        logger.warning("[claim_extraction] OpenAI client not available, returning empty list")
        return []

    # Build concept names list for the prompt
    concept_names = [c.get("name", "") for c in known_concepts if c.get("name")]
    concept_hint = ""
    if concept_names:
        concept_hint = f"\n\nKNOWN CONCEPTS (use exact names, case-insensitive):\n{', '.join(concept_names[:100])}"
        if len(concept_names) > 100:
            concept_hint += f"\n(and {len(concept_names) - 100} more concepts...)"

    user_prompt = f"""Text chunk:
{text}{concept_hint}

Extract all factual claims from this chunk. Return JSON array as specified."""

    try:
        logger.debug(f"[claim_extraction] Extracting claims from {len(text)}-char chunk")
        raw = model_router.completion(
            task_type=TASK_EXTRACT,
            messages=[
                {"role": "system", "content": CLAIM_EXTRACTION_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
            max_tokens=2000,
        )
    except Exception as api_error:
        logger.error(f"[claim_extraction] LLM call failed: {api_error}")
        return []

    # Process the response
    try:
        content = (raw or "").strip()
        if not content:
            raise ValueError("LLM returned empty content")

        # Try to extract JSON from the response (sometimes LLM adds markdown code blocks)
        json_match = re.search(r'\[.*\]', content, re.DOTALL)
        if json_match:
            content = json_match.group(0)

        try:
            claims = json.loads(content)
        except json.JSONDecodeError as e:
            logger.error(f"[claim_extraction] Failed to parse LLM response as JSON: {e}")
            logger.debug(f"[claim_extraction] Response (first 500): {content[:500]}")
            return []

        if not isinstance(claims, list):
            logger.error(f"[claim_extraction] Expected list, got {type(claims)}")
            return []

        normalized_claims = []
        for claim in claims:
            if not isinstance(claim, dict):
                continue
            normalized_claim = {
                "claim_text": claim.get("claim_text", "").strip(),
                "mentioned_concept_names": claim.get("mentioned_concept_names", []),
                "confidence": float(claim.get("confidence", 0.5)),
                "source_span": claim.get("source_span", "unknown"),
            }
            if not normalized_claim["claim_text"]:
                continue
            normalized_claim["confidence"] = max(0.0, min(1.0, normalized_claim["confidence"]))
            normalized_claims.append(normalized_claim)

        logger.debug(f"[claim_extraction] Extracted {len(normalized_claims)} claims")
        return normalized_claims

    except Exception as e:
        logger.error(f"[claim_extraction] Failed to process LLM response: {e}")
        return []
