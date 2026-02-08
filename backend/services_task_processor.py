"""
Task processor for background AI work.

Processes tasks queued via voice commands or UI.
Tasks are executed asynchronously and update their status.
"""
import logging
from typing import Optional, Dict, Any
from datetime import datetime

from neo4j import Session

from models import Task, TaskType, TaskStatus
from services_signals import get_task
from services_branch_explorer import get_active_graph_context
from services_graphrag import retrieve_graphrag_context
from services_retrieval_signals import enhance_retrieval_with_signals, format_signal_context

logger = logging.getLogger("brain_web")

# Lazy import OpenAI client
_client = None

def _get_llm_client():
    """Get OpenAI client, initializing if needed."""
    global _client
    if _client is None:
        from openai import OpenAI
        from config import OPENAI_API_KEY
        if OPENAI_API_KEY:
            cleaned_key = OPENAI_API_KEY.strip().strip('"').strip("'")
            if cleaned_key and cleaned_key.startswith("sk-"):
                try:
                    _client = OpenAI(api_key=cleaned_key)
                except Exception:
                    _client = None
    return _client


def process_task(session: Session, task_id: str) -> Optional[Task]:
    """
    Process a single task.
    
    This function executes the task based on its type and updates the task status.
    Should be called from a background worker.
    """
    task = get_task(session, task_id)
    if not task:
        logger.error(f"Task {task_id} not found")
        return None
    
    if task.status != TaskStatus.QUEUED:
        logger.warning(f"Task {task_id} is not in QUEUED status (current: {task.status})")
        return task
    
    # Update status to RUNNING
    started_at = int(datetime.utcnow().timestamp() * 1000)
    update_query = """
    MATCH (t:Task {task_id: $task_id})
    SET t.status = $status,
        t.started_at = $started_at
    RETURN t
    """
    session.run(update_query, task_id=task_id, status=TaskStatus.RUNNING.value, started_at=started_at)
    
    try:
        result = None
        error = None
        
        if task.task_type == TaskType.GENERATE_ANSWERS:
            result = _process_generate_answers(session, task)
        elif task.task_type == TaskType.SUMMARIZE:
            result = _process_summarize(session, task)
        elif task.task_type == TaskType.EXPLAIN:
            result = _process_explain(session, task)
        elif task.task_type == TaskType.GAP_ANALYSIS:
            result = _process_gap_analysis(session, task)
        elif task.task_type == TaskType.RETRIEVE_CONTEXT:
            result = _process_retrieve_context(session, task)
        elif task.task_type == TaskType.EXTRACT_CONCEPTS:
            result = _process_extract_concepts(session, task)
        elif task.task_type == TaskType.REBUILD_COMMUNITIES:
            result = _process_rebuild_communities(session, task)
        else:
            error = f"Unknown task type: {task.task_type}"
        
        # Update task with result
        completed_at = int(datetime.utcnow().timestamp() * 1000)
        import json
        result_json = json.dumps(result) if result else None
        
        update_result_query = """
        MATCH (t:Task {task_id: $task_id})
        SET t.status = $status,
            t.completed_at = $completed_at,
            t.result = $result,
            t.error = $error
        RETURN t
        """
        session.run(
            update_result_query,
            task_id=task_id,
            status=TaskStatus.READY.value if not error else TaskStatus.FAILED.value,
            completed_at=completed_at,
            result=result_json,
            error=error,
        )
        
        logger.info(f"Task {task_id} completed successfully")
        return get_task(session, task_id)
        
    except Exception as e:
        logger.error(f"Task {task_id} failed: {e}", exc_info=True)
        # Update task with error
        completed_at = int(datetime.utcnow().timestamp() * 1000)
        update_error_query = """
        MATCH (t:Task {task_id: $task_id})
        SET t.status = $status,
            t.completed_at = $completed_at,
            t.error = $error
        RETURN t
        """
        session.run(
            update_error_query,
            task_id=task_id,
            status=TaskStatus.FAILED.value,
            completed_at=completed_at,
            error=str(e),
        )
        return get_task(session, task_id)


def _process_generate_answers(session: Session, task: Task) -> Dict[str, Any]:
    """Generate answers to questions based on user's material."""
    question = task.params.get("question", "")
    if not question:
        return {
            "error": "No question provided in task params",
            "task_type": task.task_type.value,
        }
    
    # Retrieve context using GraphRAG with signal-aware retrieval
    try:
        context_result = retrieve_graphrag_context(
            session=session,
            graph_id=task.graph_id,
            branch_id=task.branch_id,
            question=question,
            evidence_strictness="medium",
        )
        
        # Enhance with signals
        concepts = context_result.get("concepts", [])
        signal_info = enhance_retrieval_with_signals(session, concepts)
        signal_context = format_signal_context(signal_info)
        
        # Combine context
        full_context = context_result.get("context_text", "")
        if signal_context:
            full_context += "\n\n" + signal_context
        
        # Generate answer using LLM
        client = _get_llm_client()
        if not client:
            return {
                "error": "OpenAI client not available",
                "context": full_context,
                "task_type": task.task_type.value,
            }
        
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful tutor. Answer questions using only the provided context from the user's knowledge graph. If the context doesn't contain enough information, say so clearly."
                },
                {
                    "role": "user",
                    "content": f"Question: {question}\n\nContext from knowledge graph:\n{full_context}\n\nAnswer:"
                }
            ],
            temperature=0.7,
            max_tokens=1000,
        )
        
        answer = response.choices[0].message.content
        
        return {
            "answer": answer,
            "question": question,
            "context_used": {
                "communities": len(context_result.get("communities", [])),
                "claims": len(context_result.get("claims", [])),
                "concepts": len(context_result.get("concepts", [])),
            },
            "task_type": task.task_type.value,
        }
    except Exception as e:
        logger.error(f"Error generating answers: {e}", exc_info=True)
        return {
            "error": str(e),
            "task_type": task.task_type.value,
        }


def _process_summarize(session: Session, task: Task) -> Dict[str, Any]:
    """Summarize highlighted or selected content."""
    text = task.params.get("text", "")
    block_id = task.params.get("block_id") or task.block_id
    concept_id = task.params.get("concept_id") or task.concept_id
    
    if not text and not block_id and not concept_id:
        return {
            "error": "No text, block_id, or concept_id provided",
            "task_type": task.task_type.value,
        }
    
    # If block_id or concept_id provided, retrieve content from graph
    if not text and (block_id or concept_id):
        # TODO: Fetch block or concept content from graph
        # For now, use retrieval as fallback
        query = f"Summarize content related to block {block_id}" if block_id else f"Summarize concept {concept_id}"
        context_result = retrieve_graphrag_context(
            session=session,
            graph_id=task.graph_id,
            branch_id=task.branch_id,
            question=query,
            evidence_strictness="medium",
        )
        text = context_result.get("context_text", "")
    
    if not text:
        return {
            "error": "No content to summarize",
            "task_type": task.task_type.value,
        }
    
    # Generate summary using LLM
    client = _get_llm_client()
    if not client:
        return {
            "error": "OpenAI client not available",
            "task_type": task.task_type.value,
        }
    
    try:
        # Truncate if too long
        max_chars = 8000
        if len(text) > max_chars:
            text = text[:max_chars] + "..."
        
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant that creates concise summaries. Focus on key concepts and main points."
                },
                {
                    "role": "user",
                    "content": f"Summarize this content:\n\n{text}"
                }
            ],
            temperature=0.3,
            max_tokens=500,
        )
        
        summary = response.choices[0].message.content
        
        return {
            "summary": summary,
            "original_length": len(text),
            "task_type": task.task_type.value,
        }
    except Exception as e:
        logger.error(f"Error summarizing: {e}", exc_info=True)
        return {
            "error": str(e),
            "task_type": task.task_type.value,
        }


def _process_explain(session: Session, task: Task) -> Dict[str, Any]:
    """Explain concept using only user's material."""
    concept_id = task.params.get("concept_id") or task.concept_id
    question = task.params.get("question", "")
    
    if not concept_id and not question:
        return {
            "error": "No concept_id or question provided",
            "task_type": task.task_type.value,
        }
    
    # Retrieve context for the concept/question
    query = question if question else f"Explain concept {concept_id}"
    
    try:
        context_result = retrieve_graphrag_context(
            session=session,
            graph_id=task.graph_id,
            branch_id=task.branch_id,
            question=query,
            evidence_strictness="medium",
        )
        
        # Enhance with signals (user's reflections, emphasis, etc.)
        concepts = context_result.get("concepts", [])
        signal_info = enhance_retrieval_with_signals(session, concepts)
        signal_context = format_signal_context(signal_info)
        
        # Combine context
        full_context = context_result.get("context_text", "")
        if signal_context:
            full_context += "\n\n" + signal_context
        
        # Generate explanation using LLM
        client = _get_llm_client()
        if not client:
            return {
                "error": "OpenAI client not available",
                "context": full_context,
                "task_type": task.task_type.value,
            }
        
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful tutor. Explain concepts using only the provided context from the user's knowledge graph. Use the user's own words and reflections when available."
                },
                {
                    "role": "user",
                    "content": f"Explain: {query}\n\nContext from knowledge graph:\n{full_context}\n\nExplanation:"
                }
            ],
            temperature=0.7,
            max_tokens=1000,
        )
        
        explanation = response.choices[0].message.content
        
        return {
            "explanation": explanation,
            "concept_id": concept_id,
            "context_used": {
                "communities": len(context_result.get("communities", [])),
                "claims": len(context_result.get("claims", [])),
                "concepts": len(context_result.get("concepts", [])),
            },
            "task_type": task.task_type.value,
        }
    except Exception as e:
        logger.error(f"Error explaining: {e}", exc_info=True)
        return {
            "error": str(e),
            "task_type": task.task_type.value,
        }


def _process_gap_analysis(session: Session, task: Task) -> Dict[str, Any]:
    """Analyze gaps between required knowledge and demonstrated understanding."""
    # TODO: Implement gap analysis for homework/exams
    # Compare required concepts vs user's demonstrated understanding
    return {
        "message": "Gap analysis not yet implemented",
        "task_type": task.task_type.value,
    }


def _process_retrieve_context(session: Session, task: Task) -> Dict[str, Any]:
    """Retrieve relevant context for a question or concept."""
    question = task.params.get("question", "")
    concept_id = task.params.get("concept_id") or task.concept_id
    
    if not question and not concept_id:
        return {
            "error": "No question or concept_id provided",
            "task_type": task.task_type.value,
        }
    
    query = question if question else f"Context for concept {concept_id}"
    
    try:
        # Retrieve context using GraphRAG
        context_result = retrieve_graphrag_context(
            session=session,
            graph_id=task.graph_id,
            branch_id=task.branch_id,
            question=query,
            evidence_strictness=task.params.get("evidence_strictness", "medium"),
        )
        
        # Enhance with signals
        concepts = context_result.get("concepts", [])
        signal_info = enhance_retrieval_with_signals(session, concepts)
        signal_context = format_signal_context(signal_info)
        
        # Combine context
        full_context = context_result.get("context_text", "")
        if signal_context:
            full_context += "\n\n" + signal_context
        
        return {
            "context": full_context,
            "context_text": full_context,
            "communities": context_result.get("communities", []),
            "claims": context_result.get("claims", []),
            "concepts": context_result.get("concepts", []),
            "edges": context_result.get("edges", []),
            "signal_info": signal_info,
            "task_type": task.task_type.value,
        }
    except Exception as e:
        logger.error(f"Error retrieving context: {e}", exc_info=True)
        return {
            "error": str(e),
            "task_type": task.task_type.value,
        }


def _process_extract_concepts(session: Session, task: Task) -> Dict[str, Any]:
    """Extract concepts from uploaded content."""
    # TODO: Use existing concept extraction logic
    return {
        "message": "Concept extraction not yet implemented",
        "task_type": task.task_type.value,
    }


def _process_rebuild_communities(session: Session, task: Task) -> Dict[str, Any]:
    """Rebuild communities for the graph."""
    try:
        from services_community_build import trigger_community_build
        
        resolution = task.params.get("resolution", 0.6)
        
        logger.info(f"Starting community rebuild task for graph {task.graph_id}")
        
        success = trigger_community_build(
            session=session,
            graph_id=task.graph_id,
            branch_id=task.branch_id,
            resolution=float(resolution),
        )
        
        if success:
            return {
                "message": "Community detection completed successfully",
                "graph_id": task.graph_id,
                "task_type": task.task_type.value,
            }
        else:
            raise Exception("Community build reported failure (check server logs for details)")
            
    except Exception as e:
        logger.error(f"Error rebuilding communities: {e}", exc_info=True)
        # Re-raise to be caught by main loop and mark task as FAILED
        raise e
