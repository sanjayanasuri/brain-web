"""
Low-cost feedback intent classifier for ambiguous free-text notes.

Used as a fallback when explicit structured feedback tags are missing and
regex heuristics cannot confidently map the feedback to style signals.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from config import (
    ENABLE_FEEDBACK_CLASSIFIER_FALLBACK,
    FEEDBACK_CLASSIFIER_MIN_CONFIDENCE,
)
from services_model_router import TASK_EXTRACT, model_router
from services_voice_style_profile import (
    has_explicit_feedback_cues,
    observe_explicit_feedback,
)

logger = logging.getLogger("brain_web")

_VERBOSITY_ALLOWED = {"too_short", "too_verbose", "just_right"}
_QUESTION_ALLOWED = {"more_questions", "fewer_questions", "ok"}
_HUMOR_ALLOWED = {"more_humor", "less_humor", "ok"}


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return float(default)


def _has_rewrite_length_signal(
    *,
    original_response: Optional[str],
    user_rewritten_version: Optional[str],
) -> bool:
    src_words = len(str(original_response or "").split())
    rewrite_words = len(str(user_rewritten_version or "").split())
    if src_words < 8 or rewrite_words < 4:
        return False
    ratio = float(rewrite_words) / float(max(1, src_words))
    return ratio <= 0.80 or ratio >= 1.20


def should_run_feedback_classifier(
    *,
    reasoning: Optional[str],
    verbosity: Optional[str] = None,
    question_preference: Optional[str] = None,
    humor_preference: Optional[str] = None,
    original_response: Optional[str] = None,
    user_rewritten_version: Optional[str] = None,
) -> bool:
    """
    Gate model fallback to truly ambiguous feedback to control cost/latency.
    """
    if not ENABLE_FEEDBACK_CLASSIFIER_FALLBACK:
        return False
    if verbosity or question_preference or humor_preference:
        return False

    text = str(reasoning or "").strip()
    if len(text) < 12:
        return False

    # Skip model call when deterministic regex logic already understands the note.
    if has_explicit_feedback_cues(text):
        return False

    # Skip model call when rewrite-length delta is already a strong signal.
    if _has_rewrite_length_signal(
        original_response=original_response,
        user_rewritten_version=user_rewritten_version,
    ):
        return False

    return True


def infer_feedback_signals(
    *,
    reasoning: str,
    original_response: Optional[str] = None,
    user_rewritten_version: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Infer style feedback tags from ambiguous free-text notes.
    Returns {} when no high-confidence inference is available.
    """
    text = str(reasoning or "").strip()
    if not text:
        return {}

    prompt = (
        "Extract style feedback tags from user notes about an assistant response.\n"
        "Return strict JSON with keys:\n"
        "- verbosity: one of [too_short, too_verbose, just_right] or null\n"
        "- question_preference: one of [more_questions, fewer_questions, ok] or null\n"
        "- humor_preference: one of [more_humor, less_humor, ok] or null\n"
        "- confidence: number between 0 and 1\n"
        "Rules:\n"
        "- If uncertain, use null for uncertain fields.\n"
        "- Do not invent preferences that are not implied.\n"
        "- Prefer null over guessing.\n"
    )

    user_payload = {
        "feedback_notes": text,
        "original_response": original_response or "",
        "user_rewritten_version": user_rewritten_version or "",
    }

    try:
        raw = model_router.completion(
            task_type=TASK_EXTRACT,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": json.dumps(user_payload)},
            ],
            response_format={"type": "json_object"},
            temperature=0.0,
            max_tokens=180,
        )
    except Exception as e:
        logger.debug(f"Feedback classifier fallback skipped: {e}")
        return {}

    try:
        parsed = json.loads(raw) if isinstance(raw, str) else {}
    except Exception:
        return {}

    verbosity = parsed.get("verbosity")
    question_pref = parsed.get("question_preference")
    humor_pref = parsed.get("humor_preference")
    confidence = _safe_float(parsed.get("confidence"), 0.0)

    if verbosity not in _VERBOSITY_ALLOWED:
        verbosity = None
    if question_pref not in _QUESTION_ALLOWED:
        question_pref = None
    if humor_pref not in _HUMOR_ALLOWED:
        humor_pref = None

    if confidence < float(FEEDBACK_CLASSIFIER_MIN_CONFIDENCE):
        return {}

    if not any([verbosity, question_pref, humor_pref]):
        return {}

    return {
        "verbosity": verbosity,
        "question_preference": question_pref,
        "humor_preference": humor_pref,
        "confidence": round(confidence, 3),
    }


def apply_inferred_feedback_signals(
    *,
    user_id: str,
    tenant_id: str,
    reasoning: str,
    original_response: Optional[str] = None,
    user_rewritten_version: Optional[str] = None,
) -> None:
    """
    Classify ambiguous notes and apply inferred tags to the style profile.
    """
    if not should_run_feedback_classifier(
        reasoning=reasoning,
        original_response=original_response,
        user_rewritten_version=user_rewritten_version,
    ):
        return

    inferred = infer_feedback_signals(
        reasoning=reasoning,
        original_response=original_response,
        user_rewritten_version=user_rewritten_version,
    )
    if not inferred:
        return

    observe_explicit_feedback(
        user_id=user_id,
        tenant_id=tenant_id,
        verbosity=inferred.get("verbosity"),
        question_preference=inferred.get("question_preference"),
        humor_preference=inferred.get("humor_preference"),
    )
