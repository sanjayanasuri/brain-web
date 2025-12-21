"""
API endpoints for Gaps View - identifying knowledge gaps in the graph.
"""
from typing import List
from fastapi import APIRouter, Depends
from datetime import datetime, timedelta
from db_neo4j import get_neo4j_session
from services_graph import _normalize_concept_from_db
from services_branch_explorer import (
    ensure_graph_scoping_initialized,
    get_active_graph_context,
)
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
        "high_interest_low_coverage": [{"node_id": "...", "name": "...", "question_count": 7, "lecture_count": 1}, ...],
        "browser_gaps": [{"node_id": "...", "name": "...", "artifact_count": 3, "label": "From browsing"}, ...]
    }
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    # 1. Missing descriptions
    missing_descriptions_query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (c:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND (c.description IS NULL OR c.description = "" OR size(c.description) < 20)
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
    missing_records = session.run(missing_descriptions_query, graph_id=graph_id, branch_id=branch_id, limit=limit)
    missing_descriptions = [
        _normalize_concept_from_db(record.data()) for record in missing_records
    ]
    
    # 2. Low connectivity (concepts with few relationships)
    low_connectivity_query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (c:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
    OPTIONAL MATCH (c)-[r]-(:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(r.on_branches, [])
    WITH c, count(DISTINCT r) AS degree
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
    low_connectivity_records = session.run(low_connectivity_query, graph_id=graph_id, branch_id=branch_id, limit=limit)
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
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (c:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND c.lecture_sources IS NOT NULL AND size(c.lecture_sources) > 0
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
    high_interest_records = session.run(high_interest_query, graph_id=graph_id, branch_id=branch_id, limit=limit)
    high_interest_low_coverage = []
    for record in high_interest_records:
        high_interest_low_coverage.append({
            "node_id": record["node_id"],
            "name": record["name"],
            "question_count": record["question_count"] or 0,
            "lecture_count": record["lecture_count"] or 0,
            "domain": record["domain"],
        })
    
    # 4. Browser gaps: concepts from artifacts with missing descriptions or low connectivity
    browser_gaps = []
    try:
        # Concepts that appear in many Artifacts but have missing descriptions or low connectivity
        browser_gaps_query = """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MATCH (a:Artifact)-[:MENTIONS]->(c:Concept)-[:BELONGS_TO]->(g)
        WHERE $branch_id IN COALESCE(a.on_branches, [])
          AND $branch_id IN COALESCE(c.on_branches, [])
          AND (c.description IS NULL OR c.description = "" OR size(c.description) < 50)
        WITH c, count(DISTINCT a) AS artifact_count
        WHERE artifact_count >= 2
        OPTIONAL MATCH (c)-[r]-(:Concept)-[:BELONGS_TO]->(g)
        WHERE $branch_id IN COALESCE(r.on_branches, [])
        WITH c, artifact_count, count(DISTINCT r) AS degree
        WHERE degree < 3 OR artifact_count >= 3
        RETURN c.node_id AS node_id,
               c.name AS name,
               c.domain AS domain,
               artifact_count,
               degree
        ORDER BY artifact_count DESC, degree ASC
        LIMIT $limit
        """
        browser_gaps_records = session.run(browser_gaps_query, graph_id=graph_id, branch_id=branch_id, limit=limit)
        for record in browser_gaps_records:
            browser_gaps.append({
                "node_id": record["node_id"],
                "name": record["name"],
                "domain": record.get("domain"),
                "artifact_count": record["artifact_count"] or 0,
                "degree": record["degree"] or 0,
                "label": "From browsing"
            })
    except Exception as e:
        # Don't fail entire endpoint if browser gaps query fails
        print(f"[Gaps] Error computing browser gaps: {e}")
    
    # 5. Recent browsing gaps: concepts frequently mentioned in artifacts from last 7 days
    recent_browsing_gaps = []
    try:
        seven_days_ago = int((datetime.utcnow() - timedelta(days=7)).timestamp() * 1000)
        
        recent_browsing_query = """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MATCH (a:Artifact)-[:MENTIONS]->(c:Concept)-[:BELONGS_TO]->(g)
        WHERE $branch_id IN COALESCE(a.on_branches, [])
          AND $branch_id IN COALESCE(c.on_branches, [])
          AND a.captured_at >= $seven_days_ago
        WITH c, count(DISTINCT a) AS recent_artifact_count
        WHERE recent_artifact_count >= 2
          AND (c.description IS NULL OR c.description = "" OR size(c.description) < 50)
        OPTIONAL MATCH (c)-[r]-(:Concept)-[:BELONGS_TO]->(g)
        WHERE $branch_id IN COALESCE(r.on_branches, [])
        WITH c, recent_artifact_count, count(DISTINCT r) AS degree
        RETURN c.node_id AS node_id,
               c.name AS name,
               c.domain AS domain,
               recent_artifact_count,
               degree
        ORDER BY recent_artifact_count DESC
        LIMIT $limit
        """
        recent_browsing_records = session.run(
            recent_browsing_query,
            graph_id=graph_id,
            branch_id=branch_id,
            seven_days_ago=seven_days_ago,
            limit=limit
        )
        for record in recent_browsing_records:
            recent_browsing_gaps.append({
                "node_id": record["node_id"],
                "name": record["name"],
                "domain": record.get("domain"),
                "recent_artifact_count": record["recent_artifact_count"] or 0,
                "degree": record["degree"] or 0,
                "label": "From browsing"
            })
    except Exception as e:
        # Don't fail entire endpoint if recent browsing gaps query fails
        print(f"[Gaps] Error computing recent browsing gaps: {e}")
    
    # Combine browser gaps (deduplicate by node_id)
    all_browser_gaps = {}
    for gap in browser_gaps + recent_browsing_gaps:
        node_id = gap["node_id"]
        if node_id not in all_browser_gaps:
            all_browser_gaps[node_id] = gap
        else:
            # Merge counts if duplicate
            existing = all_browser_gaps[node_id]
            existing["artifact_count"] = max(
                existing.get("artifact_count", 0),
                gap.get("artifact_count", 0),
                gap.get("recent_artifact_count", 0)
            )
    
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
        "browser_gaps": list(all_browser_gaps.values()),
    }
