"""
Signal-aware retrieval enhancements.

Enhances retrieval with signal information to:
1. Weight emphasized content higher
2. Include user's reflections and confusions
3. Use concept confidence from signals
4. Prioritize user-authored material
"""
from typing import List, Dict, Any, Optional
import logging

from neo4j import Session

from models import SignalType
from services_branch_explorer import get_active_graph_context

logger = logging.getLogger("brain_web")


def get_signals_for_concepts(
    session: Session,
    concept_ids: List[str],
    signal_types: Optional[List[SignalType]] = None,
    limit_per_concept: int = 10,
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Get signals for a list of concepts.
    
    Returns dict mapping concept_id to list of signals.
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    if not concept_ids:
        return {}
    
    signal_type_filter = ""
    params = {
        "graph_id": graph_id,
        "branch_id": branch_id,
        "concept_ids": concept_ids,
        "limit": limit_per_concept,
    }
    
    if signal_types:
        signal_type_filter = "AND s.signal_type IN $signal_types"
        params["signal_types"] = [st.value for st in signal_types]
    
    query = f"""
    MATCH (c:Concept {{graph_id: $graph_id}})
    WHERE c.node_id IN $concept_ids
      AND $branch_id IN COALESCE(c.on_branches, [])
    MATCH (s:Signal {{graph_id: $graph_id}})-[:OBSERVES_CONCEPT]->(c)
    WHERE $branch_id IN COALESCE(s.on_branches, [])
      {signal_type_filter}
    RETURN c.node_id AS concept_id,
           s.signal_id AS signal_id,
           s.signal_type AS signal_type,
           s.timestamp AS timestamp,
           s.payload AS payload,
           s.block_id AS block_id,
           s.document_id AS document_id
    ORDER BY s.timestamp DESC
    LIMIT $limit
    """
    
    result = session.run(query, **params)
    
    signals_by_concept: Dict[str, List[Dict[str, Any]]] = {cid: [] for cid in concept_ids}
    
    for record in result:
        concept_id = record["concept_id"]
        signal = {
            "signal_id": record["signal_id"],
            "signal_type": record["signal_type"],
            "timestamp": record["timestamp"],
            "payload": record["payload"],
            "block_id": record.get("block_id"),
            "document_id": record.get("document_id"),
        }
        signals_by_concept[concept_id].append(signal)
    
    return signals_by_concept


def get_emphasis_for_concepts(
    session: Session,
    concept_ids: List[str],
) -> Dict[str, int]:
    """
    Get emphasis count for concepts.
    
    Returns dict mapping concept_id to emphasis count.
    """
    signals = get_signals_for_concepts(
        session,
        concept_ids,
        signal_types=[SignalType.EMPHASIS],
        limit_per_concept=1000,  # Get all emphasis signals
    )
    
    return {
        concept_id: len(signal_list)
        for concept_id, signal_list in signals.items()
    }


def get_user_reflections_for_concepts(
    session: Session,
    concept_ids: List[str],
    limit_per_concept: int = 5,
) -> Dict[str, List[str]]:
    """
    Get user reflections (voice capture signals) for concepts.
    
    Returns dict mapping concept_id to list of reflection transcripts.
    """
    signals = get_signals_for_concepts(
        session,
        concept_ids,
        signal_types=[SignalType.VOICE_CAPTURE],
        limit_per_concept=limit_per_concept,
    )
    
    reflections: Dict[str, List[str]] = {}
    
    for concept_id, signal_list in signals.items():
        transcripts = []
        for signal in signal_list:
            payload = signal.get("payload", {})
            transcript = payload.get("transcript")
            classification = payload.get("classification", "")
            
            # Only include reflections and confusions (not explanations)
            if transcript and classification in ["reflection", "confusion"]:
                transcripts.append(transcript)
        
        reflections[concept_id] = transcripts
    
    return reflections


def enhance_retrieval_with_signals(
    session: Session,
    concepts: List[Dict[str, Any]],
    include_reflections: bool = True,
    include_emphasis: bool = True,
) -> Dict[str, Any]:
    """
    Enhance retrieval results with signal information.
    
    Args:
        session: Neo4j session
        concepts: List of concept dicts from retrieval
        include_reflections: Whether to include user reflections
        include_emphasis: Whether to include emphasis counts
    
    Returns:
        Enhanced context with signal information
    """
    if not concepts:
        return {
            "signals": {},
            "emphasis_counts": {},
            "reflections": {},
        }
    
    concept_ids = [c.get("node_id") or c.get("id") for c in concepts if c.get("node_id") or c.get("id")]
    
    emphasis_counts = {}
    reflections = {}
    
    if include_emphasis:
        emphasis_counts = get_emphasis_for_concepts(session, concept_ids)
    
    if include_reflections:
        reflections = get_user_reflections_for_concepts(session, concept_ids)
    
    return {
        "signals": get_signals_for_concepts(session, concept_ids),
        "emphasis_counts": emphasis_counts,
        "reflections": reflections,
    }


def format_signal_context(signal_info: Dict[str, Any]) -> str:
    """
    Format signal information as context text for LLM.
    
    Returns formatted string that can be appended to retrieval context.
    """
    context_parts = []
    
    # Add emphasis information
    emphasis_counts = signal_info.get("emphasis_counts", {})
    if emphasis_counts:
        emphasized_concepts = [
            concept_id for concept_id, count in emphasis_counts.items() if count > 0
        ]
        if emphasized_concepts:
            context_parts.append(
                f"User has emphasized {len(emphasized_concepts)} concept(s) in their notes."
            )
    
    # Add reflections
    reflections = signal_info.get("reflections", {})
    if reflections:
        for concept_id, reflection_list in reflections.items():
            if reflection_list:
                context_parts.append(
                    f"User's reflections on this concept: {'; '.join(reflection_list[:3])}"
                )
    
    return "\n".join(context_parts) if context_parts else ""


# Import needed for ensure_graph_scoping_initialized
from services_branch_explorer import ensure_graph_scoping_initialized
