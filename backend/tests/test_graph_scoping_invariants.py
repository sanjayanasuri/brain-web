import os
from urllib.parse import urlparse

import pytest
from neo4j import GraphDatabase

from models import ConceptCreate, LectureCreate
from services_branch_explorer import set_active_graph, ensure_branch_exists, ensure_graphspace_exists
from services_graph import create_concept, create_relationship_by_ids, get_all_concepts, get_concept_by_id
from services_lectures import create_lecture


def _is_truthy(value: str) -> bool:
    return value.strip().lower() in ("1", "true", "yes")


def _resolve_graph_scoping_uri(uri: str) -> str:
    """
    Normalize local Neo4j routing URIs to direct Bolt for integration tests.

    This avoids routing-table lookups (neo4j://...) when running against a
    local standalone Neo4j instance.
    """
    parsed = urlparse(uri)
    local_hosts = {"localhost", "127.0.0.1", "::1", "neo4j"}
    scheme_map = {
        "neo4j": "bolt",
        "neo4j+s": "bolt+s",
        "neo4j+ssc": "bolt+ssc",
    }
    if parsed.hostname in local_hosts and parsed.scheme in scheme_map:
        current_prefix = f"{parsed.scheme}://"
        target_prefix = f"{scheme_map[parsed.scheme]}://"
        if uri.startswith(current_prefix):
            return uri.replace(current_prefix, target_prefix, 1)
    return uri


GRAPH_SCOPING_PROFILE = {
    "uri": _resolve_graph_scoping_uri(
        os.getenv("GRAPH_SCOPING_NEO4J_URI")
        or os.getenv("NEO4J_TEST_URI")
        or os.getenv("NEO4J_URI")
        or "bolt://127.0.0.1:7687"
    ),
    "user": (
        os.getenv("GRAPH_SCOPING_NEO4J_USER")
        or os.getenv("NEO4J_TEST_USER")
        or os.getenv("NEO4J_USER")
        or "neo4j"
    ),
    "password": (
        os.getenv("GRAPH_SCOPING_NEO4J_PASSWORD")
        or os.getenv("NEO4J_TEST_PASSWORD")
        or os.getenv("NEO4J_PASSWORD")
        or ""
    ),
    "database": (
        os.getenv("GRAPH_SCOPING_NEO4J_DATABASE")
        or os.getenv("NEO4J_TEST_DATABASE")
        or os.getenv("NEO4J_DATABASE")
        or "neo4j"
    ),
}


def _open_graph_scoping_session():
    if not GRAPH_SCOPING_PROFILE["password"]:
        raise ValueError(
            "Neo4j password missing for graph scoping test profile. "
            "Set GRAPH_SCOPING_NEO4J_PASSWORD, NEO4J_TEST_PASSWORD, or NEO4J_PASSWORD."
        )

    driver = GraphDatabase.driver(
        GRAPH_SCOPING_PROFILE["uri"],
        auth=(GRAPH_SCOPING_PROFILE["user"], GRAPH_SCOPING_PROFILE["password"]),
        connection_acquisition_timeout=10,
    )
    session = driver.session(database=GRAPH_SCOPING_PROFILE["database"])
    return driver, session


def _is_neo4j_available() -> bool:
    driver = None
    session = None
    try:
        driver, session = _open_graph_scoping_session()
        rec = session.run("RETURN 1 AS ok").single()
        return bool(rec and rec.get("ok") == 1)
    except Exception:
        return False
    finally:
        if session is not None:
            try:
                session.close()
            except Exception:
                pass
        if driver is not None:
            try:
                driver.close()
            except Exception:
                pass


_env = os.getenv("RUN_GRAPH_SCOPING_TESTS", "").strip().lower()
if _is_truthy(_env):
    RUN_GRAPH_SCOPING_TESTS = True
elif _env in ("0", "false", "no"):
    RUN_GRAPH_SCOPING_TESTS = False
else:
    RUN_GRAPH_SCOPING_TESTS = _is_neo4j_available()


@pytest.mark.skipif(
    not RUN_GRAPH_SCOPING_TESTS,
    reason=(
        f"Neo4j unavailable for graph scoping test profile "
        f"({GRAPH_SCOPING_PROFILE['uri']}). "
        "Set RUN_GRAPH_SCOPING_TESTS=true to force-run."
    ),
)
def test_graph_scoping_invariants():
    graph_a = "TEST_GRAPH_A"
    graph_b = "TEST_GRAPH_B"
    branch_id = "main"

    driver = None
    session = None

    concept_a_id = None
    concept_b_id = None
    lecture_a_id = None
    lecture_b_id = None
    try:
        driver, session = _open_graph_scoping_session()

        # Clean up any prior test data (best-effort).
        for gid in (graph_a, graph_b):
            session.run(
                """
                MATCH (g:GraphSpace {graph_id: $graph_id})
                OPTIONAL MATCH (n)-[:BELONGS_TO]->(g)
                DETACH DELETE n
                WITH g
                OPTIONAL MATCH (b:Branch {graph_id: $graph_id})
                DETACH DELETE b
                WITH g
                OPTIONAL MATCH (s:Snapshot {graph_id: $graph_id})
                DETACH DELETE s
                WITH g
                DETACH DELETE g
                """,
                graph_id=gid,
            )

        # Graph A: set active context and create data.
        ensure_graphspace_exists(session, graph_a, name="Test Graph A")
        ensure_branch_exists(session, graph_a, branch_id, name="Main")
        set_active_graph(session, graph_a)

        concept_a = create_concept(
            session,
            ConceptCreate(
                name="Test Concept A",
                domain="Testing",
                type="concept",
                description="Concept A",
            ),
        )
        concept_a_id = concept_a.node_id

        lecture_a = create_lecture(
            session,
            LectureCreate(
                title="Test Lecture A",
                description="Lecture A",
                primary_concept=concept_a_id,
                level="intro",
                estimated_time=10,
                slug="test-lecture-a",
            ),
        )
        lecture_a_id = lecture_a.lecture_id

        create_relationship_by_ids(
            session,
            source_id=concept_a_id,
            target_id=concept_a_id,
            predicate="RELATES_TO",
        )

        # Graph B: set active context and create data.
        ensure_graphspace_exists(session, graph_b, name="Test Graph B")
        ensure_branch_exists(session, graph_b, branch_id, name="Main")
        set_active_graph(session, graph_b)

        concept_b = create_concept(
            session,
            ConceptCreate(
                name="Test Concept B",
                domain="Testing",
                type="concept",
                description="Concept B",
            ),
        )
        concept_b_id = concept_b.node_id

        lecture_b = create_lecture(
            session,
            LectureCreate(
                title="Test Lecture B",
                description="Lecture B",
                primary_concept=concept_b_id,
                level="intro",
                estimated_time=10,
                slug="test-lecture-b",
            ),
        )
        lecture_b_id = lecture_b.lecture_id

        create_relationship_by_ids(
            session,
            source_id=concept_b_id,
            target_id=concept_b_id,
            predicate="RELATES_TO",
        )

        # Graph A retrieval should not leak Graph B.
        set_active_graph(session, graph_a)
        concepts_a = get_all_concepts(session)
        concept_a_ids = {c.node_id for c in concepts_a}
        assert concept_a_id in concept_a_ids
        assert concept_b_id not in concept_a_ids
        assert get_concept_by_id(session, concept_b_id) is None

        # Graph B retrieval should not leak Graph A.
        set_active_graph(session, graph_b)
        concepts_b = get_all_concepts(session)
        concept_b_ids = {c.node_id for c in concepts_b}
        assert concept_b_id in concept_b_ids
        assert concept_a_id not in concept_b_ids
        assert get_concept_by_id(session, concept_a_id) is None

        # Assert graph_id and BELONGS_TO for created nodes.
        concept_check = session.run(
            """
            MATCH (c:Concept {node_id: $node_id})
            RETURN c.graph_id AS graph_id,
                   EXISTS((c)-[:BELONGS_TO]->(:GraphSpace {graph_id: $graph_id})) AS belongs
            """,
            node_id=concept_a_id,
            graph_id=graph_a,
        ).single()
        assert concept_check["graph_id"] == graph_a
        assert concept_check["belongs"] is True

        concept_check = session.run(
            """
            MATCH (c:Concept {node_id: $node_id})
            RETURN c.graph_id AS graph_id,
                   EXISTS((c)-[:BELONGS_TO]->(:GraphSpace {graph_id: $graph_id})) AS belongs
            """,
            node_id=concept_b_id,
            graph_id=graph_b,
        ).single()
        assert concept_check["graph_id"] == graph_b
        assert concept_check["belongs"] is True

        lecture_check = session.run(
            """
            MATCH (l:Lecture {lecture_id: $lecture_id})
            RETURN l.graph_id AS graph_id,
                   EXISTS((l)-[:BELONGS_TO]->(:GraphSpace {graph_id: $graph_id})) AS belongs
            """,
            lecture_id=lecture_a_id,
            graph_id=graph_a,
        ).single()
        assert lecture_check["graph_id"] == graph_a
        assert lecture_check["belongs"] is True

        lecture_check = session.run(
            """
            MATCH (l:Lecture {lecture_id: $lecture_id})
            RETURN l.graph_id AS graph_id,
                   EXISTS((l)-[:BELONGS_TO]->(:GraphSpace {graph_id: $graph_id})) AS belongs
            """,
            lecture_id=lecture_b_id,
            graph_id=graph_b,
        ).single()
        assert lecture_check["graph_id"] == graph_b
        assert lecture_check["belongs"] is True

        # Assert relationships are graph-scoped.
        rel_check = session.run(
            """
            MATCH (s:Concept {node_id: $source})-[r]->(t:Concept {node_id: $target})
            RETURN r.graph_id AS graph_id
            """,
            source=concept_a_id,
            target=concept_a_id,
        ).single()
        assert rel_check["graph_id"] == graph_a

        rel_check = session.run(
            """
            MATCH (s:Concept {node_id: $source})-[r]->(t:Concept {node_id: $target})
            RETURN r.graph_id AS graph_id
            """,
            source=concept_b_id,
            target=concept_b_id,
        ).single()
        assert rel_check["graph_id"] == graph_b
    finally:
        if session is not None:
            try:
                # Cleanup test data to keep runs deterministic.
                if lecture_a_id or lecture_b_id:
                    session.run(
                        """
                        MATCH (l:Lecture)
                        WHERE l.lecture_id IN $lecture_ids
                        DETACH DELETE l
                        """,
                        lecture_ids=[lid for lid in (lecture_a_id, lecture_b_id) if lid],
                    )
                if concept_a_id or concept_b_id:
                    session.run(
                        """
                        MATCH (c:Concept)
                        WHERE c.node_id IN $node_ids
                        DETACH DELETE c
                        """,
                        node_ids=[cid for cid in (concept_a_id, concept_b_id) if cid],
                    )
                for gid in (graph_a, graph_b):
                    session.run(
                        """
                        MATCH (g:GraphSpace {graph_id: $graph_id})
                        OPTIONAL MATCH (b:Branch {graph_id: $graph_id})
                        DETACH DELETE b
                        WITH g
                        OPTIONAL MATCH (s:Snapshot {graph_id: $graph_id})
                        DETACH DELETE s
                        WITH g
                        DETACH DELETE g
                        """,
                        graph_id=gid,
                    )
            except Exception:
                # Best-effort cleanup only; keep original test failures.
                pass
            finally:
                try:
                    session.close()
                except Exception:
                    pass
        if driver is not None:
            try:
                driver.close()
            except Exception:
                pass
