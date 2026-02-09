from fastapi import APIRouter, Depends, BackgroundTasks
from pydantic import BaseModel
import hashlib
from models import (
    AIChatRequest, AIChatResponse,
    SemanticSearchRequest, SemanticSearchResponse,
    SemanticSearchCommunitiesRequest, SemanticSearchCommunitiesResponse,
    GraphRAGContextRequest, GraphRAGContextResponse,
)
from db_neo4j import get_neo4j_session
from services_search import semantic_search_nodes
from services_graphrag import semantic_search_communities, retrieve_graphrag_context
from services_graph import get_evidence_subgraph
from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context
from cache_utils import get_cached, set_cached
from typing import List, Optional
from auth import require_auth
from fastapi.responses import StreamingResponse
from openai import OpenAI
from config import OPENAI_API_KEY
import json
import logging

logger = logging.getLogger("brain_web")

router = APIRouter(prefix="/ai", tags=["ai"])


class EvidenceSubgraphRequest(BaseModel):
    graph_id: str
    claim_ids: List[str]
    limit_nodes: int = 10
    limit_edges: int = 15


@router.post("/chat", response_model=AIChatResponse)
def ai_chat(payload: AIChatRequest, auth: dict = Depends(require_auth)):
    """
    Stub endpoint for AI chat.

    Later, this will:
      - Call LLM with tools for graph operations
      - Execute operations
      - Return summary + maybe diff
    """
    # For now, just echo back
    return AIChatResponse(reply=f"You said: {payload.message}")


    return StreamingResponse(generate_stream(), media_type="text/event-stream")


@router.post("/chat/stream")
async def chat_stream_endpoint(
    payload: AIChatRequest,
    background_tasks: BackgroundTasks,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """
    Streaming AI chat endpoint using Server-Sent Events (SSE).
    """
    # Trigger notes digest update in background
    if payload.chat_id:
        try:
            from services_notes_digest import update_notes_digest
            # Wrap in error handler to prevent constraint violations from blocking chat
            def safe_update_notes_digest():
                try:
                    update_notes_digest(
                        chat_id=payload.chat_id,
                        trigger_source="chat_message"
                    )
                except Exception as e:
                    # Log but don't fail - concept extraction errors shouldn't block chat
                    error_msg = str(e)
                    if "ConstraintValidationFailed" in error_msg or "already exists" in error_msg:
                        logger.debug(f"Skipping duplicate concept in notes digest: {error_msg}")
                    else:
                        logger.error(f"Notes digest update failed: {e}")
            
            background_tasks.add_task(safe_update_notes_digest)
        except Exception as e:
            logger.error(f"Failed to queue notes digest update: {e}")

    async def generate_stream():
        try:
            if not OPENAI_API_KEY:
                error_msg = {"type": "error", "content": "OpenAI API Key not missing"}
                yield f"data: {json.dumps(error_msg)}\n\n"
                return

            # 0. Semantic Cache (Redis Hot Path): short-circuit if near-duplicate question exists.
            # NOTE: Cache is strictly scoped by (tenant_id, user_id) to prevent cross-user leakage.
            cache_hit = None
            query_embedding = None
            try:
                from services_semantic_cache import lookup_question

                tenant_id_scoped = auth.get("tenant_id")
                user_id_scoped = auth.get("user_id")
                if tenant_id_scoped and user_id_scoped:
                    cache_hit, query_embedding = lookup_question(
                        tenant_id=str(tenant_id_scoped),
                        user_id=str(user_id_scoped),
                        question=payload.message,
                    )
            except Exception as e:
                logger.debug(f"Semantic cache lookup skipped/failed: {e}")
                cache_hit = None
                query_embedding = None

            # If cache hit, return immediately (skip memory orchestration + LLM).
            if cache_hit and isinstance(cache_hit.get("answer"), str):
                full_response = str(cache_hit["answer"])
                data = {
                    "type": "chunk",
                    "content": full_response,
                    "cache": {"hit": True, "distance": cache_hit.get("distance")},
                }
                yield f"data: {json.dumps(data)}\n\n"

                # Save messages to history (best-effort) to keep continuity.
                if payload.chat_id:
                    try:
                        from services_chat_history import save_message

                        save_message(
                            chat_id=payload.chat_id,
                            user_id=auth.get("user_id", "unknown"),
                            tenant_id=auth.get("tenant_id", "default"),
                            role="user",
                            content=payload.message,
                        )
                        save_message(
                            chat_id=payload.chat_id,
                            user_id=auth.get("user_id", "unknown"),
                            tenant_id=auth.get("tenant_id", "default"),
                            role="assistant",
                            content=full_response,
                        )

                        # Extract facts in background for cross-session memory
                        try:
                            from services_fact_extractor import extract_facts_from_conversation

                            background_tasks.add_task(
                                extract_facts_from_conversation,
                                user_message=payload.message,
                                assistant_response=full_response,
                                chat_id=payload.chat_id,
                                user_id=auth.get("user_id", "unknown"),
                                tenant_id=auth.get("tenant_id", "default"),
                                session=session,
                            )
                        except Exception as e:
                            logger.warning(f"Failed to queue fact extraction: {e}")
                    except Exception as e:
                        logger.warning(f"Failed to save chat history: {e}")

                yield f"data: {json.dumps({'type': 'done'})}\n\n"
                return

            # Fetch Tutor Profile for persona customization
            try:
                from services_tutor_profile import get_tutor_profile as get_tutor_profile_svc
                # We need a user_id here. auth dict has it.
                user_id = auth.get("user_id", "default")
                tutor_profile = get_tutor_profile_svc(session, user_id=user_id)
                
                # Check if user has custom instructions
                if tutor_profile.custom_instructions:
                    # Use custom instructions directly
                    profile_instruction = f"Tutor Persona:\n{tutor_profile.custom_instructions}"
                else:
                    # Fall back to predefined mode mappings
                    voice_cards = {
                        "neutral": "Tone: professional and clear.",
                        "friendly": "Tone: warm, friendly, and supportive.",
                        "direct": "Tone: straightforward and no-nonsense.",
                        "playful": "Tone: light and engaging.",
                    }
                    audience_cards = {
                        "default": "Audience: default learner.",
                        "eli5": "Audience: ELI5 (simple, concrete, define jargon).",
                        "ceo_pitch": "Audience: CEO pitch (executive summary, tradeoffs).",
                        "recruiter_interview": "Audience: recruiter interview (clear definition + practical example).",
                        "technical": "Audience: technical (precise terms).",
                    }
                    
                    # Build instruction from predefined modes
                    voice_instruction = voice_cards.get(str(tutor_profile.voice_id), f"Tone: {tutor_profile.voice_id}")
                    audience_instruction = audience_cards.get(str(tutor_profile.audience_mode), f"Audience: {tutor_profile.audience_mode}")
                    correctness_instruction = "- Correctness: be direct; correct errors if found." if tutor_profile.no_glazing else "- Correctness: be supportive."
                    
                    profile_instruction = "\n".join([
                        "Tutor Profile:",
                        f"- {voice_instruction}",
                        f"- {audience_instruction}",
                        correctness_instruction,
                    ])
            except Exception as e:
                logger.warning(f"Failed to load tutor profile for chat: {e}")
                profile_instruction = ""

            # 1. Load Unified Memory Context (all three tiers)
            unified_context = {}
            try:
                from services_memory_orchestrator import get_unified_context, get_active_lecture_id
                
                # Get active lecture if any
                active_lecture_id = get_active_lecture_id(
                    user_id=auth.get("user_id", "unknown"),
                    tenant_id=auth.get("tenant_id", "default"),
                    session=session
                )
                
                # Load all memory tiers
                unified_context = get_unified_context(
                    user_id=auth.get("user_id", "unknown"),
                    tenant_id=auth.get("tenant_id", "default"),
                    chat_id=payload.chat_id or "default",
                    query=payload.message,
                    session=session,
                    active_lecture_id=active_lecture_id,
                    include_chat_history=True,
                    include_lecture_context=True,
                    include_user_facts=True
                )
                
                logger.info(f"Loaded unified context: {len(unified_context.get('chat_history', []))} messages, "
                           f"user_facts={'yes' if unified_context.get('user_facts') else 'no'}, "
                           f"lecture_context={'yes' if unified_context.get('lecture_context') else 'no'}")
            except Exception as e:
                logger.warning(f"Failed to load unified context: {e}")
                unified_context = {"user_facts": "", "lecture_context": "", "chat_history": []}

            # 2. Fetch Recent User Activity (Handwriting/Voice)
            recent_activity = ""
            try:
                from services_signals import get_recent_user_activity
                recent_activity = get_recent_user_activity(session)
            except Exception as e:
                logger.warning(f"Failed to fetch recent activity: {e}")
                recent_activity = ""

            # 2.5 Resolve Tutor Profile Instructions (moved from below for scope)
            response_mode_instruction = ""
            question_policy_instruction = ""
            try:
                if tutor_profile.response_mode == "compact":
                    response_mode_instruction = "**Response Length**: Keep responses VERY BRIEF (2-3 sentences maximum). Be concise and to the point."
                elif tutor_profile.response_mode == "hint":
                    response_mode_instruction = "**Response Length**: Provide hints only, not full answers. Guide the user to discover the solution themselves."
                elif tutor_profile.response_mode == "deep":
                    response_mode_instruction = "**Response Length**: Provide COMPREHENSIVE, DETAILED explanations. Include examples, context, and thorough coverage of the topic."
                else:  # normal
                    response_mode_instruction = "**Response Length**: Provide balanced responses (4-6 sentences)."
                
                if tutor_profile.ask_question_policy == "never":
                    question_policy_instruction = "**CRITICAL**: NEVER ask questions. Only provide statements and explanations."
                elif tutor_profile.ask_question_policy == "at_most_one":
                    question_policy_instruction = "**Question Policy**: You may ask at most ONE follow-up question per response."
                else:  # ok
                    question_policy_instruction = "**Question Policy**: You may ask questions to engage the user."
            except:
                pass
                
            # Detect if user is responding to a task
            task_evaluation_feedback = ""
            try:
                # Check chat history for last assistant message
                chat_history = unified_context.get("chat_history", [])
                if chat_history:
                    last_ast = next((m for m in reversed(chat_history) if m["role"] == "assistant"), None)
                    if last_ast and "[STUDY_TASK:" in last_ast["content"]:
                        logger.info("Detected student response to a study task. Evaluating...")
                        # Heuristic: LLM in next turn will evaluate based on prompt instructions
                        # but we can also explicitly signal it.
                        task_evaluation_feedback = "\n**SYSTEM NOTE**: The student is answering a previous STUDY_TASK. Evaluate their response strictly according to correct principles before continuing."
            except Exception as e:
                logger.warning(f"Failed task detection: {e}")

            # 3. Construct System Prompt using Orchestrator
            try:
                from services_memory_orchestrator import build_system_prompt_with_memory
                
                # Base prompt with profile instructions
                base_prompt = f"""
                You are a helpful assistant for Brain Web.
                
                {recent_activity}
                
                ## Tutor Persona
                {profile_instruction}
                
                {response_mode_instruction}
                {question_policy_instruction}
                """
                
                system_msg = build_system_prompt_with_memory(
                    base_prompt=base_prompt.strip(),
                    context=unified_context,
                    include_sections=["user_facts", "lecture_context", "study_context"]
                )
                
                if task_evaluation_feedback:
                    system_msg += task_evaluation_feedback
            except Exception as e:
                logger.warning(f"Failed to build memory prompt: {e}")
                system_msg = "You are a helpful assistant for Brain Web."

            # 4. Use Model Router with chat history
            chat_history = unified_context.get("chat_history", [])

            # 5. Use Model Router
            from services_model_router import model_router, TASK_CHAT_FAST
            
            # Build messages array with history
            messages = [
                {"role": "system", "content": system_msg.strip()},
                *chat_history,  # Include conversation history
                {"role": "user", "content": payload.message}
            ]
            
            stream = model_router.completion(
                task_type=TASK_CHAT_FAST,
                messages=messages,
                stream=True
            )
        
            # Accumulate assistant response for saving
            full_response = ""
            
            for chunk in stream:
                content = chunk.choices[0].delta.content
                if content:
                    full_response += content
                    data = {"type": "chunk", "content": content, "cache": {"hit": False}}
                    yield f"data: {json.dumps(data)}\n\n"

            # Store response in semantic cache (best-effort)
            try:
                from services_semantic_cache import store
                tenant_id_scoped = auth.get("tenant_id")
                user_id_scoped = auth.get("user_id")
                if tenant_id_scoped and user_id_scoped and query_embedding and full_response:
                    store(
                        tenant_id=str(tenant_id_scoped),
                        user_id=str(user_id_scoped),
                        question=payload.message,
                        answer=full_response,
                        question_embedding=query_embedding,
                        extra={"task_type": TASK_CHAT_FAST},
                    )
            except Exception as e:
                logger.debug(f"Semantic cache store skipped/failed: {e}")
            
            # Save messages to history
            if payload.chat_id:
                try:
                    from services_chat_history import save_message
                    
                    # Save user message
                    save_message(
                        chat_id=payload.chat_id,
                        user_id=auth.get("user_id", "unknown"),
                        tenant_id=auth.get("tenant_id", "default"),
                        role="user",
                        content=payload.message
                    )
                    
                    # Save assistant response
                    if full_response:
                        save_message(
                            chat_id=payload.chat_id,
                            user_id=auth.get("user_id", "unknown"),
                            tenant_id=auth.get("tenant_id", "default"),
                            role="assistant",
                            content=full_response
                        )
                        
                        # Extract facts in background for cross-session memory
                        try:
                            from services_fact_extractor import extract_facts_from_conversation
                            background_tasks.add_task(
                                extract_facts_from_conversation,
                                user_message=payload.message,
                                assistant_response=full_response,
                                chat_id=payload.chat_id,
                                user_id=auth.get("user_id", "unknown"),
                                tenant_id=auth.get("tenant_id", "default"),
                                session=session
                            )
                        except Exception as e:
                            logger.warning(f"Failed to queue fact extraction: {e}")
                            
                except Exception as e:
                    logger.warning(f"Failed to save chat history: {e}")
            
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            
        except Exception as e:
            logger.error(f"Streaming error: {e}")
            error_data = {"type": "error", "content": str(e)}
            yield f"data: {json.dumps(error_data)}\n\n"

    return StreamingResponse(generate_stream(), media_type="text/event-stream")


@router.post("/semantic-search", response_model=SemanticSearchResponse)
def semantic_search(
    payload: SemanticSearchRequest,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """
    Performs semantic search over the knowledge graph.
    Returns the most relevant nodes based on the query.
    """
    # Extract tenant_id from auth context
    tenant_id = auth.get("tenant_id")
    results = semantic_search_nodes(payload.message, session, payload.limit, tenant_id=tenant_id)
    return SemanticSearchResponse(
        nodes=[r["node"] for r in results],
        scores=[r["score"] for r in results]
    )


@router.post("/semantic-search-communities", response_model=SemanticSearchCommunitiesResponse)
def semantic_search_communities_endpoint(
    payload: SemanticSearchCommunitiesRequest,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """
    Performs semantic search over communities using summary embeddings.
    Returns the most relevant communities based on the query.
    """
    results = semantic_search_communities(
        session=session,
        graph_id=payload.graph_id,
        branch_id=payload.branch_id,
        query=payload.message,
        limit=payload.limit
    )
    
    from models import CommunitySearchResult
    communities = [
        CommunitySearchResult(
            community_id=r["community_id"],
            name=r["name"],
            score=r["score"],
            summary=r.get("summary")
        )
        for r in results
    ]
    
    return SemanticSearchCommunitiesResponse(communities=communities)


@router.post("/graphrag-context", response_model=GraphRAGContextResponse)
def graphrag_context_endpoint(
    payload: GraphRAGContextRequest,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """
    Retrieves GraphRAG context: communities -> claims -> evidence subgraph.
    Returns formatted context text and debug information.
    Cached for 5 minutes to improve performance for repeated queries.
    """
    # Build cache key from query parameters
    # Use a hash of the message to keep cache keys reasonable length
    message_hash = hashlib.md5(payload.message.encode()).hexdigest()[:8]
    cache_key = (
        "graphrag_context",
        payload.graph_id or "",
        payload.branch_id or "",
        message_hash,
        payload.recency_days or 0,
        payload.evidence_strictness or "medium",
        payload.include_proposed_edges if payload.include_proposed_edges is not None else True,
    )
    
    # Try cache first (5 minute TTL for expensive GraphRAG operations)
    cached_result = get_cached(*cache_key, ttl_seconds=300)
    if cached_result is not None:
        return GraphRAGContextResponse(**cached_result)
    
    context = retrieve_graphrag_context(
        session=session,
        graph_id=payload.graph_id,
        branch_id=payload.branch_id,
        question=payload.message,
        evidence_strictness=payload.evidence_strictness or "medium",
    )

    debug = {
        "communities": len(context.get("communities", []) or []),
        "claims": len(context.get("claims", []) or []),
        "concepts": len(context.get("concepts", []) or []),
        "edges": len(context.get("edges", []) or []),
        "has_evidence": context.get("has_evidence", True),
    }
        
    # Build unified citations
    from services_unified_citations import build_retrieval_citations
    citations = build_retrieval_citations(
        context=context,
        graph_id=payload.graph_id,
        branch_id=payload.branch_id
    )
    
    # Add citations to response
    response = GraphRAGContextResponse(context_text=context["context_text"], debug=debug, citations=citations)

    # Cache the result
    set_cached(cache_key[0], response.dict(), *cache_key[1:], ttl_seconds=300)
    return response


@router.post("/evidence-subgraph")
def evidence_subgraph_endpoint(
    payload: EvidenceSubgraphRequest,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """
    Get evidence subgraph for given claim IDs.
    Returns concepts and edges that support the claims.
    
    Args:
        payload: EvidenceSubgraphRequest with graph_id, claim_ids, and limits
    """
    ensure_graph_scoping_initialized(session)
    _, branch_id = get_active_graph_context(session)
    
    subgraph = get_evidence_subgraph(
        session=session,
        graph_id=payload.graph_id,
        claim_ids=payload.claim_ids,
        max_concepts=payload.limit_nodes,
        include_proposed="auto"
    )
    
    # Apply edge limit
    edges = subgraph.get("edges", [])[:payload.limit_edges]
    
    return {
        "concepts": subgraph.get("concepts", [])[:payload.limit_nodes],
        "edges": edges,
    }


class AssessmentRequest(BaseModel):
    action: str  # "probe", "evaluate", "contextual_probe"
    concept_name: Optional[str] = None
    concept_id: Optional[str] = None
    current_mastery: Optional[int] = 0
    graph_id: str
    # specific to evaluate
    question: Optional[str] = None
    user_answer: Optional[str] = None
    # specific to probe
    history: Optional[List[dict]] = []
    # specific to contextual_probe
    text_selection: Optional[str] = None
    context: Optional[str] = None

class AssessmentResponse(BaseModel):
    mastery_score: int
    feedback: str
    next_question: Optional[str] = None
    concepts_discussed: List[str] = []

@router.post("/assess", response_model=AssessmentResponse)
def assess_endpoint(
    payload: AssessmentRequest,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """
    Assessment Agent Endpoint.
    - action="probe": Generate a probing question.
    - action="evaluate": Grade answer and update mastery.
    - action="contextual_probe": Socratic questioning based on highlighted text.
    """
    from agents.assessment import AssessmentAgent
    from services_graph import update_concept_mastery, get_concept_mastery
    
    agent = AssessmentAgent()
    
    if payload.action == "probe":
        if not payload.concept_name:
            raise ValueError("concept_name required for probe")
        
        # Fetch real mastery if not explicitly provided (or trusted)
        real_mastery = get_concept_mastery(session, payload.graph_id, payload.concept_name)
            
        question = agent.generate_probe(
            payload.concept_name, 
            real_mastery, 
            payload.history or []
        )
        return AssessmentResponse(
            mastery_score=real_mastery,
            feedback="",
            next_question=question
        )
        
    elif payload.action == "contextual_probe":
        if not payload.text_selection:
            raise ValueError("text_selection required for contextual_probe")
        
        # We try to use the selection as a proxy for concept name lookup
        # Ideally we'd use entity extraction, but for now exact match or 0
        real_mastery = get_concept_mastery(session, payload.graph_id, payload.text_selection)
            
        question = agent.contextual_probe(
            payload.text_selection,
            payload.context or "",
            real_mastery
        )
        return AssessmentResponse(
            mastery_score=real_mastery,
            feedback="",
            next_question=question
        )
        
    elif payload.action == "evaluate":
        if not payload.concept_name:
             # Try to infer concept name if missing? For now require it or default.
             # In a real flow, evaluate comes after probe, so we should know the concept.
             pass

        if not payload.question or not payload.user_answer:
            raise ValueError("question and user_answer required for evaluation")
            
        result = agent.evaluate_response(
            payload.concept_name or "Unknown Concept",
            payload.question,
            payload.user_answer,
            payload.current_mastery or 0
        )
        
        # Persist new mastery
        if payload.concept_id:
            update_concept_mastery(
                session, 
                payload.graph_id, 
                payload.concept_id, 
                result.mastery_score
            )
        
        return AssessmentResponse(
            mastery_score=result.mastery_score,
            feedback=result.feedback,
            next_question=result.next_question,
            concepts_discussed=result.concepts_discussed
        )
    
    else:
        raise ValueError(f"Unknown action: {payload.action}")
