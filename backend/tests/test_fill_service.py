import services_fill as svc


def test_parse_fill_command_variants():
    assert svc.parse_fill_command("/fill diagram: cell cycle") == ("diagram", "cell cycle")
    assert svc.parse_fill_command("/fill diag meiosis") == ("diagram", "meiosis")
    assert svc.parse_fill_command("/fill link: centromere") == ("link", "centromere")
    assert svc.parse_fill_command("/fill where telophase") == ("link", "telophase")
    assert svc.parse_fill_command("/fill web: latest mitosis news") == ("web", "latest mitosis news")
    assert svc.parse_fill_command("/fill spindle fibers") == ("link", "spindle fibers")


def test_run_fill_link_formats_and_persists(mock_neo4j_session, monkeypatch):
    monkeypatch.setattr(
        svc,
        "_search_links",
        lambda **kwargs: {
            "artifacts": [
                {"artifact_id": "A123", "title": "Whiteboard Photo", "url": "note-image://abc", "artifact_type": "note_image", "captured_at": 0},
            ],
            "quotes": [
                {"quote_id": "QIMG_1", "text_preview": "centromere holds chromatids", "anchor_json": "{}", "artifact_id": "A123", "artifact_title": "Whiteboard Photo", "artifact_url": "note-image://abc"},
            ],
        },
    )

    captured = {}

    def _fake_upsert(*, artifact_type: str, **kwargs):
        captured["artifact_type"] = artifact_type
        return "ATESTFILL"

    monkeypatch.setattr(svc, "_upsert_fill_artifact", _fake_upsert)

    resp = svc.run_fill(
        session=mock_neo4j_session,
        command="/fill link: centromere",
        graph_id="default",
        branch_id="main",
        limit=5,
        tenant_id="test-tenant",
    )

    assert resp.status == "ok"
    assert resp.kind == "link"
    assert resp.artifact_id == "ATESTFILL"
    assert captured["artifact_type"] == "fill_links"
    assert "centromere" in resp.answer.lower()
    assert "Artifacts" in resp.answer
    assert "Anchored quotes" in resp.answer


def test_run_fill_diagram_persists_mermaid(mock_neo4j_session, monkeypatch):
    monkeypatch.setattr(svc, "generate_mermaid_diagram", lambda topic: ("flowchart TD\n  A-->B", ["warn"]))

    captured = {}

    def _fake_upsert(*, artifact_type: str, text: str, **kwargs):
        captured["artifact_type"] = artifact_type
        captured["text"] = text
        return "ADIAGRAM"

    monkeypatch.setattr(svc, "_upsert_fill_artifact", _fake_upsert)

    resp = svc.run_fill(
        session=mock_neo4j_session,
        command="/fill diagram: meiosis I vs meiosis II",
        graph_id="default",
        branch_id="main",
        tenant_id="test-tenant",
    )

    assert resp.status == "ok"
    assert resp.kind == "diagram"
    assert resp.artifact_id == "ADIAGRAM"
    assert captured["artifact_type"] == "generated_diagram"
    assert "```mermaid" in resp.answer
    assert resp.data.get("mermaid")
    assert "warn" in resp.warnings

