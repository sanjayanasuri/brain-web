"""
Per-user adaptive voice style profile.

Tracks speaking patterns per account and derives:
- adaptive VAD overrides (pause/sensitivity tuning)
- style hints for assistant response behavior
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, Optional, Tuple

from db_postgres import execute_query, execute_update

logger = logging.getLogger("brain_web")

_schema_initialized = False

_WORD_RE = re.compile(r"[a-zA-Z']+")
_HUMOR_RE = re.compile(r"\b(lol|lmao|haha|hehe|joke|kidding|funny)\b", re.IGNORECASE)
_QUESTION_OPENERS = {"what", "why", "how", "when", "where", "who", "which", "can", "could", "would", "should", "is", "are", "do", "does", "did"}
_FILLERS = {"um", "uh", "like", "hmm", "you", "know"}
_DETAIL_HINT_RE = re.compile(r"\b(in detail|detailed|deep dive|step by step|comprehensive|thorough)\b", re.IGNORECASE)
_BRIEF_HINT_RE = re.compile(r"\b(brief|short|quick|quickly|concise|tldr|summary)\b", re.IGNORECASE)
_TOO_VERBOSE_RE = re.compile(r"\b(too verbose|too long|long[- ]winded|wordy|rambling|wall of text|excessive detail)\b", re.IGNORECASE)
_TOO_SHORT_RE = re.compile(r"\b(too short|too brief|not enough detail|more detail|expand|elaborate|go deeper)\b", re.IGNORECASE)
_MORE_QUESTIONS_RE = re.compile(r"\b(ask more questions|probe more|more follow[- ]up)\b", re.IGNORECASE)
_FEWER_QUESTIONS_RE = re.compile(r"\b(too many questions|ask fewer questions|stop asking questions|less questioning)\b", re.IGNORECASE)
_MORE_HUMOR_RE = re.compile(r"\b(more humor|more humour|more funny|be funnier|more playful)\b", re.IGNORECASE)
_LESS_HUMOR_RE = re.compile(r"\b(less humor|less humour|too playful|too jokey|too many jokes)\b", re.IGNORECASE)

# Emotional cues tracking
_EXCITED_RE = re.compile(r"\b(wow|awesome|great|cool|exciting|amazing|incredible|love|yay|excellent)\b", re.IGNORECASE)
_FRUSTRATED_RE = re.compile(r"\b(argh|annoying|stupid|bad|wrong|hate|dumb|confused|hard|difficult)\b", re.IGNORECASE)
_TIRED_RE = re.compile(r"\b(tired|sleepy|long day|exhausted|yawn|ready to stop)\b", re.IGNORECASE)

# Technical vocabulary convergence: track terms like GraphRAG, K8s, o1-mini, etc.
_TECHNICAL_TERM_RE = re.compile(r"\b([A-Z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*|[A-Z]{2,}[0-9]*|[a-z]+[A-Z][a-z]+|[a-z0-9]+-[a-z0-9]+)\b")


def has_explicit_feedback_cues(text: Optional[str]) -> bool:
    """
    Return True when free-text feedback contains explicit style directives
    we can interpret deterministically without model inference.
    """
    reason_text = str(text or "").strip().lower()
    if not reason_text:
        return False
    return bool(
        _TOO_VERBOSE_RE.search(reason_text)
        or _TOO_SHORT_RE.search(reason_text)
        or _MORE_QUESTIONS_RE.search(reason_text)
        or _FEWER_QUESTIONS_RE.search(reason_text)
        or _MORE_HUMOR_RE.search(reason_text)
        or _LESS_HUMOR_RE.search(reason_text)
    )


def _ensure_schema() -> None:
    global _schema_initialized
    if _schema_initialized:
        return

    execute_update(
        """
        CREATE TABLE IF NOT EXISTS voice_user_style_profiles (
          user_id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          sample_count INTEGER NOT NULL DEFAULT 0,
          metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          preferences_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, tenant_id)
        );
        """
    )
    execute_update(
        """
        CREATE INDEX IF NOT EXISTS idx_voice_user_style_profiles_updated
        ON voice_user_style_profiles(updated_at DESC);
        """
    )

    _schema_initialized = True


def _default_metrics() -> Dict[str, float]:
    return {
        "avg_speech_ms": 1200.0,
        "avg_utterance_span_ms": 1350.0,
        "avg_pause_ratio": 0.10,
        "question_ratio": 0.35,
        "humor_ratio": 0.08,
        "filler_ratio": 0.06,
        "interrupt_rate": 0.05,
        "short_turn_ratio": 0.12,
        "text_avg_words": 16.0,
        "text_long_turn_ratio": 0.28,
        "text_detail_request_ratio": 0.15,
        "text_brief_request_ratio": 0.10,
        "feedback_alignment_score": 0.0,
        "avg_sentiment": 0.0,
    }


def _parse_json_obj(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            loaded = json.loads(value)
            if isinstance(loaded, dict):
                return loaded
        except Exception:
            return {}
    return {}


def _load_profile(user_id: str, tenant_id: str) -> Tuple[int, Dict[str, float], Dict[str, Any]]:
    _ensure_schema()
    rows = execute_query(
        """
        SELECT sample_count, metrics_json, preferences_json
        FROM voice_user_style_profiles
        WHERE user_id = %s AND tenant_id = %s
        LIMIT 1
        """,
        (user_id, tenant_id),
    )
    if not rows:
        return 0, _default_metrics(), {}

    row = rows[0] or {}
    sample_count = int(row.get("sample_count") or 0)
    metrics_raw = _parse_json_obj(row.get("metrics_json"))
    prefs_raw = _parse_json_obj(row.get("preferences_json"))

    metrics = _default_metrics()
    for k, v in metrics_raw.items():
        try:
            metrics[str(k)] = float(v)
        except Exception:
            continue
    return sample_count, metrics, prefs_raw


def _save_profile(user_id: str, tenant_id: str, sample_count: int, metrics: Dict[str, float], prefs: Dict[str, Any]) -> None:
    _ensure_schema()
    execute_update(
        """
        INSERT INTO voice_user_style_profiles
          (user_id, tenant_id, sample_count, metrics_json, preferences_json, updated_at)
        VALUES
          (%s, %s, %s, %s::jsonb, %s::jsonb, NOW())
        ON CONFLICT (user_id, tenant_id) DO UPDATE
        SET sample_count = EXCLUDED.sample_count,
            metrics_json = EXCLUDED.metrics_json,
            preferences_json = EXCLUDED.preferences_json,
            updated_at = NOW()
        """,
        (user_id, tenant_id, int(sample_count), json.dumps(metrics), json.dumps(prefs)),
    )


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _ewma(prev: float, new_value: float, alpha: float) -> float:
    return ((1.0 - alpha) * float(prev)) + (alpha * float(new_value))


def _adaptive_alpha(sample_count: int) -> float:
    # Fast adaptation early, stable later.
    return _clamp(2.0 / (float(sample_count) + 6.0), 0.06, 0.28)


def _blend(base: float, learned: float, confidence: float) -> float:
    c = _clamp(confidence, 0.0, 1.0)
    return (base * (1.0 - c)) + (learned * c)


def _word_count(text: Optional[str]) -> int:
    if not text:
        return 0
    return len(_WORD_RE.findall(str(text)))


def _derive_preferences(metrics: Dict[str, float], sample_count: int) -> Dict[str, Any]:
    confidence = _clamp(float(sample_count) / 30.0, 0.0, 1.0)

    pause_ratio = float(metrics.get("avg_pause_ratio", 0.10))
    question_ratio = float(metrics.get("question_ratio", 0.35))
    humor_ratio = float(metrics.get("humor_ratio", 0.08))
    filler_ratio = float(metrics.get("filler_ratio", 0.06))
    interrupt_rate = float(metrics.get("interrupt_rate", 0.05))
    short_turn_ratio = float(metrics.get("short_turn_ratio", 0.12))
    avg_speech_ms = float(metrics.get("avg_speech_ms", 1200.0))
    text_avg_words = float(metrics.get("text_avg_words", 16.0))
    text_long_turn_ratio = float(metrics.get("text_long_turn_ratio", 0.28))
    text_detail_request_ratio = float(metrics.get("text_detail_request_ratio", 0.15))
    text_brief_request_ratio = float(metrics.get("text_brief_request_ratio", 0.10))
    feedback_alignment_score = float(metrics.get("feedback_alignment_score", 0.0))

    if pause_ratio >= 0.20:
        pause_style = "long_pauses"
    elif pause_ratio <= 0.07:
        pause_style = "compact_pauses"
    else:
        pause_style = "balanced_pauses"

    if question_ratio >= 0.48:
        question_style = "exploratory"
    elif question_ratio <= 0.25:
        question_style = "direct"
    else:
        question_style = "balanced"

    if humor_ratio >= 0.16:
        humor_style = "playful"
    elif humor_ratio >= 0.08:
        humor_style = "light"
    else:
        humor_style = "minimal"

    if (text_detail_request_ratio - text_brief_request_ratio) >= 0.08 or text_avg_words >= 28.0:
        response_detail_preference = "detailed"
    elif (text_brief_request_ratio - text_detail_request_ratio) >= 0.08 or (text_avg_words <= 10.0 and short_turn_ratio >= 0.25):
        response_detail_preference = "concise"
    else:
        response_detail_preference = "balanced"

    # Learned VAD targets (before confidence blending)
    learned_end_silence = 1100.0
    if pause_ratio >= 0.24:
        learned_end_silence += 350.0
    elif pause_ratio >= 0.16:
        learned_end_silence += 220.0
    elif pause_ratio <= 0.06:
        learned_end_silence -= 120.0
    if interrupt_rate >= 0.25:
        learned_end_silence -= 140.0

    learned_min_speech = 260.0
    if filler_ratio >= 0.12:
        learned_min_speech += 40.0
    if short_turn_ratio >= 0.35:
        learned_min_speech += 35.0
    if avg_speech_ms <= 800.0:
        learned_min_speech -= 40.0

    learned_threshold = 0.65
    if short_turn_ratio >= 0.35:
        learned_threshold += 0.03
    if avg_speech_ms <= 700.0:
        learned_threshold -= 0.02
    if interrupt_rate >= 0.30:
        learned_threshold += 0.01
    if text_long_turn_ratio >= 0.45:
        learned_threshold -= 0.01

    end_silence_ms = int(round(_clamp(_blend(1100.0, learned_end_silence, confidence), 800.0, 1700.0)))
    min_speech_ms = int(round(_clamp(_blend(260.0, learned_min_speech, confidence), 180.0, 360.0)))
    speech_threshold = float(_clamp(_blend(0.65, learned_threshold, confidence), 0.58, 0.74))

    if sample_count < 8:
        alignment_trend = "insufficient_data"
    elif feedback_alignment_score <= -0.18:
        alignment_trend = "needs_adjustment"
    elif feedback_alignment_score >= 0.18:
        alignment_trend = "aligned"
    else:
        alignment_trend = "mixed"

    return {
        "confidence": round(confidence, 3),
        "pause_style": pause_style,
        "question_style": question_style,
        "humor_style": humor_style,
        "response_detail_preference": response_detail_preference,
        "alignment_trend": alignment_trend,
        "recommended_vad": {
            "speech_threshold": round(speech_threshold, 3),
            "end_silence_ms": end_silence_ms,
            "min_speech_ms": min_speech_ms,
        },
        "vocabulary": metrics.get("top_vocabulary", []),
        "sentiment": metrics.get("avg_sentiment", 0.0),
    }


def observe_voice_turn(
    *,
    user_id: str,
    tenant_id: str,
    transcript: str,
    speech_ms: Optional[int] = None,
    utterance_span_ms: Optional[int] = None,
) -> None:
    """
    Update per-user style profile from one spoken turn.
    """
    text = str(transcript or "").strip()
    if not text:
        return

    sample_count, metrics, _ = _load_profile(user_id, tenant_id)
    alpha = _adaptive_alpha(sample_count)

    words = [w.lower() for w in _WORD_RE.findall(text)]
    word_count = len(words)
    if word_count == 0:
        return

    filler_count = sum(1 for w in words if w in _FILLERS)
    humor_hits = len(_HUMOR_RE.findall(text))
    first_word = words[0] if words else ""
    is_question = ("?" in text) or (first_word in _QUESTION_OPENERS)
    short_turn = word_count <= 2 and not is_question

    metrics["question_ratio"] = _ewma(metrics["question_ratio"], 1.0 if is_question else 0.0, alpha)
    metrics["humor_ratio"] = _ewma(metrics["humor_ratio"], float(humor_hits > 0), alpha)
    metrics["filler_ratio"] = _ewma(metrics["filler_ratio"], float(filler_count) / float(max(1, word_count)), alpha)
    metrics["short_turn_ratio"] = _ewma(metrics["short_turn_ratio"], 1.0 if short_turn else 0.0, alpha)
    metrics["interrupt_rate"] = _ewma(metrics["interrupt_rate"], 0.0, alpha)

    if speech_ms is not None and speech_ms > 0:
        metrics["avg_speech_ms"] = _ewma(metrics["avg_speech_ms"], float(speech_ms), alpha)

    if utterance_span_ms is not None and utterance_span_ms > 0:
        metrics["avg_utterance_span_ms"] = _ewma(metrics["avg_utterance_span_ms"], float(utterance_span_ms), alpha)

    if (speech_ms is not None and speech_ms > 0) and (utterance_span_ms is not None and utterance_span_ms > 0):
        span = max(float(speech_ms), float(utterance_span_ms))
        pause_ratio = _clamp((span - float(speech_ms)) / span, 0.0, 0.85)
        metrics["avg_pause_ratio"] = _ewma(metrics["avg_pause_ratio"], pause_ratio, alpha)

    new_count = int(sample_count) + 1
    
    # Emotional Wave-Matching: track sentiment
    sentiment_score = 0.0
    if _EXCITED_RE.search(text): sentiment_score += 0.5
    if _FRUSTRATED_RE.search(text): sentiment_score -= 0.5
    if _TIRED_RE.search(text): sentiment_score -= 0.3
    metrics["avg_sentiment"] = _ewma(metrics.get("avg_sentiment", 0.0), sentiment_score, alpha)

    # Vocabulary tracking
    vocab_map = _parse_json_obj(metrics.get("vocabulary_freq", {}))
    tech_terms = _TECHNICAL_TERM_RE.findall(text)
    for term in tech_terms:
        if len(term) < 2: continue
        vocab_map[term] = vocab_map.get(term, 0) + 1
    
    # Sort and keep top 10
    sorted_vocab = sorted(vocab_map.items(), key=lambda x: x[1], reverse=True)[:10]
    metrics["top_vocabulary"] = [item[0] for item in sorted_vocab]
    metrics["vocabulary_freq"] = vocab_map

    prefs = _derive_preferences(metrics, new_count)
    _save_profile(user_id, tenant_id, new_count, metrics, prefs)


def observe_text_turn(
    *,
    user_id: str,
    tenant_id: str,
    message: str,
) -> None:
    """
    Update per-user style profile from a typed chat message.
    """
    text = str(message or "").strip()
    if not text:
        return

    sample_count, metrics, _ = _load_profile(user_id, tenant_id)
    alpha = _adaptive_alpha(sample_count)

    words = [w.lower() for w in _WORD_RE.findall(text)]
    word_count = len(words)
    if word_count == 0:
        return

    first_word = words[0] if words else ""
    is_question = ("?" in text) or (first_word in _QUESTION_OPENERS)
    humor_hit = bool(_HUMOR_RE.search(text))
    detail_hint = bool(_DETAIL_HINT_RE.search(text))
    brief_hint = bool(_BRIEF_HINT_RE.search(text))
    long_turn = word_count >= 26
    short_turn = word_count <= 6 and not is_question

    metrics["question_ratio"] = _ewma(metrics["question_ratio"], 1.0 if is_question else 0.0, alpha)
    metrics["humor_ratio"] = _ewma(metrics["humor_ratio"], 1.0 if humor_hit else 0.0, alpha)
    metrics["short_turn_ratio"] = _ewma(metrics["short_turn_ratio"], 1.0 if short_turn else 0.0, alpha)
    metrics["text_avg_words"] = _ewma(metrics["text_avg_words"], float(word_count), alpha)
    metrics["text_long_turn_ratio"] = _ewma(metrics["text_long_turn_ratio"], 1.0 if long_turn else 0.0, alpha)
    metrics["text_detail_request_ratio"] = _ewma(metrics["text_detail_request_ratio"], 1.0 if detail_hint else 0.0, alpha)
    metrics["text_brief_request_ratio"] = _ewma(metrics["text_brief_request_ratio"], 1.0 if brief_hint else 0.0, alpha)

    # Typed messages are not interruptions; decay slowly.
    metrics["interrupt_rate"] = _ewma(metrics["interrupt_rate"], 0.0, alpha)

    new_count = int(sample_count) + 1
    
    # Emotional Wave-Matching: track sentiment
    sentiment_score = 0.0
    if _EXCITED_RE.search(text): sentiment_score += 0.5
    if _FRUSTRATED_RE.search(text): sentiment_score -= 0.5
    if _TIRED_RE.search(text): sentiment_score -= 0.3
    metrics["avg_sentiment"] = _ewma(metrics.get("avg_sentiment", 0.0), sentiment_score, alpha)

    # Vocabulary tracking
    vocab_map = _parse_json_obj(metrics.get("vocabulary_freq", {}))
    tech_terms = _TECHNICAL_TERM_RE.findall(text)
    for term in tech_terms:
        if len(term) < 2: continue
        vocab_map[term] = vocab_map.get(term, 0) + 1
    
    sorted_vocab = sorted(vocab_map.items(), key=lambda x: x[1], reverse=True)[:10]
    metrics["top_vocabulary"] = [item[0] for item in sorted_vocab]
    metrics["vocabulary_freq"] = vocab_map

    prefs = _derive_preferences(metrics, new_count)
    _save_profile(user_id, tenant_id, new_count, metrics, prefs)


def observe_explicit_feedback(
    *,
    user_id: str,
    tenant_id: str,
    rating: Optional[int] = None,
    reasoning: Optional[str] = None,
    verbosity: Optional[str] = None,
    question_preference: Optional[str] = None,
    humor_preference: Optional[str] = None,
    original_response: Optional[str] = None,
    user_rewritten_version: Optional[str] = None,
) -> None:
    """
    Apply explicit user feedback signals (thumbs + style corrections) to the profile.
    """
    sample_count, metrics, _ = _load_profile(user_id, tenant_id)
    # Explicit feedback should have stronger effect than passive observation.
    alpha = max(0.20, _adaptive_alpha(sample_count))

    reason_text = str(reasoning or "").strip().lower()
    verbose_signal = False
    short_signal = False
    more_q_signal = False
    fewer_q_signal = False
    more_humor_signal = False
    less_humor_signal = False

    if verbosity == "too_verbose":
        verbose_signal = True
    elif verbosity == "too_short":
        short_signal = True

    if question_preference == "more_questions":
        more_q_signal = True
    elif question_preference == "fewer_questions":
        fewer_q_signal = True

    if humor_preference == "more_humor":
        more_humor_signal = True
    elif humor_preference == "less_humor":
        less_humor_signal = True

    if reason_text:
        verbose_signal = verbose_signal or bool(_TOO_VERBOSE_RE.search(reason_text))
        short_signal = short_signal or bool(_TOO_SHORT_RE.search(reason_text))
        more_q_signal = more_q_signal or bool(_MORE_QUESTIONS_RE.search(reason_text))
        fewer_q_signal = fewer_q_signal or bool(_FEWER_QUESTIONS_RE.search(reason_text))
        more_humor_signal = more_humor_signal or bool(_MORE_HUMOR_RE.search(reason_text))
        less_humor_signal = less_humor_signal or bool(_LESS_HUMOR_RE.search(reason_text))

    # Rewrite-length cues are strong explicit signals:
    # user rewrite much shorter -> likely wanted concise; longer -> likely wanted detail.
    src_words = _word_count(original_response)
    rewrite_words = _word_count(user_rewritten_version)
    if src_words >= 8 and rewrite_words >= 4:
        ratio = float(rewrite_words) / float(max(1, src_words))
        if ratio <= 0.80:
            verbose_signal = True
        elif ratio >= 1.20:
            short_signal = True

    if verbose_signal or short_signal:
        metrics["text_brief_request_ratio"] = _ewma(
            metrics["text_brief_request_ratio"],
            1.0 if verbose_signal else 0.0,
            alpha,
        )
        metrics["text_detail_request_ratio"] = _ewma(
            metrics["text_detail_request_ratio"],
            1.0 if short_signal else 0.0,
            alpha,
        )

    if more_q_signal or fewer_q_signal:
        metrics["question_ratio"] = _ewma(
            metrics["question_ratio"],
            1.0 if more_q_signal else 0.0,
            alpha,
        )

    if more_humor_signal or less_humor_signal:
        metrics["humor_ratio"] = _ewma(
            metrics["humor_ratio"],
            1.0 if more_humor_signal else 0.0,
            alpha,
        )

    if isinstance(rating, int) and rating in (-1, 1):
        metrics["feedback_alignment_score"] = _ewma(
            metrics.get("feedback_alignment_score", 0.0),
            float(rating),
            alpha,
        )

    new_count = int(sample_count) + 1
    prefs = _derive_preferences(metrics, new_count)
    _save_profile(user_id, tenant_id, new_count, metrics, prefs)


def observe_voice_interrupt(*, user_id: str, tenant_id: str) -> None:
    """
    Update interruption tendency for a user (e.g., barge-in while assistant speaks).
    """
    sample_count, metrics, _ = _load_profile(user_id, tenant_id)
    alpha = _adaptive_alpha(sample_count)
    metrics["interrupt_rate"] = _ewma(metrics["interrupt_rate"], 1.0, alpha)
    prefs = _derive_preferences(metrics, sample_count)
    _save_profile(user_id, tenant_id, sample_count, metrics, prefs)


def get_adaptive_vad_config_for_user(*, user_id: str, tenant_id: str) -> Dict[str, Any]:
    """
    Return user-specific VAD overrides based on learned speaking style.
    Empty dict when confidence is too low.
    """
    sample_count, metrics, prefs = _load_profile(user_id, tenant_id)
    if sample_count < 4:
        return {}
    rec = _parse_json_obj(prefs).get("recommended_vad")
    if not isinstance(rec, dict):
        return {}
    out: Dict[str, Any] = {}
    if "speech_threshold" in rec:
        try:
            out["speech_threshold"] = float(rec["speech_threshold"])
        except Exception:
            pass
    if "end_silence_ms" in rec:
        try:
            out["end_silence_ms"] = int(rec["end_silence_ms"])
        except Exception:
            pass
    if "min_speech_ms" in rec:
        try:
            out["min_speech_ms"] = int(rec["min_speech_ms"])
        except Exception:
            pass
    return out


def get_voice_response_style_hint(*, user_id: str, tenant_id: str) -> str:
    """
    Build prompt-safe hint text describing learned per-user speaking style.
    """
    sample_count, metrics, prefs = _load_profile(user_id, tenant_id)
    if sample_count < 6:
        return ""
    p = _parse_json_obj(prefs)
    confidence = float(p.get("confidence") or 0.0)
    if confidence < 0.25:
        return ""

    pause_style = str(p.get("pause_style") or "balanced_pauses")
    question_style = str(p.get("question_style") or "balanced")
    humor_style = str(p.get("humor_style") or "minimal")
    detail_pref = str(p.get("response_detail_preference") or "balanced")
    alignment_trend = str(p.get("alignment_trend") or "")
    if not alignment_trend:
        score = float(metrics.get("feedback_alignment_score", 0.0))
        if score <= -0.18:
            alignment_trend = "needs_adjustment"
        elif score >= 0.18:
            alignment_trend = "aligned"
        else:
            alignment_trend = "mixed"

    alignment_instruction = ""
    if alignment_trend == "needs_adjustment":
        alignment_instruction = (
            "- Recent explicit feedback suggests style mismatch: prioritize direct, concise replies and"
            " minimize humor/follow-up questions unless requested.\n"
        )
    elif alignment_trend == "aligned":
        alignment_instruction = "- Recent explicit feedback trend is positive; keep this style stable.\n"

    lines = [
        "Learned User Communication Style (cross-modal, per-account):",
        f"- Pause cadence: {pause_style}.",
        f"- Questioning style: {question_style}.",
        f"- Humor preference: {humor_style}.",
        f"- Detail preference: {detail_pref}.",
    ]
    
    avg_sentiment = float(p.get("sentiment") or 0.0)
    if avg_sentiment > 0.3:
        lines.append("- Mirror the user's high energy and excitement; use upbeat, encouraging tone.")
    elif avg_sentiment < -0.3:
        lines.append("- The user seems frustrated or tired; use a calm, empathetic, and patient tone. Be extra direct and clear.")

    vocab = p.get("vocabulary", [])
    if vocab:
        lines.append(f"- Technical vocabulary: prioritize terms the user uses: {', '.join(vocab)}.")

    if alignment_instruction:
        lines.append(alignment_instruction.strip())
    lines.extend(
        [
            "- Adapt pacing and tone to this profile, but stay accurate.",
            "- If pauses suggest the user is still thinking, wait before replying.",
            "- Do not mimic filler words.",
        ]
    )
    return "\n".join(lines)


def get_chat_response_style_hint(*, user_id: str, tenant_id: str) -> str:
    """
    Prompt-safe hint for typed chat responses using the same shared profile.
    """
    sample_count, metrics, prefs = _load_profile(user_id, tenant_id)
    if sample_count < 6:
        return ""
    p = _parse_json_obj(prefs)
    confidence = float(p.get("confidence") or 0.0)
    if confidence < 0.25:
        return ""

    question_style = str(p.get("question_style") or "balanced")
    humor_style = str(p.get("humor_style") or "minimal")
    detail_pref = str(p.get("response_detail_preference") or "balanced")
    alignment_trend = str(p.get("alignment_trend") or "")
    if not alignment_trend:
        score = float(metrics.get("feedback_alignment_score", 0.0))
        if score <= -0.18:
            alignment_trend = "needs_adjustment"
        elif score >= 0.18:
            alignment_trend = "aligned"
        else:
            alignment_trend = "mixed"

    detail_instruction = "Keep answers concise by default." if detail_pref == "concise" else (
        "Provide deeper, step-by-step detail when relevant." if detail_pref == "detailed" else "Use balanced detail."
    )
    humor_instruction = "A light witty tone is acceptable when context fits." if humor_style in {"light", "playful"} else "Prefer neutral tone over humor."
    question_instruction = (
        "Use exploratory follow-up questions when useful." if question_style == "exploratory"
        else ("Ask minimal follow-up questions; be direct." if question_style == "direct" else "Use balanced follow-up questions.")
    )
    alignment_instruction = ""
    if alignment_trend == "needs_adjustment":
        alignment_instruction = "Feedback trend: recent outputs mismatched; be conservative and direct."
    elif alignment_trend == "aligned":
        alignment_instruction = "Feedback trend: recent outputs aligned; preserve style consistency."

    lines = [
        "Learned User Communication Style (cross-modal, per-account):",
        f"- {detail_instruction}",
        f"- {question_instruction}",
        f"- {humor_instruction}",
    ]
    if alignment_instruction:
        lines.append(f"- {alignment_instruction}")
    lines.append("- Never sacrifice correctness for style.")
    return "\n".join(lines)


def get_voice_style_profile_snapshot(*, user_id: str, tenant_id: str) -> Dict[str, Any]:
    """
    Return full learned style profile for transparency/debugging.
    """
    sample_count, metrics, prefs = _load_profile(user_id, tenant_id)
    return {
        "user_id": user_id,
        "tenant_id": tenant_id,
        "sample_count": sample_count,
        "metrics": metrics,
        "preferences": prefs,
    }
