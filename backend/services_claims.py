"""
Service for extracting claims from text chunks using LLM.
"""
import json
import re
from typing import List, Dict, Any, Optional
from openai import OpenAI
from config import OPENAI_API_KEY

# Initialize OpenAI client
client = None
if OPENAI_API_KEY:
    cleaned_key = OPENAI_API_KEY.strip().strip('"').strip("'")
    if cleaned_key and cleaned_key.startswith('sk-'):
        try:
            client = OpenAI(api_key=cleaned_key)
            print(f"✓ OpenAI client initialized for claim extraction (key length: {len(cleaned_key)})")
        except Exception as e:
            print(f"ERROR: Failed to initialize OpenAI client for claim extraction: {e}")
            client = None
    else:
        print("WARNING: OPENAI_API_KEY format invalid (should start with 'sk-')")
        client = None
else:
    print("WARNING: OPENAI_API_KEY not found - claim extraction will not work")


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
    if not client:
        print("[Claim Extraction] OpenAI client not available, returning empty list")
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
        print(f"[Claim Extraction] Calling LLM to extract claims from chunk ({len(text)} chars)")
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": CLAIM_EXTRACTION_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,  # Low temperature for consistent extraction
            max_tokens=2000,
        )
    except Exception as api_error:
        error_str = str(api_error)
        print(f"[Claim Extraction] ERROR: Failed to call LLM: {error_str}")
        return []
    
    # Process the response
    try:
        if not response or not response.choices or len(response.choices) == 0:
            raise ValueError("LLM returned empty response (no choices)")
        
        message = response.choices[0].message
        if not message or not message.content:
            raise ValueError("LLM returned empty response (no content)")
        
        content = message.content.strip()
        if not content:
            raise ValueError("LLM returned empty content")
        
        # Try to extract JSON from the response (sometimes LLM adds markdown code blocks)
        json_match = re.search(r'\[.*\]', content, re.DOTALL)
        if json_match:
            content = json_match.group(0)
        
        # Parse JSON
        try:
            claims = json.loads(content)
        except json.JSONDecodeError as e:
            print(f"[Claim Extraction] ERROR: Failed to parse LLM response as JSON: {e}")
            print(f"[Claim Extraction] Response content (first 500 chars): {content[:500]}...")
            return []
        
        # Validate and normalize claims
        if not isinstance(claims, list):
            print(f"[Claim Extraction] ERROR: Expected list, got {type(claims)}")
            return []
        
        normalized_claims = []
        for claim in claims:
            if not isinstance(claim, dict):
                continue
            
            # Ensure required fields
            normalized_claim = {
                "claim_text": claim.get("claim_text", "").strip(),
                "mentioned_concept_names": claim.get("mentioned_concept_names", []),
                "confidence": float(claim.get("confidence", 0.5)),
                "source_span": claim.get("source_span", "unknown"),
            }
            
            # Skip empty claims
            if not normalized_claim["claim_text"]:
                continue
            
            # Clamp confidence to [0, 1]
            normalized_claim["confidence"] = max(0.0, min(1.0, normalized_claim["confidence"]))
            
            normalized_claims.append(normalized_claim)
        
        print(f"[Claim Extraction] Successfully extracted {len(normalized_claims)} claims")
        return normalized_claims
        
    except Exception as e:
        print(f"[Claim Extraction] ERROR: Failed to process LLM response: {e}")
        return []
