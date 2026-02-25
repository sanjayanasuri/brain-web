"""
Speech-to-text helpers (backend-driven voice pipeline).

Primary target: MediaRecorder WebM/Opus chunks buffered server-side.
We transcribe using OpenAI Whisper (`whisper-1`) with an ffmpeg WAV fallback.
"""

from __future__ import annotations

import io
import logging
import os
import subprocess
import tempfile
from typing import Optional, Dict, Any, Union

import wave

from openai import OpenAI

from config import OPENAI_API_KEY

logger = logging.getLogger("brain_web")


def _get_openai_client() -> OpenAI:
    key = (OPENAI_API_KEY or "").strip().strip('"').strip("'")
    if not key:
        raise ValueError("OPENAI_API_KEY not configured")
    return OpenAI(api_key=key)


def _ffmpeg_to_wav(input_path: str) -> str:
    """
    Convert input audio to 16kHz mono WAV (PCM16) using ffmpeg.
    Returns output path (caller must delete).
    """
    out = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    out_path = out.name
    out.close()

    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        input_path,
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "wav",
        out_path,
    ]
    try:
        subprocess.run(
            cmd,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=20,
        )
        return out_path
    except Exception:
        try:
            os.unlink(out_path)
        except Exception:
            pass
        raise


def _transcribe_file(
    *,
    client: OpenAI,
    path: str,
    model: str,
    language: Optional[str],
) -> str:
    with open(path, "rb") as f:
        result = client.audio.transcriptions.create(
            model=model,
            file=f,
            language=language,
            response_format="text",
        )
    if isinstance(result, str):
        return result.strip()
    text = getattr(result, "text", None)
    if isinstance(text, str):
        return text.strip()
    return str(result).strip()


def wav_bytes_from_pcm16(
    pcm16_bytes: bytes,
    *,
    sample_rate_hz: int = 16000,
    channels: int = 1,
) -> bytes:
    """
    Wrap raw PCM16LE bytes into a WAV container and return WAV bytes.
    """
    if not pcm16_bytes:
        return b""
    if channels not in (1, 2):
        raise ValueError("channels must be 1 or 2")
    if sample_rate_hz <= 0:
        raise ValueError("sample_rate_hz must be positive")

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(int(channels))
        wf.setsampwidth(2)  # PCM16LE
        wf.setframerate(int(sample_rate_hz))
        wf.writeframes(pcm16_bytes)
    return buf.getvalue()


def transcribe_wav_bytes(
    audio_bytes: bytes,
    *,
    model: str = "whisper-1",
    language: Optional[str] = "en",
) -> str:
    """
    Transcribe WAV bytes using an in-memory buffer (no temp-file disk I/O).
    """
    if not audio_bytes:
        return ""

    client = _get_openai_client()

    buf = io.BytesIO(audio_bytes)
    buf.name = "audio.wav"  # OpenAI SDK uses the file extension to determine format
    result = client.audio.transcriptions.create(
        model=model,
        file=buf,
        language=language,
        response_format="text",
    )
    if isinstance(result, str):
        return result.strip()
    return (getattr(result, "text", None) or "").strip()


def transcribe_wav_with_metadata(
    audio_bytes: bytes,
    *,
    model: str = "whisper-1",
    language: Optional[str] = "en",
) -> Dict[str, Any]:
    """
    Transcribe WAV bytes and return the full verbose_json response (including timestamps).
    """
    if not audio_bytes:
        return {}

    client = _get_openai_client()
    buf = io.BytesIO(audio_bytes)
    buf.name = "audio.wav"
    
    # We use verbose_json to get segment and word level data if needed
    result = client.audio.transcriptions.create(
        model=model,
        file=buf,
        language=language,
        response_format="verbose_json",
        timestamp_granularities=["word", "segment"]
    )
    
    # The OpenAI SDK returns a Transcription object which can be cast to dict
    if hasattr(result, "model_dump"):
        return result.model_dump()
    return dict(result)


def transcribe_webm_bytes(
    audio_bytes: bytes,
    *,
    model: str = "whisper-1",
    language: Optional[str] = "en",
) -> str:
    """
    Transcribe WebM/Opus audio bytes.

    - First attempt: send as .webm directly to OpenAI transcription.
    - Fallback: convert to WAV via ffmpeg, then transcribe.
    """
    if not audio_bytes:
        return ""

    client = _get_openai_client()

    webm_tmp = tempfile.NamedTemporaryFile(suffix=".webm", delete=False)
    webm_path = webm_tmp.name
    try:
        webm_tmp.write(audio_bytes)
        webm_tmp.flush()
        webm_tmp.close()

        try:
            return _transcribe_file(client=client, path=webm_path, model=model, language=language)
        except Exception as e:
            logger.warning(f"[STT] WebM transcription failed; trying WAV fallback: {e}")

        wav_path = _ffmpeg_to_wav(webm_path)
        try:
            return _transcribe_file(client=client, path=wav_path, model=model, language=language)
        finally:
            try:
                os.unlink(wav_path)
            except Exception:
                pass
    finally:
        try:
            os.unlink(webm_path)
        except Exception:
            pass


def transcribe_webm_with_metadata(
    audio_bytes: bytes,
    *,
    model: str = "whisper-1",
    language: Optional[str] = "en",
) -> Dict[str, Any]:
    """
    Transcribe WebM bytes and return full metadata.
    """
    if not audio_bytes:
        return {}

    client = _get_openai_client()
    webm_tmp = tempfile.NamedTemporaryFile(suffix=".webm", delete=False)
    webm_path = webm_tmp.name
    try:
        webm_tmp.write(audio_bytes)
        webm_tmp.flush()
        webm_tmp.close()

        # Try WebM directly first
        try:
            with open(webm_path, "rb") as f:
                result = client.audio.transcriptions.create(
                    model=model,
                    file=f,
                    language=language,
                    response_format="verbose_json",
                    timestamp_granularities=["word", "segment"]
                )
                return result.model_dump() if hasattr(result, "model_dump") else dict(result)
        except Exception as e:
            logger.warning(f"[STT] WebM metadata transcription failed; trying WAV: {e}")

        wav_path = _ffmpeg_to_wav(webm_path)
        try:
            return transcribe_wav_with_metadata(open(wav_path, "rb").read(), model=model, language=language)
        finally:
            try:
                os.unlink(wav_path)
            except Exception:
                pass
    finally:
        try:
            os.unlink(webm_path)
        except Exception:
            pass
