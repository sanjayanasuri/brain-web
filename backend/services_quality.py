"""
Quality metrics service for concepts and graphs.

Computes:
- Concept Coverage Score (0-100)
- Evidence Freshness (Fresh/Aging/Stale/No evidence)
- Graph Health (Healthy/Needs attention/Poor)
"""

from typing import Dict, Any, Optional, List
from neo4j import Session
from datetime import datetime, timedelta
from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context
from services_resources import get_resources_for_concept
from services_graph import get_neighbors_with_relationships, get_proposed_relationships


def compute_concept_coverage(
    session: Session,
    concept_id: str,
    graph_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Compute coverage score (0-100) for a concept.
    
    Scoring:
    - Has description: 30 points
    - Evidence count:
      - 0 = 0 points
      - 1-2 = 15 points
      - 3+ = 25 points
    - Connectivity (degree):
      - degree >= 5 = 25 points
      - degree 2-4 = 15 points
      - degree 0-1 = 5 points
    - Reviewed relationships ratio: 20 points
      (if available, otherwise not included in score)
    
    Returns:
        {
            "coverage_score": int (0-100),
            "coverage_breakdown": {
                "has_description": bool,
                "evidence_count": int,
                "degree": int,
                "reviewed_ratio": Optional[float]
            }
        }
    """
    ensure_graph_scoping_initialized(session)
    if graph_id:
        # Use provided graph_id
        graph_id_ctx = graph_id
        branch_id = "main"  # Default branch
    else:
        graph_id_ctx, branch_id = get_active_graph_context(session)
    
    # Get concept
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (c:Concept {node_id: $concept_id})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
    RETURN c.description AS description
    """
    result = session.run(query, concept_id=concept_id, graph_id=graph_id_ctx, branch_id=branch_id)
    record = result.single()
    if not record:
        return {
            "coverage_score": 0,
            "coverage_breakdown": {
                "has_description": False,
                "evidence_count": 0,
                "degree": 0,
                "reviewed_ratio": None
            }
        }
    
    has_description = bool(record["description"] and len(record["description"].strip()) > 0)
    
    # Count evidence (resources)
    resources = get_resources_for_concept(session, concept_id, include_archived=False)
    evidence_count = len(resources)
    
    # Count degree (connections)
    neighbors = get_neighbors_with_relationships(session, concept_id, include_proposed="all")
    degree = len(neighbors)
    
    # Count reviewed vs total relationships
    reviewed_count = 0
    total_relationships = 0
    for neighbor in neighbors:
        status = neighbor.get("relationship_status", "ACCEPTED")
        total_relationships += 1
        if status == "ACCEPTED":
            reviewed_count += 1
    
    reviewed_ratio = reviewed_count / total_relationships if total_relationships > 0 else None
    
    # Compute score
    score = 0
    
    # Description: 30 points
    if has_description:
        score += 30
    
    # Evidence: 0/15/25 points
    if evidence_count == 0:
        evidence_points = 0
    elif evidence_count <= 2:
        evidence_points = 15
    else:
        evidence_points = 25
    score += evidence_points
    
    # Connectivity: 5/15/25 points
    if degree >= 5:
        connectivity_points = 25
    elif degree >= 2:
        connectivity_points = 15
    else:
        connectivity_points = 5
    score += connectivity_points
    
    # Reviewed ratio: 20 points (if available)
    if reviewed_ratio is not None:
        reviewed_points = int(reviewed_ratio * 20)
        score += reviewed_points
    
    # If reviewed_ratio not available, scale the score to 100
    # Otherwise max is 100
    max_possible = 100 if reviewed_ratio is not None else 80
    if max_possible < 100:
        # Scale to 100
        score = int((score / max_possible) * 100)
    
    return {
        "coverage_score": min(100, max(0, score)),
        "coverage_breakdown": {
            "has_description": has_description,
            "evidence_count": evidence_count,
            "degree": degree,
            "reviewed_ratio": reviewed_ratio
        }
    }


def compute_evidence_freshness(
    session: Session,
    concept_id: str
) -> Dict[str, Any]:
    """
    Compute freshness level for a concept's evidence.
    
    Returns:
        {
            "level": "Fresh" | "Aging" | "Stale" | "No evidence",
            "newest_evidence_at": Optional[str] (ISO format)
        }
    """
    resources = get_resources_for_concept(session, concept_id, include_archived=False)
    
    if not resources:
        return {
            "level": "No evidence",
            "newest_evidence_at": None
        }
    
    # Find newest evidence date
    newest_date = None
    for resource in resources:
        created_at = resource.created_at
        if created_at:
            try:
                # Parse ISO format or timestamp
                if isinstance(created_at, str):
                    # Try parsing ISO format
                    if 'T' in created_at:
                        dt = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                    else:
                        # Try timestamp
                        dt = datetime.fromtimestamp(float(created_at))
                elif isinstance(created_at, (int, float)):
                    dt = datetime.fromtimestamp(created_at)
                else:
                    continue
                
                if newest_date is None or dt > newest_date:
                    newest_date = dt
            except (ValueError, TypeError):
                continue
    
    if newest_date is None:
        return {
            "level": "No evidence",
            "newest_evidence_at": None
        }
    
    # Compute age
    now = datetime.now(newest_date.tzinfo) if newest_date.tzinfo else datetime.now()
    age_days = (now - newest_date).days
    
    if age_days <= 30:
        level = "Fresh"
    elif age_days <= 120:
        level = "Aging"
    else:
        level = "Stale"
    
    return {
        "level": level,
        "newest_evidence_at": newest_date.isoformat()
    }


def compute_graph_health(
    session: Session,
    graph_id: str
) -> Dict[str, Any]:
    """
    Compute graph-level health metrics.
    
    Returns:
        {
            "health": "HEALTHY" | "NEEDS_ATTENTION" | "POOR",
            "stats": {
                "concepts_total": int,
                "missing_description_pct": float,
                "no_evidence_pct": float,
                "stale_evidence_pct": float,
                "proposed_relationships_count": int
            }
        }
    """
    ensure_graph_scoping_initialized(session)
    graph_id_ctx = graph_id
    branch_id = "main"  # Default branch
    
    # Get all concepts in graph
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (c:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND COALESCE(c.archived, false) = false
    RETURN c.node_id AS node_id,
           c.description AS description
    """
    result = session.run(query, graph_id=graph_id_ctx, branch_id=branch_id)
    
    concepts = list(result)
    concepts_total = len(concepts)
    
    if concepts_total == 0:
        return {
            "health": "POOR",
            "stats": {
                "concepts_total": 0,
                "missing_description_pct": 0.0,
                "no_evidence_pct": 0.0,
                "stale_evidence_pct": 0.0,
                "proposed_relationships_count": 0
            }
        }
    
    # Count missing descriptions
    missing_description_count = 0
    for record in concepts:
        description = record["description"]
        if not description or len(description.strip()) == 0:
            missing_description_count += 1
    
    missing_description_pct = (missing_description_count / concepts_total) * 100
    
    # Count concepts with no evidence and stale evidence
    no_evidence_count = 0
    stale_evidence_count = 0
    now = datetime.now()
    
    for record in concepts:
        node_id = record["node_id"]
        resources = get_resources_for_concept(session, node_id, include_archived=False)
        
        if len(resources) == 0:
            no_evidence_count += 1
        else:
            # Check if all evidence is stale
            has_fresh = False
            for resource in resources:
                created_at = resource.created_at
                if created_at:
                    try:
                        if isinstance(created_at, str):
                            if 'T' in created_at:
                                dt = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                            else:
                                dt = datetime.fromtimestamp(float(created_at))
                        elif isinstance(created_at, (int, float)):
                            dt = datetime.fromtimestamp(created_at)
                        else:
                            continue
                        
                        age_days = (now - dt.replace(tzinfo=None)).days
                        if age_days <= 120:
                            has_fresh = True
                            break
                    except (ValueError, TypeError):
                        continue
            
            if not has_fresh:
                stale_evidence_count += 1
    
    no_evidence_pct = (no_evidence_count / concepts_total) * 100
    stale_evidence_pct = (stale_evidence_count / concepts_total) * 100
    
    # Count proposed relationships
    proposed_rels = get_proposed_relationships(session, graph_id_ctx, status="PROPOSED", limit=1000)
    proposed_relationships_count = len(proposed_rels)
    
    # Determine health level
    # Healthy: <10% missing descriptions, <20% no evidence, <15% stale, <10% proposed
    # Needs attention: <25% missing, <40% no evidence, <30% stale, <25% proposed
    # Poor: otherwise
    
    proposed_pct = (proposed_relationships_count / concepts_total) * 100 if concepts_total > 0 else 0
    
    if (missing_description_pct < 10 and no_evidence_pct < 20 and 
        stale_evidence_pct < 15 and proposed_pct < 10):
        health = "HEALTHY"
    elif (missing_description_pct < 25 and no_evidence_pct < 40 and 
          stale_evidence_pct < 30 and proposed_pct < 25):
        health = "NEEDS_ATTENTION"
    else:
        health = "POOR"
    
    return {
        "health": health,
        "stats": {
            "concepts_total": concepts_total,
            "missing_description_pct": round(missing_description_pct, 1),
            "no_evidence_pct": round(no_evidence_pct, 1),
            "stale_evidence_pct": round(stale_evidence_pct, 1),
            "proposed_relationships_count": proposed_relationships_count
        }
    }


def compute_narrative_metrics(
    session: Session,
    concept_ids: List[str],
    graph_id: Optional[str] = None
) -> Dict[str, Dict[str, float]]:
    """
    Compute narrative metrics (recency, mention frequency, centrality) for a list of concepts.
    
    Metrics:
    - recencyWeight: 0-1, based on last activity/evidence timestamp (higher = more recent)
    - mentionFrequency: 0-1, based on degree + evidence count + activity events (higher = more mentioned)
    - centralityDelta: 0-1, based on degree relative to graph average (higher = more central)
    
    Returns:
        {
            "concept_id": {
                "recencyWeight": float (0-1),
                "mentionFrequency": float (0-1),
                "centralityDelta": float (0-1)
            },
            ...
        }
    """
    if not concept_ids:
        return {}
    
    ensure_graph_scoping_initialized(session)
    if graph_id:
        graph_id_ctx = graph_id
        branch_id = "main"
    else:
        graph_id_ctx, branch_id = get_active_graph_context(session)
    
    # Get user_id (demo-safe)
    user_id = "demo"  # Could be passed as parameter if needed
    
    results = {}
    now = datetime.now()
    
    # First, get max degree in graph for normalization
    max_degree_query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (c:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
    OPTIONAL MATCH (c)-[r]-(:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(r.on_branches, [])
    WITH c, count(DISTINCT r) AS degree
    RETURN max(degree) AS max_degree, avg(degree) AS avg_degree
    """
    max_degree_result = session.run(max_degree_query, graph_id=graph_id_ctx, branch_id=branch_id)
    max_degree_record = max_degree_result.single()
    max_degree = max_degree_record["max_degree"] if max_degree_record and max_degree_record["max_degree"] else 1
    avg_degree = max_degree_record["avg_degree"] if max_degree_record and max_degree_record["avg_degree"] else 0
    
    # Process each concept
    for concept_id in concept_ids:
        # Get last activity timestamp
        activity_query = """
        MATCH (e:ActivityEvent)
        WHERE e.user_id = $user_id
          AND e.concept_id = $concept_id
          AND e.type IN ['CONCEPT_VIEWED', 'RESOURCE_OPENED', 'EVIDENCE_FETCHED']
        RETURN e.created_at AS created_at
        ORDER BY e.created_at DESC
        LIMIT 1
        """
        activity_result = session.run(activity_query, user_id=user_id, concept_id=concept_id)
        activity_record = activity_result.single()
        
        last_activity_ts = None
        if activity_record and activity_record["created_at"]:
            try:
                created_at_str = activity_record["created_at"]
                if isinstance(created_at_str, str):
                    if 'T' in created_at_str:
                        last_activity_ts = datetime.fromisoformat(created_at_str.replace('Z', '+00:00'))
                    else:
                        last_activity_ts = datetime.fromtimestamp(float(created_at_str))
            except (ValueError, TypeError):
                pass
        
        # Get newest evidence timestamp
        resources = get_resources_for_concept(session, concept_id, include_archived=False)
        newest_evidence_ts = None
        for resource in resources:
            created_at = resource.created_at
            if created_at:
                try:
                    if isinstance(created_at, str):
                        if 'T' in created_at:
                            dt = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                        else:
                            dt = datetime.fromtimestamp(float(created_at))
                    elif isinstance(created_at, (int, float)):
                        dt = datetime.fromtimestamp(created_at)
                    else:
                        continue
                    
                    if newest_evidence_ts is None or dt > newest_evidence_ts:
                        newest_evidence_ts = dt
                except (ValueError, TypeError):
                    continue
        
        # Calculate recency: use most recent of activity or evidence
        most_recent_ts = None
        if last_activity_ts and newest_evidence_ts:
            most_recent_ts = max(last_activity_ts, newest_evidence_ts)
        elif last_activity_ts:
            most_recent_ts = last_activity_ts
        elif newest_evidence_ts:
            most_recent_ts = newest_evidence_ts
        
        # Recency weight: exponential decay over 90 days
        if most_recent_ts:
            age_days = (now - most_recent_ts.replace(tzinfo=None) if most_recent_ts.tzinfo else now - most_recent_ts).days
            # Exponential decay: 1.0 for 0 days, ~0.37 for 30 days, ~0.05 for 90 days
            recency_weight = max(0.0, min(1.0, 1.0 / (1.0 + age_days / 30.0)))
        else:
            recency_weight = 0.0
        
        # Get degree and evidence count for mention frequency
        neighbors = get_neighbors_with_relationships(session, concept_id, include_proposed="all")
        degree = len(neighbors)
        evidence_count = len(resources)
        
        # Count activity events for this concept
        activity_count_query = """
        MATCH (e:ActivityEvent)
        WHERE e.user_id = $user_id
          AND e.concept_id = $concept_id
        RETURN count(e) AS count
        """
        activity_count_result = session.run(activity_count_query, user_id=user_id, concept_id=concept_id)
        activity_count_record = activity_count_result.single()
        activity_count = activity_count_record["count"] if activity_count_record else 0
        
        # Mention frequency: combine degree, evidence count, and activity
        # Normalize each component to 0-1, then average
        # Degree: normalize by max_degree (cap at 1.0)
        degree_norm = min(1.0, degree / max_degree) if max_degree > 0 else 0.0
        
        # Evidence: normalize by 10 (cap at 1.0)
        evidence_norm = min(1.0, evidence_count / 10.0)
        
        # Activity: normalize by 20 (cap at 1.0)
        activity_norm = min(1.0, activity_count / 20.0)
        
        # Weighted average: degree 50%, evidence 30%, activity 20%
        mention_frequency = (degree_norm * 0.5 + evidence_norm * 0.3 + activity_norm * 0.2)
        
        # Centrality delta: how much above/below average degree
        # Normalize: (degree - avg_degree) / max_degree, then scale to 0-1
        if max_degree > 0:
            centrality_raw = (degree - avg_degree) / max_degree
            # Shift and scale to 0-1: (raw + 1) / 2, then clamp
            centrality_delta = max(0.0, min(1.0, (centrality_raw + 1.0) / 2.0))
        else:
            centrality_delta = 0.5  # Neutral if no graph data
        
        results[concept_id] = {
            "recencyWeight": round(recency_weight, 3),
            "mentionFrequency": round(mention_frequency, 3),
            "centralityDelta": round(centrality_delta, 3)
        }
    
    return results

