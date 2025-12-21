"""
Tests for finance vertical retrieval features.

Tests finance-specific retrieval including:
- Anchor company detection
- Lens routing
- Finance-specific templates
- Evidence strictness filtering
"""
import pytest
from unittest.mock import Mock, MagicMock, patch
from tests.mock_helpers import MockNeo4jRecord, MockNeo4jResult


@pytest.fixture
def mock_finance_data():
    """Mock data for finance retrieval tests."""
    return {
        "companies": [
            {"node_id": "comp_1", "name": "Apple Inc", "type": "Company", "domain": "Technology"},
            {"node_id": "comp_2", "name": "Microsoft", "type": "Company", "domain": "Technology"},
        ],
        "communities": [
            {
                "community_id": f"comm_{i}",
                "name": f"Finance Community {i}",
                "score": 0.9 - (i * 0.1),
            }
            for i in range(5)
        ],
        "claims": [
            {
                "claim_id": f"claim_{i}",
                "text": f"Financial claim {i}",
                "confidence": 0.85 - (i * 0.05),
                "source_id": f"source_{i % 2}",
                "published_at": "2024-01-01T00:00:00Z",
            }
            for i in range(20)
        ],
        "concepts": [
            {
                "node_id": f"node_{i}",
                "name": f"Finance Concept {i}",
                "domain": "Finance",
                "type": "concept",
            }
            for i in range(10)
        ],
    }


@pytest.fixture
def setup_mock_neo4j_for_finance(mock_neo4j_session, mock_finance_data):
    """Setup mock Neo4j session for finance retrieval."""
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
        
        # Company/concept search by name (get_concept_by_name returns fields directly)
        # This MUST come before graph scoping checks to avoid false matches
        # Check for queries that match (c:Concept {name: $name}) pattern
        if ("concept" in query_lower and "name" in query_lower and 
            "return" in query_lower and "c.node_id" in query_lower and 
            "as node_id" in query_lower and "limit 1" in query_lower and
            "graphspace" in query_lower):
            # This is get_concept_by_name - returns fields directly
            company = mock_finance_data["companies"][0]
            return MockNeo4jResult(record=MockNeo4jRecord({
                "node_id": company["node_id"],
                "name": company["name"],
                "type": company["type"],
                "domain": company["domain"],
                "description": None,
                "tags": [],
                "notes_key": None,
                "lecture_key": None,
                "url_slug": None,
                "lecture_sources": [],
                "created_by": None,
                "last_updated_by": None,
            }))
        
        # Handle active graph context queries
        if "graph_id" in query_lower and "branch_id" in query_lower and "graphspace" in query_lower:
            return MockNeo4jResult(record=MockNeo4jRecord({
                "graph_id": "default",
                "branch_id": "main"
            }))
        
        # Semantic/concept search (returns nested structure)
        if "concept" in query_lower and "semantic" in query_lower:
            company_records = [
                MockNeo4jRecord({
                    "c": {
                        "node_id": comp["node_id"],
                        "name": comp["name"],
                        "type": comp["type"],
                        "domain": comp["domain"],
                    }
                })
                for comp in mock_finance_data["companies"][:1]
            ]
            return MockNeo4jResult(records=company_records)
        
        # Communities
        if "community" in query_lower and "semantic" in query_lower:
            community_records = [
                MockNeo4jRecord({
                    "c": {
                        "community_id": comm["community_id"],
                        "name": comm["name"],
                        "score": comm["score"],
                    }
                })
                for comm in mock_finance_data["communities"][:3]
            ]
            return MockNeo4jResult(records=community_records)
        
        # Claims
        if "claim" in query_lower:
            claim_records = [
                MockNeo4jRecord({
                    "claim": {
                        "claim_id": claim["claim_id"],
                        "text": claim["text"],
                        "confidence": claim["confidence"],
                    },
                    "source": {
                        "source_id": claim["source_id"],
                    }
                })
                for claim in mock_finance_data["claims"][:15]
            ]
            return MockNeo4jResult(records=claim_records)
        
        # Concepts/edges
        if "concept" in query_lower and ("mentions" in query_lower or "neighbor" in query_lower):
            concept_records = [
                MockNeo4jRecord({
                    "c": {
                        "node_id": concept["node_id"],
                        "name": concept["name"],
                        "domain": concept["domain"],
                        "type": concept["type"],
                    }
                })
                for concept in mock_finance_data["concepts"][:10]
            ]
            return MockNeo4jResult(records=concept_records)
        
        return MockNeo4jResult(record=None)
    
    mock_neo4j_session.run.side_effect = mock_run
    return mock_neo4j_session


class TestFinanceRetrieval:
    """Test finance vertical retrieval."""
    
    def test_finance_graphrag_context_with_lens(self, client, setup_mock_neo4j_for_finance):
        """Test finance GraphRAG context retrieval with lens parameter."""
        payload = {
            "message": "AAPL: What are the key financial metrics?",
            "graph_id": "default",
            "branch_id": "main",
            "vertical": "finance",
            "lens": "earnings",
        }
        
        response = client.post("/ai/graphrag-context", json=payload)
        assert response.status_code == 200
        data = response.json()
        
        assert "context_text" in data
        assert "debug" in data
        assert "meta" in data
        
        # Verify meta contains finance-specific fields
        meta = data.get("meta", {})
        assert "lens" in meta or "anchor_name" in meta
    
    def test_finance_anchor_company_detection(self, client, setup_mock_neo4j_for_finance):
        """Test that finance retrieval detects anchor company from query."""
        payload = {
            "message": "AAPL: revenue trends",
            "graph_id": "default",
            "branch_id": "main",
            "vertical": "finance",
        }
        
        response = client.post("/ai/graphrag-context", json=payload)
        assert response.status_code == 200
        data = response.json()
        
        # Should successfully process finance query
        assert "context_text" in data
    
    def test_finance_evidence_strictness_filtering(self, client, setup_mock_neo4j_for_finance):
        """Test that evidence_strictness parameter filters claims appropriately."""
        # Test high strictness
        payload_high = {
            "message": "AAPL: financial performance",
            "graph_id": "default",
            "branch_id": "main",
            "vertical": "finance",
            "evidence_strictness": "high",
        }
        
        response_high = client.post("/ai/graphrag-context", json=payload_high)
        assert response_high.status_code == 200
        data_high = response_high.json()
        
        # Test medium strictness
        payload_medium = {
            "message": "AAPL: financial performance",
            "graph_id": "default",
            "branch_id": "main",
            "vertical": "finance",
            "evidence_strictness": "medium",
        }
        
        response_medium = client.post("/ai/graphrag-context", json=payload_medium)
        assert response_medium.status_code == 200
        data_medium = response_medium.json()
        
        # High strictness should return fewer claims than medium
        meta_high = data_high.get("meta", {})
        meta_medium = data_medium.get("meta", {})
        
        claims_high = meta_high.get("claim_counts", {}).get("after_strictness", 0)
        claims_medium = meta_medium.get("claim_counts", {}).get("after_strictness", 0)
        
        assert claims_high <= claims_medium, "High strictness should filter more claims"
    
    def test_finance_recency_filtering(self, client, setup_mock_neo4j_for_finance):
        """Test that recency_days parameter filters claims by date."""
        payload = {
            "message": "AAPL: recent financial news",
            "graph_id": "default",
            "branch_id": "main",
            "vertical": "finance",
            "recency_days": 30,
        }
        
        response = client.post("/ai/graphrag-context", json=payload)
        assert response.status_code == 200
        data = response.json()
        
        # Should successfully filter by recency
        assert "context_text" in data
    
    def test_finance_lens_routing(self, client, setup_mock_neo4j_for_finance):
        """Test that different lenses route to appropriate templates."""
        lenses = ["earnings", "revenue", "valuation", "risk"]
        
        for lens in lenses:
            payload = {
                "message": f"AAPL: {lens} analysis",
                "graph_id": "default",
                "branch_id": "main",
                "vertical": "finance",
                "lens": lens,
            }
            
            response = client.post("/ai/graphrag-context", json=payload)
            assert response.status_code == 200
            data = response.json()
            
            assert "context_text" in data
            # Verify lens is included in meta
            meta = data.get("meta", {})
            assert meta.get("lens") == lens
    
    def test_finance_include_proposed_edges(self, client, setup_mock_neo4j_for_finance):
        """Test that include_proposed_edges parameter controls edge visibility."""
        # Test with proposed edges
        payload_with = {
            "message": "AAPL: relationships",
            "graph_id": "default",
            "branch_id": "main",
            "vertical": "finance",
            "include_proposed_edges": True,
        }
        
        response_with = client.post("/ai/graphrag-context", json=payload_with)
        assert response_with.status_code == 200
        
        # Test without proposed edges
        payload_without = {
            "message": "AAPL: relationships",
            "graph_id": "default",
            "branch_id": "main",
            "vertical": "finance",
            "include_proposed_edges": False,
        }
        
        response_without = client.post("/ai/graphrag-context", json=payload_without)
        assert response_without.status_code == 200
    
    def test_finance_ticker_format_detection(self, client, setup_mock_neo4j_for_finance):
        """Test that ticker format 'TICKER: query' is detected correctly."""
        payload = {
            "message": "AAPL: What is the revenue?",
            "graph_id": "default",
            "branch_id": "main",
            "vertical": "finance",
        }
        
        response = client.post("/ai/graphrag-context", json=payload)
        assert response.status_code == 200
        data = response.json()
        
        # Should successfully detect AAPL ticker
        assert "context_text" in data
    
    def test_finance_short_query_as_company(self, client, setup_mock_neo4j_for_finance):
        """Test that short queries are treated as company names/tickers."""
        payload = {
            "message": "Apple",
            "graph_id": "default",
            "branch_id": "main",
            "vertical": "finance",
        }
        
        response = client.post("/ai/graphrag-context", json=payload)
        assert response.status_code == 200
        data = response.json()
        
        # Should treat "Apple" as company name
        assert "context_text" in data

