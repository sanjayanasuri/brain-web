"""
Heuristic learning-signal extraction for voice transcripts.

Phase B goal:
- detect pacing / turn-taking / confusion / verification / restart cues
- enable "no interruption" policy without breaking existing flows
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def extract_learning_signals(transcript: str) -> List[Dict[str, Any]]:
    t = _norm(transcript)
    if not t:
        return []

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

    return signals


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
        if kind == "pacing_request" and sig.get("pace") == "slow":
            if policy.get("pacing") != "slow":
                policy["pacing"] = "slow"
                changed = True
    return policy, changed

