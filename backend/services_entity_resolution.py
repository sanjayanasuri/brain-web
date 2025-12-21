"""
Entity resolution service for detecting and merging duplicate concepts.
"""
import datetime
import hashlib
import re
from typing import List, Dict, Any, Optional, Tuple
from neo4j import Session

from models import Concept
from services_graph import (
    get_all_concepts,
    ensure_graph_scoping_initialized,
    get_active_graph_context,
    upsert_merge_candidate,
)
from services_search import embed_text, cosine_similarity

try:
    from rapidfuzz import fuzz
    RAPIDFUZZ_AVAILABLE = True
except ImportError:
    RAPIDFUZZ_AVAILABLE = False
    print("[Entity Resolution] WARNING: rapidfuzz not available, using fallback string matching")


def normalize_name(name: str) -> str:
    """Normalize a concept name for blocking/comparison."""
    # Lowercase, remove punctuation, collapse spaces
    normalized = name.lower()
    normalized = re.sub(r'[^\w\s]', '', normalized)
    normalized = re.sub(r'\s+', ' ', normalized)
    return normalized.strip()


def get_blocking_key(name: str) -> str:
    """Generate a blocking key for candidate generation."""
    normalized = normalize_name(name)
    if len(normalized) >= 3:
        return normalized[:3]
    return normalized


def string_similarity(name1: str, name2: str) -> float:
    """Compute string similarity score (0-1)."""
    if not RAPIDFUZZ_AVAILABLE:
        # Fallback: simple token overlap
        tokens1 = set(normalize_name(name1).split())
        tokens2 = set(normalize_name(name2).split())
        if not tokens1 or not tokens2:
            return 0.0
        intersection = len(tokens1 & tokens2)
        union = len(tokens1 | tokens2)
        return intersection / union if union > 0 else 0.0
    
    # Use rapidfuzz token_set_ratio (handles word order differences)
    return fuzz.token_set_ratio(name1, name2) / 100.0


def embedding_similarity(text1: str, text2: str) -> Optional[float]:
    """Compute embedding similarity score (0-1)."""
    try:
        emb1 = embed_text(text1)
        emb2 = embed_text(text2)
        return cosine_similarity(emb1, emb2)
    except Exception as e:
        print(f"[Entity Resolution] WARNING: Failed to compute embedding similarity: {e}")
        return None


def compute_hybrid_score(
    name1: str,
    name2: str,
    desc1: Optional[str],
    desc2: Optional[str],
    tags1: Optional[List[str]],
    tags2: Optional[List[str]]
) -> Tuple[float, str, str]:
    """
    Compute hybrid similarity score for two concepts.
    
    Returns:
        Tuple of (score, method, rationale)
    """
    # String similarity
    str_score = string_similarity(name1, name2)
    
    # Build text representations for embedding
    text1_parts = [name1]
    if desc1:
        text1_parts.append(desc1)
    if tags1:
        text1_parts.append(", ".join(tags1))
    text1 = "\n".join(text1_parts)
    
    text2_parts = [name2]
    if desc2:
        text2_parts.append(desc2)
    if tags2:
        text2_parts.append(", ".join(tags2))
    text2 = "\n".join(text2_parts)
    
    # Embedding similarity
    emb_score = embedding_similarity(text1, text2)
    
    # Hybrid scoring
    if emb_score is not None:
        # Weighted combination: 40% string, 60% embedding
        hybrid_score = 0.4 * str_score + 0.6 * emb_score
        method = "hybrid"
        rationale = f"String similarity: {str_score:.2f}, Embedding similarity: {emb_score:.2f}"
    else:
        # Fallback to string only
        hybrid_score = str_score
        method = "string"
        rationale = f"String similarity: {str_score:.2f} (embeddings unavailable)"
    
    return hybrid_score, method, rationale


def generate_merge_candidates(
    session: Session,
    graph_id: str,
    top_k_per_node: int = 3,
    score_threshold: float = 0.82,
    limit_pairs: int = 3000
) -> int:
    """
    Generate merge candidates using hybrid blocking and scoring.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        top_k_per_node: Maximum candidates per node
        score_threshold: Minimum score to create candidate
        limit_pairs: Maximum pairs to evaluate (safety limit)
    
    Returns:
        Number of candidates created
    """
    ensure_graph_scoping_initialized(session)
    
    # Get all concepts (get_all_concepts already excludes merged ones)
    concepts = get_all_concepts(session)
    
    if len(concepts) < 2:
        print(f"[Entity Resolution] Not enough concepts ({len(concepts)}) to generate candidates")
        return 0
    
    print(f"[Entity Resolution] Generating merge candidates from {len(concepts)} concepts...")
    
    # Blocking: group by first 3 chars of normalized name
    blocks: Dict[str, List] = {}
    for concept in concepts:
        key = get_blocking_key(concept.name)
        if key not in blocks:
            blocks[key] = []
        blocks[key].append(concept)
    
    # Generate candidate pairs within blocks
    candidates_created = 0
    pairs_evaluated = 0
    
    for block_key, block_concepts in blocks.items():
        if len(block_concepts) < 2:
            continue
        
        # Compare all pairs in this block
        for i in range(len(block_concepts)):
            if pairs_evaluated >= limit_pairs:
                print(f"[Entity Resolution] Reached limit of {limit_pairs} pairs, stopping")
                break
            
            concept1 = block_concepts[i]
            scores_for_node = []
            
            for j in range(i + 1, len(block_concepts)):
                if pairs_evaluated >= limit_pairs:
                    break
                
                concept2 = block_concepts[j]
                pairs_evaluated += 1
                
                # Compute hybrid score
                score, method, rationale = compute_hybrid_score(
                    concept1.name,
                    concept2.name,
                    concept1.description,
                    concept2.description,
                    concept1.tags,
                    concept2.tags
                )
                
                if score >= score_threshold:
                    scores_for_node.append((score, concept2, method, rationale))
            
            # Sort by score and take top_k
            scores_for_node.sort(key=lambda x: x[0], reverse=True)
            top_candidates = scores_for_node[:top_k_per_node]
            
            # Create MergeCandidate nodes
            for score, concept2, method, rationale in top_candidates:
                # Deterministic candidate_id
                node_ids_sorted = sorted([concept1.node_id, concept2.node_id])
                candidate_id_hash = hashlib.sha256(
                    f"{graph_id}{node_ids_sorted[0]}{node_ids_sorted[1]}".encode()
                ).hexdigest()[:16]
                candidate_id = f"MERGE_{candidate_id_hash.upper()}"
                
                # Ensure src < dst for consistency
                if concept1.node_id < concept2.node_id:
                    src_node_id = concept1.node_id
                    dst_node_id = concept2.node_id
                else:
                    src_node_id = concept2.node_id
                    dst_node_id = concept1.node_id
                
                try:
                    upsert_merge_candidate(
                        session=session,
                        graph_id=graph_id,
                        candidate_id=candidate_id,
                        src_node_id=src_node_id,
                        dst_node_id=dst_node_id,
                        score=score,
                        method=method,
                        rationale=rationale,
                        status="PROPOSED"
                    )
                    candidates_created += 1
                except Exception as e:
                    print(f"[Entity Resolution] ERROR: Failed to create candidate {candidate_id}: {e}")
                    continue
        
        if pairs_evaluated >= limit_pairs:
            break
    
    print(f"[Entity Resolution] Created {candidates_created} merge candidates from {pairs_evaluated} pairs evaluated")
    return candidates_created


def merge_concepts(
    session: Session,
    graph_id: str,
    keep_node_id: str,
    merge_node_id: str,
    reviewed_by: Optional[str] = None
) -> Dict[str, Any]:
    """
    Safely merge two concepts, redirecting all relationships.
    
    Args:
        session: Neo4j session
        graph_id: Graph ID for scoping
        keep_node_id: Node ID to keep (survives merge)
        merge_node_id: Node ID to merge (absorbed into keep)
        reviewed_by: Reviewer identifier (optional)
    
    Returns:
        Dict with merge statistics
    """
    ensure_graph_scoping_initialized(session)
    _, branch_id = get_active_graph_context(session)
    
    # Validate nodes exist and are not already merged
    query_check = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (keep:Concept {graph_id: $graph_id, node_id: $keep_node_id})-[:BELONGS_TO]->(g)
    MATCH (merge:Concept {graph_id: $graph_id, node_id: $merge_node_id})-[:BELONGS_TO]->(g)
    WHERE $branch_id IN COALESCE(keep.on_branches, [])
      AND $branch_id IN COALESCE(merge.on_branches, [])
      AND COALESCE(keep.is_merged, false) = false
      AND COALESCE(merge.is_merged, false) = false
    RETURN keep, merge
    """
    
    result = session.run(
        query_check,
        graph_id=graph_id,
        branch_id=branch_id,
        keep_node_id=keep_node_id,
        merge_node_id=merge_node_id
    )
    record = result.single()
    
    if not record:
        raise ValueError(f"Concepts not found or already merged: {keep_node_id}, {merge_node_id}")
    
    keep_node = record["keep"]
    merge_node = record["merge"]
    
    # Step 1: Get all relationships from merge node
    query_get_rels = """
    MATCH (merge:Concept {graph_id: $graph_id, node_id: $merge_node_id})
    MATCH (merge)-[r]-(other)
    WHERE type(r) <> 'BELONGS_TO'
    RETURN r, startNode(r).node_id = $merge_node_id AS is_outgoing, 
           CASE WHEN startNode(r).node_id = $merge_node_id THEN endNode(r) ELSE startNode(r) END AS other_node
    """
    
    rels_result = session.run(query_get_rels, graph_id=graph_id, merge_node_id=merge_node_id)
    relationships = []
    for rel_record in rels_result:
        rel = rel_record["r"]
        is_outgoing = rel_record["is_outgoing"]
        other_node = rel_record["other_node"]
        relationships.append({
            "rel": rel,
            "rel_type": type(rel).__name__,
            "is_outgoing": is_outgoing,
            "other_node_id": other_node.get("node_id") if other_node else None,
            "other_node_labels": list(other_node.labels) if other_node else [],
        })
    
    # Step 2: Merge properties
    # Combine descriptions, tags, etc.
    keep_name = keep_node.get("name")
    merge_name = merge_node.get("name")
    
    # Merge description
    keep_desc = keep_node.get("description") or ""
    merge_desc = merge_node.get("description") or ""
    if not keep_desc and merge_desc:
        final_desc = merge_desc
    elif keep_desc and merge_desc and merge_desc not in keep_desc:
        final_desc = f"{keep_desc}\n\n{merge_desc}"
    else:
        final_desc = keep_desc
    
    # Merge tags
    keep_tags = set(keep_node.get("tags") or [])
    merge_tags = set(merge_node.get("tags") or [])
    final_tags = list(keep_tags | merge_tags)
    
    # Build alias_names list
    alias_names = keep_node.get("alias_names") or []
    if merge_name and merge_name != keep_name and merge_name not in alias_names:
        alias_names.append(merge_name)
    
    # Build merged_node_ids list
    merged_node_ids = keep_node.get("merged_node_ids") or []
    if merge_node_id not in merged_node_ids:
        merged_node_ids.append(merge_node_id)
    # Also include any previously merged nodes
    merge_merged_ids = merge_node.get("merged_node_ids") or []
    for mid in merge_merged_ids:
        if mid not in merged_node_ids:
            merged_node_ids.append(mid)
    
    # Step 3: Update keep node with merged properties
    query_update_keep = """
    MATCH (keep:Concept {graph_id: $graph_id, node_id: $keep_node_id})
    SET keep.description = $description,
        keep.tags = $tags,
        keep.alias_names = $alias_names,
        keep.merged_node_ids = $merged_node_ids
    RETURN 1
    """
    
    session.run(
        query_update_keep,
        graph_id=graph_id,
        keep_node_id=keep_node_id,
        description=final_desc,
        tags=final_tags,
        alias_names=alias_names,
        merged_node_ids=merged_node_ids
    )
    
    # Step 4: Redirect relationships
    redirected_count = 0
    skipped_count = 0
    
    for rel_info in relationships:
        rel_type = rel_info["rel_type"]
        is_outgoing = rel_info["is_outgoing"]
        other_node_id = rel_info["other_node_id"]
        other_node_labels = rel_info["other_node_labels"]
        
        # Skip if other node is not a Concept or is the keep node
        if "Concept" not in other_node_labels or other_node_id == keep_node_id:
            skipped_count += 1
            continue
        
        # Get relationship properties
        rel = rel_info["rel"]
        rel_props = dict(rel)
        
        # Determine source and target
        if is_outgoing:
            source_id = keep_node_id
            target_id = other_node_id
        else:
            source_id = other_node_id
            target_id = keep_node_id
        
        # Check if relationship already exists
        query_check_existing = """
        MATCH (s:Concept {graph_id: $graph_id, node_id: $source_id})
        MATCH (t:Concept {graph_id: $graph_id, node_id: $target_id})
        MATCH (s)-[r]->(t)
        WHERE type(r) = $rel_type
        RETURN count(r) AS exists
        """
        
        check_result = session.run(
            query_check_existing,
            graph_id=graph_id,
            source_id=source_id,
            target_id=target_id,
            rel_type=rel_type
        )
        exists_record = check_result.single()
        if exists_record and exists_record["exists"] > 0:
            skipped_count += 1
            continue
        
        # Create redirected relationship with all properties
        set_clauses = [
            "r.graph_id = $graph_id",
            """r.on_branches = CASE
                WHEN r.on_branches IS NULL THEN [$branch_id]
                WHEN $branch_id IN r.on_branches THEN r.on_branches
                ELSE r.on_branches + $branch_id
            END"""
        ]
        
        params = {
            "graph_id": graph_id,
            "branch_id": branch_id,
            "source_id": source_id,
            "target_id": target_id,
        }
        
        # Copy all relationship properties
        for key, value in rel_props.items():
            if key not in ["graph_id", "on_branches"]:  # Already handled
                set_clauses.append(f"r.{key} = ${key}")
                params[key] = value
        
        query_redirect = f"""
        MATCH (s:Concept {{graph_id: $graph_id, node_id: $source_id}})
        MATCH (t:Concept {{graph_id: $graph_id, node_id: $target_id}})
        MERGE (s)-[r:`{rel_type}`]->(t)
        SET {', '.join(set_clauses)}
        RETURN 1
        """
        
        try:
            session.run(query_redirect, **params)
            redirected_count += 1
        except Exception as e:
            print(f"[Entity Resolution] WARNING: Failed to redirect relationship {rel_type}: {e}")
            skipped_count += 1
    
    # Step 5: Mark merge node as merged
    current_timestamp = int(datetime.datetime.now().timestamp() * 1000)
    
    query_mark_merged = """
    MATCH (merge:Concept {graph_id: $graph_id, node_id: $merge_node_id})
    SET merge.is_merged = true,
        merge.merged_into = $keep_node_id,
        merge.merged_at = $merged_at
    RETURN 1
    """
    
    session.run(
        query_mark_merged,
        graph_id=graph_id,
        merge_node_id=merge_node_id,
        keep_node_id=keep_node_id,
        merged_at=current_timestamp
    )
    
    # Step 6: Delete old relationships from merge node (except BELONGS_TO)
    query_delete_old_rels = """
    MATCH (merge:Concept {graph_id: $graph_id, node_id: $merge_node_id})-[r]-(other)
    WHERE type(r) <> 'BELONGS_TO'
    DELETE r
    RETURN count(r) AS deleted
    """
    
    delete_result = session.run(query_delete_old_rels, graph_id=graph_id, merge_node_id=merge_node_id)
    deleted_record = delete_result.single()
    deleted_count = deleted_record["deleted"] if deleted_record else 0
    
    return {
        "keep_node_id": keep_node_id,
        "merge_node_id": merge_node_id,
        "relationships_redirected": redirected_count,
        "relationships_skipped": skipped_count,
        "relationships_deleted": deleted_count,
        "reviewed_by": reviewed_by,
    }
