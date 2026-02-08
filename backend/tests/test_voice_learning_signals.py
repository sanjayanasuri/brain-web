"""
Unit tests for heuristic voice learning-signal extraction.

These tests are intentionally pure (no DB / no FastAPI app import).
"""

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

