"""
WebSocket endpoint for the Browser Extension Voice Assistant.
Implements a simple protocol:
1. Receive JSON context (page title, url, text).
2. Receive binary WebM audio chunks.
3. Server-side VAD detects speech end.
4. STT -> VoiceAgentOrchestrator -> TTS.
5. Send binary audio back to client.
"""

import json
import asyncio
import logging
import time
from typing import Optional, Dict, Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from services_voice_agent import VoiceAgentOrchestrator
from services_stt import transcribe_wav_bytes, wav_bytes_from_pcm16
from services_tts import synthesize_speech_bytes, map_tutor_voice_id_to_openai_voice
from services_vad import VadConfig, VadUtteranceSegmenter, get_speech_detector

logger = logging.getLogger("brain_web")

router = APIRouter(prefix="/voice", tags=["voice-extension"])

@router.websocket("/session")
async def voice_session_ws(
    websocket: WebSocket,
    user_id: str = Query("guest"),
    tenant_id: str = Query("demo"),
):
    await websocket.accept()
    logger.info(f"Extension Voice Session started for user={user_id}, tenant={tenant_id}")

    orchestrator = VoiceAgentOrchestrator(user_id, tenant_id)
    
    # State
    session_id: Optional[str] = None
    graph_id = "default"
    branch_id = "main"
    current_context: Dict[str, Any] = {}
    
    # VAD & Decoder setup
    vad_config = VadConfig(end_silence_ms=1000) # Slightly more relaxed for casual browsing
    segmenter = VadUtteranceSegmenter(get_speech_detector(vad_config), vad_config)
    
    # FFmpeg decoder process
    decoder_proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-loglevel", "error",
        "-hide_banner",
        "-fflags", "nobuffer",
        "-flags", "low_delay",
        "-vn", "-f", "webm", "-i", "pipe:0",
        "-ac", "1", "-ar", str(vad_config.sample_rate_hz),
        "-f", "s16le", "pipe:1",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    async def send_status(status: str):
        try:
            await websocket.send_text(json.dumps({"type": "agent_status", "status": status}))
        except: pass

    async def process_utterance(pcm16: bytes):
        nonlocal session_id
        await send_status("Thinking...")
        
        try:
            # 1. PCM -> WAV -> STT
            wav_bytes = wav_bytes_from_pcm16(pcm16, sample_rate_hz=vad_config.sample_rate_hz)
            transcript = await asyncio.to_thread(transcribe_wav_bytes, wav_bytes)
            transcript = (transcript or "").strip()
            
            if not transcript:
                await send_status("Listening...")
                return

            logger.info(f"Voice Extension Transcript: {transcript}")

            # 2. Start session if needed
            if not session_id:
                session_data = await orchestrator.start_session(
                    graph_id=graph_id,
                    branch_id=branch_id,
                    metadata={"source": "extension", "context": current_context}
                )
                session_id = session_data["session_id"]

            # 3. Get AI Response
            # We use a condensed version of the context fetch for the extension
            result = await orchestrator.get_interaction_context(
                graph_id=graph_id,
                branch_id=branch_id,
                last_transcript=transcript,
                session_id=session_id
            )
            
            agent_response = result.get("agent_response")
            if agent_response:
                await send_status("Speaking...")
                # 4. TTS
                voice_id = map_tutor_voice_id_to_openai_voice("alloy") # Default for extension
                audio_bytes = await asyncio.to_thread(
                    synthesize_speech_bytes,
                    agent_response,
                    voice=voice_id,
                    response_format="mp3"
                )
                
                if audio_bytes:
                    await websocket.send_bytes(audio_bytes)
            
            await send_status("Listening...")
            
        except Exception as e:
            logger.error(f"Error processing voice utterance: {e}", exc_info=True)
            await send_status("Error occurred")

    # Decoder reader task
    async def decoder_reader():
        try:
            while True:
                pcm = await decoder_proc.stdout.read(4096)
                if not pcm: break
                
                segments = segmenter.process_pcm16(pcm)
                for seg in segments:
                    # Run processing in a task so we don't block audio feeding
                    asyncio.create_task(process_utterance(seg.pcm16))
        except Exception as e:
            logger.error(f"Decoder reader error: {e}")

    reader_task = asyncio.create_task(decoder_reader())

    try:
        while True:
            message = await websocket.receive()
            
            if "text" in message:
                try:
                    data = json.loads(message["text"])
                    if data.get("type") == "context":
                        current_context = data.get("content", {})
                        logger.info(f"Received page context: {current_context.get('title')}")
                except: pass
            
            elif "bytes" in message:
                chunk = message["bytes"]
                if decoder_proc.stdin:
                    decoder_proc.stdin.write(chunk)
                    await decoder_proc.stdin.drain()

    except WebSocketDisconnect:
        logger.info("Voice Extension WebSocket disconnected")
    except Exception as e:
        logger.error(f"Voice Extension WebSocket error: {e}")
    finally:
        reader_task.cancel()
        if decoder_proc:
            try: decoder_proc.terminate()
            except: pass
        if session_id:
            # We don't have duration tokens here easily, but we can stop it
            await orchestrator.stop_session(session_id, 0, 0)
