"""
Fact Extraction Service

Automatically extracts structured facts from chat conversations using LLM.
Stores facts as UserFact nodes in Neo4j for cross-session memory.
"""
import json
import logging
from typing import List, Dict, Optional
from datetime import datetime
from pydantic import BaseModel

logger = logging.getLogger("brain_web")


class ExtractedFact(BaseModel):
    """Structured fact extracted from conversation."""
    fact_type: str  # personal_info, preference, goal, confusion, mastery
    content: str
    confidence: float  # 0.0 to 1.0
    related_concepts: List[str] = []


class UserFact(BaseModel):
    """User fact stored in Neo4j."""
    fact_id: str
    user_id: str
    tenant_id: str
    fact_type: str
    content: str
    extracted_from: str  # chat_id
    confidence: float
    created_at: datetime
    last_confirmed: Optional[datetime] = None


async def extract_facts_from_conversation(
    user_message: str,
    assistant_response: str,
    chat_id: str,
    user_id: str,
    tenant_id: str,
    session
) -> List[ExtractedFact]:
    """
    Extract structured facts from a conversation turn using LLM.
    
    Args:
        user_message: User's message
        assistant_response: Assistant's response
        chat_id: Conversation identifier
        user_id: User identifier
        tenant_id: Tenant identifier
        session: Neo4j session
    
    Returns:
        List of extracted facts
    """
    try:
        from services_model_router import model_router, TASK_CHAT_FAST
        
        # Prompt for fact extraction
        extraction_prompt = f"""
Extract any personal facts, preferences, goals, or learning insights from this conversation.

User: {user_message}
Assistant: {assistant_response}

Return ONLY a JSON array of facts. Each fact should have:
- fact_type: one of [personal_info, preference, goal, confusion, mastery]
- content: the fact as a complete sentence
- confidence: 0.0 to 1.0 (how certain you are)
- related_concepts: list of concept names mentioned (if any)

Examples:
- {{"fact_type": "personal_info", "content": "User's name is Alex", "confidence": 0.95, "related_concepts": []}}
- {{"fact_type": "preference", "content": "User prefers visual learning", "confidence": 0.8, "related_concepts": []}}
- {{"fact_type": "goal", "content": "User wants to learn neural networks", "confidence": 0.9, "related_concepts": ["Neural Networks"]}}
- {{"fact_type": "confusion", "content": "User is confused about backpropagation", "confidence": 0.85, "related_concepts": ["Backpropagation"]}}
- {{"fact_type": "mastery", "content": "User understands linear regression", "confidence": 0.9, "related_concepts": ["Linear Regression"]}}

Only extract facts that are:
1. Explicitly stated or strongly implied
2. About the user (not general knowledge)
3. Likely to be useful in future conversations

Return empty array [] if no facts found.
"""
        
        # Call LLM with JSON mode
        content = model_router.completion(
            task_type=TASK_CHAT_FAST,
            messages=[
                {"role": "system", "content": "You are a fact extraction assistant. Return only valid JSON."},
                {"role": "user", "content": extraction_prompt}
            ],
            stream=False,
            response_format={"type": "json_object"}
        )
        
        # Handle both array and object responses
        if not content:
            return []
        
        try:
            parsed = json.loads(content)
            if isinstance(parsed, dict):
                # LLM might wrap in {"facts": [...]}
                facts_data = parsed.get("facts", parsed.get("result", []))
                # If still not found, check if the whole dict IS the fact (single fact result)
                if not facts_data and "fact_type" in parsed:
                    facts_data = [parsed]
            else:
                facts_data = parsed
        except json.JSONDecodeError:
            logger.warning(f"Failed to parse fact extraction response: {content}")
            return []
        
        # Convert to ExtractedFact objects
        facts = []
        for fact_data in facts_data:
            try:
                fact = ExtractedFact(**fact_data)
                facts.append(fact)
            except Exception as e:
                logger.warning(f"Invalid fact format: {fact_data}, error: {e}")
                continue
        
        # Store facts in Neo4j
        if facts:
            await store_facts_in_neo4j(
                facts=facts,
                user_id=user_id,
                tenant_id=tenant_id,
                chat_id=chat_id,
                session=session
            )
        
        logger.info(f"Extracted {len(facts)} facts from conversation")
        return facts
        
    except Exception as e:
        logger.error(f"Fact extraction failed: {e}")
        return []


async def store_facts_in_neo4j(
    facts: List[ExtractedFact],
    user_id: str,
    tenant_id: str,
    chat_id: str,
    session
):
    """
    Store extracted facts as UserFact nodes in Neo4j.
    
    Creates relationships to concepts if mentioned.
    """
    import uuid
    
    for fact in facts:
        fact_id = f"fact-{uuid.uuid4().hex[:12]}"
        
        # Create UserFact node
        query = """
        MERGE (u:User {user_id: $user_id, tenant_id: $tenant_id})
        CREATE (f:UserFact {
            fact_id: $fact_id,
            user_id: $user_id,
            tenant_id: $tenant_id,
            fact_type: $fact_type,
            content: $content,
            extracted_from: $chat_id,
            confidence: $confidence,
            created_at: datetime(),
            last_confirmed: datetime()
        })
        CREATE (u)-[:HAS_FACT]->(f)
        
        // Link to concepts if mentioned
        WITH f
        UNWIND $related_concepts AS concept_name
        MATCH (c:Concept {name: concept_name})
        WHERE c.tenant_id = $tenant_id OR c.tenant_id IS NULL
        MERGE (f)-[:RELATES_TO]->(c)
        
        RETURN f.fact_id AS fact_id
        """
        
        try:
            result = session.run(
                query,
                user_id=user_id,
                tenant_id=tenant_id,
                fact_id=fact_id,
                fact_type=fact.fact_type,
                content=fact.content,
                chat_id=chat_id,
                confidence=fact.confidence,
                related_concepts=fact.related_concepts or []
            )
            
            logger.info(f"Stored fact: {fact.content} (type: {fact.fact_type})")
            
        except Exception as e:
            logger.error(f"Failed to store fact in Neo4j: {e}")


def get_user_facts(
    user_id: str,
    tenant_id: str,
    session,
    fact_types: Optional[List[str]] = None,
    limit: int = 5
) -> List[Dict]:
    """
    Retrieve user facts from Neo4j.
    
    Args:
        user_id: User identifier
        tenant_id: Tenant identifier
        session: Neo4j session
        fact_types: Optional filter by fact types
        limit: Maximum number of facts to return
    
    Returns:
        List of facts ordered by confidence and recency
    """
    # Build query with optional type filter
    type_filter = ""
    if fact_types:
        type_filter = "AND f.fact_type IN $fact_types"
    
    query = f"""
    MATCH (u:User {{user_id: $user_id, tenant_id: $tenant_id}})-[:HAS_FACT]->(f:UserFact)
    WHERE f.tenant_id = $tenant_id
    {type_filter}
    RETURN f.fact_type AS fact_type,
           f.content AS content,
           f.confidence AS confidence,
           f.created_at AS created_at,
           f.last_confirmed AS last_confirmed
    ORDER BY f.confidence DESC, f.last_confirmed DESC
    LIMIT $limit
    """
    
    try:
        result = session.run(
            query,
            user_id=user_id,
            tenant_id=tenant_id,
            fact_types=fact_types or [],
            limit=limit
        )
        
        facts = []
        for record in result:
            facts.append({
                "fact_type": record["fact_type"],
                "content": record["content"],
                "confidence": record["confidence"],
                "created_at": record["created_at"],
                "last_confirmed": record["last_confirmed"]
            })
        
        return facts
        
    except Exception as e:
        logger.error(f"Failed to retrieve user facts: {e}")
        return []


def format_user_facts_for_prompt(facts: List[Dict]) -> str:
    """
    Format user facts into a string for LLM context.
    
    Groups by fact type for better readability.
    """
    if not facts:
        return "No user facts available yet."
    
    # Group by type
    grouped = {}
    for fact in facts:
        fact_type = fact["fact_type"]
        if fact_type not in grouped:
            grouped[fact_type] = []
        grouped[fact_type].append(fact["content"])
    
    # Format
    sections = []
    
    type_labels = {
        "personal_info": "Personal Information",
        "preference": "Learning Preferences",
        "goal": "Learning Goals",
        "confusion": "Areas of Confusion",
        "mastery": "Mastered Concepts"
    }
    
    for fact_type, contents in grouped.items():
        label = type_labels.get(fact_type, fact_type.replace("_", " ").title())
        section = f"**{label}:**\n" + "\n".join(f"- {c}" for c in contents)
        sections.append(section)
    
    return "\n\n".join(sections)
