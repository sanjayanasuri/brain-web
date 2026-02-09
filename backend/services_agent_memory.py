import logging
from typing import Optional
from db_neo4j import get_neo4j_session
from services_branch_explorer import get_active_graph_context

logger = logging.getLogger("brain_web")

def read_agent_memory(session, graph_id: str, user_id: Optional[str] = None, tenant_id: Optional[str] = None) -> str:
    """
    Reads the agent memory for a specific user from Neo4j.
    
    Now retrieves UserFacts instead of the old text blob.
    Falls back to legacy agent_memory property if UserFacts don't exist.
    
    Args:
        session: Neo4j session
        graph_id: Graph identifier
        user_id: Optional user identifier
        tenant_id: Optional tenant identifier
    
    Returns:
        Formatted string of user facts for LLM context
    """
    # Try to get UserFacts first (new system)
    if user_id and tenant_id:
        try:
            from services_fact_extractor import get_user_facts, format_user_facts_for_prompt
            
            facts = get_user_facts(
                user_id=user_id,
                tenant_id=tenant_id,
                session=session,
                limit=5
            )
            
            if facts:
                return format_user_facts_for_prompt(facts)
        except Exception as e:
            logger.warning(f"Failed to retrieve UserFacts: {e}")
    
    # Fallback to legacy agent_memory (old system)
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    RETURN g.agent_memory AS memory
    """
    result = session.run(query, graph_id=graph_id).single()
    if result and result["memory"]:
        return result["memory"]
    
    return ""

def update_agent_memory(session, graph_id: str, content: str) -> bool:
    """
    Overwrites the agent memory for a specific graph.
    
    DEPRECATED: Use services_fact_extractor instead for automatic fact extraction.
    This is kept for backward compatibility.
    """
    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    SET g.agent_memory = $content
    RETURN g.graph_id
    """
    try:
        session.run(query, graph_id=graph_id, content=content)
        return True
    except Exception as e:
        logger.error(f"Failed to update agent memory: {e}")
        return False

def append_to_agent_memory(session, graph_id: str, new_segment: str) -> bool:
    """
    Appends text to the agent memory.
    
    DEPRECATED: Use services_fact_extractor instead for automatic fact extraction.
    This is kept for backward compatibility.
    """
    current = read_agent_memory(session, graph_id)
    updated = current + "\n\n" + new_segment if current else new_segment
    return update_agent_memory(session, graph_id, updated)
