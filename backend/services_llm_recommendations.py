"""
LLM-powered study recommendations service.

Uses GPT to analyze study patterns, exam requirements, and suggest
optimal study plans.
"""
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from neo4j import Session
from services_model_router import model_router, TASK_RECOMMEND
from services_study_analytics import StudyRecommendation, UpcomingExam
from services_branch_explorer import get_active_graph_context, ensure_graph_scoping_initialized
from services_graph import get_concept_by_id, get_concept_by_name
from services_lectures import get_lecture_by_id
import json
import re
import logging

logger = logging.getLogger("brain_web")



def generate_study_plan_with_llm(
    session: Session,
    upcoming_exam: Optional[UpcomingExam] = None,
    study_time_by_domain: Optional[Dict[str, int]] = None,
    graph_id: Optional[str] = None,
    branch_id: Optional[str] = None
) -> List[StudyRecommendation]:
    """
    Use LLM to generate personalized study recommendations.
    
    Args:
        session: Neo4j session
        upcoming_exam: Optional upcoming exam to prioritize
        study_time_by_domain: Optional dict of domain -> time_ms
        graph_id: Optional graph ID
        branch_id: Optional branch ID
    
    Returns:
        List of StudyRecommendation objects
    """
    if not model_router.client:
        return []

    
    ensure_graph_scoping_initialized(session)
    if not graph_id or not branch_id:
        graph_id, branch_id = get_active_graph_context(session)
    
    # Build context about user's study patterns
    study_context = ""
    if study_time_by_domain:
        domain_hours = {domain: ms / (1000 * 60 * 60) for domain, ms in study_time_by_domain.items()}
        study_context = f"""
STUDY TIME (last 7 days):
{chr(10).join([f"- {domain}: {hours:.1f} hours" for domain, hours in domain_hours.items()])}
"""
    
    exam_context = ""
    if upcoming_exam:
        exam_context = f"""
UPCOMING EXAM:
- Title: {upcoming_exam.title}
- Date: {upcoming_exam.date.strftime('%Y-%m-%d')} ({upcoming_exam.days_until} days away)
- Required concepts: {', '.join(upcoming_exam.required_concepts[:10])}
- Domain: {upcoming_exam.domain or 'General'}
"""
    
    # Get concepts that need study (low coverage or exam-related)
    query = """
    MATCH (c:Concept)
    WHERE c.graph_id = $graph_id
    OPTIONAL MATCH (c)<-[:MENTIONS]-(claim:Claim)
    OPTIONAL MATCH (c)<-[:COVERS]-(seg:LectureSegment)
    WITH c, 
         COUNT(DISTINCT claim) AS claim_count,
         COUNT(DISTINCT seg) AS segment_count
    WHERE claim_count < 5 OR segment_count < 3
    RETURN c.node_id AS concept_id,
           c.name AS concept_name,
           c.domain AS domain,
           c.description AS description,
           claim_count,
           segment_count
    ORDER BY claim_count ASC
    LIMIT 20
    """
    
    result = session.run(query, graph_id=graph_id)
    concepts_data = []
    for record in result:
        concepts_data.append({
            "concept_id": record["concept_id"],
            "concept_name": record["concept_name"],
            "domain": record.get("domain", "General"),
            "description": record.get("description", ""),
            "claim_count": record["claim_count"],
            "segment_count": record["segment_count"]
        })
    
    if not concepts_data:
        return []
    
    # Build prompt for LLM
    concepts_text = "\n".join([
        f"- {c['concept_name']} ({c['domain']}): {c['description'][:100]}... "
        f"[Coverage: {c['claim_count']} claims, {c['segment_count']} segments]"
        for c in concepts_data[:15]
    ])
    
    prompt = f"""You are a study planning assistant. Analyze the user's study patterns and upcoming exam to recommend what they should study next.

{study_context}

{exam_context}

CONCEPTS NEEDING STUDY:
{concepts_text}

Your task:
1. Recommend 5-8 concepts to study next, prioritizing:
   - Concepts required for the upcoming exam (if any)
   - Concepts with low coverage that are foundational
   - Concepts in domains where the user has spent less time
2. For each recommendation, provide:
   - Priority: "high", "medium", or "low"
   - Reason: 1-2 sentence explanation
   - Estimated study time in minutes

Return ONLY valid JSON matching this schema:
{{
  "recommendations": [
    {{
      "concept_id": "concept_id",
      "concept_name": "Concept Name",
      "priority": "high|medium|low",
      "reason": "Why this should be studied now",
      "estimated_time_min": 30
    }}
  ]
}}

Focus on actionable, prioritized recommendations. Do not include any text before or after the JSON."""
    
    try:
        raw = model_router.completion(
            task_type=TASK_RECOMMEND,
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert study planning assistant that creates personalized, prioritized study recommendations based on exam deadlines, study patterns, and knowledge gaps.",
                },
                {
                    "role": "user",
                    "content": prompt,
                },
            ],
            temperature=0.3,
            max_tokens=1500,
        )

        content = (raw or "").strip()
        
        # Extract JSON
        json_match = re.search(r'\{.*\}', content, re.DOTALL)
        if json_match:
            content = json_match.group(0)
        
        data = json.loads(content)
        
        recommendations = []
        for rec_data in data.get("recommendations", []):
            concept_id = rec_data.get("concept_id")
            if not concept_id:
                continue
            
            # Get concept details (try by ID first, then by name)
            concept = get_concept_by_id(session, concept_id)
            if not concept and rec_data.get("concept_name"):
                # Fallback: try to find by name
                concept = get_concept_by_name(session, rec_data["concept_name"])
            if not concept:
                continue
            
            # Get suggested documents (segments/lectures)
            seg_query = """
            MATCH (c:Concept {node_id: $concept_id})<-[:COVERS]-(seg:LectureSegment)
            MATCH (lec:Lecture {lecture_id: seg.lecture_id})
            RETURN lec.lecture_id AS document_id,
                   lec.title AS title,
                   seg.segment_index AS section_index
            ORDER BY seg.segment_index
            LIMIT 3
            """
            seg_result = session.run(seg_query, concept_id=concept_id)
            
            suggested_docs = []
            for seg_rec in seg_result:
                segment_id = seg_rec.get("segment_id")
                if segment_id:
                    suggested_docs.append({
                        "document_id": seg_rec["document_id"],
                        "title": seg_rec["title"],
                        "section": f"Segment {seg_rec.get('section_index', 0)}",
                        "url": f"/reader/segment?lectureId={seg_rec['document_id']}&segmentIndex={seg_rec.get('section_index', 0)}"
                    })
                else:
                    suggested_docs.append({
                        "document_id": seg_rec["document_id"],
                        "title": seg_rec["title"],
                        "section": f"Segment {seg_rec.get('section_index', 0)}",
                        "url": f"/reader/segment?lectureId={seg_rec['document_id']}&segmentIndex={seg_rec.get('section_index', 0)}"
                    })
            
            recommendations.append(StudyRecommendation(
                concept_id=concept_id,
                concept_name=rec_data.get("concept_name", concept.name),
                priority=rec_data.get("priority", "medium"),
                reason=rec_data.get("reason", "Recommended for study"),
                suggested_documents=suggested_docs,
                estimated_time_min=rec_data.get("estimated_time_min", 30)
            ))
        
        return recommendations
        
    except Exception as e:
        logger.error(f"Failed to generate LLM study recommendations: {e}")
        return []
