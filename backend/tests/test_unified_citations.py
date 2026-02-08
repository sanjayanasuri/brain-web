"""
Unit tests for services_unified_citations (Phase C).
"""

from services_unified_citations import build_retrieval_citations


def test_build_retrieval_citations_from_source_chunks():
    context = {
        "chunks": [
            {
                "chunk_id": "chunk_1",
                "chunk_index": 0,
                "source_id": "source_1",
                "doc_id": "doc_1",
                "url": "https://example.com/doc",
                "source_type": "news",
                "published_at": "2024-01-01T00:00:00Z",
                "text": "Hello world",
            }
        ]
    }

    citations = build_retrieval_citations(context=context, graph_id="default", branch_id="main")
    assert len(citations) == 1

    c0 = citations[0]
    assert c0["kind"] == "source_chunk"
    assert c0["chunk_id"] == "chunk_1"
    assert c0["url"] == "https://example.com/doc"

    anchor = c0["anchor"]
    assert anchor["anchor_id"].startswith("ANCH_")
    assert anchor["artifact"]["namespace"] == "neo4j"
    assert anchor["artifact"]["type"] == "source_chunk"
    assert anchor["artifact"]["id"] == "chunk_1"
    assert anchor["artifact"]["graph_id"] == "default"
    assert anchor["artifact"]["branch_id"] == "main"
    assert anchor["selector"]["kind"] == "text_offsets"
    assert anchor["selector"]["start_offset"] == 0
    assert anchor["selector"]["end_offset"] == len("Hello world")
    assert anchor["preview"] == "Hello world"

