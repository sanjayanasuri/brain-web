"""
Service for drafting follow-up lectures using LLM and teaching style.
"""
import json
import re
from typing import List, Dict, Any, Optional
from neo4j import Session
from openai import OpenAI
from config import OPENAI_API_KEY
from services_teaching_style import get_teaching_style
from services_graph import get_concept_by_name, get_neighbors_with_relationships, _normalize_concept_from_db
from services_lectures import get_lecture_by_id
from models import LectureSegment, Concept, Analogy

# Initialize OpenAI client
client = None
if OPENAI_API_KEY:
    cleaned_key = OPENAI_API_KEY.strip().strip('"').strip("'")
    if cleaned_key and cleaned_key.startswith('sk-'):
        try:
            client = OpenAI(api_key=cleaned_key)
        except Exception as e:
            print(f"ERROR: Failed to initialize OpenAI client for lecture draft: {e}")
            client = None
    else:
        client = None
else:
    print("WARNING: OPENAI_API_KEY not found - lecture drafting will not work")


def draft_next_lecture(
    session: Session,
    seed_concepts: List[str],
    source_lecture_id: Optional[str] = None,
    target_level: str = "intermediate",
) -> Dict[str, Any]:
    """
    Draft a follow-up lecture outline using teaching style and graph context.
    
    Args:
        session: Neo4j session
        seed_concepts: List of concept names to build the lecture around
        source_lecture_id: Optional lecture ID to use as context
        target_level: "intro", "intermediate", or "advanced"
    
    Returns:
        Dict with outline, sections, and suggested_analogies
    """
    if not client:
        raise ValueError("OpenAI client not initialized. Check OPENAI_API_KEY.")
    
    # Get teaching style
    teaching_style = get_teaching_style(session)
    
    # Build context from seed concepts
    concept_contexts = []
    for concept_name in seed_concepts:
        concept = get_concept_by_name(session, concept_name)
        if concept:
            neighbors = get_neighbors_with_relationships(session, concept.node_id)
            neighbor_names = [n["concept"].name for n in neighbors[:5]]  # Top 5 neighbors
            concept_contexts.append({
                "name": concept.name,
                "description": concept.description or "No description available",
                "domain": concept.domain,
                "neighbors": neighbor_names,
            })
    
    # Get source lecture context if provided
    source_lecture_context = ""
    if source_lecture_id:
        lecture = get_lecture_by_id(session, source_lecture_id)
        if lecture:
            # Fetch segments directly from Neo4j to avoid circular import
            query = """
            MATCH (lec:Lecture {lecture_id: $lecture_id})-[:HAS_SEGMENT]->(seg:LectureSegment)
            RETURN seg.summary AS summary, seg.text AS text
            ORDER BY seg.segment_index
            LIMIT 3
            """
            records = session.run(query, lecture_id=source_lecture_id)
            segment_texts = []
            for rec in records:
                summary = rec.get("summary")
                text = rec.get("text", "")
                segment_texts.append(summary or text[:100] + "...")
            
            source_lecture_context = f"""
Source lecture: {lecture.title}
{lecture.description or ""}

Recent segments from this lecture:
{chr(10).join([f"- {text}" for text in segment_texts])}
"""
    
    # Build prompt
    concepts_text = "\n".join([
        f"- {c['name']}: {c['description']} (neighbors: {', '.join(c['neighbors'][:3])})"
        for c in concept_contexts
    ])
    
    prompt = f"""You are drafting a follow-up lecture in the user's teaching style.

TEACHING STYLE PROFILE:
- Tone: {teaching_style.tone}
- Teaching style: {teaching_style.teaching_style}
- Sentence structure: {teaching_style.sentence_structure}
- Explanation order: {' → '.join(teaching_style.explanation_order)}
- Forbidden styles: {', '.join(teaching_style.forbidden_styles)}

TARGET LEVEL: {target_level}

SEED CONCEPTS (to build the lecture around):
{concepts_text}

{source_lecture_context}

Your task:
1. Create a practical, teachable outline for a follow-up lecture that builds on these concepts
2. Match the user's teaching style exactly (tone, structure, explanation order)
3. Prefer analogies consistent with their style (analogy-first if that's their style)
4. Keep it practical, not academic fluff
5. Structure it as 4-6 main sections

Return ONLY valid JSON matching this schema:
{{
  "outline": [
    "1. Section title",
    "2. Section title",
    ...
  ],
  "sections": [
    {{
      "title": "Section title",
      "summary": "1-2 sentence summary of what this section covers"
    }},
    ...
  ],
  "suggested_analogies": [
    {{
      "label": "Short memorable analogy name",
      "description": "What this analogy explains (1-2 sentences)",
      "target_concepts": ["Concept Name"]
    }},
    ...
  ]
}}

Do not include any text before or after the JSON."""
    
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful teaching assistant that drafts lecture outlines matching the user's exact teaching style.",
                },
                {
                    "role": "user",
                    "content": prompt,
                },
            ],
            temperature=0.7,
            max_tokens=1200,
        )
        
        content = response.choices[0].message.content
        # Try to extract JSON from response
        json_match = re.search(r'\{.*\}', content, re.DOTALL)
        if json_match:
            content = json_match.group(0)
        
        result = json.loads(content)
        
        # Validate structure
        if "outline" not in result:
            result["outline"] = []
        if "sections" not in result:
            result["sections"] = []
        if "suggested_analogies" not in result:
            result["suggested_analogies"] = []
        
        return result
        
    except json.JSONDecodeError as e:
        print(f"ERROR: Failed to parse LLM response as JSON: {e}")
        print(f"Response content: {content[:500]}")
        # Return a fallback structure
        return {
            "outline": [
                "1. Recap: What we already know",
                "2. Deep dive into core concepts",
                "3. Connections and applications",
                "4. Summary and next steps",
            ],
            "sections": [
                {
                    "title": "Recap: What we already know",
                    "summary": "Brief recap of prior concepts",
                },
            ],
            "suggested_analogies": [],
        }
    except Exception as e:
        print(f"ERROR: Failed to draft lecture: {e}")
        raise ValueError(f"Failed to draft lecture: {str(e)}")
