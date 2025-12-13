"""
Service for aggregating teaching style across multiple lectures.

This module:
1. Fetches recent lectures with their segments and analogies
2. Extracts style from each lecture using LLM
3. Aggregates into a unified TeachingStyleProfile
4. Persists the aggregated profile
"""
import logging
from typing import List, Dict, Any, Optional
from neo4j import Session
from models import TeachingStyleProfile, LectureSegment
from services_teaching_style import get_teaching_style, update_teaching_style
from teaching_style_extractor import extract_style_from_lecture

logger = logging.getLogger(__name__)


def get_recent_lectures_with_segments(
    session: Session,
    limit: int = 5,
) -> List[Dict[str, Any]]:
    """
    Fetch recent lectures with their segments and analogies.
    
    Args:
        session: Neo4j session
        limit: Maximum number of recent lectures to fetch
        
    Returns:
        List of dicts, each containing:
        - lecture_id: str
        - lecture_title: str
        - lecture_text: str (if stored) or None
        - segments: List[LectureSegment]
    """
    # Query to get recent lectures with their segments
    # We'll order by a timestamp if available, or by lecture_id as fallback
    query = """
    MATCH (lec:Lecture)
    OPTIONAL MATCH (lec)-[:HAS_SEGMENT]->(seg:LectureSegment)
    OPTIONAL MATCH (seg)-[:COVERS]->(c:Concept)
    OPTIONAL MATCH (seg)-[:USES_ANALOGY]->(a:Analogy)
    WITH lec, seg
    ORDER BY lec.lecture_id DESC
    LIMIT $limit
    WITH lec, collect(DISTINCT seg) AS segs
    RETURN lec.lecture_id AS lecture_id,
           lec.title AS lecture_title,
           lec.description AS lecture_description,
           segs AS segments
    ORDER BY lec.lecture_id DESC
    LIMIT $limit
    """
    
    records = session.run(query, limit=limit)
    lectures = []
    
    for rec in records:
        lecture_id = rec["lecture_id"]
        lecture_title = rec["lecture_title"] or "Untitled"
        lecture_description = rec["lecture_description"]
        
        # Get segments for this lecture with full details
        segments_query = """
        MATCH (lec:Lecture {lecture_id: $lecture_id})-[:HAS_SEGMENT]->(seg:LectureSegment)
        OPTIONAL MATCH (seg)-[:COVERS]->(c:Concept)
        OPTIONAL MATCH (seg)-[:USES_ANALOGY]->(a:Analogy)
        RETURN seg.segment_id AS segment_id,
               seg.lecture_id AS lecture_id,
               seg.segment_index AS segment_index,
               seg.start_time_sec AS start_time_sec,
               seg.end_time_sec AS end_time_sec,
               seg.text AS text,
               seg.summary AS summary,
               seg.style_tags AS style_tags,
               collect(DISTINCT {
                 node_id: c.node_id,
                 name: c.name,
                 domain: c.domain,
                 type: c.type,
                 description: c.description,
                 tags: c.tags
               }) AS concepts,
               collect(DISTINCT {
                 analogy_id: a.analogy_id,
                 label: a.label,
                 description: a.description,
                 tags: a.tags
               }) AS analogies
        ORDER BY seg.segment_index
        """
        
        seg_records = session.run(segments_query, lecture_id=lecture_id)
        segments = []
        
        for seg_rec in seg_records:
            # Convert segment to dict format for extract_style_from_lecture
            concepts_list = [c for c in (seg_rec["concepts"] or []) if c and c.get("node_id")]
            analogies_list = [a for a in (seg_rec["analogies"] or []) if a and a.get("analogy_id")]
            
            segments.append({
                "segment_index": seg_rec["segment_index"] or 0,
                "text": seg_rec["text"] or "",
                "summary": seg_rec["summary"],
                "style_tags": seg_rec["style_tags"] or [],
                "covered_concepts": concepts_list,
                "analogies": analogies_list,
            })
        
        # Try to get lecture text from segments (concatenate all segment texts)
        # If lecture text is stored elsewhere, we'd need to query that
        lecture_text = " ".join([seg.get("text", "") for seg in segments if seg.get("text")])
        
        # If no text from segments, use description as fallback
        if not lecture_text and lecture_description:
            lecture_text = lecture_description
        
        lectures.append({
            "lecture_id": lecture_id,
            "lecture_title": lecture_title,
            "lecture_text": lecture_text,
            "segments": segments,
        })
    
    return lectures


def recompute_teaching_style_from_recent_lectures(
    session: Session,
    limit: int = 5,
) -> TeachingStyleProfile:
    """
    Recompute teaching style from recent lectures.
    
    1. Fetch recent lectures + their segments/analogies.
    2. Extract style for each via LLM.
    3. Aggregate into a unified TeachingStyleProfile.
    4. Persist and return it.
    
    Aggregation strategy:
    - For tone, teaching_style, sentence_structure: last lecture wins (most recent)
    - For explanation_order and forbidden_styles: union with order preference from latest lecture
    
    Args:
        session: Neo4j session
        limit: Number of recent lectures to analyze (default 5)
        
    Returns:
        TeachingStyleProfile (the aggregated and persisted profile)
    """
    logger.info(f"Recomputing teaching style from {limit} recent lectures")
    
    # Fetch recent lectures
    lectures = get_recent_lectures_with_segments(session, limit=limit)
    
    if not lectures:
        logger.warning("No lectures found, keeping existing style")
        return get_teaching_style(session)
    
    logger.info(f"Found {len(lectures)} lectures to analyze")
    
    # Extract style from each lecture
    extracted_styles = []
    for lecture in lectures:
        try:
            style = extract_style_from_lecture(
                lecture_title=lecture["lecture_title"],
                lecture_text=lecture["lecture_text"],
                segments=lecture["segments"],
            )
            extracted_styles.append(style)
            logger.info(f"Extracted style from lecture: {lecture['lecture_title']}")
        except Exception as e:
            logger.warning(f"Failed to extract style from lecture {lecture['lecture_id']}: {e}")
            continue
    
    if not extracted_styles:
        logger.warning("No styles extracted, keeping existing style")
        return get_teaching_style(session)
    
    # Aggregate styles
    # Strategy: last lecture wins for tone, teaching_style, sentence_structure
    # Union for explanation_order and forbidden_styles (with latest taking precedence in ordering)
    latest_style = extracted_styles[-1]  # Most recent
    
    # For explanation_order: use the latest, but merge unique items from all
    all_explanation_orders = []
    for style in extracted_styles:
        all_explanation_orders.extend(style.explanation_order)
    
    # Dedupe while preserving order (latest first)
    seen = set()
    aggregated_explanation_order = []
    for item in reversed(all_explanation_orders):  # Start from latest
        if item not in seen:
            seen.add(item)
            aggregated_explanation_order.insert(0, item)  # Insert at beginning to maintain latest-first
    
    # If empty, use default
    if not aggregated_explanation_order:
        aggregated_explanation_order = latest_style.explanation_order
    
    # For forbidden_styles: union all, dedupe
    all_forbidden_styles = []
    for style in extracted_styles:
        all_forbidden_styles.extend(style.forbidden_styles)
    
    aggregated_forbidden_styles = list(set(all_forbidden_styles))  # Dedupe
    
    # If empty, use default
    if not aggregated_forbidden_styles:
        aggregated_forbidden_styles = latest_style.forbidden_styles
    
    # Build aggregated profile
    aggregated_profile = TeachingStyleProfile(
        id="default",
        tone=latest_style.tone,
        teaching_style=latest_style.teaching_style,
        sentence_structure=latest_style.sentence_structure,
        explanation_order=aggregated_explanation_order,
        forbidden_styles=aggregated_forbidden_styles,
    )
    
    # Persist via update_teaching_style
    from models import TeachingStyleUpdateRequest
    update_request = TeachingStyleUpdateRequest(
        tone=aggregated_profile.tone,
        teaching_style=aggregated_profile.teaching_style,
        sentence_structure=aggregated_profile.sentence_structure,
        explanation_order=aggregated_profile.explanation_order,
        forbidden_styles=aggregated_profile.forbidden_styles,
    )
    
    persisted_profile = update_teaching_style(session, update_request)
    logger.info("Teaching style recomputed and persisted")
    
    return persisted_profile
