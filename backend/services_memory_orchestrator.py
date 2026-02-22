"""
Unified Memory Orchestrator

Combines all three memory tiers into a single context:
1. Short-term: Redis chat history (last 10 messages)
2. Working memory: Qdrant lecture context (current study session)
3. Long-term: Neo4j user facts (persistent knowledge about user)
"""
import logging
import json
from typing import Optional, Dict, List, Any
from config import POSTGRES_CONNECTION_STRING

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    from psycopg2.pool import ThreadedConnectionPool
    PSYCOPG2_AVAILABLE = True
except ImportError:
    PSYCOPG2_AVAILABLE = False

logger = logging.getLogger("brain_web")

_pg_pool: Optional[ThreadedConnectionPool] = None


def _get_pg_pool():
    """Get Postgres connection pool."""
    global _pg_pool
    if _pg_pool is None and PSYCOPG2_AVAILABLE:
        try:
            _pg_pool = ThreadedConnectionPool(1, 5, POSTGRES_CONNECTION_STRING)
        except Exception as e:
            logger.error(f"Failed to initialize Postgres pool in memory orchestrator: {e}")
    return _pg_pool


def get_unified_context(
    user_id: str,
    tenant_id: str,
    chat_id: str,
    query: str,
    session,
    active_lecture_id: Optional[str] = None,
    include_chat_history: bool = True,
    include_lecture_context: bool = True,
    include_user_facts: bool = True,
    include_study_context: bool = True,
    include_recent_topics: bool = True,  # NEW: cross-surface awareness
) -> Dict[str, Any]:
    """
    Orchestrate all three memory tiers into unified context.
    
    Args:
        user_id: User identifier
        tenant_id: Tenant identifier
        chat_id: Current chat identifier
        query: User's current message
        session: Neo4j session
        active_lecture_id: Optional lecture ID for working memory
        include_chat_history: Whether to include short-term memory
        include_lecture_context: Whether to include working memory
        include_user_facts: Whether to include long-term memory
    
    Returns:
        Dictionary with formatted context sections:
        {
            "user_facts": "...",
            "lecture_context": "...",
            "chat_history": [...]
        }
    """
    context = {
        "user_facts": "",
        "user_identity": {}, # Goals, Background
        "tutor_persona": {}, # Personality parameters
        "lecture_context": "",
        "chat_history": [],
        "study_context": {},
        "recent_topics": "",  # cross-surface ambient context
    }
    
    # 1. Long-term memory: User facts from Neo4j
    if include_user_facts:
        try:
            from services_fact_extractor import get_user_facts, format_user_facts_for_prompt
            
            facts = get_user_facts(
                user_id=user_id,
                tenant_id=tenant_id,
                session=session,
                limit=5
            )
            
            if facts:
                context["user_facts"] = format_user_facts_for_prompt(facts)
                logger.debug(f"Loaded {len(facts)} user facts")
        except Exception as e:
            logger.warning(f"Failed to load user facts: {e}")
    
    # 2. Working memory: Current lecture context from Qdrant
    if include_lecture_context and active_lecture_id:
        try:
            from services_graphrag import retrieve_graphrag_context
            
            # Get relevant lecture context for current query
            graphrag_data = retrieve_graphrag_context(
                session=session,
                graph_id=active_lecture_id,
                branch_id="main", # Default to main if not specified
                question=query,
                community_k=3
            )
            
            context_text = graphrag_data.get("context_text", "")
            if context_text:
                context["lecture_context"] = context_text
                logger.debug(f"Loaded GraphRAG context for lecture {active_lecture_id}")
        except Exception as e:
            logger.warning(f"Failed to load lecture context: {e}")
    
    # 3. Short-term memory: Recent chat history from Redis/Postgres
    if include_chat_history:
        try:
            from services_chat_history import get_chat_history
            
            # Get last 10 messages (Redis will be fast!)
            chat_history = get_chat_history(
                chat_id=chat_id,
                limit=10,
                user_id=user_id,
                tenant_id=tenant_id
            )
            
            context["chat_history"] = chat_history
            logger.debug(f"Loaded {len(chat_history)} chat messages")
        except Exception as e:
            logger.warning(f"Failed to load chat history: {e}")
    
    # 4. Learning State: Study context from Postgres
    if include_study_context:
        try:
            from services_graph import get_user_profile
            from services_tutor_profile import get_tutor_profile
            
            # Fetch Profiles
            user_profile = get_user_profile(session, user_id=user_id)
            tutor_profile = get_tutor_profile(session, user_id=user_id)

            context["user_identity"] = {
                "name": user_profile.name,
                "learning_goals": user_profile.learning_goals,
                "domain_background": user_profile.domain_background,
                "weak_areas": user_profile.weak_areas,
                "mastered_concepts": list(user_profile.inferred_knowledge_tags.keys())
            }
            context["tutor_persona"] = tutor_profile.model_dump()
            
            study_data = get_study_context(user_id, tenant_id)
            context["study_context"] = study_data
            logger.debug("Loaded learning state + profiles (v2)")
        except Exception as e:
            logger.warning(f"Failed to load study context or profiles: {e}")

    # 5. Cross-surface recent topics — what the user was discussing on OTHER screens.
    #    Excluded: the current chat_id so we don't double-count the current convo.
    if include_recent_topics:
        try:
            recent = get_recent_cross_surface_topics(
                user_id=user_id,
                tenant_id=tenant_id,
                exclude_chat_id=chat_id,
                limit=6,
            )
            if recent:
                context["recent_topics"] = recent
                logger.debug(f"Loaded {len(recent.splitlines())} cross-surface topic lines")
        except Exception as e:
            logger.warning(f"Failed to load cross-surface topics: {e}")

    return context


def get_study_context(user_id: str, tenant_id: str) -> Dict[str, Any]:
    """
    Fetch user's current learning state from Postgres.
    
    Includes:
    - Task difficulty levels
    - Gap concepts (last 5 unique)
    - Performance averages
    """
    pool = _get_pg_pool()
    if not pool:
        return {}
        
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # 1. Get Difficulty Levels
            cur.execute("""
                SELECT task_type, difficulty_level 
                FROM user_difficulty_levels 
                WHERE user_id = %s AND tenant_id = %s
            """, (user_id, tenant_id))
            difficulty = {row["task_type"]: row["difficulty_level"] for row in cur.fetchall()}
            
            # 2. Get Performance Averages
            cur.execute("""
                SELECT task_type, avg_score, attempt_count 
                FROM user_performance_cache 
                WHERE user_id = %s AND tenant_id = %s
            """, (user_id, tenant_id))
            performance = cur.fetchall()
            
            # 3. Get Recent Gap Concepts (from last 10 attempts)
            cur.execute("""
                SELECT sa.gap_concepts 
                FROM study_attempts sa
                JOIN study_tasks st ON sa.task_id = st.id
                JOIN study_sessions ss ON st.session_id = ss.id
                WHERE ss.user_id = %s AND ss.tenant_id = %s
                ORDER BY sa.created_at DESC
                LIMIT 10
            """, (user_id, tenant_id))
            
            gap_rows = cur.fetchall()
            gaps = []
            seen_gaps = set()
            for row in gap_rows:
                row_gaps = row.get("gap_concepts", [])
                if isinstance(row_gaps, str):
                    try: row_gaps = json.loads(row_gaps)
                    except: row_gaps = []
                
                for g in row_gaps:
                    if g not in seen_gaps:
                        gaps.append(g)
                        seen_gaps.add(g)
            
            return {
                "difficulty": difficulty,
                "performance": performance,
                "gap_concepts": gaps[:5] # Top 5 unique recent gaps
            }
    except Exception as e:
        logger.error(f"Error fetching study context: {e}")
        return {}
    finally:
        pool.putconn(conn)


def get_recent_cross_surface_topics(
    user_id: str,
    tenant_id: str,
    exclude_chat_id: str,
    limit: int = 6,
) -> str:
    """
    Fetch the most recent user messages across ALL of the user's chat sessions
    (not just the current one), to give every surface ambient awareness of what
    was discussed elsewhere.

    Returns a short plain-text summary like:
        "Recent topics from your other conversations:
        - [Explorer chat] What is backpropagation?
        - [Lecture Studio] How does attention work in transformers?"

    Excluded: the current chat_id so we don't double-count the active convo.
    Excluded: assistant messages (only user questions are taken as topic signals).
    """
    pool = _get_pg_pool()
    if not pool:
        return ""

    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT content, chat_id, created_at
                FROM chat_messages
                WHERE user_id = %s
                  AND tenant_id = %s
                  AND chat_id != %s
                  AND role = 'user'
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (user_id, tenant_id, exclude_chat_id, limit),
            )
            rows = cur.fetchall()
    except Exception as e:
        logger.warning(f"[memory_orchestrator] cross-surface topic fetch failed: {e}")
        return ""
    finally:
        pool.putconn(conn)

    if not rows:
        return ""

    lines = []
    for row in rows:
        content = (row["content"] or "").strip()
        if not content:
            continue
        # Truncate long messages to a topic-length snippet
        snippet = content[:120].rstrip()
        if len(content) > 120:
            snippet += "..."
        lines.append(f"- {snippet}")

    if not lines:
        return ""

    return "Recent topics from your other conversations:\n" + "\n".join(lines)


def format_lecture_context(lecture_blocks: List[Dict]) -> str:
    """
    Format lecture blocks into readable context.
    
    Args:
        lecture_blocks: List of lecture blocks from Qdrant
    
    Returns:
        Formatted string for LLM context
    """
    if not lecture_blocks:
        return ""
    
    sections = []
    for block in lecture_blocks:
        content = block.get("content", "")
        metadata = block.get("metadata", {})
        
        # Add source information if available
        source_info = ""
        if "lecture_title" in metadata:
            source_info = f"From: {metadata['lecture_title']}"
        
        section = f"{content}"
        if source_info:
            section = f"{source_info}\n{section}"
        
        sections.append(section)
    
    return "\n\n---\n\n".join(sections)


def build_system_prompt_with_memory(
    base_prompt: str,
    context: Dict[str, str],
    include_sections: Optional[List[str]] = None
) -> str:
    """
    Build system prompt with memory context.
    
    Args:
        base_prompt: Base system prompt
        context: Context from get_unified_context
        include_sections: Optional list of sections to include
            Options: ["user_facts", "lecture_context", "chat_history"]
    
    Returns:
        Enhanced system prompt with memory context
    """
    if include_sections is None:
        include_sections = ["user_facts", "lecture_context", "study_context", "recent_topics"]
    
    memory_sections = []
    
    # Add user facts
    if "user_facts" in include_sections and context.get("user_facts"):
        memory_sections.append(f"""
## About This User
{context["user_facts"]}
""")
    
    # Add lecture context
    if "lecture_context" in include_sections and context.get("lecture_context"):
        memory_sections.append(f"""
## Current Study Material
{context["lecture_context"]}
""")

    # Add cross-surface recent topics
    if "recent_topics" in include_sections and context.get("recent_topics"):
        memory_sections.append(f"""
## Recent Activity (other conversations)
{context["recent_topics"]}
Use this as ambient awareness only — do not repeat or summarise these back to the user unless directly relevant.
""")
    
    # Add study context (Adaptive Learning)
    if "study_context" in include_sections and context.get("study_context"):
        sc = context["study_context"]
        gaps = ", ".join(sc.get("gap_concepts", []))
        
        study_instructions = f"""
## Learning Progress & Active Learning
- **Identified Gaps**: {gaps if gaps else "None yet"}
- **Difficulty Levels**: {json.dumps(sc.get("difficulty", {}))}

**ACTIVE LEARNING INSTRUCTIONS**:
1. **Monitor Goals/Gaps**: If the user mentions a gap or goal, update your approach.
2. **Proactive Probing**: If the user's Mastery/Performance is high on a topic, challenge them with a [STUDY_TASK].
3. **Format**: When issuing a task, use the tag `[STUDY_TASK: task_type]` followed by the prompt.
4. **Scaffolding**: If they have many 'Identified Gaps', be more supportive and provide hints.
"""
        memory_sections.append(study_instructions)

    
    # Add Learner Identity
    if context.get("user_identity"):
        ui = context["user_identity"]
        identity_sections = []
        if ui.get("learning_goals"): identity_sections.append(f"- Goals: {ui['learning_goals']}")
        if ui.get("domain_background"): identity_sections.append(f"- Background: {ui['domain_background']}")
        if ui.get("mastered_concepts"): identity_sections.append(f"- Mastered: {', '.join(ui['mastered_concepts'])}")
        
        if identity_sections:
            memory_sections.append("## Learner Identity\n" + "\n".join(identity_sections))

    # Add Tutor Persona v2
    if context.get("tutor_persona"):
        tp = context["tutor_persona"]
        if tp.get("custom_instructions"):
            memory_sections.append(f"## AI Tutor Persona (Custom Overwrite)\n{tp['custom_instructions']}")
        else:
            persona_desc = "\n".join([
                f"- Comprehension: {tp.get('comprehension_level', 'intermediate')}",
                f"- Tone: {tp.get('tone', 'balanced')}",
                f"- Pacing: {tp.get('pacing', 'moderate')}",
                f"- Turn-taking: {tp.get('turn_taking', 'dialogic')}",
                f"- Verbosity: {tp.get('response_length', 'balanced')}",
                f"- Behavior: {'Direct feedback, no glaze' if tp.get('no_glazing') else 'Supportive guide'}",
            ])
            memory_sections.append(f"## AI Tutor Persona\n{persona_desc}")
    
    # Combine
    if memory_sections:
        memory_context = "\n".join(memory_sections)
        # Ensure base_prompt doesn't already contain these sections or handle merging
        return f"{base_prompt}\n\n{memory_context}"
    
    return base_prompt


def get_active_lecture_id(user_id: str, tenant_id: str, session) -> Optional[str]:
    """
    Get the currently active lecture for a user.
    
    This could be based on:
    - Active study session
    - Most recently accessed lecture
    - User preference
    
    Args:
        user_id: User identifier
        tenant_id: Tenant identifier
        session: Neo4j session
    
    Returns:
        Lecture ID if active, None otherwise
    """
    try:
        # Check for active study session
        query = """
        MATCH (u:User {user_id: $user_id, tenant_id: $tenant_id})-[:IN_SESSION]->(s:StudySession)
        WHERE s.ended_at IS NULL
        RETURN s.lecture_id AS lecture_id
        LIMIT 1
        """
        
        result = session.run(query, user_id=user_id, tenant_id=tenant_id).single()
        if result and result["lecture_id"]:
            return result["lecture_id"]
        
        # Fallback: Get most recently accessed lecture
        query = """
        MATCH (u:User {user_id: $user_id, tenant_id: $tenant_id})-[:ACCESSED]->(l:Lecture)
        RETURN l.lecture_id AS lecture_id
        ORDER BY l.last_accessed DESC
        LIMIT 1
        """
        
        result = session.run(query, user_id=user_id, tenant_id=tenant_id).single()
        if result and result["lecture_id"]:
            return result["lecture_id"]
        
        return None
        
    except Exception as e:
        logger.warning(f"Failed to get active lecture: {e}")
        return None
