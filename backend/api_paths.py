from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional, List, Dict, Any, Literal
from neo4j import Session
import uuid

from db_neo4j import get_neo4j_session
from services_branch_explorer import (
    ensure_graph_scoping_initialized,
    get_active_graph_context,
    set_active_graph,
)
from services_graph import (
    get_neighbors_with_relationships,
    get_concept_by_id,
    _normalize_include_proposed,
    _build_edge_visibility_where_clause,
    _normalize_concept_from_db,
)
from config import PROPOSED_VISIBILITY_THRESHOLD

router = APIRouter(prefix="/paths", tags=["paths"])


def _generate_path_id() -> str:
    """Generate a unique path ID."""
    return f"path_{uuid.uuid4().hex[:12]}"


def _get_resource_count(session: Session, concept_id: str) -> int:
    """Get the count of resources for a concept."""
    query = """
    MATCH (c:Concept {node_id: $concept_id})-[:HAS_RESOURCE]->(r:Resource)
    WHERE COALESCE(r.archived, false) = false
    RETURN count(r) AS count
    """
    result = session.run(query, concept_id=concept_id)
    record = result.single()
    return record["count"] if record else 0


def _get_prereq_and_dependent_counts(session: Session, concept_id: str, graph_id: str, branch_id: str) -> tuple[int, int]:
    """Get count of prerequisites and dependents for a concept."""
    include_proposed = "auto"
    edge_visibility_clause = _build_edge_visibility_where_clause(include_proposed)
    
    # Query for prerequisites
    prereq_query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MATCH (c:Concept {{node_id: $concept_id}})-[:BELONGS_TO]->(g)
    MATCH (prereq:Concept)-[:BELONGS_TO]->(g)
    MATCH (prereq)-[r:PREREQUISITE_FOR]->(c)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND $branch_id IN COALESCE(prereq.on_branches, [])
      AND $branch_id IN COALESCE(r.on_branches, [])
      AND COALESCE(prereq.is_merged, false) = false
      AND {edge_visibility_clause}
    RETURN count(DISTINCT prereq) AS prereq_count
    """
    
    # Query for dependents
    dependent_query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MATCH (c:Concept {{node_id: $concept_id}})-[:BELONGS_TO]->(g)
    MATCH (c)-[r:PREREQUISITE_FOR]->(dependent:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND $branch_id IN COALESCE(dependent.on_branches, [])
      AND $branch_id IN COALESCE(r.on_branches, [])
      AND COALESCE(dependent.is_merged, false) = false
      AND {edge_visibility_clause}
    RETURN count(DISTINCT dependent) AS dependent_count
    """
    
    params = {
        "concept_id": concept_id,
        "graph_id": graph_id,
        "branch_id": branch_id,
        "include_proposed": include_proposed,
        "threshold": PROPOSED_VISIBILITY_THRESHOLD,
    }
    
    prereq_result = session.run(prereq_query, **params)
    prereq_record = prereq_result.single()
    prereq_count = prereq_record["prereq_count"] if prereq_record else 0
    
    dependent_result = session.run(dependent_query, **params)
    dependent_record = dependent_result.single()
    dependent_count = dependent_record["dependent_count"] if dependent_record else 0
    
    return (prereq_count, dependent_count)


def _score_path(
    session: Session,
    path: Dict[str, Any],
    graph_id: str,
    branch_id: str,
    lens: Literal["NONE", "LEARNING", "FINANCE"] = "NONE"
) -> float:
    """
    Score a path based on multiple quality signals.
    Returns a score (higher is better).
    """
    steps = path.get("steps", [])
    if not steps:
        return 0.0
    
    score = 0.0
    
    # 1. Coverage quality: prefer paths with at least one prerequisite + one dependent
    step_ids = [step["concept_id"] for step in steps]
    has_prereq = False
    has_dependent = False
    
    for step_id in step_ids:
        prereq_count, dependent_count = _get_prereq_and_dependent_counts(session, step_id, graph_id, branch_id)
        if prereq_count > 0:
            has_prereq = True
        if dependent_count > 0:
            has_dependent = True
    
    if has_prereq and has_dependent:
        score += 2.0
    elif has_prereq or has_dependent:
        score += 1.0
    
    # 2. Evidence coverage: prefer concepts with resources
    evidence_score = 0.0
    for step in steps:
        resource_count = _get_resource_count(session, step["concept_id"])
        if resource_count > 0:
            evidence_score += 1.0
    
    if len(steps) > 0:
        evidence_ratio = evidence_score / len(steps)
        score += evidence_ratio * 1.5
    
    # 3. Diversity: penalize paths where all steps share the same immediate neighborhood
    # Check if steps are too similar (share many neighbors)
    if len(steps) > 1:
        step_neighbors: Dict[str, set] = {}
        for step in steps:
            step_id = step["concept_id"]
            # Get immediate neighbors
            neighbors = get_neighbors_with_relationships(session, step_id, include_proposed="auto")
            neighbor_ids = {n["concept"].node_id for n in neighbors}
            step_neighbors[step_id] = neighbor_ids
        
        # Calculate average overlap
        total_overlap = 0.0
        comparisons = 0
        step_list = list(step_neighbors.items())
        for i in range(len(step_list)):
            for j in range(i + 1, len(step_list)):
                set1 = step_list[i][1]
                set2 = step_list[j][1]
                if len(set1) > 0 or len(set2) > 0:
                    union_size = len(set1 | set2)
                    if union_size > 0:
                        overlap = len(set1 & set2) / union_size
                        total_overlap += overlap
                        comparisons += 1
        
        if comparisons > 0:
            avg_overlap = total_overlap / comparisons
            # Penalize high overlap (low diversity)
            diversity_penalty = avg_overlap * 1.0
            score -= diversity_penalty
    
    # 4. Length: prefer 4-5 steps; penalize <3 or >6
    length = len(steps)
    if 4 <= length <= 5:
        score += 1.5
    elif length == 3 or length == 6:
        score += 0.5
    elif length < 3:
        score -= 1.0
    elif length > 6:
        score -= 0.5
    
    # 5. Lens-aware tweaks
    if lens == "LEARNING":
        # Boost prerequisite-oriented paths
        if "Prerequisites" in path.get("title", "") or "prereq" in path.get("rationale", "").lower():
            score += 0.5
    elif lens == "FINANCE":
        # Boost paths that include finance-type nodes
        finance_types = {"company", "metric", "risk", "financial", "finance"}
        has_finance = False
        for step in steps:
            step_type = (step.get("type") or "").lower()
            if any(ft in step_type for ft in finance_types):
                has_finance = True
                break
        if has_finance:
            score += 0.5
    
    return score


def _jaccard_overlap(path1: Dict[str, Any], path2: Dict[str, Any]) -> float:
    """Calculate Jaccard overlap between two paths based on step concept IDs."""
    steps1 = {step["concept_id"] for step in path1.get("steps", [])}
    steps2 = {step["concept_id"] for step in path2.get("steps", [])}
    
    if len(steps1) == 0 and len(steps2) == 0:
        return 1.0
    
    intersection = len(steps1 & steps2)
    union = len(steps1 | steps2)
    
    if union == 0:
        return 0.0
    
    return intersection / union


def _remove_duplicates(paths: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Remove duplicate paths based on:
    - Unique start_concept_id OR
    - Low Jaccard overlap (< 0.6)
    """
    if not paths:
        return []
    
    # Sort by score (descending) - paths should have a score field
    sorted_paths = sorted(paths, key=lambda p: p.get("_score", 0.0), reverse=True)
    
    result = []
    seen_start_ids = set()
    
    for path in sorted_paths:
        start_id = path.get("start_concept_id")
        
        # Check for unique start_concept_id
        if start_id and start_id not in seen_start_ids:
            result.append(path)
            seen_start_ids.add(start_id)
            continue
        
        # Check Jaccard overlap with existing paths
        is_duplicate = False
        for existing in result:
            overlap = _jaccard_overlap(path, existing)
            if overlap >= 0.6:
                is_duplicate = True
                break
        
        if not is_duplicate:
            result.append(path)
            if start_id:
                seen_start_ids.add(start_id)
    
    return result


def _build_prereqs_path(
    session: Session,
    concept_id: str,
    graph_id: str,
    branch_id: str,
    max_depth: int = 3,
    max_length: int = 6
) -> Optional[Dict[str, Any]]:
    """
    Build a path from prerequisites to the concept.
    Traverses backwards along PREREQUISITE_FOR edges.
    """
    include_proposed = "auto"
    edge_visibility_clause = _build_edge_visibility_where_clause(include_proposed)
    
    # Find prerequisites (incoming PREREQUISITE_FOR edges)
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MATCH (c:Concept {{node_id: $concept_id}})-[:BELONGS_TO]->(g)
    MATCH (prereq:Concept)-[:BELONGS_TO]->(g)
    MATCH (prereq)-[r:PREREQUISITE_FOR]->(c)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND $branch_id IN COALESCE(prereq.on_branches, [])
      AND $branch_id IN COALESCE(r.on_branches, [])
      AND COALESCE(prereq.is_merged, false) = false
      AND {edge_visibility_clause}
    RETURN prereq.node_id AS node_id,
           prereq.name AS name,
           prereq.domain AS domain,
           prereq.type AS type
    ORDER BY prereq.name
    LIMIT 5
    """
    
    params = {
        "concept_id": concept_id,
        "graph_id": graph_id,
        "branch_id": branch_id,
        "include_proposed": include_proposed,
        "threshold": PROPOSED_VISIBILITY_THRESHOLD,
    }
    
    result = session.run(query, **params)
    prereqs = [record.data() for record in result]
    
    if not prereqs:
        return None
    
    # Build path: take up to 3 prereqs, then the concept
    steps = []
    for prereq in prereqs[:3]:
        steps.append({
            "concept_id": prereq["node_id"],
            "name": prereq["name"],
            "domain": prereq.get("domain"),
            "type": prereq.get("type"),
        })
    
    # Add the target concept
    concept = get_concept_by_id(session, concept_id)
    if concept:
        steps.append({
            "concept_id": concept.node_id,
            "name": concept.name,
            "domain": concept.domain,
            "type": concept.type,
        })
    
    if len(steps) < 3:
        return None
    
    return {
        "path_id": _generate_path_id(),
        "title": f"Prerequisites for {concept.name if concept else 'this concept'}",
        "rationale": "Build foundational understanding by exploring prerequisites first",
        "steps": steps,
        "start_concept_id": steps[0]["concept_id"],
    }


def _build_dependents_path(
    session: Session,
    concept_id: str,
    graph_id: str,
    branch_id: str,
    max_depth: int = 3,
    max_length: int = 6
) -> Optional[Dict[str, Any]]:
    """
    Build a path from the concept to its dependents.
    Traverses forwards along PREREQUISITE_FOR edges.
    """
    include_proposed = "auto"
    edge_visibility_clause = _build_edge_visibility_where_clause(include_proposed)
    
    # Find dependents (outgoing PREREQUISITE_FOR edges)
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MATCH (c:Concept {{node_id: $concept_id}})-[:BELONGS_TO]->(g)
    MATCH (c)-[r:PREREQUISITE_FOR]->(dependent:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND $branch_id IN COALESCE(dependent.on_branches, [])
      AND $branch_id IN COALESCE(r.on_branches, [])
      AND COALESCE(dependent.is_merged, false) = false
      AND {edge_visibility_clause}
    RETURN dependent.node_id AS node_id,
           dependent.name AS name,
           dependent.domain AS domain,
           dependent.type AS type
    ORDER BY dependent.name
    LIMIT 5
    """
    
    params = {
        "concept_id": concept_id,
        "graph_id": graph_id,
        "branch_id": branch_id,
        "include_proposed": include_proposed,
        "threshold": PROPOSED_VISIBILITY_THRESHOLD,
    }
    
    result = session.run(query, **params)
    dependents = [record.data() for record in result]
    
    if not dependents:
        return None
    
    # Build path: start with concept, then add up to 4 dependents
    concept = get_concept_by_id(session, concept_id)
    if not concept:
        return None
    
    steps = [{
        "concept_id": concept.node_id,
        "name": concept.name,
        "domain": concept.domain,
        "type": concept.type,
    }]
    
    for dependent in dependents[:4]:
        steps.append({
            "concept_id": dependent["node_id"],
            "name": dependent["name"],
            "domain": dependent.get("domain"),
            "type": dependent.get("type"),
        })
    
    if len(steps) < 3:
        return None
    
    return {
        "path_id": _generate_path_id(),
        "title": f"Next steps after {concept.name}",
        "rationale": "Explore concepts that build on this foundation",
        "steps": steps,
        "start_concept_id": steps[0]["concept_id"],
    }


def _build_related_cluster_path(
    session: Session,
    concept_id: str,
    graph_id: str,
    branch_id: str,
    max_length: int = 6
) -> Optional[Dict[str, Any]]:
    """
    Build a path through related concepts (RELATED_TO edges).
    Selects neighbors by degree to find well-connected concepts.
    """
    include_proposed = "auto"
    edge_visibility_clause = _build_edge_visibility_where_clause(include_proposed)
    
    # Find related neighbors, ordered by their degree (connectivity)
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MATCH (c:Concept {{node_id: $concept_id}})-[:BELONGS_TO]->(g)
    MATCH (c)-[r:RELATED_TO]-(related:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND $branch_id IN COALESCE(related.on_branches, [])
      AND $branch_id IN COALESCE(r.on_branches, [])
      AND COALESCE(related.is_merged, false) = false
      AND {edge_visibility_clause}
    OPTIONAL MATCH (related)-[r2]-(other:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(r2.on_branches, [])
      AND $branch_id IN COALESCE(other.on_branches, [])
    WITH related, count(DISTINCT r2) AS degree
    RETURN related.node_id AS node_id,
           related.name AS name,
           related.domain AS domain,
           related.type AS type,
           degree
    ORDER BY degree DESC, related.name
    LIMIT 6
    """
    
    params = {
        "concept_id": concept_id,
        "graph_id": graph_id,
        "branch_id": branch_id,
        "include_proposed": include_proposed,
        "threshold": PROPOSED_VISIBILITY_THRESHOLD,
    }
    
    result = session.run(query, **params)
    related = [record.data() for record in result]
    
    if not related:
        return None
    
    # Build path: start with concept, then add related concepts
    concept = get_concept_by_id(session, concept_id)
    if not concept:
        return None
    
    steps = [{
        "concept_id": concept.node_id,
        "name": concept.name,
        "domain": concept.domain,
        "type": concept.type,
    }]
    
    # Add up to 5 related concepts
    for rel in related[:5]:
        steps.append({
            "concept_id": rel["node_id"],
            "name": rel["name"],
            "domain": rel.get("domain"),
            "type": rel.get("type"),
        })
    
    if len(steps) < 3:
        return None
    
    return {
        "path_id": _generate_path_id(),
        "title": f"Related concepts to {concept.name}",
        "rationale": "Explore connected concepts in the same knowledge cluster",
        "steps": steps,
        "start_concept_id": steps[0]["concept_id"],
    }


def _build_generic_starter_paths(
    session: Session,
    graph_id: str,
    branch_id: str,
    max_candidates: int = 30
) -> List[Dict[str, Any]]:
    """
    Build generic starter paths from top hubs across different domains.
    Returns up to max_candidates paths for scoring.
    """
    include_proposed = "auto"
    edge_visibility_clause = _build_edge_visibility_where_clause(include_proposed)
    
    # Find top hubs (high degree) grouped by domain
    query = f"""
    MATCH (g:GraphSpace {{graph_id: $graph_id}})
    MATCH (c:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND COALESCE(c.is_merged, false) = false
    OPTIONAL MATCH (c)-[r]-(n:Concept)-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(r.on_branches, [])
      AND $branch_id IN COALESCE(n.on_branches, [])
      AND {edge_visibility_clause}
    WITH c, count(DISTINCT r) AS degree
    WHERE degree > 2
    RETURN c.node_id AS node_id,
           c.name AS name,
           c.domain AS domain,
           c.type AS type,
           degree
    ORDER BY degree DESC
    LIMIT 100
    """
    
    params = {
        "graph_id": graph_id,
        "branch_id": branch_id,
        "include_proposed": include_proposed,
        "threshold": PROPOSED_VISIBILITY_THRESHOLD,
    }
    
    result = session.run(query, **params)
    all_hubs = [record.data() for record in result]
    
    # Group by domain
    hubs_by_domain: Dict[str, List[Dict[str, Any]]] = {}
    for hub in all_hubs:
        domain = hub.get("domain") or "General"
        if domain not in hubs_by_domain:
            hubs_by_domain[domain] = []
        hubs_by_domain[domain].append(hub)
    
    paths = []
    
    # Generate multiple candidate paths from different domains
    # Try to create paths with 4-5 steps each
    for domain, hubs in hubs_by_domain.items():
        if len(paths) >= max_candidates:
            break
        
        # Create paths of different sizes from this domain
        for path_size in [4, 5, 3, 6]:
            if len(paths) >= max_candidates:
                break
            if len(hubs) < path_size:
                continue
            
            # Try different starting points
            for start_idx in range(min(3, len(hubs) - path_size + 1)):
                if len(paths) >= max_candidates:
                    break
                
                selected_hubs = hubs[start_idx:start_idx + path_size]
                if len(selected_hubs) < 3:
                    continue
                
                steps = []
                for hub in selected_hubs:
                    steps.append({
                        "concept_id": hub["node_id"],
                        "name": hub["name"],
                        "domain": hub.get("domain"),
                        "type": hub.get("type"),
                    })
                
                paths.append({
                    "path_id": _generate_path_id(),
                    "title": f"Explore {domain}",
                    "rationale": f"Discover key concepts in {domain}",
                    "steps": steps,
                    "start_concept_id": steps[0]["concept_id"],
                })
    
    return paths


@router.get("/suggested")
def get_suggested_paths(
    graph_id: str = Query(..., description="Graph ID"),
    concept_id: Optional[str] = Query(None, description="Optional concept ID to scope paths"),
    limit: int = Query(10, ge=1, le=20, description="Maximum number of paths to return"),
    lens: Literal["NONE", "LEARNING", "FINANCE"] = Query("NONE", description="Lens for path prioritization"),
    session: Session = Depends(get_neo4j_session)
) -> List[Dict[str, Any]]:
    """
    Get suggested exploration paths with quality scoring.
    
    If concept_id is provided, returns paths scoped to that concept:
    - Prerequisites path (prereqs → concept)
    - Dependents path (concept → dependents)
    - Related cluster path (concept → related neighbors)
    
    If no concept_id, returns generic starter paths from top hubs across domains.
    
    Paths are scored and ranked based on:
    - Coverage quality (prerequisites + dependents)
    - Evidence coverage (resources)
    - Diversity (avoid near-duplicates)
    - Length (prefer 4-5 steps)
    - Lens-aware tweaks (LEARNING: boost prereqs, FINANCE: boost finance nodes)
    """
    try:
        # Set active graph context
        set_active_graph(session, graph_id)
        ensure_graph_scoping_initialized(session)
        graph_id_ctx, branch_id = get_active_graph_context(session)
        
        if graph_id_ctx != graph_id:
            raise HTTPException(status_code=404, detail=f"Graph {graph_id} not found")
        
        candidate_paths = []
        
        if concept_id:
            # Verify concept exists
            concept = get_concept_by_id(session, concept_id)
            if not concept:
                raise HTTPException(status_code=404, detail=f"Concept {concept_id} not found")
            
            # Generate concept-scoped paths
            prereqs_path = _build_prereqs_path(session, concept_id, graph_id, branch_id)
            if prereqs_path:
                candidate_paths.append(prereqs_path)
            
            dependents_path = _build_dependents_path(session, concept_id, graph_id, branch_id)
            if dependents_path:
                candidate_paths.append(dependents_path)
            
            related_path = _build_related_cluster_path(session, concept_id, graph_id, branch_id)
            if related_path:
                candidate_paths.append(related_path)
        else:
            # Generate generic starter paths (up to 30 candidates)
            candidate_paths = _build_generic_starter_paths(session, graph_id, branch_id, max_candidates=30)
        
        # Score all candidate paths
        scored_paths = []
        for path in candidate_paths:
            score = _score_path(session, path, graph_id, branch_id, lens)
            path["_score"] = score
            scored_paths.append(path)
        
        # Remove duplicates (unique start_concept_id or low overlap)
        deduplicated = _remove_duplicates(scored_paths)
        
        # Sort by score (descending) and take top N
        sorted_paths = sorted(deduplicated, key=lambda p: p.get("_score", 0.0), reverse=True)
        
        # Remove the internal _score field before returning
        result = []
        for path in sorted_paths[:limit]:
            path_copy = {k: v for k, v in path.items() if k != "_score"}
            result.append(path_copy)
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate paths: {str(e)}")

