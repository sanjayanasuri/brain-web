"""
Unit tests for unified_primitives (ArtifactRef / AnchorRef).

These primitives are intended to be used as adapters across existing systems
without breaking current endpoints.
"""

from unified_primitives import (
    AnchorRef,
    ArtifactRef,
    BBoxSelector,
    TextOffsetsSelector,
    TextQuoteSelector,
    TimeRangeSelector,
    compute_anchor_id,
)


def test_compute_anchor_id_is_deterministic_for_same_inputs():
    artifact = ArtifactRef(namespace="frontend", type="chat_message", id="msg-123", version=2)
    selector = TextOffsetsSelector(start_offset=10, end_offset=42)

    a1 = compute_anchor_id(artifact=artifact, selector=selector)
    a2 = compute_anchor_id(artifact=artifact, selector=selector)

    assert a1 == a2
    assert a1.startswith("ANCH_")


def test_compute_anchor_id_changes_when_selector_changes():
    artifact = ArtifactRef(namespace="frontend", type="chat_message", id="msg-123", version=2)

    a1 = compute_anchor_id(artifact=artifact, selector=TextOffsetsSelector(start_offset=10, end_offset=42))
    a2 = compute_anchor_id(artifact=artifact, selector=TextOffsetsSelector(start_offset=11, end_offset=42))

    assert a1 != a2


def test_compute_anchor_id_changes_when_artifact_changes():
    selector = TextOffsetsSelector(start_offset=10, end_offset=42)

    a1 = compute_anchor_id(
        artifact=ArtifactRef(namespace="frontend", type="chat_message", id="msg-123", version=2),
        selector=selector,
    )
    a2 = compute_anchor_id(
        artifact=ArtifactRef(namespace="frontend", type="chat_message", id="msg-456", version=2),
        selector=selector,
    )

    assert a1 != a2


def test_anchorref_create_sets_deterministic_id():
    artifact = ArtifactRef(namespace="neo4j", type="artifact", id="A1B2C3D4", graph_id="default", branch_id="main")
    selector = TextQuoteSelector(exact="hello world", prefix="...", suffix="...")

    ref1 = AnchorRef.create(artifact=artifact, selector=selector, preview="hello world")
    ref2 = AnchorRef.create(artifact=artifact, selector=selector, preview="different preview ok")

    assert ref1.anchor_id == ref2.anchor_id
    assert ref1.preview == "hello world"
    assert ref2.preview == "different preview ok"


def test_anchor_selector_union_variants_round_trip():
    artifact = ArtifactRef(namespace="neo4j", type="artifact", id="A1B2C3D4")
    selectors = [
        TextOffsetsSelector(start_offset=0, end_offset=5),
        TextQuoteSelector(exact="x", prefix="", suffix=""),
        BBoxSelector(x=10, y=20, w=30, h=40, unit="px", page=None),
        TimeRangeSelector(start_ms=0, end_ms=1500),
    ]

    # This primarily verifies the discriminated union wiring doesn't explode.
    for sel in selectors:
        ref = AnchorRef.create(artifact=artifact, selector=sel)
        assert ref.selector.kind == sel.kind
