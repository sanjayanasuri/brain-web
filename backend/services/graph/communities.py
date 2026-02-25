"""
Community nodes and concept–community membership.
"""
from typing import Any, Dict, List, Optional

from neo4j import Session

from services_branch_explorer import ensure_graph_scoping_initialized, get_active_graph_context


def _normalize_claim_from_db(record_data: Any) -> dict:
    """Normalize claim record data from Neo4j."""
    return dict(record_data)


def upsert_community(
    session: Session,
    graph_id: str,
    community_id: str,
    name: str,
    summary: Optional[str] = None,
    summary_embedding: Optional[List[float]] = None,
    build_version: Optional[str] = None,
) -> dict:
    """Create or update a Community node. Returns dict with community_id and basic fields."""
    ensure_graph_scoping_initialized(session)

    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MERGE (k:Community {graph_id: $graph_id, community_id: $community_id})
    ON CREATE SET
        k.name = $name,
        k.summary = $summary,
        k.summary_embedding = $summary_embedding,
        k.build_version = $build_version,
        k.created_at = timestamp()
    ON MATCH SET
        k.name = $name,
        k.summary = $summary,
        k.summary_embedding = $summary_embedding,
        k.build_version = $build_version,
        k.updated_at = timestamp()
    MERGE (k)-[:BELONGS_TO]->(g)
    RETURN k.community_id AS community_id,
           k.name AS name,
           k.summary AS summary
    """
    result = session.run(
        query,
        graph_id=graph_id,
        community_id=community_id,
        name=name,
        summary=summary,
        summary_embedding=summary_embedding,
        build_version=build_version,
    )
    record = result.single()
    if not record:
        raise ValueError(f"Failed to create/update Community {community_id}")
    return record.data()


def set_concept_community_memberships(
    session: Session,
    graph_id: str,
    community_id: str,
    concept_node_ids: List[str],
) -> None:
    """Set community memberships for concepts, removing prior memberships within this graph."""
    if not concept_node_ids:
        return

    ensure_graph_scoping_initialized(session)

    query_remove = """
    MATCH (c:Concept {graph_id: $graph_id, node_id: $nid})-[r:IN_COMMUNITY]->(:Community {graph_id: $graph_id})
    DELETE r
    """
    query_add = """
    MATCH (c:Concept {graph_id: $graph_id, node_id: $nid})
    MATCH (k:Community {graph_id: $graph_id, community_id: $community_id})
    MERGE (c)-[:IN_COMMUNITY]->(k)
    """

    for nid in concept_node_ids:
        session.run(query_remove, graph_id=graph_id, nid=nid)
        session.run(query_add, graph_id=graph_id, community_id=community_id, nid=nid)


def get_claims_for_communities(
    session: Session,
    graph_id: str,
    community_ids: List[str],
    limit_per_comm: int = 30,
    ingestion_run_id: Optional[Any] = None,
) -> Dict[str, List[dict]]:
    """Get claims that mention concepts in each community, ordered by confidence."""
    ensure_graph_scoping_initialized(session)
    _, branch_id = get_active_graph_context(session)

    if not community_ids:
        return {}

    run_ids = None
    if ingestion_run_id:
        run_ids = ingestion_run_id if isinstance(ingestion_run_id, list) else [ingestion_run_id]

    query = """
    MATCH (g:GraphSpace {graph_id: $graph_id})
    MATCH (k:Community {graph_id: $graph_id, community_id: $comm_id})-[:BELONGS_TO]->(g)
    MATCH (c:Concept {graph_id: $graph_id})-[:IN_COMMUNITY]->(k)
    MATCH (claim:Claim {graph_id: $graph_id})-[:MENTIONS]->(c)
    WHERE $branch_id IN COALESCE(claim.on_branches, [])
      AND ($run_ids IS NULL OR claim.ingestion_run_id IN $run_ids)
    WITH k.community_id AS comm_id, claim
    ORDER BY claim.confidence DESC
    WITH comm_id, collect(claim)[0..$limit] AS claims
    RETURN comm_id, claims
    """

    results = {}
    for comm_id in community_ids:
        params = {
            "graph_id": graph_id,
            "comm_id": comm_id,
            "branch_id": branch_id,
            "run_ids": run_ids,
            "limit": limit_per_comm,
        }
        res = session.run(query, **params)
        record = res.single()
        if record:
            results[comm_id] = [_normalize_claim_from_db(c) for c in record["claims"]]
        else:
            results[comm_id] = []

    return results
