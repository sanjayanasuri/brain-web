# backend/services/context_builder.py
"""
Context building service for adaptive learning system.
Extracts grounded excerpts from user selections.
"""

from typing import List, Dict, Any, Optional
from neo4j import Session

from models.study import Excerpt, ContextPack


def build_context_from_selection(
    *,
    session: Session,
    selection_id: str,
    radius: int = 2,
    include_related: bool = True,
    user_id: str,
    tenant_id: str,
    graph_id: Optional[str] = None,
    branch_id: Optional[str] = None,
) -> ContextPack:
    """
    Build a context pack from a selection (quote or artifact).
    
    Args:
        session: Neo4j session
        selection_id: Quote ID or Artifact ID
        radius: Number of surrounding blocks to include
        include_related: Whether to include linked lectures/concepts
        user_id: User ID for tenant isolation
        tenant_id: Tenant ID for multi-tenant isolation
        graph_id: Optional graph ID (defaults to active graph)
        branch_id: Optional branch ID (defaults to active branch)
    
    Returns:
        ContextPack with excerpts and concepts
    """
    
    # Get active graph context if not provided
    if not graph_id or not branch_id:
        from services_branch_explorer import get_active_graph_context
        active_graph_id, active_branch_id = get_active_graph_context(session)
        graph_id = graph_id or active_graph_id
        branch_id = branch_id or active_branch_id
    
    excerpts: List[Excerpt] = []
    concepts: List[str] = []
    
    # Step 1: Fetch the selection itself (Quote or Artifact)
    selection_query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    OPTIONAL MATCH (q:Quote {graph_id: $graph_id, quote_id: $selection_id})-[:BELONGS_TO]->(g)
    OPTIONAL MATCH (a:Artifact {graph_id: $graph_id, artifact_id: $selection_id})-[:BELONGS_TO]->(g)
    
    WITH COALESCE(q, a) AS selection, q, a
    WHERE selection IS NOT NULL
    
    RETURN 
        selection.quote_id AS quote_id,
        selection.artifact_id AS artifact_id,
        COALESCE(q.text, a.text) AS text,
        COALESCE(q.page_url, a.url) AS url,
        COALESCE(q.page_title, a.title) AS title,
        CASE WHEN q IS NOT NULL THEN 'quote' ELSE 'artifact' END AS type
    """
    
    selection_rec = session.run(
        selection_query,
        graph_id=graph_id,
        selection_id=selection_id
    ).single()
    
    if not selection_rec:
        # Selection not found in DB as ID, treat selection_id as the raw text itself
        # This allows "on-the-fly" study from highlighted text
        excerpts.append(Excerpt(
            excerpt_id=f"raw_{hash(selection_id)}",
            content=selection_id,
            source_type="selection",
            source_id="raw",
            relevance_score=1.0,
            metadata={
                "title": "Selected Text",
                "is_raw": True
            }
        ))
        
        # Optionally find related concepts by matching text
        from services_notes_digest import _extract_related_node_ids_for_entry
        from api_concepts import get_all_concepts
        
        try:
            potential_concepts = get_all_concepts(session, user_id=user_id, tenant_id=tenant_id)
            concepts = _extract_related_node_ids_for_entry(selection_id, potential_concepts)
        except Exception:
            pass
            
        return ContextPack(
            excerpts=excerpts,
            concepts=concepts,
            metadata={
                "graph_id": graph_id,
                "branch_id": branch_id,
                "selection_id": "raw",
                "is_raw": True
            }
        )
    
    # Add the selection itself as the primary excerpt
    selection_id_actual = selection_rec["quote_id"] or selection_rec["artifact_id"]
    excerpts.append(Excerpt(
        excerpt_id=selection_id_actual,
        content=selection_rec["text"] or "",
        source_type=selection_rec["type"],
        source_id=selection_id_actual,
        relevance_score=1.0,  # Highest relevance
        metadata={
            "url": selection_rec["url"],
            "title": selection_rec["title"],
        }
    ))
    
    # Step 2: Find related concepts (mentioned in the selection)
    if include_related:
        concepts_query = """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MATCH (q:Quote {graph_id: $graph_id, quote_id: $selection_id})-[:BELONGS_TO]->(g)
        MATCH (c:Concept)-[r:MENTIONS_QUOTE]->(q)
        WHERE c.graph_id = $graph_id AND $branch_id IN COALESCE(r.on_branches, [])
        RETURN c.node_id AS concept_id, c.name AS concept_name
        LIMIT 10
        """
        
        concepts_recs = session.run(
            concepts_query,
            graph_id=graph_id,
            branch_id=branch_id,
            selection_id=selection_id
        )
        
        for rec in concepts_recs:
            concepts.append(rec["concept_id"])
    
    # Step 3: Find related lecture segments (if selection is from a lecture)
    if include_related:
        lecture_segments_query = """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MATCH (a:Artifact {graph_id: $graph_id})-[:BELONGS_TO]->(g)
        WHERE a.artifact_id = $selection_id OR a.url CONTAINS $selection_id
        
        // Find lectures that reference this artifact
        OPTIONAL MATCH (l:Lecture)-[:BELONGS_TO]->(g)
        WHERE l.lecture_id IN COALESCE(a.metadata_json, '{}')
        
        // Get lecture segments
        OPTIONAL MATCH (ls:LectureSegment {lecture_id: l.lecture_id})
        
        RETURN 
            ls.segment_id AS segment_id,
            ls.text AS text,
            ls.summary AS summary,
            l.title AS lecture_title,
            ls.segment_index AS segment_index
        ORDER BY ls.segment_index
        LIMIT $radius
        """
        
        lecture_recs = session.run(
            lecture_segments_query,
            graph_id=graph_id,
            selection_id=selection_id,
            radius=radius
        )
        
        for idx, rec in enumerate(lecture_recs):
            if rec["segment_id"]:
                # Calculate relevance based on distance from selection
                relevance = 0.8 - (idx * 0.1)  # Decay by distance
                
                excerpts.append(Excerpt(
                    excerpt_id=rec["segment_id"],
                    content=rec["text"] or rec["summary"] or "",
                    source_type="lecture",
                    source_id=rec["segment_id"],
                    relevance_score=max(0.3, relevance),
                    metadata={
                        "lecture_title": rec["lecture_title"],
                        "segment_index": rec["segment_index"],
                    }
                ))
    
    # Step 4: Find related quotes from the same artifact (context before/after)
    related_quotes_query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (q1:Quote {graph_id: $graph_id, quote_id: $selection_id})-[:FROM_ARTIFACT]->(a:Artifact)
    MATCH (q2:Quote)-[:FROM_ARTIFACT]->(a)
    WHERE q2.quote_id <> $selection_id 
      AND q2.graph_id = $graph_id
      AND $branch_id IN COALESCE(q2.on_branches, [])
    
    RETURN 
        q2.quote_id AS quote_id,
        q2.text AS text,
        q2.page_url AS url,
        q2.page_title AS title
    LIMIT $radius
    """
    
    related_recs = session.run(
        related_quotes_query,
        graph_id=graph_id,
        branch_id=branch_id,
        selection_id=selection_id,
        radius=radius
    )
    
    for idx, rec in enumerate(related_recs):
        relevance = 0.7 - (idx * 0.15)  # Decay by distance
        
        excerpts.append(Excerpt(
            excerpt_id=rec["quote_id"],
            content=rec["text"] or "",
            source_type="quote",
            source_id=rec["quote_id"],
            relevance_score=max(0.3, relevance),
            metadata={
                "url": rec["url"],
                "title": rec["title"],
            }
        ))
    
    # Sort excerpts by relevance (highest first)
    excerpts.sort(key=lambda e: e.relevance_score, reverse=True)
    
    return ContextPack(
        excerpts=excerpts,
        concepts=concepts,
        metadata={
            "graph_id": graph_id,
            "branch_id": branch_id,
            "selection_id": selection_id,
        }
    )

