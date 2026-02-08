"""
Service for generating Multiple Choice Questions (MCQs) for a topic.
"""
import logging
import json
import uuid
import asyncio
from typing import Dict, Any, List, Optional
from neo4j import Session

from services_web_search import search_and_fetch
from prompts_mcq import MCQ_GENERATION_PROMPT
from models.study import TaskSpec, ContextPack, Excerpt
from services_task_processor import _get_llm_client

logger = logging.getLogger("brain_web")

async def generate_mcq_for_topic(
    session: Session,
    topic: str,
    graph_id: Optional[str] = None,
    branch_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Generate an MCQ for a given topic using web search and LLM synthesis.
    
    Args:
        session: Neo4j session
        topic: The topic to generate a question for
        graph_id: Optional graph scoping
        branch_id: Optional branch scoping
        
    Returns:
        A TaskSpec object containing the generated MCQ.
    """
    logger.info(f"Generating MCQ for topic: {topic}")
    
    # 1. Search and Fetch Context
    # We use breadth=2 for a good balance of speed and variety
    search_result = await search_and_fetch(
        query=f"technical overview of {topic}",
        num_results=2,
        rerank=True,
        max_content_length=10000,
    )
    
    results = search_result.get("results", [])
    if not results:
        logger.warning(f"No search results found for topic: {topic}")
        # Fallback: try search without "technical overview"
        search_result = await search_and_fetch(
            query=topic,
            num_results=1,
            max_content_length=10000,
        )
        results = search_result.get("results", [])
        
    if not results:
        raise Exception(f"Could not find enough information on the web for '{topic}' to generate a quality question.")

    # 2. Build Context Pack and Excerpts
    excerpts = []
    full_context_text = ""
    
    for i, res in enumerate(results):
        fetched = res.get("fetched_content", {})
        content = fetched.get("content", "")
        if not content:
            continue
            
        url = res.get("search_result", {}).get("url", "")
        title = fetched.get("title") or res.get("search_result", {}).get("title", f"Source {i+1}")
        
        quality_score = fetched.get("quality_score", 0.8)
        if isinstance(quality_score, dict):
            quality_score = quality_score.get("overall", 0.8)
        try:
            quality_score = float(quality_score)
        except (TypeError, ValueError):
            quality_score = 0.8
            
        excerpts.append(Excerpt(
            excerpt_id=f"mcq_source_{i}_{uuid.uuid4().hex[:4]}",
            content=content[:2000], # Include a snippet for the context pack
            source_type="artifact",
            source_id=url, # Use URL as source ID for web artifacts
            relevance_score=quality_score,
            metadata={"title": title, "url": url}
        ))
        
        full_context_text += f"\n--- Source: {title} ---\n{content}\n"

    # 3. Call LLM to Generate MCQ
    client = _get_llm_client()
    if not client:
        raise Exception("OpenAI client not configured. Cannot generate MCQ.")
        
    prompt = MCQ_GENERATION_PROMPT.format(
        context=full_context_text[:12000], # Cap context for token limits
        topic=topic
    )
    
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini", # Use mini for fast generation
            messages=[
                {"role": "system", "content": "You are a specialized MCQ generation engine. Return only JSON."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.7,
        )
        
        mcq_data = json.loads(response.choices[0].message.content)
        
        # 4. Construct TaskSpec
        task_id = f"TASK_MCQ_{uuid.uuid4().hex[:8].upper()}"
        
        # The rubric_json stores the MCQ choices and feedback
        rubric_json = {
            "question": mcq_data.get("question"),
            "options": mcq_data.get("options"),
            "correct_index": mcq_data.get("correct_index"),
            "explanations": mcq_data.get("explanations"),
        }
        
        context_pack = ContextPack(
            excerpts=excerpts,
            concepts=[mcq_data.get("concept_id")] if mcq_data.get("concept_id") else []
        )
        
        task_spec = TaskSpec(
            task_id=task_id,
            task_type="multiple_choice",
            prompt=mcq_data.get("question", f"Solve this quiz about {topic}"),
            rubric_json=rubric_json,
            context_pack=context_pack,
            compatible_modes=["explain", "typing"],
            disruption_cost=0.2
        )
        
        return task_spec.dict()
        
    except Exception as e:
        logger.error(f"Failed to generate MCQ: {e}")
        raise
