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
from services_voice_style_profile import get_voice_response_style_hint

import json
import re
from openai import OpenAI

from services_model_router import model_router, TASK_VOICE, TASK_SYNTHESIS
from services_agent_memory import read_agent_memory

logger = logging.getLogger("brain_web")


async def _bg_task(coro, label: str = "background") -> None:
    """
    Wrap a coroutine as a fire-and-forget background task with error logging.
    Prevents silent failures when asyncio.create_task() exceptions go unobserved.
    """
    try:
        await coro
    except Exception as e:
        logger.error(f"[voice_agent][{label}] Background task failed: {e}", exc_info=True)

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
        """
        Extract distinct topics from the voice session and create one Concept node
        per topic, with edges between related topics.

        Old behaviour: one merged "Voice Recap: [timestamp]" node — discarded.
        New behaviour: atomic topic nodes that naturally MERGE with existing concepts
        across sessions.  Related topics get a [:RELATED_TO] edge so the graph
        stays navigable without mixing their content.
        """
        history = await self.get_session_history(session_id)
        if not history:
            return None

        # Build a readable transcript
        lines = []
        for m in history:
            u = (m.get("user") or "").strip()
            a = (m.get("agent") or "").strip()
            if u:
                lines.append(f"User: {u}")
            if a:
                lines.append(f"Agent: {a}")
        transcript = "\n".join(lines)

        extraction_prompt = f"""You are analyzing a voice learning session transcript.

Extract every DISTINCT topic or concept that was meaningfully discussed.
For each topic return:
  - name: a short, precise concept name (e.g. "Watson X", "Carbohydrates", "Backpropagation")
  - summary: 1-3 sentences capturing what was said about this specific topic — NO cross-topic blending
  - related_to: list of other topic names FROM THIS SAME LIST that are genuinely related

Rules:
- One entry per distinct topic — do NOT merge separate topics into one entry
- If two topics happened to be mentioned in the same session but are unrelated, do NOT list them as related_to each other
- Only include related_to links that reflect a real conceptual relationship (e.g. "Carbohydrates" -> "Macromolecules")
- Return a JSON object: {{"topics": [...]}}
- Return an empty list if nothing substantive was discussed

Transcript:
{transcript}
"""

        try:
            raw = model_router.completion(
                task_type=TASK_SYNTHESIS,
                messages=[
                    {"role": "system", "content": "You extract structured knowledge from transcripts. Return only valid JSON."},
                    {"role": "user", "content": extraction_prompt},
                ],
                response_format={"type": "json_object"},
                temperature=0.3,
            )

            import json as _json
            parsed = _json.loads(raw) if raw else {}
            topics = parsed.get("topics", [])
            if not isinstance(topics, list) or not topics:
                logger.info(f"[voice_agent] No topics extracted for session {session_id}")
                return None

            # Create / merge one Concept node per topic, collect node_ids
            topic_node_ids: Dict[str, str] = {}  # topic name -> node_id

            with neo4j_session() as neo_sess:
                for topic in topics:
                    t_name = (topic.get("name") or "").strip()
                    t_summary = (topic.get("summary") or "").strip()
                    if not t_name:
                        continue

                    # MERGE on name so repeated sessions reinforce the same node
                    payload = ConceptCreate(
                        name=t_name,
                        domain="learning",
                        type="concept",
                        description=t_summary,
                        tags=["voice-extracted"],
                        created_by=f"voice-agent-{self.user_id}",
                    )
                    node = create_concept(neo_sess, payload, tenant_id=self.tenant_id)
                    node_id = getattr(node, "node_id", None) or getattr(node, "id", None)
                    if node_id:
                        topic_node_ids[t_name] = node_id

                # Draw edges between related topics
                for topic in topics:
                    t_name = (topic.get("name") or "").strip()
                    src_id = topic_node_ids.get(t_name)
                    if not src_id:
                        continue
                    for rel_name in (topic.get("related_to") or []):
                        rel_name = (rel_name or "").strip()
                        dst_id = topic_node_ids.get(rel_name)
                        if dst_id and dst_id != src_id:
                            try:
                                rel_payload = RelationshipCreate(
                                    source_name=t_name,
                                    target_name=rel_name,
                                    predicate="RELATED_TO",
                                )
                                create_relationship(neo_sess, rel_payload, tenant_id=self.tenant_id)
                            except Exception as rel_err:
                                logger.debug(f"[voice_agent] Could not create relationship {t_name}->{rel_name}: {rel_err}")

            topic_names = [t.get("name", "") for t in topics if t.get("name")]
            summary_text = f"Extracted {len(topic_names)} topic(s): {', '.join(topic_names)}"
            logger.info(f"[voice_agent] Session {session_id}: {summary_text}")
            return summary_text

        except Exception as e:
            logger.error(f"[voice_agent] Failed to extract session topics: {e}", exc_info=True)
            return None

    async def stop_session(self, session_id: str, duration_seconds: int, tokens_used: int):
        """End a voice session, log final usage, and synthesize takeaways."""
        ended_at = datetime.utcnow()
        
        # 1. Fetch graph_id for synthesis
        query_fetch = "SELECT graph_id, branch_id FROM voice_sessions WHERE id = %s AND user_id = %s AND tenant_id = %s"
        graph_res = execute_query(query_fetch, (session_id, self.user_id, self.tenant_id))
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
        WHERE id = %s AND user_id = %s AND tenant_id = %s
        """
        params = (ended_at, duration_seconds, tokens_used, session_id, self.user_id, self.tenant_id)
        
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

    def _is_likely_incomplete_utterance(self, transcript: str) -> bool:
        """
        Best-effort detector for mid-thought pauses in voice transcripts.
        Prevents premature replies when the user is still formulating a question.
        """
        text = str(transcript or "").strip()
        if not text:
            return True

        t = re.sub(r"\s+", " ", text.lower()).strip()
        if not t:
            return True

        # Complete sentence punctuation usually means the user is done.
        if t.endswith("?") or t.endswith(".") or t.endswith("!"):
            return False

        complete_short = {"yes", "no", "okay", "ok", "continue", "go ahead", "stop", "repeat that"}
        if t in complete_short:
            return False

        trailing_fragments = {
            "and", "or", "but", "so", "because", "if", "when", "while",
            "to", "for", "with", "about", "like", "in", "on", "at", "from", "of",
            "um", "uh", "hmm",
        }
        words = t.split()
        if not words:
            return True

        if words[-1] in trailing_fragments:
            return True

        if len(words) <= 2 and t not in complete_short:
            return True

        if t.startswith(("what about", "and what about", "so about")) and len(words) <= 6:
            return True

        return False

    async def handle_fog_clearing(self, graph_id: str, transcript: str, context: str) -> Dict[str, Any]:
        """
        Generate a pedagogical explanation and — only if there is a clear,
        nameable concept being discussed — persist it to the graph.

        Old behaviour: created 'Understanding: {transcript[:30]}...' node on
        every confused utterance.  Problem: junk nodes for filler questions.

        New behaviour:
          1. Extract a clean concept name from the utterance (e.g. 'Watson X').
          2. If meaningful, MERGE a Concept node under that name so repeated
             discussions of the same topic converge on one node.
          3. If no clear concept can be identified (e.g. "okay so I have an
             interview") skip node creation entirely.
        """
        prompt = f"""
        The student said: "{transcript}"
        Knowledge Graph Context:
        {context}

        TASK:
        1. Write a clear, simple pedagogical explanation (max 80 words, no jargon, use analogy if possible).
        2. On a new line write: CONCEPT_NAME: <the single clearest concept name this confusion is about>
           - Use a proper noun / topic name, e.g. "Watson X", "Backpropagation", "TCP/IP".
           - If the utterance is general small-talk, a transition phrase, or has no identifiable concept, write: CONCEPT_NAME: NONE

        Respond in this exact format:
        EXPLANATION: <explanation>
        CONCEPT_NAME: <name or NONE>
        """

        try:
            raw = model_router.completion(
                task_type=TASK_SYNTHESIS,
                messages=[{"role": "system", "content": prompt}],
                temperature=0.6,
            )

            explanation = ""
            concept_name = None
            if raw:
                for line in raw.splitlines():
                    line = line.strip()
                    if line.startswith("EXPLANATION:"):
                        explanation = line[len("EXPLANATION:"):].strip()
                    elif line.startswith("CONCEPT_NAME:"):
                        val = line[len("CONCEPT_NAME:"):].strip()
                        if val and val.upper() != "NONE" and len(val) > 1:
                            concept_name = val

            if not explanation:
                explanation = raw or "Let me re-explain that."

            node_id = None
            if concept_name:
                try:
                    with neo4j_session() as neo_sess:
                        payload = ConceptCreate(
                            name=concept_name,
                            domain="learning",
                            type="concept",
                            description=explanation,
                            tags=["voice-extracted"],
                            created_by=f"voice-agent-{self.user_id}",
                        )
                        node = create_concept(neo_sess, payload, tenant_id=self.tenant_id)
                        node_id = getattr(node, "node_id", None)
                        logger.info(f"[voice_agent] Fog-clearing persisted concept: '{concept_name}' ({node_id})")
                except Exception as e:
                    logger.warning(f"[voice_agent] Fog-clearing node upsert failed: {e}")
            else:
                logger.debug(f"[voice_agent] Fog-clearing: no clear concept in '{transcript[:60]}' — skipping node creation")

            return {"explanation": explanation, "node_id": node_id}

        except Exception as e:
            logger.error(f"[voice_agent] Fog-clearing failed: {e}")
            return {"explanation": "I'm sorry, I tried to simplify that for you but hit a mental block.", "node_id": None}

    async def get_session_history(self, session_id: str) -> List[Dict[str, Any]]:
        """Retrieve conversation history — in-memory first, Postgres as cold-start fallback."""
        if session_id in self._session_history:
            return list(self._session_history[session_id])
        query = "SELECT metadata FROM voice_sessions WHERE id = %s AND user_id = %s AND tenant_id = %s"
        try:
            res = execute_query(query, (session_id, self.user_id, self.tenant_id))
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
        query = "SELECT metadata FROM voice_sessions WHERE id = %s AND user_id = %s AND tenant_id = %s"
        try:
            res = execute_query(query, (session_id, self.user_id, self.tenant_id))
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
                WHERE id = %s AND user_id = %s AND tenant_id = %s
                """,
                (json.dumps(policy), session_id, self.user_id, self.tenant_id),
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
        WHERE id = %s AND user_id = %s AND tenant_id = %s
        """
        try:
            execute_update(query, (json.dumps(self._session_history[session_id]), session_id, self.user_id, self.tenant_id))
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
            style_hint_task = asyncio.create_task(
                asyncio.to_thread(
                    get_voice_response_style_hint,
                    user_id=self.user_id,
                    tenant_id=self.tenant_id,
                )
            )

            gathered = await asyncio.gather(
                history_task if history_task else asyncio.sleep(0),
                policy_task if policy_task else asyncio.sleep(0),
                confusion_task,
                eureka_task,
                commands_task,
                memories_task,
                style_hint_task,
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
            learned_style_hint: str = gathered[6] if not isinstance(gathered[6], Exception) else ""
            if not isinstance(learned_style_hint, str):
                learned_style_hint = ""

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

                    # Use the voice session_id if provided, otherwise a stable
                    # per-user voice thread so all voice turns accumulate in one
                    # chat history that other surfaces can see.
                    # "voice_default" was shared across ALL users — bug.
                    voice_chat_id = session_id or f"voice_{self.user_id}"

                    unified_context = get_unified_context(
                        user_id=self.user_id,
                        tenant_id=self.tenant_id,
                        chat_id=voice_chat_id,
                        query=last_transcript,
                        session=neo_session,
                        active_lecture_id=graph_id,
                        include_chat_history=True,
                        include_lecture_context=True,
                        include_user_facts=True,
                        include_study_context=True,
                        include_recent_topics=True,  # pull in Explorer/Lecture Studio context
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

            # Phase F/v2: apply TutorProfile parameters (Clean Break)
            tutor_layer = ""
            try:
                if tutor_profile:
                    # If custom_instructions (God Mode) is set, it overrides structured settings
                    if tutor_profile.custom_instructions:
                        tutor_layer = f"\nAI PERSONA OVERRIDE:\n{tutor_profile.custom_instructions}"
                    else:
                        tutor_layer = "\n".join([
                            "## AI Tutor Persona (v2)",
                            f"- Comprehension Level: {tutor_profile.comprehension_level} (Target {tutor_profile.comprehension_level} level explanations)",
                            f"- Tone: {tutor_profile.tone}",
                            f"- Pacing: {tutor_profile.pacing}",
                            f"- Turn-Taking Style: {tutor_profile.turn_taking}",
                            f"- Response Length: {tutor_profile.response_length}",
                            f"- Behavioral: {'Direct feedback, no glaze' if tutor_profile.no_glazing else 'Supportive guide'}",
                            f"- Completion Rule: {'Always end with a suggested next step' if tutor_profile.end_with_next_step else 'Natural flow'}"
                        ])

                    # Sync pacing/turn-taking to session policy if not explicitly set by signals
                    if isinstance(policy, dict):
                        if tutor_profile.pacing and "pacing" not in policy:
                            policy["pacing"] = tutor_profile.pacing
                        if tutor_profile.turn_taking and "turn_taking" not in policy:
                            policy["turn_taking"] = tutor_profile.turn_taking
            except Exception as e:
                logger.debug(f"Failed to apply TutorProfile v2 layer: {e}")
                tutor_layer = ""
            
            # Unified memory sections
            memory_sections = []
            if unified_context.get("user_facts"):
                memory_sections.append(f"## About This User\n{unified_context['user_facts']}")
            if unified_context.get("lecture_context"):
                memory_sections.append(f"## Current Study Material\n{unified_context['lecture_context']}")
            
            agent_memory = "\n".join(memory_sections)

            system_prompt = f"""
            You are {VOICE_AGENT_NAME}, a knowledgeable learning companion.
            Current Mode: {mode_desc}
            
            ## Persistent Memory & Context
            {agent_memory}
            {study_instruction}
            {task_signal}
            
            Your goal is to help the user explore the knowledge graph and reflect on their learning.
            {tutor_layer}
            {learned_style_hint}
            {f"STIMULUS: The student is confused. Your reply should be derived from this explanation: {fog_result['explanation']}" if fog_result else ""}
            
            Knowledge Graph Context:
            {graph_context}
            {memory_context}
            
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

            # If the utterance looks unfinished, wait for continuation rather than replying too early.
            if should_speak:
                if self._is_likely_incomplete_utterance(last_transcript) and not is_yield_turn(last_transcript):
                    should_speak = False

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
                asyncio.create_task(_bg_task(self.save_interaction(session_id, last_transcript, agent_reply), "save_interaction"))
                if policy_changed:
                    asyncio.create_task(_bg_task(self.set_session_policy(session_id, policy), "set_session_policy"))

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

                    asyncio.create_task(_bg_task(_extract_facts_bg(), "extract_facts"))

                # Persist transcript chunks + extracted learning signals as artifacts (additive)
                try:
                    started_at_ms = get_voice_session_started_at_ms(
                        voice_session_id=session_id,
                        user_id=self.user_id,
                        tenant_id=self.tenant_id,
                    )
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
