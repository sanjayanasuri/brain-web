"""
API endpoints for Suggestions - rule-based suggestions for improving the graph.
"""
import hashlib
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, Query, HTTPException
from neo4j import Session
from db_neo4j import get_neo4j_session
from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context
from services_graph import get_proposed_relationships
from services_resources import get_resources_for_concept
from services_quality import compute_concept_coverage, compute_evidence_freshness, compute_graph_health

router = APIRouter(prefix="/suggestions", tags=["suggestions"])


def _generate_suggestion_id(suggestion_type: str, **kwargs) -> str:
    """Generate a stable ID for a suggestion based on its type and key fields."""
    key_parts = [suggestion_type]
    for k, v in sorted(kwargs.items()):
        if v:
            key_parts.append(f"{k}:{v}")
    key_str = "|".join(key_parts)
    return hashlib.md5(key_str.encode()).hexdigest()[:12]


def _generate_quality_suggestions(
    session: Session,
    graph_id: str,
    concept_id: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Generate quality-based suggestions using coverage and freshness signals.
    These are computed on the fly, not persisted.
    """
    suggestions: List[Dict[str, Any]] = []
    
    try:
        if concept_id:
            # Concept-scoped quality suggestions
            try:
                # Get concept quality metrics
                coverage = compute_concept_coverage(session, concept_id, graph_id)
                freshness = compute_evidence_freshness(session, concept_id)
                
                # Get concept name
                concept_query = """
                MATCH (g:GraphSpace {graph_id: $graph_id})
                MATCH (c:Concept {node_id: $concept_id})-[:BELONGS_TO]->(g)
                RETURN c.name AS name
                """
                concept_result = session.run(concept_query, graph_id=graph_id, concept_id=concept_id)
                concept_record = concept_result.single()
                if not concept_record:
                    return []
                concept_name = concept_record["name"]
                
                # 1. COVERAGE_LOW: coverage_score < 50
                if coverage["coverage_score"] < 50:
                    breakdown = coverage["coverage_breakdown"]
                    actions = []
                    
                    if not breakdown["has_description"]:
                        actions.append({
                            "label": "Add description",
                            "kind": "OPEN_CONCEPT",
                            "href": f"/?select={concept_id}&chat=Define {concept_name}",
                        })
                    
                    if breakdown["evidence_count"] == 0:
                        actions.append({
                            "label": "Add evidence",
                            "kind": "FETCH_EVIDENCE",
                            "payload": {
                                "concept_id": concept_id,
                                "concept_name": concept_name,
                            }
                        })
                    
                    if breakdown["degree"] < 2:
                        actions.append({
                            "label": "Connect related concepts",
                            "kind": "OPEN_CONCEPT",
                            "href": f"/?select={concept_id}",
                        })
                    
                    if actions:
                        primary_action = actions[0]
                        # Generate observational title based on what's missing
                        if not breakdown["has_description"] and breakdown["evidence_count"] > 0:
                            title = f'"{concept_name}" appears frequently across your graph, but rarely stands on its own'
                            rationale = "It's usually referenced in passing rather than examined directly."
                        elif not breakdown["has_description"]:
                            title = f'"{concept_name}" is often assumed rather than explained directly'
                            rationale = "It appears in your recent exploration without a clear definition."
                        elif breakdown["evidence_count"] == 0:
                            title = f'"{concept_name}" appears central to many connections, but remains implicit'
                            rationale = "It lacks supporting evidence in your graph."
                        else:
                            title = f'"{concept_name}" appears frequently across claims, but rarely stands on its own'
                            rationale = "It's usually referenced in passing rather than examined directly."
                        
                        suggestions.append({
                            "id": _generate_suggestion_id("COVERAGE_LOW", concept_id=concept_id),
                            "type": "COVERAGE_LOW",
                            "kind": "COVERAGE_LOW",
                            "title": title,
                            "rationale": rationale,
                            "explanation": rationale,
                            "severity": "MEDIUM",
                            "priority": 60,  # Lower priority than GAP_* suggestions
                            "concept_id": concept_id,
                            "concept_name": concept_name,
                            "graph_id": graph_id,
                            "primary_action": primary_action,
                            "secondary_action": actions[1] if len(actions) > 1 else None,
                            "action": primary_action
                        })
                
                # 2. EVIDENCE_STALE: freshness = STALE
                if freshness["level"] == "Stale":
                    primary_action = {
                        "label": "Fetch fresh evidence",
                        "kind": "FETCH_EVIDENCE",
                        "payload": {
                            "concept_id": concept_id,
                            "concept_name": concept_name,
                        }
                    }
                    suggestions.append({
                        "id": _generate_suggestion_id("EVIDENCE_STALE", concept_id=concept_id),
                        "type": "EVIDENCE_STALE",
                        "kind": "EVIDENCE_STALE",
                        "title": f'"{concept_name}" appears in older evidence, but hasn\'t surfaced in your recent exploration',
                        "rationale": "The newest evidence is older than 120 days.",
                        "explanation": "The newest evidence is older than 120 days.",
                        "severity": "LOW",
                        "priority": 55,
                        "concept_id": concept_id,
                        "concept_name": concept_name,
                        "graph_id": graph_id,
                        "primary_action": primary_action,
                        "secondary_action": {
                            "label": "Review existing sources",
                            "kind": "OPEN_CONCEPT",
                            "href": f"/?select={concept_id}&tab=evidence",
                        },
                        "action": primary_action
                    })
            except Exception:
                # Skip quality suggestions if computation fails
                pass
        else:
            # Graph-level quality suggestions
            try:
                # 3. GRAPH_HEALTH_ISSUE: graph health = NEEDS_ATTENTION or POOR
                graph_health = compute_graph_health(session, graph_id)
                if graph_health["health"] in ["NEEDS_ATTENTION", "POOR"]:
                    stats = graph_health["stats"]
                    primary_action = {
                        "label": "View gaps",
                        "kind": "OPEN_GAPS",
                        "href": "/gaps",
                    }
                    suggestions.append({
                        "id": _generate_suggestion_id("GRAPH_HEALTH_ISSUE", graph_id=graph_id),
                        "type": "GRAPH_HEALTH_ISSUE",
                        "kind": "GRAPH_HEALTH_ISSUE",
                        "title": f"Many concepts in your graph appear frequently but remain implicit",
                        "rationale": f"{stats['missing_description_pct']:.1f}% are referenced without clear definitions, {stats['no_evidence_pct']:.1f}% lack supporting evidence.",
                        "explanation": f"{stats['missing_description_pct']:.1f}% are referenced without clear definitions, {stats['no_evidence_pct']:.1f}% lack supporting evidence.",
                        "severity": "MEDIUM",
                        "priority": 50,
                        "graph_id": graph_id,
                        "primary_action": primary_action,
                        "secondary_action": {
                            "label": "Open digest",
                            "kind": "OPEN_DIGEST",
                            "href": "/digest",
                        },
                        "action": primary_action
                    })
                
                # 4. REVIEW_BACKLOG: proposed relationships > threshold (e.g., >5)
                proposed_rels = get_proposed_relationships(
                    session=session,
                    graph_id=graph_id,
                    status="PROPOSED",
                    limit=1000,
                )
                proposed_count = len(proposed_rels)
                
                if proposed_count > 5:
                    primary_action = {
                        "label": "Review now",
                        "kind": "OPEN_REVIEW",
                        "href": "/review?status=PROPOSED",
                    }
                    suggestions.append({
                        "id": _generate_suggestion_id("REVIEW_BACKLOG", graph_id=graph_id),
                        "type": "REVIEW_BACKLOG",
                        "kind": "REVIEW_BACKLOG",
                        "title": f"Several relationships are proposed but not yet reviewed",
                        "rationale": f"{proposed_count} connections between concepts are waiting for your review.",
                        "explanation": f"{proposed_count} connections between concepts are waiting for your review.",
                        "severity": "LOW",
                        "priority": 45,
                        "graph_id": graph_id,
                        "primary_action": primary_action,
                        "action": primary_action
                    })
            except Exception:
                # Skip graph-level quality suggestions if computation fails
                pass
    
    except Exception:
        # Fail silently - don't break suggestions if quality computation fails
        pass
    
    return suggestions


@router.get("")
def get_suggestions(
    limit: int = Query(20, ge=1, le=100, description="Maximum number of suggestions to return"),
    graph_id: Optional[str] = Query(None, description="Graph ID (optional, uses active if not provided)"),
    recent_concepts: Optional[str] = Query(None, description="Comma-separated list of recent concept IDs"),
    concept_id: Optional[str] = Query(None, description="Concept ID to scope suggestions to (optional)"),
    session: Session = Depends(get_neo4j_session),
) -> List[Dict[str, Any]]:
    """
    Get rule-based suggestions for improving the graph.
    
    If concept_id is provided, returns only suggestions relevant to that concept.
    Otherwise, returns general suggestions for the graph.
    
    Returns suggestions sorted by priority (descending).
    """
    try:
        ensure_graph_scoping_initialized(session)
        
        # Get graph_id - use provided or active context
        if graph_id:
            target_graph_id = graph_id
        else:
            target_graph_id, _ = get_active_graph_context(session)
        
        suggestions: List[Dict[str, Any]] = []
        
        # Parse recent_concepts if provided
        recent_concept_ids: List[str] = []
        if recent_concepts:
            recent_concept_ids = [c.strip() for c in recent_concepts.split(",") if c.strip()]
        
        # If concept_id is provided, scope suggestions to that concept only
        if concept_id:
            try:
                # Fetch concept details
                concept_query = """
                MATCH (g:GraphSpace {graph_id: $graph_id})
                MATCH (c:Concept {node_id: $concept_id})-[:BELONGS_TO]->(g)
                OPTIONAL MATCH (c)-[:HAS_RESOURCE]->(r:Resource)
                RETURN c.node_id AS node_id,
                       c.name AS name,
                       c.description AS description,
                       count(r) AS resource_count
                """
                concept_result = session.run(concept_query, graph_id=target_graph_id, concept_id=concept_id)
                record = concept_result.single()
                
                if not record:
                    # Concept not found, return empty
                    return []
                
                concept_name = record["name"]
                description = record["description"]
                resource_count = record["resource_count"]
                
                # 1. GAP_DEFINE: Missing description
                has_description = description and len(description) >= 20
                if not has_description:
                    suggestions.append({
                        "id": _generate_suggestion_id("GAP_DEFINE", concept_id=concept_id),
                        "type": "GAP_DEFINE",
                        "title": f'"{concept_name}" appears frequently but remains implicit in your graph',
                        "rationale": "It's usually referenced in passing rather than examined directly.",
                        "priority": 90,
                        "concept_id": concept_id,
                        "concept_name": concept_name,
                        "graph_id": target_graph_id,
                        "action": {
                            "kind": "OPEN_CONCEPT",
                            "href": f"/?select={concept_id}&chat=Define {concept_name}",
                        }
                    })
                
                # 2. GAP_EVIDENCE: No resources
                if resource_count == 0:
                    suggestions.append({
                        "id": _generate_suggestion_id("GAP_EVIDENCE", concept_id=concept_id),
                        "type": "GAP_EVIDENCE",
                        "title": f'"{concept_name}" is referenced but lacks supporting evidence',
                        "rationale": "It appears in your graph without sources to ground it.",
                        "priority": 85,
                        "concept_id": concept_id,
                        "concept_name": concept_name,
                        "graph_id": target_graph_id,
                        "action": {
                            "kind": "FETCH_EVIDENCE",
                            "payload": {
                                "concept_id": concept_id,
                                "concept_name": concept_name,
                            }
                        }
                    })
                
                # 3. STALE_EVIDENCE: Resources older than 30 days (if we have resources)
                if resource_count > 0:
                    try:
                        stale_query = """
                        MATCH (g:GraphSpace {graph_id: $graph_id})
                        MATCH (c:Concept {node_id: $concept_id})-[:BELONGS_TO]->(g)
                        MATCH (c)-[:HAS_RESOURCE]->(r:Resource)
                        WHERE r.created_at IS NOT NULL
                          AND datetime() - r.created_at > duration({days: 30})
                        RETURN count(r) AS stale_count
                        """
                        stale_result = session.run(stale_query, graph_id=target_graph_id, concept_id=concept_id)
                        stale_record = stale_result.single()
                        stale_count = stale_record["stale_count"] if stale_record else 0
                        
                        if stale_count > 0:
                            suggestions.append({
                                "id": _generate_suggestion_id("STALE_EVIDENCE", concept_id=concept_id),
                                "type": "STALE_EVIDENCE",
                                "title": f"Refresh {stale_count} stale source{'s' if stale_count != 1 else ''}",
                                "rationale": "Some evidence is older than 30 days and may need updating.",
                                "priority": 70,
                                "concept_id": concept_id,
                                "concept_name": concept_name,
                                "graph_id": target_graph_id,
                                "action": {
                                    "kind": "FETCH_EVIDENCE",
                                    "payload": {
                                        "concept_id": concept_id,
                                        "concept_name": concept_name,
                                    }
                                }
                            })
                    except Exception:
                        # Skip stale evidence check if it fails
                        pass
                
                # 4. REVIEW_RELATIONSHIPS: Proposed relationships involving this concept
                try:
                    _, branch_id = get_active_graph_context(session)
                    
                    proposed_rel_query = """
                    MATCH (g:GraphSpace {graph_id: $graph_id})
                    MATCH (c:Concept {node_id: $concept_id})-[:BELONGS_TO]->(g)
                    MATCH (c)-[r]-(other:Concept)-[:BELONGS_TO]->(g)
                    WHERE r.graph_id = $graph_id
                      AND $branch_id IN COALESCE(r.on_branches, [])
                      AND COALESCE(r.status, 'ACCEPTED') = 'PROPOSED'
                    RETURN count(r) AS count
                    """
                    proposed_result = session.run(
                        proposed_rel_query,
                        graph_id=target_graph_id,
                        concept_id=concept_id,
                        branch_id=branch_id
                    )
                    proposed_record = proposed_result.single()
                    proposed_count = proposed_record["count"] if proposed_record else 0
                    
                    if proposed_count > 0:
                        suggestions.append({
                            "id": _generate_suggestion_id("REVIEW_RELATIONSHIPS", concept_id=concept_id),
                            "type": "REVIEW_RELATIONSHIPS",
                            "title": f"Review {proposed_count} proposed relationship{'s' if proposed_count != 1 else ''}",
                            "rationale": f"This concept has {proposed_count} pending connection{'s' if proposed_count != 1 else ''} to review.",
                            "priority": 80,
                            "concept_id": concept_id,
                            "concept_name": concept_name,
                            "graph_id": target_graph_id,
                            "action": {
                                "kind": "OPEN_REVIEW",
                                "href": f"/review?status=PROPOSED&concept_id={concept_id}",
                            }
                        })
                except Exception:
                    # Skip review relationships check if it fails
                    pass
                
                # Add quality-based suggestions
                quality_suggestions = _generate_quality_suggestions(session, target_graph_id, concept_id)
                suggestions.extend(quality_suggestions)
                
                # Sort by priority and return
                suggestions.sort(key=lambda x: (-x["priority"], x["type"]))
                return suggestions[:limit]
                
            except Exception as e:
                # If concept-scoped query fails, return empty
                return []
        
        # 1. GAP_DEFINE: Missing descriptions
        try:
            missing_descriptions_query = """
            MATCH (g:GraphSpace {graph_id: $graph_id})
            MATCH (c:Concept)-[:BELONGS_TO]->(g)
            WHERE (c.description IS NULL OR c.description = "" OR size(c.description) < 20)
            RETURN c.node_id AS node_id, c.name AS name
            LIMIT $limit
            """
            missing_records = session.run(missing_descriptions_query, graph_id=target_graph_id, limit=10)
            for record in missing_records:
                suggestions.append({
                    "id": _generate_suggestion_id("GAP_DEFINE", concept_id=record["node_id"]),
                    "type": "GAP_DEFINE",
                    "title": f'"{record["name"]}" appears in your activity but remains implicit',
                    "rationale": "It's referenced but lacks a clear definition.",
                    "priority": 90,
                    "concept_id": record["node_id"],
                    "concept_name": record["name"],
                    "graph_id": target_graph_id,
                    "action": {
                        "kind": "OPEN_CONCEPT",
                        "href": f"/?select={record['node_id']}",
                    }
                })
        except Exception as e:
            # Don't fail entire endpoint if one rule fails
            pass
        
        # 2. GAP_EVIDENCE: Concepts with no resources
        try:
            # Get concepts with no resources
            no_evidence_query = """
            MATCH (g:GraphSpace {graph_id: $graph_id})
            MATCH (c:Concept)-[:BELONGS_TO]->(g)
            WHERE NOT EXISTS {
                MATCH (c)-[:HAS_RESOURCE]->(:Resource)
            }
            RETURN c.node_id AS node_id, c.name AS name
            LIMIT $limit
            """
            no_evidence_records = session.run(no_evidence_query, graph_id=target_graph_id, limit=10)
            for record in no_evidence_records:
                suggestions.append({
                    "id": _generate_suggestion_id("GAP_EVIDENCE", concept_id=record["node_id"]),
                    "type": "GAP_EVIDENCE",
                    "title": f'"{record["name"]}" is referenced but lacks supporting evidence',
                    "rationale": "It appears in your graph without sources to ground it.",
                    "priority": 85,
                    "concept_id": record["node_id"],
                    "concept_name": record["name"],
                    "graph_id": target_graph_id,
                    "action": {
                        "kind": "FETCH_EVIDENCE",
                        "payload": {
                            "concept_id": record["node_id"],
                            "concept_name": record["name"],
                        }
                    }
                })
        except Exception as e:
            pass
        
        # 3. REVIEW_RELATIONSHIPS: Proposed relationships pending review
        try:
            relationships = get_proposed_relationships(
                session=session,
                graph_id=target_graph_id,
                status="PROPOSED",
                limit=1,
                offset=0,
            )
            if relationships and len(relationships) > 0:
                count_query = """
                MATCH (g:GraphSpace {graph_id: $graph_id})
                MATCH (s:Concept)-[:BELONGS_TO]->(g)
                MATCH (t:Concept)-[:BELONGS_TO]->(g)
                MATCH (s)-[r]->(t)
                WHERE r.graph_id = $graph_id
                  AND COALESCE(r.status, 'ACCEPTED') = 'PROPOSED'
                RETURN count(r) AS count
                """
                count_result = session.run(count_query, graph_id=target_graph_id)
                count = count_result.single()["count"] if count_result.peek() else 0
                
                if count > 0:
                    suggestions.append({
                        "id": _generate_suggestion_id("REVIEW_RELATIONSHIPS", graph_id=target_graph_id),
                        "type": "REVIEW_RELATIONSHIPS",
                        "title": f"Review {count} proposed relationship{'s' if count != 1 else ''}",
                        "rationale": "Your graph has pending connections to accept or reject.",
                        "priority": 80,
                        "graph_id": target_graph_id,
                        "action": {
                            "kind": "OPEN_REVIEW",
                            "href": "/review?status=PROPOSED",
                        }
                    })
        except Exception as e:
            pass
        
        # 4. STALE_EVIDENCE: Resources older than 30 days
        # Skip in v1 if too expensive - just add TODO comment
        # For now, we'll skip this to avoid expensive scans
        
        # 5. RECENT_LOW_COVERAGE: Recent concepts with missing description or no resources
        if recent_concept_ids:
            try:
                for concept_id in recent_concept_ids[:20]:  # Limit to 20 to avoid heavy queries
                    # Check if concept has missing description or no resources
                    concept_query = """
                    MATCH (g:GraphSpace {graph_id: $graph_id})
                    MATCH (c:Concept {node_id: $concept_id})-[:BELONGS_TO]->(g)
                    OPTIONAL MATCH (c)-[:HAS_RESOURCE]->(r:Resource)
                    RETURN c.node_id AS node_id,
                           c.name AS name,
                           c.description AS description,
                           count(r) AS resource_count
                    """
                    concept_result = session.run(concept_query, graph_id=target_graph_id, concept_id=concept_id)
                    record = concept_result.single()
                    
                    if record:
                        has_description = record["description"] and len(record["description"]) >= 20
                        has_resources = record["resource_count"] > 0
                        
                        if not has_description or not has_resources:
                            suggestion_type = "GAP_DEFINE" if not has_description else "GAP_EVIDENCE"
                            if not has_description:
                                title = f'"{record["name"]}" appears frequently but remains implicit'
                                rationale = "You recently viewed this and it's still referenced without a clear definition."
                            else:
                                title = f'"{record["name"]}" is referenced but lacks supporting evidence'
                                rationale = "You recently viewed this and it still lacks sources to ground it."
                            priority = 65
                            
                            if not has_description:
                                action = {
                                    "kind": "OPEN_CONCEPT",
                                    "href": f"/?select={concept_id}",
                                }
                            else:
                                action = {
                                    "kind": "FETCH_EVIDENCE",
                                    "payload": {
                                        "concept_id": concept_id,
                                        "concept_name": record["name"],
                                    }
                                }
                            
                            suggestions.append({
                                "id": _generate_suggestion_id("RECENT_LOW_COVERAGE", concept_id=concept_id),
                                "type": "RECENT_LOW_COVERAGE",
                                "title": title,
                                "rationale": rationale,
                                "priority": priority,
                                "concept_id": concept_id,
                                "concept_name": record["name"],
                                "graph_id": target_graph_id,
                                "action": action,
                            })
            except Exception as e:
                pass
        
        # Add quality-based suggestions (graph-level only when concept_id is not provided)
        quality_suggestions = _generate_quality_suggestions(session, target_graph_id, None)
        suggestions.extend(quality_suggestions)
        
        # Add quality-based suggestions (graph-level only when no concept_id)
        quality_suggestions = _generate_quality_suggestions(session, target_graph_id, None)
        suggestions.extend(quality_suggestions)
        
        # Sort by priority (descending), then by type for stability
        suggestions.sort(key=lambda x: (-x["priority"], x["type"], x.get("concept_name", "")))
        
        # Return top N
        return suggestions[:limit]
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get suggestions: {str(e)}")


@router.get("/paths")
def get_suggested_paths(
    concept_id: str = Query(..., description="Starting concept ID"),
    limit: int = Query(3, ge=1, le=10, description="Number of paths to return"),
    graph_id: Optional[str] = Query(None, description="Graph ID"),
    session: Session = Depends(get_neo4j_session),
) -> List[Dict[str, Any]]:
    """
    Get suggested learning paths starting from a specific concept.
    """
    try:
        if graph_id:
            target_graph_id = graph_id
        else:
            target_graph_id, _ = get_active_graph_context(session)

        # 1. Find simple paths: Concept -> Neighbor -> Neighbor of Neighbor
        path_query = """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MATCH (start:Concept {node_id: $concept_id})-[:BELONGS_TO]->(g)
        MATCH path = (start)-[:RELATED_TO*2..3]-(end:Concept)
        WHERE (end)-[:BELONGS_TO]->(g)
        RETURN path, end.node_id as end_id, end.name as end_name, end.domain as end_domain, end.type as end_type
        LIMIT $limit
        """
        
        result = session.run(path_query, graph_id=target_graph_id, concept_id=concept_id, limit=limit)
        paths = []
        
        for record in result:
            neo4j_path = record["path"]
            nodes = neo4j_path.nodes
            steps = []
            for node in nodes:
                steps.append({
                    "concept_id": node["node_id"],
                    "name": node["name"],
                    "domain": node.get("domain", "General"),
                    "type": node.get("type", "Concept")
                })
                
            paths.append({
                "path_id": hashlib.md5(f"{concept_id}-{record['end_id']}".encode()).hexdigest()[:8],
                "title": f"Path to {record['end_name']}",
                "rationale": "Connected through key concepts",
                "steps": steps,
                "start_concept_id": concept_id
            })
            
        return paths

    except Exception as e:
        print(f"Error fetching paths: {e}")
        # Return empty list instead of erroring out to keep UI stable
        return []
