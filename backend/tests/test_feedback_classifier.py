from services_feedback_classifier import (
    infer_feedback_signals,
    should_run_feedback_classifier,
)


def test_should_run_feedback_classifier_only_for_ambiguous_feedback(monkeypatch):
    monkeypatch.setattr(
        "services_feedback_classifier.ENABLE_FEEDBACK_CLASSIFIER_FALLBACK", True
    )

    assert not should_run_feedback_classifier(
        reasoning="too verbose",
        verbosity=None,
        question_preference=None,
        humor_preference=None,
    )
    assert not should_run_feedback_classifier(
        reasoning="ok",
        verbosity=None,
        question_preference=None,
        humor_preference=None,
    )
    assert not should_run_feedback_classifier(
        reasoning="I liked it",
        verbosity="too_short",
        question_preference=None,
        humor_preference=None,
    )
    assert should_run_feedback_classifier(
        reasoning="Good explanation but maybe tune the tone and flow for my style.",
        verbosity=None,
        question_preference=None,
        humor_preference=None,
    )


def test_infer_feedback_signals_returns_high_confidence_tags(monkeypatch):
    monkeypatch.setattr("services_feedback_classifier.FEEDBACK_CLASSIFIER_MIN_CONFIDENCE", 0.60)
    monkeypatch.setattr("services_feedback_classifier.should_run_feedback_classifier", lambda **_: True)

    def fake_completion(**kwargs):
        return (
            '{"verbosity":"too_short","question_preference":"fewer_questions",'
            '"humor_preference":"ok","confidence":0.84}'
        )

    monkeypatch.setattr("services_feedback_classifier.model_router.completion", fake_completion)

    inferred = infer_feedback_signals(reasoning="Could use more detail and fewer clarifying questions.")
    assert inferred.get("verbosity") == "too_short"
    assert inferred.get("question_preference") == "fewer_questions"
    assert inferred.get("humor_preference") == "ok"
    assert inferred.get("confidence", 0.0) >= 0.80


def test_infer_feedback_signals_ignores_low_confidence(monkeypatch):
    monkeypatch.setattr("services_feedback_classifier.FEEDBACK_CLASSIFIER_MIN_CONFIDENCE", 0.70)
    monkeypatch.setattr("services_feedback_classifier.should_run_feedback_classifier", lambda **_: True)

    def fake_completion(**kwargs):
        return (
            '{"verbosity":"too_verbose","question_preference":"ok",'
            '"humor_preference":"less_humor","confidence":0.41}'
        )

    monkeypatch.setattr("services_feedback_classifier.model_router.completion", fake_completion)

    inferred = infer_feedback_signals(reasoning="Might be too much.")
    assert inferred == {}
