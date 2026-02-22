"""
WebSocket-based voice streaming (WebM/Opus) with short-lived ticket auth.

Additive only: this does not replace existing `/voice-agent/*` HTTP flows.
Supports a backend voice pipeline (Whisper STT + server VAD + OpenAI TTS), including an STT-only mode.
"""

from __future__ import annotations

import logging
import secrets
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect

from auth import require_auth
from cache_utils import get_cached, invalidate_cache, set_cached
from db_neo4j import neo4j_session
from services_tutor_profile import get_tutor_profile as get_tutor_profile_service
from services_voice_agent import VoiceAgentOrchestrator
from services_voice_style_profile import (
    get_adaptive_vad_config_for_user,
    observe_voice_interrupt,
    observe_voice_turn,
)
from services_stt import transcribe_wav_bytes, transcribe_webm_bytes, wav_bytes_from_pcm16
from services_tts import (
    map_tutor_voice_id_to_openai_voice,
    split_sentences,
    synthesize_speech_bytes,
    tts_instructions_for_voice_id,
)
from services_vad import VadConfig, VadUtteranceSegmenter, get_speech_detector

logger = logging.getLogger("brain_web")

router = APIRouter(prefix="/voice-stream", tags=["voice-stream"])

_TICKET_TTL_SECONDS = 60
_TICKET_CACHE_NAME = "voice_stream_ticket"
_MAX_UTTERANCE_BYTES = 12 * 1024 * 1024  # 12MB safety cap
_MAX_PCM_UTTERANCE_BYTES = 3 * 1024 * 1024  # ~90s @ 16kHz mono PCM16 (hard cap)


def _issue_ticket(*, user_id: str, tenant_id: str) -> str:
    ticket = "VST_" + secrets.token_urlsafe(24)
    payload = {
        "user_id": user_id,
        "tenant_id": tenant_id,
        "issued_at": int(time.time()),
    }
    set_cached(_TICKET_CACHE_NAME, payload, ticket, ttl_seconds=_TICKET_TTL_SECONDS)
    return ticket


def consume_ticket(ticket: str) -> Optional[Dict[str, Any]]:
    """
    Validate + consume a short-lived WebSocket ticket (one-time use).
    Returns the ticket payload if valid, otherwise None.
    """
    t = (ticket or "").strip()
    if not t:
        return None
    payload = get_cached(_TICKET_CACHE_NAME, t)
    if not payload:
        return None
    invalidate_cache(_TICKET_CACHE_NAME, t)
    if isinstance(payload, dict):
        return payload
    return None


@router.post("/ticket")
def issue_voice_stream_ticket(auth: dict = Depends(require_auth)):
    """
    Issue a short-lived, one-time ticket used to authenticate a WebSocket connection.

    Client flow:
    1) POST /voice-stream/ticket with Authorization: Bearer <JWT>
    2) Connect to WS with ?ticket=... (no JWT in URL)
    """
    user_id = auth.get("user_id")
    tenant_id = auth.get("tenant_id")
    if not user_id or not tenant_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    ticket = _issue_ticket(user_id=str(user_id), tenant_id=str(tenant_id))
    return {"ticket": ticket, "expires_in_seconds": _TICKET_TTL_SECONDS}


@dataclass(frozen=True)
class _QueuedUtterance:
    pcm16: bytes
    start_epoch_ms: int
    end_epoch_ms: int
    speech_ms: int


@router.websocket("/ws")
async def voice_stream_ws(websocket: WebSocket):
    """
    Full-duplex voice streaming WebSocket.

    Protocol (v0/v1, additive):
      - Client connects with `?ticket=...` (one-time ticket from POST /voice-stream/ticket)
      - Client sends JSON:
          { "type": "start", "graph_id": "...", "branch_id": "...", "session_id": "...", "is_scribe_mode": false }
      - Client sends binary frames (WebM/Opus chunks) while recording.
      - v0 (client-delimited): Client sends JSON: { "type": "end_utterance" } to trigger STT → VoiceAgent → TTS.
      - v1 (server VAD): Client sets { "vad_mode": "server", "vad_config": {...} } in "start" and streams continuously.
      - Server responds with JSON { type: "agent_reply", ... } and optional TTS chunks:
          { type: "tts_start", seq: 1, format: "mp3", voice: "alloy" }
          <binary audio>
          { type: "tts_end", seq: 1 }
    """
    ticket = websocket.query_params.get("ticket") or ""
    payload = consume_ticket(ticket)
    if not payload:
        await websocket.close(code=1008)
        return

    user_id = str(payload.get("user_id") or "")
    tenant_id = str(payload.get("tenant_id") or "")
    if not user_id or not tenant_id:
        await websocket.close(code=1008)
        return

    await websocket.accept()

    orchestrator = VoiceAgentOrchestrator(user_id, tenant_id)

    send_lock = asyncio.Lock()

    graph_id = "default"
    branch_id = "main"
    session_id: Optional[str] = None
    is_scribe_mode = False
    pipeline = "agent"  # "agent" (STT → agent → TTS) | "stt" (STT only)

    vad_mode = "client"  # "client" | "server"
    vad_config = VadConfig()
    segmenter: Optional[VadUtteranceSegmenter] = None
    stream_started_at_ms: Optional[int] = None

    decoder_proc: Optional[asyncio.subprocess.Process] = None
    decoder_in_q: Optional[asyncio.Queue] = None
    decoder_writer_task: Optional[asyncio.Task] = None
    decoder_reader_task: Optional[asyncio.Task] = None
    decoder_stderr_task: Optional[asyncio.Task] = None

    # Cap at 4 utterances — under normal use the queue should never exceed 1.
    # If the agent pipeline is consistently slower than speech, we drop the
    # oldest pending utterance rather than growing memory unboundedly.
    utterance_q: "asyncio.Queue[_QueuedUtterance]" = asyncio.Queue(maxsize=4)
    utterance_worker_task: Optional[asyncio.Task] = None

    audio_buf: bytearray = bytearray()
    audio_first_ms: Optional[int] = None
    audio_last_ms: Optional[int] = None

    tts_cancelled = False
    _interrupt_event: asyncio.Event = asyncio.Event()
    session_voice_id: Optional[str] = None
    session_voice_resolved = False

    async def _send_json(obj: Dict[str, Any]) -> None:
        async with send_lock:
            await websocket.send_text(json.dumps(obj))

    async def _send_bytes(data: bytes) -> None:
        async with send_lock:
            await websocket.send_bytes(data)

    async def _handle_interrupt() -> None:
        nonlocal tts_cancelled
        tts_cancelled = True
        _interrupt_event.set()
        # Drain the utterance queue so queued items don't process after interrupt
        while not utterance_q.empty():
            try:
                utterance_q.get_nowait()
            except asyncio.QueueEmpty:
                break
        await _send_json({"type": "interrupted"})

    async def _resolve_session_voice_once() -> Optional[str]:
        """
        Resolve TutorProfile voice_id once per WS session.
        This avoids mid-session voice switching when profile fetch intermittently fails.
        """
        nonlocal session_voice_id, session_voice_resolved
        if session_voice_resolved:
            return session_voice_id

        session_voice_resolved = True
        try:
            with neo4j_session() as neo_session:
                tp = get_tutor_profile_service(neo_session, user_id=user_id)
                vid = getattr(tp, "voice_id", None) if tp else None
                if isinstance(vid, str) and vid.strip():
                    session_voice_id = vid.strip()
        except Exception:
            # Keep None -> backend maps to default voice consistently for this session.
            session_voice_id = None
        return session_voice_id

    async def _run_tts_stream(*, text: str, voice_id: Optional[str], speech_rate: float) -> None:
        nonlocal tts_cancelled
        tts_cancelled = False
        _interrupt_event.clear()  # Reset per-stream so each reply starts clean

        openai_voice = map_tutor_voice_id_to_openai_voice(voice_id)
        instructions = tts_instructions_for_voice_id(voice_id)

        # Raised ceiling from 1.25 → 2.0; comfortable floor stays at 0.85
        speed = max(0.85, min(2.0, float(speech_rate or 1.0)))

        # Shorter segments (160 chars) start audio sooner; queue handles sequential playback
        segments = split_sentences(text, max_chars=160)
        if not segments:
            return

        for idx, seg in enumerate(segments, start=1):
            if tts_cancelled or _interrupt_event.is_set():
                break
            await _send_json(
                {
                    "type": "tts_start",
                    "seq": idx,
                    "format": "mp3",
                    "voice": openai_voice,
                    "text": seg[:120],
                }
            )
            try:
                # Race synthesis against an interrupt so we don't block mid-segment
                synth_task = asyncio.create_task(
                    asyncio.to_thread(
                        synthesize_speech_bytes,
                        seg,
                        voice=openai_voice,
                        speed=speed,
                        response_format="mp3",
                        instructions=instructions,
                    )
                )
                interrupt_wait = asyncio.create_task(_interrupt_event.wait())
                done, pending = await asyncio.wait(
                    {synth_task, interrupt_wait}, return_when=asyncio.FIRST_COMPLETED
                )
                for p in pending:
                    p.cancel()
                if _interrupt_event.is_set():
                    tts_cancelled = True
                    break
                audio_bytes = synth_task.result()
            except Exception as e:
                await _send_json({"type": "tts_error", "message": str(e)[:300], "seq": idx})
                break

            if tts_cancelled or _interrupt_event.is_set():
                break
            if audio_bytes:
                await _send_bytes(audio_bytes)
            await _send_json({"type": "tts_end", "seq": idx})

        await _send_json({"type": "tts_done"})

    async def _process_utterance_webm(*, client_start_ms: Optional[int] = None, client_end_ms: Optional[int] = None) -> None:
        nonlocal audio_buf, audio_first_ms, audio_last_ms
        if not audio_buf:
            await _send_json({"type": "warning", "message": "No audio received."})
            return

        # Snapshot + clear buffer early to allow next recording immediately.
        webm_bytes = bytes(audio_buf)
        start_ms = client_start_ms if isinstance(client_start_ms, int) else audio_first_ms
        end_ms = client_end_ms if isinstance(client_end_ms, int) else audio_last_ms
        audio_buf = bytearray()
        audio_first_ms = None
        audio_last_ms = None

        try:
            transcript = await asyncio.to_thread(transcribe_webm_bytes, webm_bytes)
        except Exception as e:
            await _send_json({"type": "stt_error", "message": str(e)[:400]})
            return

        transcript = (transcript or "").strip()
        await _send_json({"type": "transcript", "text": transcript, "final": True})
        if not transcript:
            return

        # Learn per-user speaking style from this utterance (best effort, non-blocking).
        try:
            span_ms: Optional[int] = None
            if isinstance(start_ms, int) and isinstance(end_ms, int) and end_ms > start_ms:
                span_ms = int(end_ms - start_ms)
            asyncio.create_task(
                asyncio.to_thread(
                    observe_voice_turn,
                    user_id=user_id,
                    tenant_id=tenant_id,
                    transcript=transcript,
                    speech_ms=span_ms,
                    utterance_span_ms=span_ms,
                )
            )
        except Exception:
            pass

        if pipeline != "agent":
            return

        try:
            result = await orchestrator.get_interaction_context(
                graph_id,
                branch_id,
                transcript,
                is_scribe_mode,
                session_id,
                client_start_ms=start_ms,
                client_end_ms=end_ms,
            )
        except Exception as e:
            await _send_json({"type": "agent_error", "message": str(e)[:400]})
            return

        agent_response = result.get("agent_response") or ""
        should_speak = result.get("should_speak", True) is not False
        speech_rate = float(result.get("speech_rate") or 1.0)
        policy = result.get("policy") or {}

        await _send_json(
            {
                "type": "agent_reply",
                "transcript": transcript,
                "agent_response": agent_response,
                "should_speak": should_speak,
                "speech_rate": speech_rate,
                "policy": policy,
                "learning_signals": result.get("learning_signals", []),
                "is_eureka": result.get("is_eureka", False),
                "is_fog_clearing": result.get("is_fog_clearing", False),
                "fog_node_id": result.get("fog_node_id"),
                "user_transcript_chunk": result.get("user_transcript_chunk"),
                "assistant_transcript_chunk": result.get("assistant_transcript_chunk"),
                "actions": result.get("actions", []),
                "action_summaries": result.get("action_summaries", []),
            }
        )

        if not should_speak or not agent_response:
            return

        voice_id = await _resolve_session_voice_once()
        await _run_tts_stream(text=agent_response, voice_id=voice_id, speech_rate=speech_rate)

    async def _process_utterance_pcm(utt: _QueuedUtterance) -> None:
        if not utt.pcm16:
            return
        if len(utt.pcm16) > _MAX_PCM_UTTERANCE_BYTES:
            await _send_json({"type": "warning", "message": "Utterance too long; please speak in shorter segments."})
            return

        wav_bytes = b""
        try:
            wav_bytes = wav_bytes_from_pcm16(utt.pcm16, sample_rate_hz=vad_config.sample_rate_hz, channels=1)
        except Exception as e:
            await _send_json({"type": "stt_error", "message": f"Failed to build WAV: {str(e)[:240]}"})
            return

        try:
            transcript = await asyncio.to_thread(transcribe_wav_bytes, wav_bytes)
        except Exception as e:
            await _send_json({"type": "stt_error", "message": str(e)[:400]})
            return

        transcript = (transcript or "").strip()
        await _send_json({"type": "transcript", "text": transcript, "final": True})
        if not transcript:
            return

        # Learn per-user speaking style from this utterance (best effort, non-blocking).
        try:
            span_ms = max(1, int(utt.end_epoch_ms) - int(utt.start_epoch_ms))
            asyncio.create_task(
                asyncio.to_thread(
                    observe_voice_turn,
                    user_id=user_id,
                    tenant_id=tenant_id,
                    transcript=transcript,
                    speech_ms=int(utt.speech_ms),
                    utterance_span_ms=int(span_ms),
                )
            )
        except Exception:
            pass

        if pipeline != "agent":
            return

        try:
            result = await orchestrator.get_interaction_context(
                graph_id,
                branch_id,
                transcript,
                is_scribe_mode,
                session_id,
                client_start_ms=int(utt.start_epoch_ms),
                client_end_ms=int(utt.end_epoch_ms),
            )
        except Exception as e:
            await _send_json({"type": "agent_error", "message": str(e)[:400]})
            return

        agent_response = result.get("agent_response") or ""
        should_speak = result.get("should_speak", True) is not False
        speech_rate = float(result.get("speech_rate") or 1.0)
        policy = result.get("policy") or {}

        await _send_json(
            {
                "type": "agent_reply",
                "transcript": transcript,
                "agent_response": agent_response,
                "should_speak": should_speak,
                "speech_rate": speech_rate,
                "policy": policy,
                "learning_signals": result.get("learning_signals", []),
                "is_eureka": result.get("is_eureka", False),
                "is_fog_clearing": result.get("is_fog_clearing", False),
                "fog_node_id": result.get("fog_node_id"),
                "user_transcript_chunk": result.get("user_transcript_chunk"),
                "assistant_transcript_chunk": result.get("assistant_transcript_chunk"),
                "actions": result.get("actions", []),
                "action_summaries": result.get("action_summaries", []),
            }
        )

        if not should_speak or not agent_response:
            return

        voice_id = await _resolve_session_voice_once()
        await _run_tts_stream(text=agent_response, voice_id=voice_id, speech_rate=speech_rate)

    async def _utterance_worker() -> None:
        while True:
            utt = await utterance_q.get()
            try:
                await _send_json(
                    {
                        "type": "processing_start",
                        "start_epoch_ms": utt.start_epoch_ms,
                        "end_epoch_ms": utt.end_epoch_ms,
                        "speech_ms": utt.speech_ms,
                    }
                )
                await _process_utterance_pcm(utt)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                await _send_json({"type": "error", "message": f"Utterance worker error: {str(e)[:240]}"})

    async def _ensure_decoder() -> None:
        nonlocal decoder_proc, decoder_in_q, decoder_writer_task, decoder_reader_task, decoder_stderr_task
        nonlocal segmenter, stream_started_at_ms

        if decoder_proc:
            return

        stream_started_at_ms = int(time.time() * 1000)
        segmenter = VadUtteranceSegmenter(get_speech_detector(vad_config), vad_config)
        decoder_in_q = asyncio.Queue(maxsize=64)

        decoder_proc = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-loglevel",
            "error",
            "-hide_banner",
            "-fflags",
            "nobuffer",
            "-flags",
            "low_delay",
            "-vn",
            "-f",
            "webm",
            "-i",
            "pipe:0",
            "-ac",
            "1",
            "-ar",
            str(vad_config.sample_rate_hz),
            "-f",
            "s16le",
            "pipe:1",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        async def _decoder_writer() -> None:
            assert decoder_proc and decoder_proc.stdin and decoder_in_q
            try:
                while True:
                    chunk = await decoder_in_q.get()
                    if not isinstance(chunk, (bytes, bytearray)) or not chunk:
                        continue
                    decoder_proc.stdin.write(bytes(chunk))
                    await decoder_proc.stdin.drain()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                await _send_json({"type": "error", "message": f"Decoder writer failed: {str(e)[:200]}"})

        async def _decoder_reader() -> None:
            assert decoder_proc and decoder_proc.stdout and segmenter and stream_started_at_ms is not None
            try:
                while True:
                    pcm = await decoder_proc.stdout.read(4096)
                    if not pcm:
                        break
                    segments = segmenter.process_pcm16(pcm)
                    speech_start_sample = segmenter.pop_speech_start_sample()
                    if speech_start_sample is not None:
                        start_ms = stream_started_at_ms + int(speech_start_sample * 1000 / vad_config.sample_rate_hz)
                        await _send_json(
                            {
                                "type": "vad_speech_start",
                                "start_epoch_ms": start_ms,
                            }
                        )
                    for seg in segments:
                        start_ms = stream_started_at_ms + int(seg.start_sample * 1000 / vad_config.sample_rate_hz)
                        end_ms = stream_started_at_ms + int(seg.end_sample * 1000 / vad_config.sample_rate_hz)
                        await _send_json(
                            {
                                "type": "vad_utterance_end",
                                "start_epoch_ms": start_ms,
                                "end_epoch_ms": end_ms,
                                "speech_ms": seg.speech_ms,
                            }
                        )
                        try:
                            utterance_q.put_nowait(
                                _QueuedUtterance(
                                    pcm16=seg.pcm16,
                                    start_epoch_ms=start_ms,
                                    end_epoch_ms=end_ms,
                                    speech_ms=seg.speech_ms,
                                )
                            )
                        except asyncio.QueueFull:
                            # Pipeline is behind — drop oldest utterance, keep newest
                            try:
                                utterance_q.get_nowait()
                            except asyncio.QueueEmpty:
                                pass
                            await _send_json({"type": "warning", "message": "Pipeline busy; dropping oldest queued utterance."})
                            await utterance_q.put(
                                _QueuedUtterance(
                                    pcm16=seg.pcm16,
                                    start_epoch_ms=start_ms,
                                    end_epoch_ms=end_ms,
                                    speech_ms=seg.speech_ms,
                                )
                            )
            except asyncio.CancelledError:
                raise
            except Exception as e:
                await _send_json({"type": "error", "message": f"Decoder reader failed: {str(e)[:240]}"})

        async def _decoder_stderr() -> None:
            assert decoder_proc and decoder_proc.stderr
            try:
                while True:
                    line = await decoder_proc.stderr.readline()
                    if not line:
                        break
                    logger.debug(f"[voice-stream][ffmpeg] {line.decode(errors='ignore').strip()}")
            except asyncio.CancelledError:
                raise
            except Exception:
                return

        decoder_writer_task = asyncio.create_task(_decoder_writer())
        decoder_reader_task = asyncio.create_task(_decoder_reader())
        decoder_stderr_task = asyncio.create_task(_decoder_stderr())

    try:
        await _send_json({"type": "ready"})
        while True:
            message = await websocket.receive()

            if message.get("type") == "websocket.disconnect":
                break

            if "text" in message and message["text"] is not None:
                try:
                    obj = json.loads(message["text"])
                except Exception:
                    await _send_json({"type": "error", "message": "Invalid JSON"})
                    continue

                mtype = str(obj.get("type") or "").strip()
                if mtype == "start":
                    raw_pipeline = str(obj.get("pipeline") or obj.get("mode") or pipeline).strip().lower()
                    if raw_pipeline in ("stt_only", "stt-only"):
                        raw_pipeline = "stt"
                    if raw_pipeline not in ("agent", "stt"):
                        await _send_json(
                            {
                                "type": "error",
                                "message": f"Invalid pipeline: {raw_pipeline}. Supported: agent, stt",
                            }
                        )
                        continue
                    pipeline = raw_pipeline

                    graph_id = str(obj.get("graph_id") or graph_id)
                    branch_id = str(obj.get("branch_id") or branch_id)
                    is_scribe_mode = bool(obj.get("is_scribe_mode", False))
                    session_id = obj.get("session_id") or session_id
                    if str(obj.get("vad_mode") or "").strip().lower() == "server":
                        vad_mode = "server"
                        vad_config = VadConfig.from_dict(obj.get("vad_config") if isinstance(obj.get("vad_config"), dict) else None)
                        # Apply per-account adaptive VAD overrides when enough data exists.
                        try:
                            learned_vad = await asyncio.to_thread(
                                get_adaptive_vad_config_for_user,
                                user_id=user_id,
                                tenant_id=tenant_id,
                            )
                            if learned_vad:
                                merged = {
                                    "sample_rate_hz": vad_config.sample_rate_hz,
                                    "frame_ms": vad_config.frame_ms,
                                    "speech_threshold": vad_config.speech_threshold,
                                    "end_silence_ms": vad_config.end_silence_ms,
                                    "min_speech_ms": vad_config.min_speech_ms,
                                    "pre_roll_ms": vad_config.pre_roll_ms,
                                    "max_utterance_ms": vad_config.max_utterance_ms,
                                    "engine": vad_config.engine,
                                    "silero_model_path": vad_config.silero_model_path,
                                }
                                merged.update(learned_vad)
                                vad_config = VadConfig.from_dict(merged)
                        except Exception:
                            pass
                        # Ensure background worker/decoder is started once we have a session.
                    if pipeline == "agent" and not session_id:
                        try:
                            meta = obj.get("metadata")
                            session = await orchestrator.start_session(
                                graph_id=graph_id,
                                branch_id=branch_id,
                                metadata=meta if isinstance(meta, dict) else None,
                            )
                            session_id = session.get("session_id")
                        except Exception as e:
                            await _send_json({"type": "error", "message": f"Failed to start session: {str(e)[:200]}"})
                            continue

                    # Keep one stable voice per session.
                    await _resolve_session_voice_once()

                    if vad_mode == "server":
                        if utterance_worker_task is None:
                            utterance_worker_task = asyncio.create_task(_utterance_worker())
                        await _ensure_decoder()
                    await _send_json(
                        {
                            "type": "started",
                            "graph_id": graph_id,
                            "branch_id": branch_id,
                            "session_id": session_id,
                            "pipeline": pipeline,
                        }
                    )
                elif mtype == "end_utterance":
                    cs = obj.get("client_start_ms")
                    ce = obj.get("client_end_ms")
                    if vad_mode == "server":
                        # Best-effort flush for push-to-talk callers; may be partial if decoder is lagging.
                        if segmenter and stream_started_at_ms is not None:
                            seg = segmenter.flush()
                            if seg:
                                start_ms = stream_started_at_ms + int(seg.start_sample * 1000 / vad_config.sample_rate_hz)
                                end_ms = stream_started_at_ms + int(seg.end_sample * 1000 / vad_config.sample_rate_hz)
                                await utterance_q.put(
                                    _QueuedUtterance(
                                        pcm16=seg.pcm16,
                                        start_epoch_ms=start_ms,
                                        end_epoch_ms=end_ms,
                                        speech_ms=seg.speech_ms,
                                    )
                                )
                    else:
                        await _process_utterance_webm(
                            client_start_ms=int(cs) if cs is not None else None,
                            client_end_ms=int(ce) if ce is not None else None,
                        )
                elif mtype == "interrupt":
                    # Learn barge-in tendency (best effort).
                    try:
                        asyncio.create_task(
                            asyncio.to_thread(observe_voice_interrupt, user_id=user_id, tenant_id=tenant_id)
                        )
                    except Exception:
                        pass
                    _interrupt_event.set()  # Signal immediately; _handle_interrupt will also set it
                    await _handle_interrupt()
                elif mtype == "ping":
                    await _send_json({"type": "pong"})
                elif mtype == "stop":
                    await _send_json({"type": "bye"})
                    break
                else:
                    await _send_json({"type": "error", "message": f"Unknown message type: {mtype}"})

            if "bytes" in message and message["bytes"] is not None:
                chunk = message["bytes"]
                if not isinstance(chunk, (bytes, bytearray)):
                    continue
                if vad_mode == "server":
                    if decoder_in_q is None:
                        # Wait for "start" to configure the decoder.
                        continue
                    try:
                        decoder_in_q.put_nowait(bytes(chunk))
                    except asyncio.QueueFull:
                        await _send_json({"type": "warning", "message": "Audio backlog (server busy). Dropping some audio."})
                else:
                    if audio_first_ms is None:
                        audio_first_ms = int(time.time() * 1000)
                    audio_last_ms = int(time.time() * 1000)
                    if len(audio_buf) + len(chunk) > _MAX_UTTERANCE_BYTES:
                        await _send_json({"type": "error", "message": "Utterance too large; please speak in shorter segments."})
                        audio_buf = bytearray()
                        continue
                    audio_buf.extend(chunk)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await _send_json({"type": "error", "message": str(e)[:400]})
        except Exception:
            pass
        try:
            await websocket.close(code=1011)
        except Exception:
            pass
    finally:
        # Cleanup background tasks / decoder process.
        for t in (decoder_writer_task, decoder_reader_task, decoder_stderr_task, utterance_worker_task):
            if t:
                t.cancel()
        if decoder_proc and decoder_proc.stdin:
            try:
                decoder_proc.stdin.close()
            except Exception:
                pass
        if decoder_proc:
            try:
                decoder_proc.terminate()
            except Exception:
                pass
            try:
                await asyncio.wait_for(decoder_proc.wait(), timeout=1.5)
            except Exception:
                try:
                    decoder_proc.kill()
                except Exception:
                    pass
