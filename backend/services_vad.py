"""
Voice activity detection (server-side) helpers.

Energy VAD by default, with optional Silero VAD (when a local torchscript model is available).
Falls back safely so dev/test environments keep working without downloads.

Designed for streaming PCM16LE mono @ 16kHz.
"""

from __future__ import annotations

import logging
import os
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Deque, Dict, List, Optional

import numpy as np

logger = logging.getLogger("brain_web")


@dataclass(frozen=True)
class VadConfig:
    sample_rate_hz: int = 16000
    frame_ms: int = 30
    speech_threshold: float = 0.65
    end_silence_ms: int = 700
    min_speech_ms: int = 200
    pre_roll_ms: int = 240
    max_utterance_ms: int = 20000
    engine: str = "energy"  # "silero" | "energy"
    silero_model_path: Optional[str] = None

    @staticmethod
    def from_dict(raw: Optional[Dict[str, object]]) -> "VadConfig":
        if not isinstance(raw, dict):
            return VadConfig()

        def _int(key: str, default: int) -> int:
            v = raw.get(key, default)
            try:
                return int(v)  # type: ignore[arg-type]
            except Exception:
                return default

        def _float(key: str, default: float) -> float:
            v = raw.get(key, default)
            try:
                return float(v)  # type: ignore[arg-type]
            except Exception:
                return default

        def _str(key: str, default: str) -> str:
            v = raw.get(key, default)
            return str(v) if v is not None else default

        return VadConfig(
            sample_rate_hz=_int("sample_rate_hz", 16000),
            frame_ms=max(10, _int("frame_ms", 30)),
            speech_threshold=min(0.99, max(0.01, _float("speech_threshold", 0.5))),
            end_silence_ms=max(150, _int("end_silence_ms", 700)),
            min_speech_ms=max(50, _int("min_speech_ms", 200)),
            pre_roll_ms=max(0, _int("pre_roll_ms", 240)),
            max_utterance_ms=max(2000, _int("max_utterance_ms", 20000)),
            engine=_str("engine", "energy").strip().lower() or "energy",
            silero_model_path=(str(raw.get("silero_model_path")).strip() if raw.get("silero_model_path") else None),
        )


@dataclass(frozen=True)
class UtteranceSegment:
    pcm16: bytes
    start_sample: int
    end_sample: int
    speech_ms: int


class SpeechDetector:
    def speech_probability(self, pcm16_frame: bytes, *, sample_rate_hz: int) -> float:  # pragma: no cover - interface
        raise NotImplementedError


class EnergySpeechDetector(SpeechDetector):
    """
    Simple, dependency-light fallback: RMS energy mapped to [0..1].
    """

    def __init__(self, *, gain: float = 20.0):
        self.gain = float(gain)

    def speech_probability(self, pcm16_frame: bytes, *, sample_rate_hz: int) -> float:
        if not pcm16_frame:
            return 0.0
        samples = np.frombuffer(pcm16_frame, dtype=np.int16).astype(np.float32)
        if samples.size == 0:
            return 0.0
        rms = float(np.sqrt(np.mean(samples * samples)) / 32768.0)
        p = max(0.0, min(1.0, rms * self.gain))
        return p


class SileroSpeechDetector(SpeechDetector):
    """
    Silero VAD wrapper (requires a local torchscript model).

    We deliberately do not auto-download (network may be restricted). Provide the model
    via `SILERO_VAD_MODEL_PATH` or config.silero_model_path.
    """

    def __init__(self, *, model_path: str):
        try:
            import torch  # type: ignore
        except Exception as e:
            raise RuntimeError("torch is required for Silero VAD") from e

        p = Path(model_path).expanduser()
        if not p.exists():
            raise FileNotFoundError(f"Silero VAD model not found at {p}")

        self._torch = torch
        self._model = torch.jit.load(str(p), map_location="cpu")
        self._model.eval()

    def speech_probability(self, pcm16_frame: bytes, *, sample_rate_hz: int) -> float:
        if not pcm16_frame:
            return 0.0
        audio = np.frombuffer(pcm16_frame, dtype=np.int16).astype(np.float32) / 32768.0
        if audio.size == 0:
            return 0.0
        t = self._torch.from_numpy(audio)
        if t.dim() == 1:
            t = t.unsqueeze(0)
        with self._torch.no_grad():
            out = self._model(t, int(sample_rate_hz))
        try:
            return float(out.item())
        except Exception:
            return float(out.squeeze().detach().cpu().numpy().reshape(-1)[0])


def _default_silero_model_path() -> str:
    # Allow env override first.
    env = (os.getenv("SILERO_VAD_MODEL_PATH") or "").strip()
    if env:
        return env
    # Conventional local path if the model is vendored into the repo.
    p = Path(__file__).resolve().parent / "assets" / "silero_vad.jit"
    if p.exists() and p.is_file():
        return str(p)
    return ""


def get_speech_detector(config: VadConfig) -> SpeechDetector:
    engine = (config.engine or "energy").strip().lower()
    if engine == "energy":
        return EnergySpeechDetector()

    # Silero requested, but fall back safely.
    model_path = (config.silero_model_path or _default_silero_model_path()).strip()
    if not model_path:
        logger.warning("[VAD] Silero requested but no model path configured; set SILERO_VAD_MODEL_PATH to enable Silero VAD.")
        return EnergySpeechDetector()
    try:
        return SileroSpeechDetector(model_path=model_path)
    except Exception as e:
        logger.warning(f"[VAD] Silero unavailable ({e}); falling back to energy VAD.")
        return EnergySpeechDetector()


class VadUtteranceSegmenter:
    """
    Streaming end-of-utterance segmentation using a frame-level speech detector.
    """

    def __init__(self, detector: SpeechDetector, config: Optional[VadConfig] = None):
        self.detector = detector
        self.config = config or VadConfig()

        self._frame_samples = int(self.config.sample_rate_hz * (self.config.frame_ms / 1000.0))
        self._frame_samples = max(160, self._frame_samples)
        self._frame_bytes = self._frame_samples * 2  # PCM16 mono

        pre_frames = 0
        if self.config.pre_roll_ms > 0:
            pre_frames = max(0, int(self.config.pre_roll_ms / self.config.frame_ms))
        self._pre_roll_frames: Deque[bytes] = deque(maxlen=pre_frames or 0)

        self._remainder = bytearray()
        self._in_utt = False
        self._utt_buf: bytearray = bytearray()
        self._speech_start_sample: int = 0
        self._last_speech_sample: int = 0
        self._speech_ms: int = 0
        self._silence_ms: int = 0
        self._total_samples: int = 0

    @property
    def total_samples(self) -> int:
        return self._total_samples

    @property
    def in_utterance(self) -> bool:
        return self._in_utt

    def reset(self) -> None:
        self._remainder = bytearray()
        self._in_utt = False
        self._utt_buf = bytearray()
        self._speech_start_sample = 0
        self._last_speech_sample = 0
        self._speech_ms = 0
        self._silence_ms = 0
        self._total_samples = 0
        self._pre_roll_frames.clear()

    def _start_utterance(self, *, frame: bytes, frame_start_sample: int, frame_end_sample: int) -> None:
        self._in_utt = True
        self._utt_buf = bytearray()
        for pf in self._pre_roll_frames:
            self._utt_buf.extend(pf)
        self._utt_buf.extend(frame)
        self._speech_start_sample = frame_start_sample
        self._last_speech_sample = frame_end_sample
        self._speech_ms = self.config.frame_ms
        self._silence_ms = 0

    def _finalize_utterance(self) -> Optional[UtteranceSegment]:
        if not self._in_utt:
            return None
        if self._speech_ms < self.config.min_speech_ms:
            # Likely noise / mic bump.
            self._in_utt = False
            self._utt_buf = bytearray()
            self._speech_ms = 0
            self._silence_ms = 0
            return None

        seg = UtteranceSegment(
            pcm16=bytes(self._utt_buf),
            start_sample=int(self._speech_start_sample),
            end_sample=int(self._last_speech_sample),
            speech_ms=int(self._speech_ms),
        )
        self._in_utt = False
        self._utt_buf = bytearray()
        self._speech_ms = 0
        self._silence_ms = 0
        return seg

    def flush(self) -> Optional[UtteranceSegment]:
        """
        Force-finalize the current utterance (e.g., on stop/disconnect).
        """
        return self._finalize_utterance()

    def process_pcm16(self, pcm16_bytes: bytes) -> List[UtteranceSegment]:
        if not pcm16_bytes:
            return []
        self._remainder.extend(pcm16_bytes)

        out: List[UtteranceSegment] = []
        while len(self._remainder) >= self._frame_bytes:
            frame = bytes(self._remainder[: self._frame_bytes])
            del self._remainder[: self._frame_bytes]

            frame_start = self._total_samples
            frame_end = frame_start + self._frame_samples
            self._total_samples = frame_end

            prob = self.detector.speech_probability(frame, sample_rate_hz=self.config.sample_rate_hz)
            is_speech = prob >= self.config.speech_threshold

            if not self._in_utt:
                if is_speech:
                    self._start_utterance(frame=frame, frame_start_sample=frame_start, frame_end_sample=frame_end)
                # Update pre-roll after decision so it contains "previous" frames on start.
                if self._pre_roll_frames.maxlen:
                    self._pre_roll_frames.append(frame)
                continue

            # In utterance
            self._utt_buf.extend(frame)
            if is_speech:
                self._last_speech_sample = frame_end
                self._speech_ms += self.config.frame_ms
                self._silence_ms = 0
            else:
                self._silence_ms += self.config.frame_ms

            if self._pre_roll_frames.maxlen:
                self._pre_roll_frames.append(frame)

            utt_ms = int((frame_end - self._speech_start_sample) * 1000 / self.config.sample_rate_hz)
            force_end = utt_ms >= self.config.max_utterance_ms
            end_by_silence = self._silence_ms >= self.config.end_silence_ms
            if end_by_silence or force_end:
                seg = self._finalize_utterance()
                if seg:
                    out.append(seg)

        return out
