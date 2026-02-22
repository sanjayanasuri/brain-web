"""
Heuristic learning-signal extraction for voice transcripts.

Phase B goal:
- detect pacing / turn-taking / confusion / verification / restart cues
- enable "no interruption" policy without breaking existing flows
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional, Tuple

from config import (
    ENABLE_VOICE_SIGNAL_LLM_FALLBACK,
    VOICE_SIGNAL_LLM_MAX_WORDS,
    VOICE_SIGNAL_LLM_MIN_CONFIDENCE,
)

_ALLOWED_SIGNAL_KINDS = {
    "turn_taking_request",
    "pacing_request",
    "restart_request",
    "confusion",
    "verification_question",
    "audience_mode_request",
}
_ALLOWED_PACING_VALUES = {"slow", "fast", "normal"}
_ALLOWED_AUDIENCE_MODES = {"eli5", "ceo_pitch"}
_LLM_TRIGGER_HINTS = (
    "interrupt",
    "cut in",
    "cut me off",
    "jump in",
    "talk over",
    "slow",
    "faster",
    "speed",
    "repeat",
    "again",
    "restart",
    "confused",
    "lost",
    "understand",
    "right",
    "correct",
    "eli5",
    "explain like",
    "ceo",
    "pitch",
    "wait",
    "hold on",
    "your turn",
)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return float(default)


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _signal_key(signal: Dict[str, Any]) -> Tuple[Any, ...]:
    kind = str(signal.get("kind") or "")
    if kind == "turn_taking_request":
        return kind, str(signal.get("mode") or "")
    if kind == "pacing_request":
        return kind, str(signal.get("pace") or "")
    if kind == "audience_mode_request":
        return kind, str(signal.get("mode") or "")
    return (kind,)


def _dedupe_signals(signals: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen = set()
    for signal in signals:
        key = _signal_key(signal)
        if key in seen:
            continue
        seen.add(key)
        out.append(signal)
    return out


def _extract_learning_signals_heuristic(normalized_text: str) -> List[Dict[str, Any]]:
    t = normalized_text
    signals: List[Dict[str, Any]] = []

    # Turn-taking / no interruption
    if any(
        phrase in t
        for phrase in [
            "don't interrupt",
            "do not interrupt",
            "dont interrupt",
            "don't cut me off",
            "dont cut me off",
            "let me finish",
            "hold on",
            "wait a second",
            "wait please",
        ]
    ):
        signals.append({"kind": "turn_taking_request", "mode": "no_interrupt"})

    # Pacing control
    if any(
        phrase in t
        for phrase in [
            "slow down",
            "go slower",
            "talk slowly",
            "speak slowly",
            "slower please",
            "too fast",
        ]
    ):
        signals.append({"kind": "pacing_request", "pace": "slow"})

    if any(
        phrase in t
        for phrase in [
            "speed up",
            "talk faster",
            "talk fast",
            "speak faster",
            "faster please",
            "too slow",
        ]
    ):
        signals.append({"kind": "pacing_request", "pace": "fast"})

    if any(phrase in t for phrase in ["normal speed", "resume speed", "standard speed"]):
        signals.append({"kind": "pacing_request", "pace": "normal"})

    # Restart / repeat
    if any(
        phrase in t
        for phrase in [
            "start over",
            "restart",
            "from the beginning",
            "say that again",
            "repeat that",
            "could you repeat",
            "can you repeat",
            "i missed that",
            "i wasn't paying attention",
            "i was not paying attention",
        ]
    ):
        signals.append({"kind": "restart_request"})

    # Confusion (student explicitly signals confusion)
    if any(
        phrase in t
        for phrase in [
            "i don't understand",
            "i dont understand",
            "i'm confused",
            "im confused",
            "this is confusing",
            "i'm lost",
            "im lost",
            "not sure i get it",
            "i'm not sure",
            "im not sure",
        ]
    ):
        signals.append({"kind": "confusion", "confidence": 0.85})

    # Verification pattern (user checks their model)
    if ("is that correct" in t) or ("am i right" in t) or re.search(r"\b(right|correct)\?\s*$", t):
        signals.append({"kind": "verification_question"})

    # Audience/role hints (optional; ties to TutorProfile later)
    if "eli5" in t or "explain like i'm five" in t or "explain like im five" in t:
        signals.append({"kind": "audience_mode_request", "mode": "eli5"})
    if "ceo" in t and "pitch" in t:
        signals.append({"kind": "audience_mode_request", "mode": "ceo_pitch"})

    return _dedupe_signals(signals)


def _should_try_llm_signal_extraction(
    transcript: str,
    normalized_text: str,
    heuristic_signals: List[Dict[str, Any]],
) -> bool:
    if not ENABLE_VOICE_SIGNAL_LLM_FALLBACK:
        return False
    if heuristic_signals:
        return False

    text = str(transcript or "").strip()
    if not text:
        return False
    if len(normalized_text.split()) > max(8, int(VOICE_SIGNAL_LLM_MAX_WORDS)):
        return False

    return any(hint in normalized_text for hint in _LLM_TRIGGER_HINTS)


def _normalize_llm_signal(raw_signal: Any, min_confidence: float) -> Optional[Dict[str, Any]]:
    if not isinstance(raw_signal, dict):
        return None

    kind = str(raw_signal.get("kind") or "").strip().lower()
    if kind not in _ALLOWED_SIGNAL_KINDS:
        return None

    confidence = _safe_float(raw_signal.get("confidence"), 1.0)
    if confidence < min_confidence:
        return None

    if kind == "turn_taking_request":
        mode_raw = str(raw_signal.get("mode") or "").strip().lower()
        if mode_raw in {"no_interrupt", "no interruption", "do_not_interrupt"}:
            return {"kind": "turn_taking_request", "mode": "no_interrupt"}
        return None

    if kind == "pacing_request":
        pace_raw = str(raw_signal.get("pace") or "").strip().lower()
        pace_aliases = {
            "slower": "slow",
            "slowly": "slow",
            "faster": "fast",
            "quick": "fast",
        }
        pace = pace_aliases.get(pace_raw, pace_raw)
        if pace in _ALLOWED_PACING_VALUES:
            return {"kind": "pacing_request", "pace": pace}
        return None

    if kind == "audience_mode_request":
        mode_raw = str(raw_signal.get("mode") or "").strip().lower()
        mode_aliases = {
            "explain_like_five": "eli5",
            "explain like five": "eli5",
            "ceo": "ceo_pitch",
            "ceo pitch": "ceo_pitch",
        }
        mode = mode_aliases.get(mode_raw, mode_raw)
        if mode in _ALLOWED_AUDIENCE_MODES:
            return {"kind": "audience_mode_request", "mode": mode}
        return None

    if kind == "confusion":
        return {
            "kind": "confusion",
            "confidence": round(_clamp(confidence, 0.0, 1.0), 3),
        }

    if kind in {"restart_request", "verification_question"}:
        return {"kind": kind}

    return None


def _extract_learning_signals_llm(transcript: str) -> List[Dict[str, Any]]:
    text = str(transcript or "").strip()
    if not text:
        return []

    try:
        from services_model_router import TASK_EXTRACT, model_router

        if not model_router.client:
            return []

        prompt = (
            "Extract learning/control signals from a voice transcript.\n"
            "Return strict JSON object with key `signals` (array).\n"
            "Each signal item must include:\n"
            "- kind: one of [turn_taking_request, pacing_request, restart_request, confusion, verification_question, audience_mode_request]\n"
            "- confidence: number between 0 and 1\n"
            "Optional fields by kind:\n"
            "- turn_taking_request: mode=no_interrupt\n"
            "- pacing_request: pace=slow|fast|normal\n"
            "- audience_mode_request: mode=eli5|ceo_pitch\n"
            "Rules:\n"
            "- Return empty array if no signal.\n"
            "- Do not invent unsupported kinds or fields.\n"
        )

        raw = model_router.completion(
            task_type=TASK_EXTRACT,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": json.dumps({"transcript": text})},
            ],
            response_format={"type": "json_object"},
            temperature=0.0,
            max_tokens=220,
        )

        parsed = json.loads(raw or "{}")
        raw_signals = parsed.get("signals")
        if not isinstance(raw_signals, list):
            return []

        min_confidence = _clamp(_safe_float(VOICE_SIGNAL_LLM_MIN_CONFIDENCE, 0.62), 0.0, 1.0)
        signals: List[Dict[str, Any]] = []
        for raw_signal in raw_signals[:6]:
            normalized = _normalize_llm_signal(raw_signal, min_confidence=min_confidence)
            if normalized:
                signals.append(normalized)

        return _dedupe_signals(signals)
    except Exception:
        return []


def extract_learning_signals(transcript: str) -> List[Dict[str, Any]]:
    t = _norm(transcript)
    if not t:
        return []

    heuristic_signals = _extract_learning_signals_heuristic(t)
    if _should_try_llm_signal_extraction(transcript, t, heuristic_signals):
        llm_signals = _extract_learning_signals_llm(transcript)
        if llm_signals:
            return llm_signals

    return heuristic_signals


def is_yield_turn(transcript: str) -> bool:
    """
    Heuristic: did the user *yield the floor* / explicitly request a response?
    """
    t = _norm(transcript)
    if not t:
        return False

    # Direct questions / verification
    if "?" in transcript:
        return True
    if any(phrase in t for phrase in ["is that correct", "am i right", "can you explain", "could you explain"]):
        return True

    # Explicit prompt to respond
    if any(
        phrase in t
        for phrase in [
            "what do you think",
            "your turn",
            "go ahead",
            "answer me",
            "respond",
        ]
    ):
        return True

    return False


def apply_signals_to_policy(policy: Dict[str, Any], signals: List[Dict[str, Any]]) -> Tuple[Dict[str, Any], bool]:
    """
    Apply extracted signals to a mutable policy dict.
    Returns (policy, changed).
    """
    changed = False
    for sig in signals:
        kind = sig.get("kind")
        if kind == "turn_taking_request" and sig.get("mode") == "no_interrupt":
            if policy.get("turn_taking") != "no_interrupt":
                policy["turn_taking"] = "no_interrupt"
                changed = True
        if kind == "pacing_request":
            pace = sig.get("pace")
            if pace in ["slow", "fast", "normal"]:
                if policy.get("pacing") != pace:
                    policy["pacing"] = pace
                    changed = True
    return policy, changed
