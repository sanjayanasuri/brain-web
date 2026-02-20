"""
Orchestrator for the Conversational Voice Agent.
Integrates GraphRAG, Supermemory AI, and usage tracking for a seamless voice experience.
"""
import os
import json
import logging
import asyncio
from typing import Dict, Any, Optional, List
from datetime import datetime
import uuid

from db_neo4j import neo4j_session
from services_graphrag import retrieve_graphrag_context
from services_supermemory import search_memories, sync_learning_moment
from services_usage_tracker import log_usage, check_limit
from db_postgres import execute_update, execute_query
from config import VOICE_AGENT_NAME, OPENAI_API_KEY
from services_graph import create_concept, create_relationship, get_recent_conversation_summaries
from models import ConceptCreate, RelationshipCreate
from services_voice_learning_signals import (
    apply_signals_to_policy,
    extract_learning_signals,
    is_yield_turn,
)
from services_voice_transcripts import (
    get_voice_session_started_at_ms,
    record_voice_learning_signals,
    record_voice_transcript_chunk,
)
from services_tutor_profile import get_tutor_profile as get_tutor_profile_service

import json
import re
from openai import OpenAI

from services_model_router import model_router, TASK_VOICE, TASK_SYNTHESIS
from services_agent_memory import read_agent_memory

logger = logging.getLogger("brain_web")

class VoiceAgentOrchestrator:
    def __init__(self, user_id: str, tenant_id: str):
        self.user_id = user_id
        self.tenant_id = tenant_id
        # In-memory history cache: avoids a Postgres round-trip on every turn
        self._session_history: Dict[str, list] = {}


    async def start_session(self, graph_id: str, branch_id: str, metadata: Optional[Dict[str, Any]] = None, companion_session_id: Optional[str] = None) -> Dict[str, Any]:
        """Initiate a new voice session with usage checking."""
        if not check_limit(self.user_id, 'voice_session'):
            raise Exception("Daily voice session limit reached.")

        session_id = str(uuid.uuid4())
        started_at = datetime.utcnow()

        # Phase F: best-effort TutorProfile -> voice policy defaults (additive only)
        metadata_to_store: Dict[str, Any] = metadata if isinstance(metadata, dict) else {}
        
        if companion_session_id:
            metadata_to_store["companion_session_id"] = companion_session_id
            try:
                from services_session_continuity import get_or_create_session, update_session_context
                get_or_create_session(self.user_id, companion_session_id)
                update_session_context(companion_session_id, voice_session_id=session_id)
            except Exception as e:
                logger.error(f"Failed to link companion session: {e}")

        try:
            with neo4j_session() as neo_session:
                tutor_profile = get_tutor_profile_service(neo_session, user_id=self.user_id)
            policy = metadata_to_store.get("policy")
            if not isinstance(policy, dict):
                policy = {}
            if "turn_taking" not in policy and tutor_profile.turn_taking:
                policy["turn_taking"] = tutor_profile.turn_taking
            if "pacing" not in policy and tutor_profile.pacing:
                policy["pacing"] = tutor_profile.pacing
            if policy:
                metadata_to_store["policy"] = policy
        except Exception as e:
            logger.debug(f"Skipping TutorProfile policy defaults: {e}")

        query = """
        INSERT INTO voice_sessions (id, user_id, tenant_id, graph_id, branch_id, started_at, metadata)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """
        params = (session_id, self.user_id, self.tenant_id, graph_id, branch_id, started_at, metadata_to_store)
        
        try:
            execute_update(query, params)
            return {
                "session_id": session_id,
                "started_at": started_at,
                "agent_name": VOICE_AGENT_NAME
            }
        except Exception as e:
            logger.error(f"Failed to start voice session: {e}")
            raise

    async def summarize_session(self, session_id: str, graph_id: str) -> Optional[str]:
        """Generate a synthesis of the entire voice session and save it as a node."""
        history = await self.get_session_history(session_id)
        if not history:
            return None

        # Format history for LLM
        formatted_history = "\n".join([f"{'User' if m['user'] else 'Agent'}: {m['user'] if m['user'] else m['agent']}" for m in history])
        
        prompt = f"""
        Below is a transcript of a voice learning session. 
        Synthesize the key takeaways, concepts discussed, and any breakthroughs achieved.
        Create a concise 'Session Recap' (max 200 words).
        
        Transcript:
        {formatted_history}
        """

        try:
            summary = model_router.completion(
                task_type=TASK_SYNTHESIS, # Use heavy model (gpt-4o) for synthesis
                messages=[{"role": "system", "content": prompt}],
                temperature=0.5
            )


            # Save to Graph
            with neo4j_session() as session:
                payload = ConceptCreate(
                    name=f"Voice Recap: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
                    domain="learning",
                    type="synthesis",
                    description=summary,
                    tags=["voice-synthesis", "automatic-recap"],
                    created_by=f"voice-agent-synthesis-{self.user_id}"
                )
                create_concept(session, payload)
            
            return summary
        except Exception as e:
            logger.error(f"Failed to synthesize session: {e}")
            return None

    async def stop_session(self, session_id: str, duration_seconds: int, tokens_used: int):
        """End a voice session, log final usage, and synthesize takeaways."""
        ended_at = datetime.utcnow()
        
        # 1. Fetch graph_id for synthesis
        query_fetch = "SELECT graph_id, branch_id FROM voice_sessions WHERE id = %s AND user_id = %s"
        graph_res = execute_query(query_fetch, (session_id, self.user_id))
        graph_id = graph_res[0]["graph_id"] if graph_res else None
        branch_id = graph_res[0].get("branch_id") if graph_res else None

        # 2. Synthesize session if possible
        synthesis: Optional[str] = None
        if graph_id:
            synthesis = await self.summarize_session(session_id, graph_id)

        # 2b. Store recap into conversation summaries for cross-modal continuity (best-effort, additive)
        if synthesis:
            try:
                from models import ConversationSummary
                from services_graph import store_conversation_summary

                with neo4j_session() as neo_session:
                    store_conversation_summary(
                        neo_session,
                        ConversationSummary(
                            id=f"voice-{session_id}",
                            timestamp=int(datetime.utcnow().timestamp()),
                            question=f"[Voice Session Recap] graph={graph_id} branch={branch_id or 'main'}",
                            answer="",
                            topics=["voice_session", "recap"],
                            summary=synthesis,
                        ),
                        user_id=self.user_id,
                        tenant_id=self.tenant_id,
                    )
            except Exception as e:
                logger.debug(f"Failed to store voice recap as conversation summary: {e}")

        # 3. Update DB
        query = """
        UPDATE voice_sessions
        SET ended_at = %s, total_duration_seconds = %s, token_usage_estimate = %s
        WHERE id = %s AND user_id = %s
        """
        params = (ended_at, duration_seconds, tokens_used, session_id, self.user_id)
        
        try:
            execute_update(query, params)
            # Log to usage tracker for limits
            log_usage(self.user_id, self.tenant_id, 'voice_session', duration_seconds, {"session_id": session_id})
        except Exception as e:
            logger.error(f"Failed to stop voice session: {e}")

    async def generate_agent_reply(self, system_prompt: str, history: List[Dict[str, str]], user_transcript: str) -> str:
        """Generate a natural conversational reply using the prompt, history, and transcript."""
        # if not self.client: return ... removed
        
        # ... logic ...

        messages = [{"role": "system", "content": system_prompt}]
        
        # Add history (last 5 interactions for token efficiency)
        for entry in history[-5:]:
            user_turn = str(entry.get("user") or "").strip()
            assistant_turn = str(entry.get("agent") or "").strip()
            if user_turn:
                messages.append({"role": "user", "content": user_turn})
            if assistant_turn:
                messages.append({"role": "assistant", "content": assistant_turn})
            
        messages.append({"role": "user", "content": user_transcript})

        try:
            return model_router.completion(
                task_type=TASK_VOICE, # Fast model
                messages=messages,
                temperature=0.7,
                max_tokens=220
            )

        except Exception as e:
            logger.error(f"Failed to generate agent reply: {e}")
            return f"I'm sorry, I encountered an error while thinking about that."

    def _normalize_history_pairs(self, history: List[Dict[str, Any]]) -> List[Dict[str, str]]:
        """
        Normalize mixed history shapes into [{user, agent}] pairs for voice generation.

        Supports:
        - voice session history: [{"user": "...", "agent": "..."}]
        - chat history style: [{"role": "user|assistant", "content": "..."}]
        """
        if not isinstance(history, list):
            return []

        normalized: List[Dict[str, str]] = []
        pending_user: Optional[str] = None

        for raw in history:
            if not isinstance(raw, dict):
                continue

            # Native voice format
            if "user" in raw or "agent" in raw:
                user_turn = str(raw.get("user") or "").strip()
                agent_turn = str(raw.get("agent") or "").strip()
                if user_turn or agent_turn:
                    normalized.append({"user": user_turn, "agent": agent_turn})
                continue

            # Generic chat format
            role = str(raw.get("role") or "").strip().lower()
            content = str(raw.get("content") or "").strip()
            if not content:
                continue

            if role == "user":
                if pending_user:
                    normalized.append({"user": pending_user, "agent": ""})
                pending_user = content
            elif role == "assistant":
                if pending_user:
                    normalized.append({"user": pending_user, "agent": content})
                    pending_user = None
                else:
                    normalized.append({"user": "", "agent": content})

        if pending_user:
            normalized.append({"user": pending_user, "agent": ""})

        return normalized[-10:]

    async def detect_confusion(self, transcript: str) -> bool:
        """Heuristic and LLM check for user confusion."""
        keywords = ["don't understand", "confused", "what is", "explain", "help me with", "not sure about"]
        if any(k in transcript.lower() for k in keywords):
            # Double check with a quick LLM pass if needed, but heuristic is fine for MVP
            return True
        return False

    async def handle_fog_clearing(self, graph_id: str, transcript: str, context: str) -> Dict[str, Any]:
        """Generate a pedagogical explanation and save it as an 'UNDERSTANDING' node."""
        
        prompt = f"""
        The student is confused: "{transcript}"
        Based on this Knowledge Graph Context:
        {context}

        Provide a clear, simple, and pedagogical explanation. Avoid jargon. Use analogies if possible.
        Keep it under 100 words.
        """

        try:
            explanation = model_router.completion(
                task_type=TASK_SYNTHESIS, # Use smart model for pedagogy
                messages=[{"role": "system", "content": prompt}],
                temperature=0.7
            )


            # Save to Graph as an "UNDERSTANDING" node
            with neo4j_session() as session:
                payload = ConceptCreate(
                    name=f"Understanding: {transcript[:30]}...",
                    domain="learning",
                    type="understanding",
                    description=explanation,
                    tags=["fog-clearing", "persistence-of-understanding"],
                    created_by=f"voice-agent-fog-clearer-{self.user_id}"
                )
                node = create_concept(session, payload)
                
            return {
                "explanation": explanation,
                "node_id": node.node_id
            }
        except Exception as e:
            logger.error(f"Fog-clearing failed: {e}")
            return {"explanation": "I'm sorry, I tried to simplify that for you but hit a mental block.", "node_id": None}

    async def get_session_history(self, session_id: str) -> List[Dict[str, Any]]:
        """Retrieve conversation history — in-memory first, Postgres as cold-start fallback."""
        if session_id in self._session_history:
            return list(self._session_history[session_id])
        query = "SELECT metadata FROM voice_sessions WHERE id = %s AND user_id = %s"
        try:
            res = execute_query(query, (session_id, self.user_id))
            history: list = []
            if res and res[0]['metadata']:
                history = res[0]['metadata'].get('history', [])
            self._session_history[session_id] = history
            return list(history)
        except Exception as e:
            logger.error(f"Failed to retrieve session history: {e}")
            return []

    async def get_session_policy(self, session_id: str) -> Dict[str, Any]:
        """Retrieve turn-taking/pacing policy from voice session metadata."""
        query = "SELECT metadata FROM voice_sessions WHERE id = %s AND user_id = %s"
        try:
            res = execute_query(query, (session_id, self.user_id))
            metadata = res[0].get("metadata") if res else None
            if isinstance(metadata, dict):
                return metadata.get("policy", {}) or {}
            return {}
        except Exception as e:
            logger.error(f"Failed to retrieve session policy: {e}")
            return {}

    async def set_session_policy(self, session_id: str, policy: Dict[str, Any]) -> None:
        """Persist policy into voice session metadata (jsonb)."""
        try:
            execute_update(
                """
                UPDATE voice_sessions
                SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{policy}', %s::jsonb, true)
                WHERE id = %s AND user_id = %s
                """,
                (json.dumps(policy), session_id, self.user_id),
            )
        except Exception as e:
            logger.error(f"Failed to set session policy: {e}")

    async def save_interaction(self, session_id: str, transcript: str, agent_response: str):
        """Update in-memory history immediately, then persist to Postgres (non-blocking caller)."""
        entry = {
            "user": transcript,
            "agent": agent_response,
            "timestamp": datetime.utcnow().isoformat(),
        }
        # In-memory update is instant — safe to read on next turn without a DB hit
        cache = self._session_history.setdefault(session_id, [])
        cache.append(entry)
        self._session_history[session_id] = cache[-20:]

        query = """
        UPDATE voice_sessions
        SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{history}', %s::jsonb, true)
        WHERE id = %s AND user_id = %s
        """
        try:
            execute_update(query, (json.dumps(self._session_history[session_id]), session_id, self.user_id))
        except Exception as e:
            logger.error(f"Failed to save interaction history: {e}")

    async def get_interaction_context(
        self,
        graph_id: str,
        branch_id: str,
        last_transcript: str,
        is_scribe_mode: bool = False,
        session_id: Optional[str] = None,
        client_start_ms: Optional[int] = None,
        client_end_ms: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Gather context, process commands, and generate a conversational reply.
        Now includes Fog-Clearing and Session Continuity (Interaction History).
        """
        try:
            # ----------------------------------------------------------------
            # 1. Kick off all independent I/O concurrently (major latency win)
            # ----------------------------------------------------------------
            history_task = asyncio.create_task(self.get_session_history(session_id)) if session_id else None
            policy_task = asyncio.create_task(self.get_session_policy(session_id)) if session_id else None
            confusion_task = asyncio.create_task(self.detect_confusion(last_transcript))
            eureka_task = asyncio.create_task(self.handle_eureka_moment(last_transcript))
            commands_task = asyncio.create_task(self.extract_voice_commands(last_transcript, is_scribe_mode))
            memories_task = asyncio.create_task(search_memories(self.user_id, last_transcript))

            gathered = await asyncio.gather(
                history_task if history_task else asyncio.sleep(0),
                policy_task if policy_task else asyncio.sleep(0),
                confusion_task,
                eureka_task,
                commands_task,
                memories_task,
                return_exceptions=True,
            )

            session_history: list = gathered[0] if history_task and not isinstance(gathered[0], Exception) else []
            policy: Dict[str, Any] = gathered[1] if policy_task and not isinstance(gathered[1], Exception) else {}
            if not isinstance(policy, dict):
                policy = {}
            is_confused: bool = gathered[2] if not isinstance(gathered[2], Exception) else False
            is_eureka: bool = gathered[3] if not isinstance(gathered[3], Exception) else False
            actions: list = gathered[4] if not isinstance(gathered[4], Exception) else []
            personal_memories: list = gathered[5] if not isinstance(gathered[5], Exception) else []

            extracted_signals = extract_learning_signals(last_transcript)
            policy, policy_changed = apply_signals_to_policy(policy, extracted_signals)

            action_summaries = await self.execute_voice_commands(actions)

            # 3. Fetch Context (Neo4j — still needs to be serial due to shared session)
            unified_context = {}
            tutor_profile = None
            graph_context = ""

            with neo4j_session() as neo_session:
                try:
                    from services_memory_orchestrator import get_unified_context, get_active_lecture_id

                    unified_context = get_unified_context(
                        user_id=self.user_id,
                        tenant_id=self.tenant_id,
                        chat_id=session_id or "voice_default",
                        query=last_transcript,
                        session=neo_session,
                        active_lecture_id=graph_id,
                        include_chat_history=True,
                        include_lecture_context=True,
                        include_user_facts=True,
                        include_study_context=True,
                    )
                    logger.info(
                        f"Voice session {session_id} loaded unified context: "
                        f"{len(unified_context.get('chat_history', []))} messages, "
                        f"user_facts={'yes' if unified_context.get('user_facts') else 'no'}"
                    )
                except Exception as e:
                    logger.warning(f"Failed to load unified context for voice: {e}")
                    unified_context = {"user_facts": "", "lecture_context": "", "chat_history": []}

                try:
                    tutor_profile = get_tutor_profile_service(neo_session, user_id=self.user_id)
                except Exception:
                    tutor_profile = None

                try:
                    graphrag_data = retrieve_graphrag_context(
                        session=neo_session,
                        graph_id=graph_id,
                        branch_id=branch_id,
                        question=last_transcript,
                    )
                    graph_context = graphrag_data.get("context_text", "")
                except Exception as e:
                    logger.warning(f"GraphRAG context failed: {e}")
                    graph_context = ""

            # 4. Handle Fog Clearing if student is confused
            fog_result = None
            if is_confused:
                fog_result = await self.handle_fog_clearing(graph_id, last_transcript, graph_context)

            memory_context = ""
            if personal_memories:
                memory_context = "\nPersonal Memory Context:\n" + "\n".join([m.get("content", "") for m in personal_memories])

            # 5b. Resolve Study Context for Prompt
            study_instruction = ""
            try:
                from services_memory_orchestrator import build_system_prompt_with_memory
                # We reuse the logic from the orchestrator's prompt builder
                temp_prompt = build_system_prompt_with_memory("", unified_context, ["study_context"])
                # Extract just the added part
                study_instruction = temp_prompt.replace("\n\n", "", 1)
            except:
                pass

            # 5c. Detect if user is responding to a task (Voice)
            task_signal = ""
            try:
                if session_history:
                    last_ast = session_history[-1].get("agent", "")
                    if "[STUDY_TASK:" in last_ast:
                        task_signal = "\nSTIMULUS: The student is answering a previous STUDY_TASK verbally. Listen carefully and evaluate their understanding."
            except:
                pass

            # 6. Construct system prompt
            mode_desc = "SCRIBE MODE" if is_scribe_mode else ("FOG-CLEARER MODE" if is_confused else "CONVERSATIONAL MODE")

            # Phase F: apply TutorProfile tone/audience/depth (best-effort)
            tutor_layer = ""
            try:
                if tutor_profile:
                    voice_cards = {
                        "neutral": "Tone: professional and clear.",
                        "friendly": "Tone: warm, friendly, and supportive (still precise).",
                        "direct": "Tone: straightforward and no-nonsense (still kind).",
                        "playful": "Tone: light and engaging (avoid distracting jokes).",
                    }
                    audience_cards = {
                        "default": "Audience: default learner.",
                        "eli5": "Audience: ELI5 (simple, concrete, define jargon).",
                        "ceo_pitch": "Audience: CEO pitch (executive summary, tradeoffs, crisp).",
                        "recruiter_interview": "Audience: recruiter interview (clear definition + practical example).",
                        "technical": "Audience: technical (precise terms, rigorous reasoning).",
                    }
                    response_depth = {
                        "hint": "Depth: one brief nudge (1–2 sentences).",
                        "compact": "Depth: concise (2–4 short sentences by default).",
                        "normal": "Depth: balanced (short explanation + one example).",
                        "deep": "Depth: step-by-step (short numbered steps; pause to check alignment).",
                    }

                    voice_id = getattr(tutor_profile, "voice_id", "neutral") or "neutral"
                    audience_mode = getattr(tutor_profile, "audience_mode", "default") or "default"
                    response_mode = getattr(tutor_profile, "response_mode", "compact") or "compact"
                    ask_question_policy = getattr(tutor_profile, "ask_question_policy", "at_most_one") or "at_most_one"
                    end_with_next_step = getattr(tutor_profile, "end_with_next_step", True) is not False
                    no_glazing = getattr(tutor_profile, "no_glazing", True) is not False

                    question_policy_cards = {
                        "never": "Question policy: avoid follow-up questions unless critical details are missing.",
                        "at_most_one": "Question policy: ask at most one brief clarification, then answer directly.",
                        "ok": "Question policy: questions are allowed, but avoid repeated clarifying loops.",
                    }
                    tutor_layer = "\n".join(
                        [
                            "Tutor Profile:",
                            f"- {voice_cards.get(str(voice_id), voice_cards['neutral'])}",
                            f"- {audience_cards.get(str(audience_mode), audience_cards['default'])}",
                            f"- {response_depth.get(str(response_mode), response_depth['compact'])}",
                            f"- {question_policy_cards.get(str(ask_question_policy), question_policy_cards['at_most_one'])}",
                            f"- Closure: {'end with one concrete next step when useful.' if end_with_next_step else 'do not force next-step prompts.'}",
                            f"- Correctness: {'be direct; answer yes/no when asked; correct errors (no glazing).' if no_glazing else 'be supportive; still correct errors.'}",
                        ]
                    )

                    # Apply pacing/turn-taking defaults to policy if missing (signals still override)
                    if isinstance(policy, dict):
                        pacing = getattr(tutor_profile, "pacing", None)
                        turn_taking = getattr(tutor_profile, "turn_taking", None)
                        if pacing and "pacing" not in policy:
                            policy["pacing"] = pacing
                        if turn_taking and "turn_taking" not in policy:
                            policy["turn_taking"] = turn_taking
            except Exception:
                tutor_layer = ""
            
            # Unified memory sections
            memory_sections = []
            if unified_context.get("user_facts"):
                memory_sections.append(f"## About This User\n{unified_context['user_facts']}")
            if unified_context.get("lecture_context"):
                memory_sections.append(f"## Current Study Material\n{unified_context['lecture_context']}")
            
            unified_memory_context = "\n".join(memory_sections)
            agent_memory = "\n".join(memory_sections)
            cross_modal_context = "" # Placeholder for future cross-modal context

            system_prompt = f"""
            You are {VOICE_AGENT_NAME}, a knowledgeable learning companion.
            Current Mode: {mode_desc}
            
            ## Persistent Memory & Context
            {agent_memory}
            {study_instruction}
            {task_signal}
            
            Your goal is to help the user explore the knowledge graph and reflect on their learning.
            {tutor_layer}
            {f"STIMULUS: The student is confused. Your reply should be derived from this explanation: {fog_result['explanation']}" if fog_result else ""}
            
            Knowledge Graph Context:
            {graph_context}
            {memory_context}
            {cross_modal_context}
            
            Recent Actions Executed:
            {", ".join(action_summaries) if action_summaries else "None"}

            Instructions:
            - Keep responses concise, direct, and conversational.
            - ABSOLUTELY FORBIDDEN: Do not say "I'm here to help", "Goodbye", "Take care", or use generic customer service pleasantries. 
            - Be kind, but do not glaze: if the user asks whether something is correct, say yes/no and correct it if needed.
            - Once user intent is clear, answer directly with concrete steps or details.
            - Ask a clarifying question only if required details are missing; never ask the same clarification twice.
            - If the user confirms with phrases like "yes", "go ahead", or "exactly", start the explanation immediately.
            - If policy says no interruption, only speak when the user yields (asks a question or requests a response).
            - If policy says slow pacing, use short sentences and a slower cadence. This is CRITICAL.
            - If policy says fast pacing, speak quickly and get straight to the point.
            - If the user has a "EUREKA" moment, acknowledge it warmly.
            - If they were confused, present the simplified explanation as yours. Mention you've saved this "Insight" to their graph.
            - Do not use markdown (bold/bullets) for voice.
            """

            # Turn-taking gate: optionally wait silently unless user yields
            should_speak = True
            if policy.get("turn_taking") == "no_interrupt":
                yield_turn = is_yield_turn(last_transcript) or any(
                    s.get("kind") in {"verification_question", "confusion", "restart_request"} for s in extracted_signals
                )
                # One-time acknowledgements still count as a "speak" even if no yield
                ack_turn = any(s.get("kind") in {"turn_taking_request", "pacing_request"} for s in extracted_signals)
                should_speak = bool(yield_turn or ack_turn)

            agent_reply = ""
            if should_speak:
                # Provide immediate acknowledgements if user is setting policy
                if any(s.get("kind") == "turn_taking_request" for s in extracted_signals):
                    agent_reply = "Got it. I won’t interrupt — just ask when you want me to jump in."
                elif any(s.get("kind") == "pacing_request" for s in extracted_signals):
                    pace = policy.get("pacing", "normal")
                    if pace == "slow":
                        agent_reply = "Okay. I’ll slow down."
                    elif pace == "fast":
                        agent_reply = "Got it. Speeding up."
                    else:
                        agent_reply = "Okay, back to normal speed."
                else:
                    # Prefer actual voice session continuity; fallback to text chat history when empty.
                    current_history = self._normalize_history_pairs(session_history)
                    if not current_history:
                        current_history = self._normalize_history_pairs(unified_context.get("chat_history", []))
                    agent_reply = await self.generate_agent_reply(system_prompt, current_history, last_transcript)

            # 8. Persist artifacts — fire as background tasks so the reply isn't blocked
            user_transcript_chunk = None
            assistant_transcript_chunk = None
            if session_id:
                # Non-blocking: in-memory cache updated instantly; Postgres write is backgrounded
                asyncio.create_task(self.save_interaction(session_id, last_transcript, agent_reply))
                if policy_changed:
                    asyncio.create_task(self.set_session_policy(session_id, policy))

                # FACT EXTRACTION — background, never blocks the reply
                if agent_reply:
                    async def _extract_facts_bg(
                        _transcript: str = last_transcript,
                        _reply: str = agent_reply,
                        _session_id: str = session_id,
                    ) -> None:
                        try:
                            from services_fact_extractor import extract_facts_from_conversation
                            from db_neo4j import neo4j_session as fresh_neo4j_session
                            with fresh_neo4j_session() as fact_session:
                                await extract_facts_from_conversation(
                                    user_message=_transcript,
                                    assistant_response=_reply,
                                    chat_id=_session_id,
                                    user_id=self.user_id,
                                    tenant_id=self.tenant_id,
                                    session=fact_session,
                                )
                            logger.info(f"Fact extraction completed for session {_session_id}")
                        except Exception as e:
                            logger.warning(f"Fact extraction failed in voice: {e}")

                    asyncio.create_task(_extract_facts_bg())

                # Persist transcript chunks + extracted learning signals as artifacts (additive)
                try:
                    started_at_ms = get_voice_session_started_at_ms(voice_session_id=session_id, user_id=self.user_id)
                    now_ms = int(datetime.utcnow().timestamp() * 1000)
                    session_offset_now = max(0, now_ms - started_at_ms) if started_at_ms else 0

                    # Convert client epoch ms to session-relative ms
                    if started_at_ms and client_start_ms is not None:
                        user_start = max(0, int(client_start_ms) - started_at_ms)
                    else:
                        user_start = session_offset_now
                    if started_at_ms and client_end_ms is not None:
                        user_end = max(user_start + 1, int(client_end_ms) - started_at_ms)
                    else:
                        user_end = user_start + 1

                    user_chunk = record_voice_transcript_chunk(
                        voice_session_id=session_id,
                        user_id=self.user_id,
                        tenant_id=self.tenant_id,
                        graph_id=graph_id,
                        branch_id=branch_id,
                        role="user",
                        content=last_transcript,
                        start_ms=user_start,
                        end_ms=user_end,
                    )
                    user_transcript_chunk = user_chunk

                    assistant_chunk = None
                    if agent_reply:
                        assist_start = max(user_end + 1, session_offset_now)
                        # rough estimate: 55ms/char + a floor
                        est_duration = max(800, int(len(agent_reply) * 55))
                        assistant_chunk = record_voice_transcript_chunk(
                            voice_session_id=session_id,
                            user_id=self.user_id,
                            tenant_id=self.tenant_id,
                            graph_id=graph_id,
                            branch_id=branch_id,
                            role="assistant",
                            content=agent_reply,
                            start_ms=assist_start,
                            end_ms=assist_start + est_duration,
                        )
                        assistant_transcript_chunk = assistant_chunk

                    record_voice_learning_signals(
                        voice_session_id=session_id,
                        chunk_id=user_chunk.get("chunk_id"),
                        user_id=self.user_id,
                        tenant_id=self.tenant_id,
                        graph_id=graph_id,
                        branch_id=branch_id,
                        signals=extracted_signals,
                    )
                except Exception as e:
                    logger.warning(f"Failed to persist voice transcript artifacts: {e}")

            return {
                "agent_response": agent_reply,
                "should_speak": should_speak,
                # 1.15x is the sweet spot for learning: noticeably faster without feeling rushed
                "speech_rate": 0.9 if policy.get("pacing") == "slow" else (1.6 if policy.get("pacing") == "fast" else 1.15),
                "learning_signals": extracted_signals,
                "policy": policy,
                "user_transcript_chunk": user_transcript_chunk,
                "assistant_transcript_chunk": assistant_transcript_chunk,
                "actions": actions,
                "action_summaries": action_summaries,
                "is_eureka": is_eureka,
                "is_fog_clearing": is_confused,
                "fog_node_id": fog_result["node_id"] if fog_result else None
            }
        except Exception as e:
            import traceback
            logger.error(f"Interaction processing failed: {e}")
            logger.error(f"Traceback: {traceback.format_exc()}")
            return {
                "agent_response": "I'm sorry, I'm having a bit of trouble connecting to my central knowledge hub right now. Could you repeat that?",
                "should_speak": True,
                "speech_rate": 1.0,
                "learning_signals": [],
                "actions": [],
                "action_summaries": [],
                "is_eureka": False,
                "is_fog_clearing": False,
                "fog_node_id": None
            }

    async def handle_eureka_moment(self, transcript: str):
        """Sync a learning breakthrough to Supermemory AI."""
        # Simple heuristic or LLM check would go here
        if any(word in transcript.lower() for word in ["aha", "eureka", "i get it", "finally understands", "makes move sense"]):
            await sync_learning_moment(self.user_id, transcript, source="voice")
            return True
        return False

    async def extract_voice_commands(self, transcript: str, is_scribe_mode: bool = False) -> List[Dict[str, Any]]:
        """Extract graph operations from voice transcript using LLM."""
        
        if is_scribe_mode:
            prompt = f"""
            You are a Shadow Scriber for a teacher. Your job is to listen to the lecture and implicitly extract the knowledge structure.
            For every key concept mentioned, create a node. For every relationship explained, create a link.
            
            Actions:
            - CREATE_NODE: name, type, description (summary of the concept)
            - CREATE_LINK: source, target, predicate (the relationship)

            Transcript: "{transcript}"

            Respond ONLY with a JSON list of actions, e.g., {{"actions": [{{"type": "CREATE_NODE", "name": "DNA", "node_type": "concept", "description": "The molecule containing genetic instructions."}}]}}.
            Include only high-confidence entities.
            """
        else:
            prompt = f"""
            You are a Graph Synthesis Assistant. Extract intentional graph commands from this transcript.
            Look for phrases like "add a node", "link x to y", "create a concept for...".
            
            Actions:
            - CREATE_NODE: name, type, description
            - CREATE_LINK: source, target, predicate

            Transcript: "{transcript}"

            Respond ONLY with a JSON list of actions. If no explicit command is found, return empty list.
            """

        try:
            content = model_router.completion(
                task_type=TASK_VOICE,
                messages=[{"role": "system", "content": prompt}],
                temperature=0.1,
                response_format={"type": "json_object"}
            )
            data = json.loads(content)
            return data.get("actions", [])
        except Exception as e:
            logger.error(f"Failed to extract voice commands: {e}")
            return []

    async def execute_voice_commands(self, actions: List[Dict[str, Any]]):
        """Execute extracted graph operations in Neo4j."""
        results = []
        with neo4j_session() as session:
            for action in actions:
                try:
                    if action["type"] == "CREATE_NODE":
                        payload = ConceptCreate(
                            name=action["name"],
                            domain="learning",
                            type=action.get("node_type", "concept"),
                            description=action.get("description", ""),
                            created_by=f"voice-agent-{self.user_id}"
                        )
                        create_concept(session, payload)
                        results.append(f"Created node: {action['name']}")
                    elif action["type"] == "CREATE_LINK":
                        payload = RelationshipCreate(
                            source_name=action["source"],
                            target_name=action["target"],
                            predicate=action.get("predicate", "RELATED_TO").upper()
                        )
                        create_relationship(session, payload)
                        results.append(f"Linked {action['source']} to {action['target']}")
                except Exception as e:
                    logger.error(f"Failed to execute voice command {action}: {e}")
        return results
