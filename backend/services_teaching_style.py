"""
Service for managing Teaching Style Profile in Neo4j.

The Teaching Style Profile represents the user's preferred explanation style,
learned from ingested lectures and manually editable via API.
"""
from typing import Optional
from neo4j import Session
from models import TeachingStyleProfile, TeachingStyleUpdateRequest


DEFAULT_STYLE = TeachingStyleProfile(
    id="default",
    tone="intuitive, grounded, exploratory, technical but conversational",
    teaching_style=(
        "analogy-first, zoom-out then zoom-in, highlight big picture, "
        "emphasize real-world pattern recognition"
    ),
    sentence_structure="short, minimal filler, avoid dramatic language",
    explanation_order=[
        "big picture",
        "core concept definition",
        "example or analogy",
        "connection to adjacent concepts",
        "common pitfalls",
        "summary",
    ],
    forbidden_styles=[
        "overly formal",
        "generic GPT-like filler",
        "glib positivity",
        "verbose academic tone",
    ],
)


def get_teaching_style(session: Session) -> TeachingStyleProfile:
    """
    Load the teaching style profile from Neo4j.
    If none exists, create one using DEFAULT_STYLE and return it.
    
    Args:
        session: Neo4j session
        
    Returns:
        TeachingStyleProfile (always returns a valid profile)
    """
    query = """
    MATCH (s:TeachingStyle {id: 'default'})
    RETURN s.id AS id,
           s.tone AS tone,
           s.teaching_style AS teaching_style,
           s.sentence_structure AS sentence_structure,
           s.explanation_order AS explanation_order,
           s.forbidden_styles AS forbidden_styles
    LIMIT 1
    """
    
    record = session.run(query).single()
    
    if record:
        # Load existing profile
        return TeachingStyleProfile(
            id=record["id"] or "default",
            tone=record["tone"] or DEFAULT_STYLE.tone,
            teaching_style=record["teaching_style"] or DEFAULT_STYLE.teaching_style,
            sentence_structure=record["sentence_structure"] or DEFAULT_STYLE.sentence_structure,
            explanation_order=record["explanation_order"] or DEFAULT_STYLE.explanation_order,
            forbidden_styles=record["forbidden_styles"] or DEFAULT_STYLE.forbidden_styles,
        )
    else:
        # No profile exists, create default one
        return create_default_teaching_style(session)


def create_default_teaching_style(session: Session) -> TeachingStyleProfile:
    """
    Create a default teaching style profile in Neo4j.
    
    Args:
        session: Neo4j session
        
    Returns:
        TeachingStyleProfile (the created default profile)
    """
    query = """
    MERGE (s:TeachingStyle {id: 'default'})
    SET s.tone = $tone,
        s.teaching_style = $teaching_style,
        s.sentence_structure = $sentence_structure,
        s.explanation_order = $explanation_order,
        s.forbidden_styles = $forbidden_styles
    RETURN s.id AS id,
           s.tone AS tone,
           s.teaching_style AS teaching_style,
           s.sentence_structure AS sentence_structure,
           s.explanation_order AS explanation_order,
           s.forbidden_styles AS forbidden_styles
    """
    
    params = {
        "tone": DEFAULT_STYLE.tone,
        "teaching_style": DEFAULT_STYLE.teaching_style,
        "sentence_structure": DEFAULT_STYLE.sentence_structure,
        "explanation_order": DEFAULT_STYLE.explanation_order,
        "forbidden_styles": DEFAULT_STYLE.forbidden_styles,
    }
    
    record = session.run(query, **params).single()
    
    if not record:
        # Fallback: return default without persisting (shouldn't happen)
        return DEFAULT_STYLE
    
    return TeachingStyleProfile(
        id=record["id"] or "default",
        tone=record["tone"],
        teaching_style=record["teaching_style"],
        sentence_structure=record["sentence_structure"],
        explanation_order=record["explanation_order"],
        forbidden_styles=record["forbidden_styles"],
    )


def update_teaching_style(
    session: Session,
    update: TeachingStyleUpdateRequest,
) -> TeachingStyleProfile:
    """
    Update the teaching style profile with partial updates.
    Loads existing (or creates default if missing), applies non-None fields from update,
    writes back to Neo4j and returns full profile.
    
    Args:
        session: Neo4j session
        update: Partial update request (only non-None fields are applied)
        
    Returns:
        TeachingStyleProfile (the updated full profile)
    """
    # Load existing profile (or default if missing)
    current = get_teaching_style(session)
    
    # Apply updates (only non-None fields)
    updated_tone = update.tone if update.tone is not None else current.tone
    updated_teaching_style = update.teaching_style if update.teaching_style is not None else current.teaching_style
    updated_sentence_structure = update.sentence_structure if update.sentence_structure is not None else current.sentence_structure
    updated_explanation_order = update.explanation_order if update.explanation_order is not None else current.explanation_order
    updated_forbidden_styles = update.forbidden_styles if update.forbidden_styles is not None else current.forbidden_styles
    
    # Write back to Neo4j
    query = """
    MERGE (s:TeachingStyle {id: 'default'})
    SET s.tone = $tone,
        s.teaching_style = $teaching_style,
        s.sentence_structure = $sentence_structure,
        s.explanation_order = $explanation_order,
        s.forbidden_styles = $forbidden_styles
    RETURN s.id AS id,
           s.tone AS tone,
           s.teaching_style AS teaching_style,
           s.sentence_structure AS sentence_structure,
           s.explanation_order AS explanation_order,
           s.forbidden_styles AS forbidden_styles
    """
    
    params = {
        "tone": updated_tone,
        "teaching_style": updated_teaching_style,
        "sentence_structure": updated_sentence_structure,
        "explanation_order": updated_explanation_order,
        "forbidden_styles": updated_forbidden_styles,
    }
    
    record = session.run(query, **params).single()
    
    if not record:
        # Fallback: return the updated model without persisting (shouldn't happen)
        return TeachingStyleProfile(
            id=current.id,
            tone=updated_tone,
            teaching_style=updated_teaching_style,
            sentence_structure=updated_sentence_structure,
            explanation_order=updated_explanation_order,
            forbidden_styles=updated_forbidden_styles,
        )
    
    return TeachingStyleProfile(
        id=record["id"] or "default",
        tone=record["tone"],
        teaching_style=record["teaching_style"],
        sentence_structure=record["sentence_structure"],
        explanation_order=record["explanation_order"],
        forbidden_styles=record["forbidden_styles"],
    )
