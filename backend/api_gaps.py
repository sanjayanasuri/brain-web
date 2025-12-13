"""
API endpoints for Gaps View - identifying knowledge gaps in the graph.
"""
from typing import List
from fastapi import APIRouter, Depends
from db_neo4j import get_neo4j_session
from services_graph import _normalize_concept_from_db
from models import Concept

router = APIRouter(prefix="/gaps", tags=["gaps"])


@router.get("/overview")
def get_gaps_overview(limit: int = 10, session=Depends(get_neo4j_session)):
    """
    Get a comprehensive overview of knowledge gaps.
    
    Returns:
    {
        "missing_descriptions": [{"node_id": "...", "name": "...", "domain": "..."}, ...],
        "low_connectivity": [{"node_id": "...", "name": "...", "degree": 1, "domain": "..."}, ...],
        "high_interest_low_coverage": [{"node_id": "...", "name": "...", "question_count": 7, "lecture_count": 1}, ...]
    }
    """
    # 1. Missing descriptions
    missing_descriptions_query = """
    MATCH (c:Concept)
    WHERE c.description IS NULL OR c.description = "" OR size(c.description) < 20
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.description AS description,
           c.tags AS tags,
           c.notes_key AS notes_key,
           c.lecture_key AS lecture_key,
           c.url_slug AS url_slug,
           COALESCE(c.lecture_sources, []) AS lecture_sources,
           c.created_by AS created_by,
           c.last_updated_by AS last_updated_by
    LIMIT $limit
    """
    missing_records = session.run(missing_descriptions_query, limit=limit)
    missing_descriptions = [
        _normalize_concept_from_db(record.data()) for record in missing_records
    ]
    
    # 2. Low connectivity (concepts with few relationships)
    low_connectivity_query = """
    MATCH (c:Concept)
    OPTIONAL MATCH (c)-[r]-()
    WITH c, count(r) AS degree
    WHERE degree < 3 AND (c.description IS NULL OR size(c.description) < 100)
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.description AS description,
           c.tags AS tags,
           c.notes_key AS notes_key,
           c.lecture_key AS lecture_key,
           c.url_slug AS url_slug,
           COALESCE(c.lecture_sources, []) AS lecture_sources,
           c.created_by AS created_by,
           c.last_updated_by AS last_updated_by,
           degree
    ORDER BY degree ASC
    LIMIT $limit
    """
    low_connectivity_records = session.run(low_connectivity_query, limit=limit)
    low_connectivity = []
    for record in low_connectivity_records:
        concept_data = _normalize_concept_from_db(record.data())
        low_connectivity.append({
            "node_id": concept_data.node_id,
            "name": concept_data.name,
            "degree": record["degree"],
            "domain": concept_data.domain,
        })
    
    # 3. High interest but low coverage
    # Concepts that appear in many lecture sources but have short descriptions
    high_interest_query = """
    MATCH (c:Concept)
    WHERE c.lecture_sources IS NOT NULL AND size(c.lecture_sources) > 0
    WITH c, size(c.lecture_sources) AS lecture_count
    WHERE (c.description IS NULL OR size(c.description) < 50) AND lecture_count >= 2
    OPTIONAL MATCH (a:AnswerRecord)
    WHERE a.question CONTAINS c.name OR a.raw_answer CONTAINS c.name
    WITH c, lecture_count, count(a) AS question_count
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           c.description AS description,
           c.tags AS tags,
           c.notes_key AS notes_key,
           c.lecture_key AS lecture_key,
           c.url_slug AS url_slug,
           COALESCE(c.lecture_sources, []) AS lecture_sources,
           c.created_by AS created_by,
           c.last_updated_by AS last_updated_by,
           lecture_count,
           question_count
    ORDER BY question_count DESC, lecture_count DESC
    LIMIT $limit
    """
    high_interest_records = session.run(high_interest_query, limit=limit)
    high_interest_low_coverage = []
    for record in high_interest_records:
        high_interest_low_coverage.append({
            "node_id": record["node_id"],
            "name": record["name"],
            "question_count": record["question_count"] or 0,
            "lecture_count": record["lecture_count"] or 0,
            "domain": record["domain"],
        })
    
    return {
        "missing_descriptions": [
            {
                "node_id": c.node_id,
                "name": c.name,
                "domain": c.domain,
            }
            for c in missing_descriptions
        ],
        "low_connectivity": low_connectivity,
        "high_interest_low_coverage": high_interest_low_coverage,
    }
