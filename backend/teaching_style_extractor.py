"""
Extract teaching style from a single lecture using LLM analysis.

This module analyzes lecture text, segments, and analogies to infer
the user's teaching and writing style.
"""
import json
import logging
from typing import List, Dict, Any, Optional
from models import TeachingStyleProfile
from services_teaching_style import DEFAULT_STYLE
from config import OPENAI_API_KEY

# Reuse OpenAI client from lecture ingestion if available
# Otherwise initialize our own
try:
    from services_lecture_ingestion import client as lecture_client
    client = lecture_client
except ImportError:
    client = None
    if OPENAI_API_KEY:
        from openai import OpenAI
        cleaned_key = OPENAI_API_KEY.strip().strip('"').strip("'")
        if cleaned_key and cleaned_key.startswith('sk-'):
            try:
                client = OpenAI(api_key=cleaned_key)
            except Exception as e:
                logging.warning(f"Failed to initialize OpenAI client for style extraction: {e}")
                client = None

logger = logging.getLogger(__name__)


STYLE_EXTRACTION_SYSTEM_PROMPT = """You are analyzing a single lecture written by a specific teacher.

Infer their teaching and explanation style from the lecture content, structure, and analogies used.

Respond ONLY as valid JSON with these exact keys:
- tone: string (overall vibe, e.g., "intuitive, grounded, exploratory, technical but conversational")
- teaching_style: string (how they explain, e.g., "analogy-first, zoom-out then zoom-in, highlight big picture")
- sentence_structure: string (how they write sentences, e.g., "short, minimal filler, avoid dramatic language")
- explanation_order: list of strings (ordered steps they tend to follow when explaining)
- forbidden_styles: list of strings (what clearly does NOT match this teacher, e.g., "overly formal", "verbose academic tone")

Tone: overall vibe (intuitive, grounded, exploratory, etc.)
Teaching style: how they explain (analogy-first, zoom-out then zoom-in, etc.)
Sentence structure: how they write sentences (short, long, etc.)
Explanation order: ordered steps they tend to follow when explaining.
Forbidden styles: what clearly does NOT match this teacher (e.g., overly formal, verbose, generic).

Return ONLY the JSON object, no markdown, no code blocks, no explanation."""


def extract_style_from_lecture(
    lecture_title: str,
    lecture_text: str,
    segments: List[Dict[str, Any]],
) -> TeachingStyleProfile:
    """
    Call the LLM to infer teaching style from the lecture and its segments/analogies.
    
    Args:
        lecture_title: Title of the lecture
        lecture_text: Full text of the lecture
        segments: List of dicts with at least 'covered_concepts' and 'analogies' if available.
                  Each segment should have: segment_index, text, summary (optional), 
                  covered_concepts (list), analogies (list)
    
    Returns:
        TeachingStyleProfile (falls back to DEFAULT_STYLE if extraction fails)
    """
    if not client:
        logger.warning("OpenAI client not available, returning default style")
        return DEFAULT_STYLE
    
    # Truncate lecture text if too long (keep first 6k characters)
    truncated_text = lecture_text[:6000] if len(lecture_text) > 6000 else lecture_text
    if len(lecture_text) > 6000:
        truncated_text += "\n[... text truncated ...]"
    
    # Build a compact summary of segments/analogies
    segments_summary = []
    for i, seg in enumerate(segments[:10]):  # Limit to first 10 segments
        seg_info = f"Segment {seg.get('segment_index', i)}: "
        
        # Add covered concepts
        concepts = seg.get('covered_concepts', [])
        if concepts:
            concept_names = [c.get('name', c) if isinstance(c, dict) else str(c) for c in concepts]
            seg_info += f"concepts={concept_names[:5]}"  # Limit to 5 concepts
        
        # Add analogies
        analogies = seg.get('analogies', [])
        if analogies:
            analogy_labels = [a.get('label', a) if isinstance(a, dict) else str(a) for a in analogies]
            seg_info += f", analogies={analogy_labels[:3]}"  # Limit to 3 analogies
        
        # Add text snippet (first 200 chars)
        text = seg.get('text', '')
        if text:
            seg_info += f", text_preview={text[:200]}"
        
        segments_summary.append(seg_info)
    
    segments_text = "\n".join(segments_summary) if segments_summary else "No segments available"
    
    # Build user prompt
    user_prompt = f"""Analyze this lecture to infer the teacher's style:

LECTURE TITLE: {lecture_title}

LECTURE TEXT (first 6000 chars):
{truncated_text}

SEGMENTS SUMMARY:
{segments_text}

Based on the writing style, explanation patterns, analogies used, and sentence structure,
infer the teaching style profile as JSON."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": STYLE_EXTRACTION_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,  # Lower temperature for more consistent extraction
            response_format={"type": "json_object"},
        )
        
        content = response.choices[0].message.content
        if not content:
            logger.warning("LLM returned empty content, using default style")
            return DEFAULT_STYLE
        
        # Parse JSON response
        try:
            # Clean content: remove markdown code blocks if present
            cleaned_content = content.strip()
            if cleaned_content.startswith("```"):
                # Remove markdown code block markers
                lines = cleaned_content.split("\n")
                # Remove first line (```json or ```)
                if lines[0].startswith("```"):
                    lines = lines[1:]
                # Remove last line (```)
                if lines and lines[-1].strip() == "```":
                    lines = lines[:-1]
                cleaned_content = "\n".join(lines)
            
            # Try to parse as JSON
            style_data = json.loads(cleaned_content)
            
            # Validate required fields
            tone = style_data.get("tone", DEFAULT_STYLE.tone)
            teaching_style = style_data.get("teaching_style", DEFAULT_STYLE.teaching_style)
            sentence_structure = style_data.get("sentence_structure", DEFAULT_STYLE.sentence_structure)
            explanation_order = style_data.get("explanation_order", DEFAULT_STYLE.explanation_order)
            forbidden_styles = style_data.get("forbidden_styles", DEFAULT_STYLE.forbidden_styles)
            
            # Ensure lists are actually lists
            if not isinstance(explanation_order, list):
                explanation_order = DEFAULT_STYLE.explanation_order
            if not isinstance(forbidden_styles, list):
                forbidden_styles = DEFAULT_STYLE.forbidden_styles
            
            return TeachingStyleProfile(
                id="default",
                tone=str(tone),
                teaching_style=str(teaching_style),
                sentence_structure=str(sentence_structure),
                explanation_order=list(explanation_order),
                forbidden_styles=list(forbidden_styles),
            )
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse LLM JSON response: {e}, content: {content[:200]}")
            return DEFAULT_STYLE
        except Exception as e:
            logger.warning(f"Error processing LLM response: {e}")
            return DEFAULT_STYLE
            
    except Exception as e:
        logger.error(f"Error calling LLM for style extraction: {e}", exc_info=True)
        return DEFAULT_STYLE
