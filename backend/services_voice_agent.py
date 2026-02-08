"""
Orchestrator for the Conversational Voice Agent.
Integrates GraphRAG, Supermemory AI, and usage tracking for a seamless voice experience.
"""
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime
import uuid

from db_neo4j import neo4j_session
from services_graphrag import retrieve_graphrag_context
from services_supermemory import search_memories, sync_learning_moment
from services_usage_tracker import log_usage, check_limit
from db_postgres import execute_update, execute_query
from config import VOICE_AGENT_NAME, OPENAI_API_KEY
from services_graph import create_concept, create_relationship
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

import json
import re
from openai import OpenAI

logger = logging.getLogger("brain_web")

class VoiceAgentOrchestrator:
    def __init__(self, user_id: str, tenant_id: str):
        self.user_id = user_id
        self.tenant_id = tenant_id
        self.client = None
        if OPENAI_API_KEY:
            self.client = OpenAI(api_key=OPENAI_API_KEY.strip().strip('"').strip("'"))

    async def start_session(self, graph_id: str, branch_id: str, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Initiate a new voice session with usage checking."""
        if not check_limit(self.user_id, 'voice_session'):
            raise Exception("Daily voice session limit reached.")

        session_id = str(uuid.uuid4())
        started_at = datetime.utcnow()

        query = """
        INSERT INTO voice_sessions (id, user_id, tenant_id, graph_id, branch_id, started_at, metadata)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """
        params = (session_id, self.user_id, self.tenant_id, graph_id, branch_id, started_at, metadata or {})
        
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
        if not history or not self.client:
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
            response = self.client.chat.completions.create(
                model="gpt-4o",
                messages=[{"role": "system", "content": prompt}],
                temperature=0.5
            )
            summary = response.choices[0].message.content

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
        query_fetch = "SELECT graph_id FROM voice_sessions WHERE id = %s"
        graph_res = execute_query(query_fetch, (session_id,))
        graph_id = graph_res[0]['graph_id'] if graph_res else None

        # 2. Synthesize session if possible
        if graph_id:
            await self.summarize_session(session_id, graph_id)

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
        if not self.client:
            return f"I heard you say: {user_transcript}, but my brain is currently offline."

        messages = [{"role": "system", "content": system_prompt}]
        
        # Add history (last 5 interactions for token efficiency)
        for entry in history[-5:]:
            messages.append({"role": "user", "content": entry["user"]})
            messages.append({"role": "assistant", "content": entry["agent"]})
            
        messages.append({"role": "user", "content": user_transcript})

        try:
            response = self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=messages,
                temperature=0.7,
                max_tokens=150
            )
            return response.choices[0].message.content
        except Exception as e:
            logger.error(f"Failed to generate agent reply: {e}")
            return f"I'm sorry, I encountered an error while thinking about that."

    async def detect_confusion(self, transcript: str) -> bool:
        """Heuristic and LLM check for user confusion."""
        keywords = ["don't understand", "confused", "what is", "explain", "help me with", "not sure about"]
        if any(k in transcript.lower() for k in keywords):
            # Double check with a quick LLM pass if needed, but heuristic is fine for MVP
            return True
        return False

    async def handle_fog_clearing(self, graph_id: str, transcript: str, context: str) -> Dict[str, Any]:
        """Generate a pedagogical explanation and save it as an 'UNDERSTANDING' node."""
        if not self.client:
            return {"reply": "I'd love to help, but I'm having trouble thinking clearly right now."}

        prompt = f"""
        The student is confused: "{transcript}"
        Based on this Knowledge Graph Context:
        {context}

        Provide a clear, simple, and pedagogical explanation. Avoid jargon. Use analogies if possible.
        Keep it under 100 words.
        """

        try:
            response = self.client.chat.completions.create(
                model="gpt-4o", # Use 4o for better pedagogical quality
                messages=[{"role": "system", "content": prompt}],
                temperature=0.7
            )
            explanation = response.choices[0].message.content

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
        """Retrieve conversation history from session metadata."""
        query = "SELECT metadata FROM voice_sessions WHERE id = %s AND user_id = %s"
        try:
            res = execute_query(query, (session_id, self.user_id))
            if res and res[0]['metadata']:
                return res[0]['metadata'].get('history', [])
            return []
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
        """Persist interaction to session metadata for continuity."""
        history = await self.get_session_history(session_id)
        history.append({
            "user": transcript,
            "agent": agent_response,
            "timestamp": datetime.utcnow().isoformat()
        })
        
        # Keep only last 20 for storage sanity
        history = history[-20:]
        
        query = """
        UPDATE voice_sessions
        SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{history}', %s::jsonb, true)
        WHERE id = %s AND user_id = %s
        """
        try:
            execute_update(query, (json.dumps(history), session_id, self.user_id))
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
            # 1. Load History for Continuity
            history = []
            if session_id:
                history = await self.get_session_history(session_id)

            # 1b. Load session policy (turn-taking/pacing)
            policy: Dict[str, Any] = {}
            if session_id:
                policy = await self.get_session_policy(session_id)
            if not isinstance(policy, dict):
                policy = {}

            extracted_signals = extract_learning_signals(last_transcript)
            policy, policy_changed = apply_signals_to_policy(policy, extracted_signals)

            # 2. Detect Intent
            is_confused = await self.detect_confusion(last_transcript)
            is_eureka = await self.handle_eureka_moment(last_transcript)
            
            # 2. Extract and Execute Commands (mostly for Scribe/Synthesis mode)
            actions = await self.extract_voice_commands(last_transcript, is_scribe_mode)
            action_summaries = await self.execute_voice_commands(actions)
            
            # 3. Fetch Context
            with neo4j_session() as neo_session:
                graphrag_data = retrieve_graphrag_context(
                    session=neo_session,
                    graph_id=graph_id,
                    branch_id=branch_id,
                    question=last_transcript
                )
            graph_context = graphrag_data.get("context_text", "")

            # 4. Handle Fog Clearing if student is confused
            fog_result = None
            if is_confused:
                fog_result = await self.handle_fog_clearing(graph_id, last_transcript, graph_context)

            # 5. Fetch from Supermemory
            personal_memories = await search_memories(self.user_id, last_transcript)
            memory_context = ""
            if personal_memories:
                memory_context = "\nPersonal Memory Context:\n" + "\n".join([m.get("content", "") for m in personal_memories])

            # 6. Combine into prompt
            mode_desc = "SCRIBE MODE" if is_scribe_mode else ("FOG-CLEARER MODE" if is_confused else "CONVERSATIONAL MODE")
            
            system_prompt = f"""
            You are {VOICE_AGENT_NAME}, a knowledgeable learning companion.
            Current Mode: {mode_desc}
            
            Your goal is to help the user explore the knowledge graph and reflect on their learning.
            {f"STIMULUS: The student is confused. Your reply should be derived from this explanation: {fog_result['explanation']}" if fog_result else ""}
            
            Knowledge Graph Context:
            {graph_context}
            {memory_context}
            
            Recent Actions Executed:
            {", ".join(action_summaries) if action_summaries else "None"}

            Instructions:
            - Keep responses concise and conversational.
            - Be direct: if the user asks whether something is correct, say yes/no and correct it if needed (no glazing).
            - If policy says no interruption, only speak when the user yields (asks a question or requests a response).
            - If policy says slow pacing, use short sentences and a slower cadence.
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
                    agent_reply = "Okay. I’ll slow down."
                else:
                    agent_reply = await self.generate_agent_reply(system_prompt, history, last_transcript)

            # 8. Save Interaction if session_id provided
            user_transcript_chunk = None
            assistant_transcript_chunk = None
            if session_id:
                await self.save_interaction(session_id, last_transcript, agent_reply)
                if policy_changed:
                    await self.set_session_policy(session_id, policy)

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
                "speech_rate": 0.9 if policy.get("pacing") == "slow" else 1.0,
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
        if not self.client:
            return []

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
            response = self.client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "system", "content": prompt}],
                temperature=0.1,
                response_format={"type": "json_object"}
            )
            data = json.loads(response.choices[0].message.content)
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
