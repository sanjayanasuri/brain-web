"""
Text-to-speech helpers (backend-driven voice pipeline).

We synthesize using OpenAI TTS and return audio bytes (mp3 by default).
This is designed to be used over WebSockets, chunked sentence-by-sentence.
"""

from __future__ import annotations

import logging
import re
from typing import Iterable, List, Optional

from openai import OpenAI

from config import OPENAI_API_KEY

logger = logging.getLogger("brain_web")

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def _get_openai_client() -> OpenAI:
    key = (OPENAI_API_KEY or "").strip().strip('"').strip("'")
    if not key:
        raise ValueError("OPENAI_API_KEY not configured")
    return OpenAI(api_key=key)


def map_tutor_voice_id_to_openai_voice(voice_id: Optional[str]) -> str:
    """
    Map Brain Web TutorProfile.voice_id (tone) to an OpenAI TTS voice.
    Keep this conservative; it’s easy to expand later.
    """
    v = (voice_id or "").strip().lower()
    if v == "friendly":
        return "nova"
    if v == "direct":
        return "onyx"
    if v == "playful":
        return "shimmer"
    return "alloy"


def tts_instructions_for_voice_id(voice_id: Optional[str]) -> str:
    v = (voice_id or "").strip().lower()
    if v == "friendly":
        return "Warm, friendly, supportive. Clear articulation."
    if v == "direct":
        return "Straightforward, crisp, no filler. Clear articulation."
    if v == "playful":
        return "Light and engaging, but not silly. Clear articulation."
    return "Professional, clear, calm."


def split_sentences(text: str, *, max_chars: int = 240) -> List[str]:
    """
    Best-effort sentence splitting with a max char cap per segment to keep TTS latency low.
    """
    raw = (text or "").strip()
    if not raw:
        return []
    parts = [p.strip() for p in _SENTENCE_SPLIT_RE.split(raw) if p.strip()]

    out: List[str] = []
    for p in parts:
        if len(p) <= max_chars:
            out.append(p)
            continue
        # Soft wrap long segments.
        start = 0
        while start < len(p):
            chunk = p[start : start + max_chars].strip()
            if chunk:
                out.append(chunk)
            start += max_chars
    return out


def synthesize_speech_bytes(
    text: str,
    *,
    voice: str = "alloy",
    speed: float = 1.0,
    response_format: str = "mp3",
    preferred_model: str = "gpt-4o-mini-tts",
    fallback_model: str = "tts-1",
    instructions: Optional[str] = None,
) -> bytes:
    """
    Synthesize speech and return audio bytes.

    Uses `gpt-4o-mini-tts` first to allow optional `instructions`, then falls back to `tts-1`.
    """
    value = (text or "").strip()
    if not value:
        return b""

    client = _get_openai_client()

    # First try the preferred model (supports instructions).
    try:
        resp = client.audio.speech.create(
            model=preferred_model,
            voice=voice,
            input=value,
            response_format=response_format,  # type: ignore[arg-type]
            speed=speed,
            instructions=instructions or "",
        )
        return bytes(resp.content)
    except Exception as e:
        logger.warning(f"[TTS] Preferred model failed; falling back: {e}")

    resp = client.audio.speech.create(
        model=fallback_model,
        voice=voice,
        input=value,
        response_format=response_format,  # type: ignore[arg-type]
        speed=speed,
    )
    return bytes(resp.content)

