"""
Unit tests for heuristic voice learning-signal extraction.

These tests are intentionally pure (no DB / no FastAPI app import).
"""

import services_voice_learning_signals as svc

from services_voice_learning_signals import (
    apply_signals_to_policy,
    extract_learning_signals,
    is_yield_turn,
)


def test_extract_turn_taking_request():
    signals = extract_learning_signals("And then next also, don't interrupt me, please.")
    assert any(s.get("kind") == "turn_taking_request" and s.get("mode") == "no_interrupt" for s in signals)


def test_extract_pacing_request():
    signals = extract_learning_signals("Okay, slow down and talk slowly.")
    assert any(s.get("kind") == "pacing_request" and s.get("pace") == "slow" for s in signals)


def test_apply_policy_updates():
    policy = {}
    signals = extract_learning_signals("don't interrupt me, and also slow down")
    policy, changed = apply_signals_to_policy(policy, signals)
    assert changed is True
    assert policy.get("turn_taking") == "no_interrupt"
    assert policy.get("pacing") == "slow"


def test_is_yield_turn_question():
    assert is_yield_turn("Is that correct?") is True
    assert is_yield_turn("So let me get this straight...") is False


def test_extract_learning_signals_uses_llm_fallback_when_heuristic_misses(monkeypatch):
    monkeypatch.setattr(svc, "ENABLE_VOICE_SIGNAL_LLM_FALLBACK", True)
    monkeypatch.setattr(svc, "_extract_learning_signals_heuristic", lambda _t: [])
    monkeypatch.setattr(
        svc,
        "_extract_learning_signals_llm",
        lambda _t: [{"kind": "pacing_request", "pace": "fast"}],
    )

    signals = extract_learning_signals("Could you speak at a faster pace please")
    assert signals == [{"kind": "pacing_request", "pace": "fast"}]


def test_extract_learning_signals_prefers_heuristics_without_llm_call(monkeypatch):
    monkeypatch.setattr(svc, "ENABLE_VOICE_SIGNAL_LLM_FALLBACK", True)
    monkeypatch.setattr(
        svc,
        "_extract_learning_signals_llm",
        lambda _t: (_ for _ in ()).throw(AssertionError("LLM fallback should not run when heuristics already match")),
    )

    signals = extract_learning_signals("don't interrupt me, and also slow down")
    assert any(s.get("kind") == "turn_taking_request" for s in signals)
    assert any(s.get("kind") == "pacing_request" and s.get("pace") == "slow" for s in signals)


def test_normalize_llm_signal_enforces_schema_and_confidence():
    assert svc._normalize_llm_signal(
        {"kind": "pacing_request", "pace": "slower", "confidence": 0.9},
        min_confidence=0.62,
    ) == {"kind": "pacing_request", "pace": "slow"}

    assert svc._normalize_llm_signal(
        {"kind": "verification_question", "confidence": 0.2},
        min_confidence=0.62,
    ) is None
