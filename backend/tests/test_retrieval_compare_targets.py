from types import SimpleNamespace

import services_retrieval_plans as svc


def test_extract_compare_targets_regex_parses_common_forms():
    assert svc._extract_compare_targets_regex("TensorFlow vs PyTorch") == ["TensorFlow", "PyTorch"]
    assert svc._extract_compare_targets_regex("compare React and Vue?") == ["React", "Vue"]
    assert svc._extract_compare_targets_regex("difference between TCP and UDP") == ["TCP", "UDP"]


def test_identify_compare_targets_prefers_llm(monkeypatch):
    monkeypatch.setattr(
        svc,
        "_extract_compare_targets_llm",
        lambda _query: ["TensorFlow", "PyTorch"],
    )
    monkeypatch.setattr(
        svc,
        "_extract_compare_targets_regex",
        lambda _query: (_ for _ in ()).throw(AssertionError("regex fallback should not run")),
    )
    monkeypatch.setattr(
        svc,
        "semantic_search_nodes",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("semantic fallback should not run")),
    )

    targets, method = svc._identify_compare_targets("Compare TensorFlow and PyTorch", session=object())
    assert targets == ["TensorFlow", "PyTorch"]
    assert method == "llm"


def test_identify_compare_targets_uses_regex_when_llm_empty(monkeypatch):
    monkeypatch.setattr(svc, "_extract_compare_targets_llm", lambda _query: [])
    monkeypatch.setattr(
        svc,
        "semantic_search_nodes",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("semantic fallback should not run")),
    )

    targets, method = svc._identify_compare_targets("Compare Java and Kotlin", session=object())
    assert targets == ["Java", "Kotlin"]
    assert method == "regex"


def test_identify_compare_targets_uses_semantic_fallback(monkeypatch):
    monkeypatch.setattr(svc, "_extract_compare_targets_llm", lambda _query: [])
    monkeypatch.setattr(svc, "_extract_compare_targets_regex", lambda _query: [])
    monkeypatch.setattr(
        svc,
        "semantic_search_nodes",
        lambda *_args, **_kwargs: [
            {"node": SimpleNamespace(name="PostgreSQL")},
            {"node": SimpleNamespace(name="MySQL")},
        ],
    )

    targets, method = svc._identify_compare_targets("database options", session=object())
    assert targets == ["PostgreSQL", "MySQL"]
    assert method == "semantic"
