import pytest

pytestmark = pytest.mark.unit

from services_voice_style_profile import (
    _default_metrics,
    _derive_preferences,
    observe_explicit_feedback,
)


def test_derive_preferences_for_pause_heavy_exploratory_style():
    metrics = _default_metrics()
    metrics["avg_pause_ratio"] = 0.27
    metrics["question_ratio"] = 0.62
    metrics["humor_ratio"] = 0.18
    metrics["interrupt_rate"] = 0.08

    prefs = _derive_preferences(metrics, sample_count=40)
    rec = prefs.get("recommended_vad", {})

    assert prefs.get("pause_style") == "long_pauses"
    assert prefs.get("question_style") == "exploratory"
    assert prefs.get("humor_style") == "playful"
    assert prefs.get("response_detail_preference") == "balanced"
    assert int(rec.get("end_silence_ms", 0)) >= 1250


def test_derive_preferences_for_compact_direct_style():
    metrics = _default_metrics()
    metrics["avg_pause_ratio"] = 0.05
    metrics["question_ratio"] = 0.16
    metrics["humor_ratio"] = 0.02
    metrics["short_turn_ratio"] = 0.30
    metrics["interrupt_rate"] = 0.22

    prefs = _derive_preferences(metrics, sample_count=35)
    rec = prefs.get("recommended_vad", {})

    assert prefs.get("pause_style") == "compact_pauses"
    assert prefs.get("question_style") == "direct"
    assert prefs.get("humor_style") == "minimal"
    assert int(rec.get("end_silence_ms", 9999)) <= 1200


def test_derive_preferences_for_text_detailed_preference():
    metrics = _default_metrics()
    metrics["text_avg_words"] = 34.0
    metrics["text_long_turn_ratio"] = 0.66
    metrics["text_detail_request_ratio"] = 0.55
    metrics["text_brief_request_ratio"] = 0.08

    prefs = _derive_preferences(metrics, sample_count=30)
    assert prefs.get("response_detail_preference") == "detailed"


def test_derive_preferences_for_text_concise_preference():
    metrics = _default_metrics()
    metrics["text_avg_words"] = 8.0
    metrics["text_long_turn_ratio"] = 0.04
    metrics["text_detail_request_ratio"] = 0.05
    metrics["text_brief_request_ratio"] = 0.42
    metrics["short_turn_ratio"] = 0.31

    prefs = _derive_preferences(metrics, sample_count=30)
    assert prefs.get("response_detail_preference") == "concise"


def test_derive_preferences_tracks_negative_feedback_alignment_trend():
    metrics = _default_metrics()
    metrics["feedback_alignment_score"] = -0.42

    prefs = _derive_preferences(metrics, sample_count=24)
    assert prefs.get("alignment_trend") == "needs_adjustment"


def test_derive_preferences_tracks_positive_feedback_alignment_trend():
    metrics = _default_metrics()
    metrics["feedback_alignment_score"] = 0.37

    prefs = _derive_preferences(metrics, sample_count=24)
    assert prefs.get("alignment_trend") == "aligned"


def test_explicit_feedback_too_verbose_drives_concise_preference(monkeypatch):
    base_metrics = _default_metrics()
    captured = {}

    def fake_load_profile(user_id: str, tenant_id: str):
        return 10, dict(base_metrics), {}

    def fake_save_profile(user_id, tenant_id, sample_count, metrics, prefs):
        captured["sample_count"] = sample_count
        captured["metrics"] = metrics
        captured["prefs"] = prefs

    monkeypatch.setattr("services_voice_style_profile._load_profile", fake_load_profile)
    monkeypatch.setattr("services_voice_style_profile._save_profile", fake_save_profile)

    observe_explicit_feedback(
        user_id="u1",
        tenant_id="t1",
        rating=-1,
        verbosity="too_verbose",
    )

    assert captured["sample_count"] == 11
    assert captured["metrics"]["text_brief_request_ratio"] > base_metrics["text_brief_request_ratio"]
    assert captured["prefs"]["response_detail_preference"] == "concise"


def test_explicit_feedback_too_short_drives_detailed_preference(monkeypatch):
    base_metrics = _default_metrics()
    captured = {}

    def fake_load_profile(user_id: str, tenant_id: str):
        return 10, dict(base_metrics), {}

    def fake_save_profile(user_id, tenant_id, sample_count, metrics, prefs):
        captured["sample_count"] = sample_count
        captured["metrics"] = metrics
        captured["prefs"] = prefs

    monkeypatch.setattr("services_voice_style_profile._load_profile", fake_load_profile)
    monkeypatch.setattr("services_voice_style_profile._save_profile", fake_save_profile)

    observe_explicit_feedback(
        user_id="u1",
        tenant_id="t1",
        rating=1,
        verbosity="too_short",
    )

    assert captured["sample_count"] == 11
    assert captured["metrics"]["text_detail_request_ratio"] > base_metrics["text_detail_request_ratio"]
    assert captured["prefs"]["response_detail_preference"] == "detailed"


def test_explicit_feedback_uses_rewrite_length_and_style_preferences(monkeypatch):
    base_metrics = _default_metrics()
    captured = {}

    def fake_load_profile(user_id: str, tenant_id: str):
        return 12, dict(base_metrics), {}

    def fake_save_profile(user_id, tenant_id, sample_count, metrics, prefs):
        captured["sample_count"] = sample_count
        captured["metrics"] = metrics
        captured["prefs"] = prefs

    monkeypatch.setattr("services_voice_style_profile._load_profile", fake_load_profile)
    monkeypatch.setattr("services_voice_style_profile._save_profile", fake_save_profile)

    observe_explicit_feedback(
        user_id="u1",
        tenant_id="t1",
        question_preference="fewer_questions",
        humor_preference="more_humor",
        original_response=" ".join(["word"] * 30),
        user_rewritten_version=" ".join(["word"] * 12),
    )

    assert captured["sample_count"] == 13
    assert captured["metrics"]["text_brief_request_ratio"] > base_metrics["text_brief_request_ratio"]
    assert captured["metrics"]["question_ratio"] < base_metrics["question_ratio"]
    assert captured["metrics"]["humor_ratio"] > base_metrics["humor_ratio"]
