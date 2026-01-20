"""
Service for homework and exam intelligence.

Analyzes uploaded assessments to:
1. Parse questions and identify required concepts
2. Map against user's graph
3. Detect gaps between required depth vs demonstrated understanding
"""
from typing import List, Dict, Any, Optional
import logging

from neo4j import Session

from models import AssessmentSignal, SignalCreate, SignalType
from services_signals import create_signal
from services_branch_explorer import get_active_graph_context

logger = logging.getLogger("brain_web")


def analyze_assessment(
    session: Session,
    assessment_id: str,
    assessment_type: str,  # "homework", "exam", "practice"
    questions: List[Dict[str, Any]],  # List of {question_id, question_text, required_concepts}
    document_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Analyze an assessment and create AssessmentSignal for each question.
    
    Args:
        session: Neo4j session
        assessment_id: Unique identifier for the assessment
        assessment_type: Type of assessment
        questions: List of questions with required concepts
        document_id: Optional document ID if assessment is part of a document
    
    Returns:
        Analysis result with gap information
    """
    ensure_graph_scoping_initialized(session)
    graph_id, branch_id = get_active_graph_context(session)
    
    gap_analysis = []
    signals_created = []
    
    for question in questions:
        question_id = question.get("question_id", f"Q_{len(signals_created)}")
        question_text = question.get("question_text", "")
        required_concepts = question.get("required_concepts", [])  # List of concept IDs or names
        
        # Analyze gaps for this question
        gaps = _analyze_concept_gaps(session, graph_id, branch_id, required_concepts)
        
        # Create assessment signal
        signal_payload = {
            "assessment_id": assessment_id,
            "assessment_type": assessment_type,
            "question_id": question_id,
            "question_text": question_text,
            "required_concepts": required_concepts,
            "gaps": gaps,
        }
        
        signal_create = SignalCreate(
            signal_type=SignalType.ASSESSMENT,
            document_id=document_id,
            payload=signal_payload,
        )
        
        try:
            signal = create_signal(session, signal_create)
            signals_created.append(signal.signal_id)
            gap_analysis.append({
                "question_id": question_id,
                "question_text": question_text,
                "required_concepts": required_concepts,
                "gaps": gaps,
            })
        except Exception as e:
            logger.error(f"Failed to create assessment signal for question {question_id}: {e}")
    
    return {
        "assessment_id": assessment_id,
        "assessment_type": assessment_type,
        "signals_created": len(signals_created),
        "gap_analysis": gap_analysis,
    }


def _analyze_concept_gaps(
    session: Session,
    graph_id: str,
    branch_id: str,
    required_concepts: List[str],
) -> List[Dict[str, Any]]:
    """
    Analyze gaps between required concepts and user's demonstrated understanding.
    
    Returns list of gaps with:
    - concept_id/name
    - required_depth (inferred from question context)
    - demonstrated_depth (from user's signals and mentions)
    - gap_type ("missing", "insufficient_depth", "sufficient")
    """
    gaps = []
    
    for concept_ref in required_concepts:
        # Try to find concept by ID or name
        concept = _find_concept(session, graph_id, branch_id, concept_ref)
        
        if not concept:
            gaps.append({
                "concept": concept_ref,
                "gap_type": "missing",
                "required_depth": "unknown",
                "demonstrated_depth": "none",
                "message": f"Concept '{concept_ref}' not found in your graph",
            })
            continue
        
        # Analyze demonstrated understanding
        understanding = _analyze_understanding(session, graph_id, branch_id, concept["node_id"])
        
        # Infer required depth from question context (simplified - could use LLM)
        required_depth = "intermediate"  # Default, could be enhanced with LLM analysis
        
        gap_type = "sufficient"
        if understanding["mention_count"] == 0:
            gap_type = "missing"
        elif understanding["mention_count"] < 2:
            gap_type = "insufficient_depth"
        
        gaps.append({
            "concept": concept["name"],
            "concept_id": concept["node_id"],
            "gap_type": gap_type,
            "required_depth": required_depth,
            "demonstrated_depth": understanding["depth"],
            "mention_count": understanding["mention_count"],
            "emphasis_count": understanding["emphasis_count"],
            "message": _generate_gap_message(gap_type, concept["name"], understanding),
        })
    
    return gaps


def _find_concept(session: Session, graph_id: str, branch_id: str, concept_ref: str) -> Optional[Dict[str, Any]]:
    """Find concept by node_id or name."""
    # Try by node_id first
    query = """
    MATCH (c:Concept {node_id: $concept_ref, graph_id: $graph_id})
    WHERE $branch_id IN COALESCE(c.on_branches, [])
    RETURN c.node_id AS node_id, c.name AS name, c.description AS description
    LIMIT 1
    """
    result = session.run(query, concept_ref=concept_ref, graph_id=graph_id, branch_id=branch_id)
    record = result.single()
    if record:
        return record.data()
    
    # Try by name (case-insensitive)
    query = """
    MATCH (c:Concept {graph_id: $graph_id})
    WHERE $branch_id IN COALESCE(c.on_branches, [])
      AND toLower(c.name) = toLower($concept_ref)
    RETURN c.node_id AS node_id, c.name AS name, c.description AS description
    LIMIT 1
    """
    result = session.run(query, concept_ref=concept_ref, graph_id=graph_id, branch_id=branch_id)
    record = result.single()
    if record:
        return record.data()
    
    return None


def _analyze_understanding(
    session: Session,
    graph_id: str,
    branch_id: str,
    concept_id: str,
) -> Dict[str, Any]:
    """
    Analyze user's demonstrated understanding of a concept.
    
    Returns:
        {
            "depth": "none" | "basic" | "intermediate" | "advanced",
            "mention_count": int,
            "emphasis_count": int,
            "signal_count": int,
        }
    """
    # Count mentions
    mention_query = """
    MATCH (c:Concept {node_id: $concept_id, graph_id: $graph_id})
    MATCH (m:LectureMention {graph_id: $graph_id})-[:REFERS_TO]->(c)
    WHERE $branch_id IN COALESCE(m.on_branches, [])
    RETURN count(m) AS mention_count
    """
    mention_result = session.run(mention_query, concept_id=concept_id, graph_id=graph_id, branch_id=branch_id)
    mention_count = mention_result.single()["mention_count"] if mention_result.single() else 0
    
    # Count emphasis signals
    emphasis_query = """
    MATCH (c:Concept {node_id: $concept_id, graph_id: $graph_id})
    MATCH (s:Signal {graph_id: $graph_id, signal_type: 'EMPHASIS'})-[:OBSERVES_CONCEPT]->(c)
    WHERE $branch_id IN COALESCE(s.on_branches, [])
    RETURN count(s) AS emphasis_count
    """
    emphasis_result = session.run(emphasis_query, concept_id=concept_id, graph_id=graph_id, branch_id=branch_id)
    emphasis_count = emphasis_result.single()["emphasis_count"] if emphasis_result.single() else 0
    
    # Count total signals
    signal_query = """
    MATCH (c:Concept {node_id: $concept_id, graph_id: $graph_id})
    MATCH (s:Signal {graph_id: $graph_id})-[:OBSERVES_CONCEPT]->(c)
    WHERE $branch_id IN COALESCE(s.on_branches, [])
    RETURN count(s) AS signal_count
    """
    signal_result = session.run(signal_query, concept_id=concept_id, graph_id=graph_id, branch_id=branch_id)
    signal_count = signal_result.single()["signal_count"] if signal_result.single() else 0
    
    # Infer depth
    if mention_count == 0 and signal_count == 0:
        depth = "none"
    elif mention_count < 2:
        depth = "basic"
    elif mention_count < 5:
        depth = "intermediate"
    else:
        depth = "advanced"
    
    return {
        "depth": depth,
        "mention_count": mention_count,
        "emphasis_count": emphasis_count,
        "signal_count": signal_count,
    }


def _generate_gap_message(gap_type: str, concept_name: str, understanding: Dict[str, Any]) -> str:
    """Generate human-readable gap message."""
    if gap_type == "missing":
        return f"'{concept_name}' is not in your knowledge graph. You'll need to learn this concept."
    elif gap_type == "insufficient_depth":
        return f"You've mentioned '{concept_name}' {understanding['mention_count']} times, but may need deeper understanding for this question."
    else:
        return f"You have sufficient coverage of '{concept_name}' ({understanding['mention_count']} mentions)."


# Import needed for ensure_graph_scoping_initialized
from services_branch_explorer import ensure_graph_scoping_initialized
