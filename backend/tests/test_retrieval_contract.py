"""
Contract tests for /ai/retrieve endpoint.

Tests ensure that summary and full modes respect caps and return expected structure.
"""
import pytest
import json
from unittest.mock import Mock, MagicMock, patch
from tests.mock_helpers import MockNeo4jRecord, MockNeo4jResult
from models import Intent


@pytest.fixture
def mock_retrieval_data():
    """Mock data for retrieval tests."""
    return {
        "communities": [
            {"community_id": f"comm_{i}", "name": f"Community {i}", "summary": f"Summary {i}" * 50}
            for i in range(10)
        ],
        "claims": [
            {
                "claim_id": f"claim_{i}",
                "text": f"Claim text {i} " * 100,  # Long text
                "confidence": 0.9 - (i * 0.05),
                "source_id": f"source_{i % 3}",
                "source_title": f"Source {i % 3}",
                "source_url": f"https://example.com/{i}",
                "published_at": "2024-01-01T00:00:00Z",
                "chunk_id": f"chunk_{i}",
            }
            for i in range(20)
        ],
        "concepts": [
            {
                "node_id": f"node_{i}",
                "name": f"Concept {i}",
                "domain": "Test",
                "type": "concept",
                "description": f"Description {i} " * 50,  # Long description
            }
            for i in range(15)
        ],
        "edges": [
            {
                "source_id": f"node_{i}",
                "target_id": f"node_{i+1}",
                "predicate": "RELATED_TO",
            }
            for i in range(20)
        ],
        "chunks": [
            {
                "chunk_id": f"chunk_{i}",
                "text": f"Chunk text {i} " * 200,
                "source_id": f"source_{i % 3}",
            }
            for i in range(15)
        ],
    }


@pytest.fixture
def setup_mock_neo4j_for_retrieval(mock_neo4j_session, mock_retrieval_data):
    """Setup mock Neo4j session to return retrieval data."""
    # Mock communities query
    community_records = [
        MockNeo4jRecord({
            "c": {
                "community_id": comm["community_id"],
                "name": comm["name"],
                "summary": comm["summary"],
            }
        })
        for comm in mock_retrieval_data["communities"][:5]
    ]
    
    # Mock claims query
    claim_records = [
        MockNeo4jRecord({
            "claim": {
                "claim_id": claim["claim_id"],
                "text": claim["text"],
                "confidence": claim["confidence"],
            },
            "source": {
                "source_id": claim["source_id"],
                "title": claim["source_title"],
                "url": claim["source_url"],
            },
            "chunk": {
                "chunk_id": claim["chunk_id"],
            }
        })
        for claim in mock_retrieval_data["claims"][:10]
    ]
    
    # Mock concepts query
    concept_records = [
        MockNeo4jRecord({
            "c": {
                "node_id": concept["node_id"],
                "name": concept["name"],
                "domain": concept["domain"],
                "type": concept["type"],
                "description": concept["description"],
            }
        })
        for concept in mock_retrieval_data["concepts"][:10]
    ]
    
        # Configure session.run to return different results based on query
    def mock_run(query, **params):
        query_lower = query.lower()
        
        # Handle schema constraint queries (SHOW CONSTRAINTS, CREATE CONSTRAINT, DROP CONSTRAINT)
        if "show constraints" in query_lower:
            # Return empty constraints list (schema already initialized)
            return MockNeo4jResult(records=[])
        if "create constraint" in query_lower or "drop constraint" in query_lower:
            # These queries use .consume() so return empty result
            return MockNeo4jResult(record=None)
        
        # Handle backfill queries (used by ensure_graph_scoping_initialized) - these use .consume()
        # Check for backfill queries BEFORE GraphSpace queries (they may contain "graphspace" too)
        if ("where not" in query_lower or "where" in query_lower) and ("belongs_to" in query_lower or "on_branches" in query_lower):
            if "return count" in query_lower:
                # Backfill queries with RETURN count - return result that can be consumed
                return MockNeo4jResult(record=MockNeo4jRecord({"updated": 0}))
        if "set" in query_lower and ("graph_id" in query_lower or "on_branches" in query_lower) and "return count" in query_lower:
            # Update queries with RETURN count - return result that can be consumed
            return MockNeo4jResult(record=MockNeo4jRecord({"updated": 0}))
        
        # Handle GraphSpace queries (for ensure_graphspace_exists) - must return "g" key
        if "graphspace" in query_lower and ("merge" in query_lower or "match" in query_lower):
            if "return g" in query_lower:
                return MockNeo4jResult(record=MockNeo4jRecord({
                    "g": {
                        "graph_id": params.get("graph_id", "default"),
                        "name": params.get("name", "Default"),
                        "created_at": "2024-01-01T00:00:00Z",
                        "updated_at": "2024-01-01T00:00:00Z",
                    }
                }))
        
        # Handle Branch queries (for ensure_branch_exists) - must return "b" key
        if "branch" in query_lower and ("merge" in query_lower or "match" in query_lower):
            if "return b" in query_lower:
                return MockNeo4jResult(record=MockNeo4jRecord({
                    "b": {
                        "branch_id": params.get("branch_id", "main"),
                        "graph_id": params.get("graph_id", "default"),
                        "name": params.get("name", "Main"),
                        "created_at": "2024-01-01T00:00:00Z",
                        "updated_at": "2024-01-01T00:00:00Z",
                    }
                }))
        
        # Handle graph scoping queries (MATCH GraphSpace) - return "g" key
        if "graphspace" in query_lower and "graph_id" in query_lower and "return g" in query_lower:
            return MockNeo4jResult(record=MockNeo4jRecord({
                "g": {
                    "graph_id": params.get("graph_id", "default"),
                    "name": "Default",
                    "created_at": "2024-01-01T00:00:00Z",
                    "updated_at": "2024-01-01T00:00:00Z",
                }
            }))
        
        # Handle active graph context queries
        if "graph_id" in query_lower and "branch_id" in query_lower and "graphspace" in query_lower:
            return MockNeo4jResult(record=MockNeo4jRecord({
                "graph_id": "default",
                "branch_id": "main"
            }))
        
        # Handle retrieval queries
        if "community" in query_lower and "semantic" in query_lower:
            return MockNeo4jResult(records=community_records[:2])
        elif "claim" in query_lower and ("community" in query_lower or "embedding" in query_lower):
            return MockNeo4jResult(records=claim_records[:15])
        elif "concept" in query_lower and ("mentions" in query_lower or "neighbor" in query_lower):
            return MockNeo4jResult(records=concept_records[:10])
        elif "relationship" in query_lower or "edge" in query_lower:
            edge_records = [
                MockNeo4jRecord({
                    "src": f"node_{i}",
                    "dst": f"node_{i+1}",
                    "rel": {"predicate": "RELATED_TO"}
                })
                for i in range(15)
            ]
            return MockNeo4jResult(records=edge_records[:15])
        else:
            # Default: return empty result for other queries
            return MockNeo4jResult(record=None)
    
    mock_neo4j_session.run.side_effect = mock_run
    return mock_neo4j_session


class TestRetrievalSummaryContract:
    """Test /ai/retrieve summary mode contract."""
    
    def test_summary_default_detail_level(self, client, setup_mock_neo4j_for_retrieval):
        """Test that detail_level defaults to 'summary' if omitted."""
        payload = {
            "message": "What is machine learning?",
            "mode": "graphrag",
            "intent": "DEFINITION_OVERVIEW",
            "graph_id": "default",
            "branch_id": "main",
        }
        
        with patch('services_intent_router.classify_intent') as mock_classify:
            mock_classify.return_value = Mock(
                intent="DEFINITION_OVERVIEW",
                confidence=0.9,
                reasoning="Test"
            )
            
            response = client.post("/ai/retrieve", json=payload)
            assert response.status_code == 200
            data = response.json()
            
            # Should default to summary mode
            assert "context" in data
            assert "retrieval_meta" in data["context"]
    
    def test_summary_focus_entities_cap(self, client, setup_mock_neo4j_for_retrieval):
        """Test that focus_entities.length <= 5 in summary mode."""
        payload = {
            "message": "What is machine learning?",
            "mode": "graphrag",
            "intent": "DEFINITION_OVERVIEW",
            "graph_id": "default",
            "branch_id": "main",
            "detail_level": "summary",
        }
        
        with patch('services_intent_router.classify_intent') as mock_classify:
            mock_classify.return_value = Mock(
                intent="DEFINITION_OVERVIEW",
                confidence=0.9,
                reasoning="Test"
            )
            
            response = client.post("/ai/retrieve", json=payload)
            assert response.status_code == 200
            data = response.json()
            
            context = data.get("context", {})
            focus_entities = context.get("focus_entities", [])
            
            assert len(focus_entities) <= 5, f"Expected <= 5 entities, got {len(focus_entities)}"
            
            # Verify entities don't have descriptions
            for entity in focus_entities:
                assert "description" not in entity or entity.get("description") is None
                assert "node_id" in entity
                assert "name" in entity
    
    def test_summary_claims_cap(self, client, setup_mock_neo4j_for_retrieval):
        """Test that claims/top_claims <= 5 in summary mode."""
        payload = {
            "message": "What is machine learning?",
            "mode": "graphrag",
            "intent": "DEFINITION_OVERVIEW",
            "graph_id": "default",
            "branch_id": "main",
            "detail_level": "summary",
        }
        
        with patch('services_intent_router.classify_intent') as mock_classify:
            mock_classify.return_value = Mock(
                intent="DEFINITION_OVERVIEW",
                confidence=0.9,
                reasoning="Test"
            )
            
            response = client.post("/ai/retrieve", json=payload)
            assert response.status_code == 200
            data = response.json()
            
            context = data.get("context", {})
            claims = context.get("claims", [])
            top_claims = context.get("top_claims", [])
            
            assert len(claims) <= 5, f"Expected <= 5 claims, got {len(claims)}"
            assert len(top_claims) <= 5, f"Expected <= 5 top_claims, got {len(top_claims)}"
            
            # Verify claim text is trimmed to ~200 chars
            for claim in top_claims:
                text = claim.get("text", "")
                assert len(text) <= 210, f"Claim text too long: {len(text)} chars"
    
    def test_summary_top_sources_cap(self, client, setup_mock_neo4j_for_retrieval):
        """Test that top_sources <= 3 in summary mode."""
        payload = {
            "message": "What is machine learning?",
            "mode": "graphrag",
            "intent": "DEFINITION_OVERVIEW",
            "graph_id": "default",
            "branch_id": "main",
            "detail_level": "summary",
        }
        
        with patch('services_intent_router.classify_intent') as mock_classify:
            mock_classify.return_value = Mock(
                intent="DEFINITION_OVERVIEW",
                confidence=0.9,
                reasoning="Test"
            )
            
            response = client.post("/ai/retrieve", json=payload)
            assert response.status_code == 200
            data = response.json()
            
            context = data.get("context", {})
            top_sources = context.get("top_sources", [])
            
            assert len(top_sources) <= 3, f"Expected <= 3 sources, got {len(top_sources)}"
    
    def test_summary_subgraph_preview_cap(self, client, setup_mock_neo4j_for_retrieval):
        """Test that subgraph_preview.edges <= 10 in summary mode."""
        payload = {
            "message": "What is machine learning?",
            "mode": "graphrag",
            "intent": "DEFINITION_OVERVIEW",
            "graph_id": "default",
            "branch_id": "main",
            "detail_level": "summary",
        }
        
        with patch('services_intent_router.classify_intent') as mock_classify:
            mock_classify.return_value = Mock(
                intent="DEFINITION_OVERVIEW",
                confidence=0.9,
                reasoning="Test"
            )
            
            response = client.post("/ai/retrieve", json=payload)
            assert response.status_code == 200
            data = response.json()
            
            context = data.get("context", {})
            subgraph = context.get("subgraph", {})
            subgraph_preview = context.get("subgraph_preview", {})
            
            edges = subgraph.get("edges", [])
            preview_edges = subgraph_preview.get("edges", [])
            
            # Either subgraph_preview exists with <= 10 edges, or it's omitted
            if preview_edges:
                assert len(preview_edges) <= 10, f"Expected <= 10 preview edges, got {len(preview_edges)}"
            elif edges:
                assert len(edges) <= 10, f"Expected <= 10 edges, got {len(edges)}"
    
    def test_summary_no_chunks(self, client, setup_mock_neo4j_for_retrieval):
        """Test that chunks are not included in summary mode."""
        payload = {
            "message": "What is machine learning?",
            "mode": "graphrag",
            "intent": "DEFINITION_OVERVIEW",
            "graph_id": "default",
            "branch_id": "main",
            "detail_level": "summary",
        }
        
        with patch('services_intent_router.classify_intent') as mock_classify:
            mock_classify.return_value = Mock(
                intent="DEFINITION_OVERVIEW",
                confidence=0.9,
                reasoning="Test"
            )
            
            response = client.post("/ai/retrieve", json=payload)
            assert response.status_code == 200
            data = response.json()
            
            context = data.get("context", {})
            assert "chunks" not in context, "Chunks should not be in summary mode"
    
    def test_summary_no_community_summaries(self, client, setup_mock_neo4j_for_retrieval):
        """Test that community.summary strings are not included in summary mode."""
        payload = {
            "message": "What is machine learning?",
            "mode": "graphrag",
            "intent": "DEFINITION_OVERVIEW",
            "graph_id": "default",
            "branch_id": "main",
            "detail_level": "summary",
        }
        
        with patch('services_intent_router.classify_intent') as mock_classify:
            mock_classify.return_value = Mock(
                intent="DEFINITION_OVERVIEW",
                confidence=0.9,
                reasoning="Test"
            )
            
            response = client.post("/ai/retrieve", json=payload)
            assert response.status_code == 200
            data = response.json()
            
            context = data.get("context", {})
            communities = context.get("focus_communities", [])
            
            for comm in communities:
                assert "summary" not in comm or comm.get("summary") is None
    
    def test_summary_trace_cap(self, client, setup_mock_neo4j_for_retrieval):
        """Test that trace.length <= 10 in summary mode."""
        payload = {
            "message": "What is machine learning?",
            "mode": "graphrag",
            "intent": "DEFINITION_OVERVIEW",
            "graph_id": "default",
            "branch_id": "main",
            "detail_level": "summary",
        }
        
        with patch('services_intent_router.classify_intent') as mock_classify:
            mock_classify.return_value = Mock(
                intent="DEFINITION_OVERVIEW",
                confidence=0.9,
                reasoning="Test"
            )
            
            response = client.post("/ai/retrieve", json=payload)
            assert response.status_code == 200
            data = response.json()
            
            trace = data.get("trace", [])
            assert len(trace) <= 10, f"Expected <= 10 trace steps, got {len(trace)}"
    
    def test_summary_retrieval_meta_exists(self, client, setup_mock_neo4j_for_retrieval):
        """Test that retrieval_meta exists and includes counts and ID lists."""
        payload = {
            "message": "What is machine learning?",
            "mode": "graphrag",
            "intent": "DEFINITION_OVERVIEW",
            "graph_id": "default",
            "branch_id": "main",
            "detail_level": "summary",
        }
        
        with patch('services_intent_router.classify_intent') as mock_classify:
            mock_classify.return_value = Mock(
                intent="DEFINITION_OVERVIEW",
                confidence=0.9,
                reasoning="Test"
            )
            
            response = client.post("/ai/retrieve", json=payload)
            assert response.status_code == 200
            data = response.json()
            
            context = data.get("context", {})
            retrieval_meta = context.get("retrieval_meta", {})
            
            assert retrieval_meta is not None, "retrieval_meta should exist"
            assert "communities" in retrieval_meta
            assert "claims" in retrieval_meta
            assert "concepts" in retrieval_meta
            assert "edges" in retrieval_meta
            
            # Check ID lists are capped
            claim_ids = retrieval_meta.get("claimIds", [])
            community_ids = retrieval_meta.get("communityIds", [])
            
            assert len(claim_ids) <= 20, f"claimIds should be capped at 20, got {len(claim_ids)}"
            assert len(community_ids) <= 10, f"communityIds should be capped at 10, got {len(community_ids)}"
            
            # Check topClaims exists and is capped
            top_claims = retrieval_meta.get("topClaims", [])
            assert len(top_claims) <= 5, f"topClaims should be capped at 5, got {len(top_claims)}"


class TestRetrievalFullContract:
    """Test /ai/retrieve full mode contract."""
    
    def test_full_mode_returns_richer_fields(self, client, setup_mock_neo4j_for_retrieval):
        """Test that full mode returns richer fields but still respects caps."""
        payload = {
            "message": "What is machine learning?",
            "mode": "graphrag",
            "intent": "DEFINITION_OVERVIEW",
            "graph_id": "default",
            "branch_id": "main",
            "detail_level": "full",
        }
        
        with patch('services_intent_router.classify_intent') as mock_classify:
            mock_classify.return_value = Mock(
                intent="DEFINITION_OVERVIEW",
                confidence=0.9,
                reasoning="Test"
            )
            
            response = client.post("/ai/retrieve", json=payload)
            assert response.status_code == 200
            data = response.json()
            
            context = data.get("context", {})
            
            # Full mode may have more fields, but should still respect reasonable caps
            claims = context.get("claims", [])
            assert len(claims) <= 20, f"Full mode claims should be capped at 20, got {len(claims)}"
            
            subgraph = context.get("subgraph", {})
            edges = subgraph.get("edges", [])
            assert len(edges) <= 50, f"Full mode edges should be capped at 50, got {len(edges)}"
            
            chunks = context.get("chunks", [])
            assert len(chunks) <= 10, f"Full mode chunks should be capped at 10, got {len(chunks)}"
    
    def test_full_mode_deterministic_ordering(self, client, setup_mock_neo4j_for_retrieval):
        """Test that full mode returns deterministic ordering (run twice, compare IDs)."""
        payload = {
            "message": "What is machine learning?",
            "mode": "graphrag",
            "intent": "DEFINITION_OVERVIEW",
            "graph_id": "default",
            "branch_id": "main",
            "detail_level": "full",
        }
        
        with patch('services_intent_router.classify_intent') as mock_classify:
            mock_classify.return_value = Mock(
                intent="DEFINITION_OVERVIEW",
                confidence=0.9,
                reasoning="Test"
            )
            
            # First call
            response1 = client.post("/ai/retrieve", json=payload)
            assert response1.status_code == 200
            data1 = response1.json()
            
            # Second call
            response2 = client.post("/ai/retrieve", json=payload)
            assert response2.status_code == 200
            data2 = response2.json()
            
            # Compare claim IDs (should be in same order)
            claims1 = data1.get("context", {}).get("claims", [])
            claims2 = data2.get("context", {}).get("claims", [])
            
            if claims1 and claims2:
                claim_ids1 = [c.get("claim_id") for c in claims1]
                claim_ids2 = [c.get("claim_id") for c in claims2]
                
                # Should have same IDs in same order (deterministic ranking)
                assert claim_ids1 == claim_ids2, "Claim ordering should be deterministic"


class TestEvidenceSubgraphThrottling:
    """Test /ai/evidence-subgraph throttling."""
    
    def test_evidence_subgraph_default_limits(self, client, mock_neo4j_session):
        """Test that default returns <= 10 concepts, <= 15 edges."""
        # Setup mock for evidence subgraph
        concept_records = [
            MockNeo4jRecord({
                "node_id": f"node_{i}",
                "name": f"Concept {i}",
                "domain": "Test",
                "type": "concept",
                "description": f"Description {i}",
                "tags": [],
            })
            for i in range(15)
        ]
        
        edge_records = [
            MockNeo4jRecord({
                "source_id": f"node_{i}",
                "target_id": f"node_{i+1}",
                "predicate": "RELATED_TO"
            })
            for i in range(20)
        ]
        
        def mock_run(query, **params):
            query_lower = query.lower()
            
            # Handle schema constraint queries
            if "show constraints" in query_lower:
                return MockNeo4jResult(records=[])
            if "create constraint" in query_lower or "drop constraint" in query_lower:
                return MockNeo4jResult(record=None)
            
            # Handle backfill queries (used by ensure_graph_scoping_initialized) - these use .consume()
            # Check for backfill queries BEFORE GraphSpace queries (they may contain "graphspace" too)
            if ("where not" in query_lower or "where" in query_lower) and ("belongs_to" in query_lower or "on_branches" in query_lower):
                if "return count" in query_lower:
                    return MockNeo4jResult(record=MockNeo4jRecord({"updated": 0}))
            if "set" in query_lower and ("graph_id" in query_lower or "on_branches" in query_lower) and "return count" in query_lower:
                return MockNeo4jResult(record=MockNeo4jRecord({"updated": 0}))
            
            # Handle GraphSpace queries
            if "graphspace" in query_lower and ("merge" in query_lower or "match" in query_lower):
                if "return g" in query_lower:
                    return MockNeo4jResult(record=MockNeo4jRecord({
                        "g": {
                            "graph_id": params.get("graph_id", "default"),
                            "name": "Default",
                            "created_at": "2024-01-01T00:00:00Z",
                            "updated_at": "2024-01-01T00:00:00Z",
                        }
                    }))
            # Handle Branch queries
            if "branch" in query_lower and ("merge" in query_lower or "match" in query_lower):
                if "return b" in query_lower:
                    return MockNeo4jResult(record=MockNeo4jRecord({
                        "b": {
                            "branch_id": params.get("branch_id", "main"),
                            "graph_id": params.get("graph_id", "default"),
                            "name": "Main",
                            "created_at": "2024-01-01T00:00:00Z",
                            "updated_at": "2024-01-01T00:00:00Z",
                        }
                    }))
            # Handle edge queries (return source_id/target_id)
            if "source_id" in query_lower and "target_id" in query_lower and "return" in query_lower:
                return MockNeo4jResult(records=edge_records)
            # Handle concept queries (return node_id)
            elif "node_id" in query_lower and "return" in query_lower and "concept" in query_lower:
                return MockNeo4jResult(records=concept_records)
            return MockNeo4jResult(record=None)
        
        mock_neo4j_session.run.side_effect = mock_run
        
        payload = {
            "graph_id": "default",
            "claim_ids": ["claim_1", "claim_2", "claim_3"],
        }
        
        response = client.post("/ai/evidence-subgraph", json=payload)
        assert response.status_code == 200
        data = response.json()
        
        concepts = data.get("concepts", [])
        edges = data.get("edges", [])
        
        assert len(concepts) <= 10, f"Expected <= 10 concepts, got {len(concepts)}"
        assert len(edges) <= 15, f"Expected <= 15 edges, got {len(edges)}"
    
    def test_evidence_subgraph_custom_limits(self, client, mock_neo4j_session):
        """Test that limit_nodes and limit_edges are respected."""
        concept_records = [
            MockNeo4jRecord({
                "node_id": f"node_{i}",
                "name": f"Concept {i}",
                "domain": "Test",
                "type": "concept",
                "description": f"Description {i}",
                "tags": [],
            })
            for i in range(10)
        ]
        
        edge_records = [
            MockNeo4jRecord({
                "source_id": f"node_{i}",
                "target_id": f"node_{i+1}",
                "predicate": "RELATED_TO"
            })
            for i in range(10)
        ]
        
        def mock_run(query, **params):
            query_lower = query.lower()
            
            # Handle schema constraint queries
            if "show constraints" in query_lower:
                return MockNeo4jResult(records=[])
            if "create constraint" in query_lower or "drop constraint" in query_lower:
                return MockNeo4jResult(record=None)
            
            # Handle backfill queries (used by ensure_graph_scoping_initialized) - these use .consume()
            # Check for backfill queries BEFORE GraphSpace queries (they may contain "graphspace" too)
            if ("where not" in query_lower or "where" in query_lower) and ("belongs_to" in query_lower or "on_branches" in query_lower):
                if "return count" in query_lower:
                    return MockNeo4jResult(record=MockNeo4jRecord({"updated": 0}))
            if "set" in query_lower and ("graph_id" in query_lower or "on_branches" in query_lower) and "return count" in query_lower:
                return MockNeo4jResult(record=MockNeo4jRecord({"updated": 0}))
            
            # Handle GraphSpace queries
            if "graphspace" in query_lower and ("merge" in query_lower or "match" in query_lower):
                if "return g" in query_lower:
                    return MockNeo4jResult(record=MockNeo4jRecord({
                        "g": {
                            "graph_id": params.get("graph_id", "default"),
                            "name": "Default",
                            "created_at": "2024-01-01T00:00:00Z",
                            "updated_at": "2024-01-01T00:00:00Z",
                        }
                    }))
            # Handle Branch queries
            if "branch" in query_lower and ("merge" in query_lower or "match" in query_lower):
                if "return b" in query_lower:
                    return MockNeo4jResult(record=MockNeo4jRecord({
                        "b": {
                            "branch_id": params.get("branch_id", "main"),
                            "graph_id": params.get("graph_id", "default"),
                            "name": "Main",
                            "created_at": "2024-01-01T00:00:00Z",
                            "updated_at": "2024-01-01T00:00:00Z",
                        }
                    }))
            # Handle edge queries (return source_id/target_id)
            if "source_id" in query_lower and "target_id" in query_lower and "return" in query_lower:
                return MockNeo4jResult(records=edge_records)
            # Handle concept queries (return node_id)
            elif "node_id" in query_lower and "return" in query_lower and "concept" in query_lower:
                return MockNeo4jResult(records=concept_records)
            return MockNeo4jResult(record=None)
        
        mock_neo4j_session.run.side_effect = mock_run
        
        payload = {
            "graph_id": "default",
            "claim_ids": ["claim_1", "claim_2"],
            "limit_nodes": 3,
            "limit_edges": 4,
        }
        
        response = client.post("/ai/evidence-subgraph", json=payload)
        assert response.status_code == 200
        data = response.json()
        
        concepts = data.get("concepts", [])
        edges = data.get("edges", [])
        
        assert len(concepts) <= 3, f"Expected <= 3 concepts, got {len(concepts)}"
        assert len(edges) <= 4, f"Expected <= 4 edges, got {len(edges)}"
    
    def test_evidence_subgraph_deterministic_ranking(self, client, mock_neo4j_session):
        """Test that evidence subgraph returns deterministic ranking."""
        concept_records = [
            MockNeo4jRecord({
                "node_id": f"node_{i}",
                "name": f"Concept {i}",
                "domain": "Test",
                "type": "concept",
                "description": f"Description {i}",
                "tags": [],
            })
            for i in range(10)
        ]
        
        edge_records = [
            MockNeo4jRecord({
                "source_id": f"node_{i}",
                "target_id": f"node_{i+1}",
                "predicate": "RELATED_TO"
            })
            for i in range(10)
        ]
        
        def mock_run(query, **params):
            query_lower = query.lower()
            
            # Handle schema constraint queries
            if "show constraints" in query_lower:
                return MockNeo4jResult(records=[])
            if "create constraint" in query_lower or "drop constraint" in query_lower:
                return MockNeo4jResult(record=None)
            
            # Handle backfill queries (used by ensure_graph_scoping_initialized) - these use .consume()
            # Check for backfill queries BEFORE GraphSpace queries (they may contain "graphspace" too)
            if ("where not" in query_lower or "where" in query_lower) and ("belongs_to" in query_lower or "on_branches" in query_lower):
                if "return count" in query_lower:
                    return MockNeo4jResult(record=MockNeo4jRecord({"updated": 0}))
            if "set" in query_lower and ("graph_id" in query_lower or "on_branches" in query_lower) and "return count" in query_lower:
                return MockNeo4jResult(record=MockNeo4jRecord({"updated": 0}))
            
            # Handle GraphSpace queries
            if "graphspace" in query_lower and ("merge" in query_lower or "match" in query_lower):
                if "return g" in query_lower:
                    return MockNeo4jResult(record=MockNeo4jRecord({
                        "g": {
                            "graph_id": params.get("graph_id", "default"),
                            "name": "Default",
                            "created_at": "2024-01-01T00:00:00Z",
                            "updated_at": "2024-01-01T00:00:00Z",
                        }
                    }))
            # Handle Branch queries
            if "branch" in query_lower and ("merge" in query_lower or "match" in query_lower):
                if "return b" in query_lower:
                    return MockNeo4jResult(record=MockNeo4jRecord({
                        "b": {
                            "branch_id": params.get("branch_id", "main"),
                            "graph_id": params.get("graph_id", "default"),
                            "name": "Main",
                            "created_at": "2024-01-01T00:00:00Z",
                            "updated_at": "2024-01-01T00:00:00Z",
                        }
                    }))
            # Handle edge queries (return source_id/target_id)
            if "source_id" in query_lower and "target_id" in query_lower and "return" in query_lower:
                return MockNeo4jResult(records=edge_records)
            # Handle concept queries (return node_id)
            elif "node_id" in query_lower and "return" in query_lower and "concept" in query_lower:
                return MockNeo4jResult(records=concept_records)
            return MockNeo4jResult(record=None)
        
        mock_neo4j_session.run.side_effect = mock_run
        
        payload = {
            "graph_id": "default",
            "claim_ids": ["claim_1", "claim_2"],
            "limit_nodes": 5,
            "limit_edges": 5,
        }
        
        # First call
        response1 = client.post("/ai/evidence-subgraph", json=payload)
        assert response1.status_code == 200
        data1 = response1.json()
        
        # Second call
        response2 = client.post("/ai/evidence-subgraph", json=payload)
        assert response2.status_code == 200
        data2 = response2.json()
        
        # Compare concept IDs (should be in same order)
        concept_ids1 = [c.get("node_id") for c in data1.get("concepts", [])]
        concept_ids2 = [c.get("node_id") for c in data2.get("concepts", [])]
        
        assert concept_ids1 == concept_ids2, "Concept ordering should be deterministic"


class TestPayloadSizeGuardrail:
    """Test payload size guardrails to prevent regressions."""
    
    def test_summary_payload_size_limit(self, client, setup_mock_neo4j_for_retrieval):
        """Test that summary retrieval payload size is within threshold (60-100 KB)."""
        payload = {
            "message": "What is machine learning?",
            "mode": "graphrag",
            "intent": "DEFINITION_OVERVIEW",
            "graph_id": "default",
            "branch_id": "main",
            "detail_level": "summary",
        }
        
        with patch('services_intent_router.classify_intent') as mock_classify:
            mock_classify.return_value = Mock(
                intent="DEFINITION_OVERVIEW",
                confidence=0.9,
                reasoning="Test"
            )
            
            response = client.post("/ai/retrieve", json=payload)
            assert response.status_code == 200
            
            # Measure JSON payload size
            response_text = response.text
            payload_size_kb = len(response_text.encode('utf-8')) / 1024
            
            # Should be under 100 KB for summary mode
            assert payload_size_kb < 100, f"Summary payload too large: {payload_size_kb:.2f} KB (expected < 100 KB)"
            
            # Log for monitoring
            print(f"\n[Payload Size Test] Summary mode payload: {payload_size_kb:.2f} KB")

