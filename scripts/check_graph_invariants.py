# scripts/check_graph_invariants.py
from __future__ import annotations

import os
import sys
import json
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from neo4j import GraphDatabase


# ----------------------------
# Configuration
# ----------------------------

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "password")
NEO4J_DATABASE = os.getenv("NEO4J_DATABASE")  # optional; None => default DB
SAMPLE_LIMIT = int(os.getenv("GRAPH_INVARIANT_SAMPLE_LIMIT", "25"))

# Relationship types you explicitly allow to cross graphs (if any)
ALLOWED_CROSS_GRAPH_RELS = set(
    [s.strip() for s in os.getenv("ALLOWED_CROSS_GRAPH_RELS", "CROSS_GRAPH_LINK").split(",") if s.strip()]
)

# Node labels that should be graph-scoped (must have graph_id + BELONGS_TO -> GraphSpace)
SCOPED_NODE_LABELS = [
    "Concept",
    "Lecture",
    "Resource",
    "Quote",
    "Claim",
    "SourceChunk",
    "SourceDocument",
    "Community",
    "Branch",
    "Trail",
    "TrailStep",
    "Snapshot",
]


@dataclass
class CheckResult:
    name: str
    ok: bool
    count: int
    samples: List[Dict[str, Any]]
    notes: Optional[str] = None


def _connect():
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    return driver


def _run(tx, query: str, params: Optional[Dict[str, Any]] = None):
    return tx.run(query, **(params or {}))


def _pretty_samples(samples: List[Dict[str, Any]]) -> str:
    if not samples:
        return ""
    # Keep output readable and stable.
    return json.dumps(samples, indent=2, sort_keys=True)


def _print_header():
    print("=" * 80)
    print("Brain Web — Graph Scoping Invariants")
    print(f"NEO4J_URI={NEO4J_URI}")
    print(f"NEO4J_USER={NEO4J_USER}")
    print(f"NEO4J_DATABASE={NEO4J_DATABASE or '(default)'}")
    print(f"SAMPLE_LIMIT={SAMPLE_LIMIT}")
    print(f"ALLOWED_CROSS_GRAPH_RELS={sorted(list(ALLOWED_CROSS_GRAPH_RELS))}")
    print("=" * 80)


def _print_result(res: CheckResult):
    status = "PASS" if res.ok else "FAIL"
    print(f"[{status}] {res.name} — violations={res.count}")
    if res.notes:
        print(f"  notes: {res.notes}")
    if (not res.ok) and res.samples:
        print("  samples:")
        print(_pretty_samples(res.samples))


# ----------------------------
# Checks
# ----------------------------

def check_graphspace_exists(tx) -> CheckResult:
    q = """
    MATCH (g:GraphSpace)
    RETURN count(g) AS cnt
    """
    rec = _run(tx, q).single()
    cnt = int(rec["cnt"] or 0)
    ok = cnt > 0
    samples = []
    if not ok:
        samples = [{"hint": "No (:GraphSpace) nodes found. Create at least one graph."}]
    return CheckResult(
        name="GraphSpace exists",
        ok=ok,
        count=(0 if ok else 1),
        samples=samples,
    )


def check_scoped_nodes_have_graph_id(tx, label: str) -> CheckResult:
    q = f"""
    MATCH (n:{label})
    WHERE n.graph_id IS NULL
    RETURN
      elementId(n) AS eid,
      labels(n) AS labels,
      coalesce(n.{_id_prop_for_label(label)}, null) AS id,
      n.graph_id AS graph_id
    LIMIT $limit
    """
    cnt_q = f"""
    MATCH (n:{label})
    WHERE n.graph_id IS NULL
    RETURN count(n) AS cnt
    """
    cnt = int(_run(tx, cnt_q).single()["cnt"] or 0)
    samples = _run(tx, q, {"limit": SAMPLE_LIMIT}).data() if cnt > 0 else []
    return CheckResult(
        name=f"{label} nodes have graph_id",
        ok=(cnt == 0),
        count=cnt,
        samples=samples,
    )


def check_scoped_nodes_have_belongs_to(tx, label: str) -> CheckResult:
    # Expect: (n)-[:BELONGS_TO]->(g:GraphSpace) for graph-scoped nodes.
    q_cnt = f"""
    MATCH (n:{label})
    WHERE NOT (n)-[:BELONGS_TO]->(:GraphSpace)
    RETURN count(n) AS cnt
    """
    q = f"""
    MATCH (n:{label})
    WHERE NOT (n)-[:BELONGS_TO]->(:GraphSpace)
    RETURN
      elementId(n) AS eid,
      coalesce(n.{_id_prop_for_label(label)}, null) AS id,
      n.graph_id AS graph_id
    LIMIT $limit
    """
    cnt = int(_run(tx, q_cnt).single()["cnt"] or 0)
    samples = _run(tx, q, {"limit": SAMPLE_LIMIT}).data() if cnt > 0 else []
    return CheckResult(
        name=f"{label} nodes have BELONGS_TO GraphSpace",
        ok=(cnt == 0),
        count=cnt,
        samples=samples,
    )


def check_graph_id_matches_belongs_to(tx, label: str) -> CheckResult:
    q_cnt = f"""
    MATCH (n:{label})-[:BELONGS_TO]->(g:GraphSpace)
    WHERE n.graph_id IS NOT NULL AND g.graph_id IS NOT NULL AND n.graph_id <> g.graph_id
    RETURN count(n) AS cnt
    """
    q = f"""
    MATCH (n:{label})-[:BELONGS_TO]->(g:GraphSpace)
    WHERE n.graph_id IS NOT NULL AND g.graph_id IS NOT NULL AND n.graph_id <> g.graph_id
    RETURN
      elementId(n) AS eid,
      coalesce(n.{_id_prop_for_label(label)}, null) AS id,
      n.graph_id AS node_graph_id,
      g.graph_id AS gs_graph_id
    LIMIT $limit
    """
    cnt = int(_run(tx, q_cnt).single()["cnt"] or 0)
    samples = _run(tx, q, {"limit": SAMPLE_LIMIT}).data() if cnt > 0 else []
    return CheckResult(
        name=f"{label} graph_id matches its GraphSpace via BELONGS_TO",
        ok=(cnt == 0),
        count=cnt,
        samples=samples,
    )


def check_on_branches_for_branch_scoped(tx) -> CheckResult:
    # Nodes that are expected to have on_branches list-like:
    labels = ["Concept", "Lecture"]
    # Relationships expected to have on_branches list-like:
    rel_types = ["COVERS", "HAS_RESOURCE"]

    results: List[CheckResult] = []

    for label in labels:
        q_cnt = f"""
        MATCH (n:{label})
        WHERE n.on_branches IS NULL OR NOT n.on_branches IS LIST
        RETURN count(n) AS cnt
        """
        q = f"""
        MATCH (n:{label})
        WHERE n.on_branches IS NULL OR NOT n.on_branches IS LIST
        RETURN
          elementId(n) AS eid,
          coalesce(n.{_id_prop_for_label(label)}, null) AS id,
          n.graph_id AS graph_id,
          n.on_branches AS on_branches
        LIMIT $limit
        """
        cnt = int(_run(tx, q_cnt).single()["cnt"] or 0)
        samples = _run(tx, q, {"limit": SAMPLE_LIMIT}).data() if cnt > 0 else []
        results.append(
            CheckResult(
                name=f"{label} has on_branches (list)",
                ok=(cnt == 0),
                count=cnt,
                samples=samples,
            )
        )

    for rel in rel_types:
        q_cnt = f"""
        MATCH ()-[r:{rel}]-()
        WHERE r.on_branches IS NULL OR NOT r.on_branches IS LIST
        RETURN count(r) AS cnt
        """
        q = f"""
        MATCH (a)-[r:{rel}]->(b)
        WHERE r.on_branches IS NULL OR NOT r.on_branches IS LIST
        RETURN
          type(r) AS rel_type,
          elementId(r) AS rel_eid,
          a.graph_id AS a_graph_id,
          b.graph_id AS b_graph_id,
          r.graph_id AS r_graph_id,
          r.on_branches AS on_branches
        LIMIT $limit
        """
        cnt = int(_run(tx, q_cnt).single()["cnt"] or 0)
        samples = _run(tx, q, {"limit": SAMPLE_LIMIT}).data() if cnt > 0 else []
        results.append(
            CheckResult(
                name=f"{rel} rel has on_branches (list)",
                ok=(cnt == 0),
                count=cnt,
                samples=samples,
            )
        )

    # Combine into one grouped result for printing convenience:
    total = sum(r.count for r in results)
    ok = all(r.ok for r in results)
    samples: List[Dict[str, Any]] = []
    # Only include samples from failing subchecks, capped.
    for r in results:
        if not r.ok:
            for s in r.samples:
                samples.append({"subcheck": r.name, **s})
                if len(samples) >= SAMPLE_LIMIT:
                    break
        if len(samples) >= SAMPLE_LIMIT:
            break

    notes = None if ok else "One or more node/relationship types missing on_branches list."
    return CheckResult(
        name="Branch scoping: on_branches present and list-like",
        ok=ok,
        count=total,
        samples=samples,
        notes=notes,
    )


def check_concept_to_concept_rels_have_graph_id(tx) -> CheckResult:
    q_cnt = """
    MATCH (s:Concept)-[r]->(t:Concept)
    WHERE r.graph_id IS NULL
    RETURN count(r) AS cnt
    """
    q = """
    MATCH (s:Concept)-[r]->(t:Concept)
    WHERE r.graph_id IS NULL
    RETURN
      type(r) AS rel_type,
      elementId(r) AS rel_eid,
      s.node_id AS source_id,
      t.node_id AS target_id,
      s.graph_id AS s_graph_id,
      t.graph_id AS t_graph_id
    LIMIT $limit
    """
    cnt = int(_run(tx, q_cnt).single()["cnt"] or 0)
    samples = _run(tx, q, {"limit": SAMPLE_LIMIT}).data() if cnt > 0 else []
    return CheckResult(
        name="Concept→Concept relationships have r.graph_id",
        ok=(cnt == 0),
        count=cnt,
        samples=samples,
    )


def check_concept_to_concept_rels_match_node_graph_id(tx) -> CheckResult:
    # For most relationships, graph_id should match both endpoints.
    # Allowed cross-graph rel types are excluded.
    allowed = list(ALLOWED_CROSS_GRAPH_RELS)

    q_cnt = """
    MATCH (s:Concept)-[r]->(t:Concept)
    WHERE r.graph_id IS NOT NULL
      AND (type(r) IS NULL OR NOT type(r) IN $allowed)
      AND (s.graph_id IS NOT NULL AND t.graph_id IS NOT NULL)
      AND (r.graph_id <> s.graph_id OR r.graph_id <> t.graph_id)
    RETURN count(r) AS cnt
    """
    q = """
    MATCH (s:Concept)-[r]->(t:Concept)
    WHERE r.graph_id IS NOT NULL
      AND (type(r) IS NULL OR NOT type(r) IN $allowed)
      AND (s.graph_id IS NOT NULL AND t.graph_id IS NOT NULL)
      AND (r.graph_id <> s.graph_id OR r.graph_id <> t.graph_id)
    RETURN
      type(r) AS rel_type,
      elementId(r) AS rel_eid,
      s.node_id AS source_id,
      t.node_id AS target_id,
      r.graph_id AS r_graph_id,
      s.graph_id AS s_graph_id,
      t.graph_id AS t_graph_id
    LIMIT $limit
    """
    cnt = int(_run(tx, q_cnt, {"allowed": allowed}).single()["cnt"] or 0)
    samples = _run(tx, q, {"limit": SAMPLE_LIMIT, "allowed": allowed}).data() if cnt > 0 else []
    return CheckResult(
        name="Concept→Concept relationship r.graph_id matches both endpoints",
        ok=(cnt == 0),
        count=cnt,
        samples=samples,
        notes=f"Excludes rel types: {sorted(list(ALLOWED_CROSS_GRAPH_RELS))}",
    )


def check_no_cross_graph_concept_edges(tx) -> CheckResult:
    allowed = list(ALLOWED_CROSS_GRAPH_RELS)

    q_cnt = """
    MATCH (s:Concept)-[r]->(t:Concept)
    WHERE (type(r) IS NULL OR NOT type(r) IN $allowed)
      AND s.graph_id IS NOT NULL AND t.graph_id IS NOT NULL
      AND s.graph_id <> t.graph_id
    RETURN count(r) AS cnt
    """
    q = """
    MATCH (s:Concept)-[r]->(t:Concept)
    WHERE (type(r) IS NULL OR NOT type(r) IN $allowed)
      AND s.graph_id IS NOT NULL AND t.graph_id IS NOT NULL
      AND s.graph_id <> t.graph_id
    RETURN
      type(r) AS rel_type,
      elementId(r) AS rel_eid,
      s.node_id AS source_id,
      t.node_id AS target_id,
      s.graph_id AS s_graph_id,
      t.graph_id AS t_graph_id
    LIMIT $limit
    """
    cnt = int(_run(tx, q_cnt, {"allowed": allowed}).single()["cnt"] or 0)
    samples = _run(tx, q, {"limit": SAMPLE_LIMIT, "allowed": allowed}).data() if cnt > 0 else []
    return CheckResult(
        name="No cross-graph Concept→Concept edges (except allowed rel types)",
        ok=(cnt == 0),
        count=cnt,
        samples=samples,
        notes=f"Allowed rel types: {sorted(list(ALLOWED_CROSS_GRAPH_RELS))}",
    )


def check_has_resource_scoped(tx) -> CheckResult:
    q_cnt = """
    MATCH (c:Concept)-[rel:HAS_RESOURCE]->(r:Resource)
    WHERE rel.graph_id IS NULL
       OR c.graph_id IS NULL
       OR r.graph_id IS NULL
       OR rel.graph_id <> c.graph_id
       OR rel.graph_id <> r.graph_id
    RETURN count(rel) AS cnt
    """
    q = """
    MATCH (c:Concept)-[rel:HAS_RESOURCE]->(r:Resource)
    WHERE rel.graph_id IS NULL
       OR c.graph_id IS NULL
       OR r.graph_id IS NULL
       OR rel.graph_id <> c.graph_id
       OR rel.graph_id <> r.graph_id
    RETURN
      elementId(rel) AS rel_eid,
      c.node_id AS concept_id,
      r.resource_id AS resource_id,
      c.graph_id AS c_graph_id,
      r.graph_id AS r_graph_id,
      rel.graph_id AS rel_graph_id,
      rel.on_branches AS rel_on_branches
    LIMIT $limit
    """
    cnt = int(_run(tx, q_cnt).single()["cnt"] or 0)
    samples = _run(tx, q, {"limit": SAMPLE_LIMIT}).data() if cnt > 0 else []
    return CheckResult(
        name="HAS_RESOURCE edges are scoped (graph_id matches concept+resource)",
        ok=(cnt == 0),
        count=cnt,
        samples=samples,
    )


def check_concept_name_duplicates_per_graph(tx) -> CheckResult:
    q_cnt = """
    MATCH (c:Concept)
    WHERE c.graph_id IS NOT NULL AND c.name IS NOT NULL
    WITH c.graph_id AS graph_id, toLower(c.name) AS name_key, count(*) AS cnt
    WHERE cnt > 1
    RETURN count(*) AS dup_groups
    """
    q = """
    MATCH (c:Concept)
    WHERE c.graph_id IS NOT NULL AND c.name IS NOT NULL
    WITH c.graph_id AS graph_id, toLower(c.name) AS name_key, collect(c.node_id)[..10] AS ids, count(*) AS cnt
    WHERE cnt > 1
    RETURN graph_id, name_key, cnt, ids
    ORDER BY cnt DESC
    LIMIT $limit
    """
    dup_groups = int(_run(tx, q_cnt).single()["dup_groups"] or 0)
    samples = _run(tx, q, {"limit": SAMPLE_LIMIT}).data() if dup_groups > 0 else []
    return CheckResult(
        name="No duplicate Concept names within the same graph (case-insensitive)",
        ok=(dup_groups == 0),
        count=dup_groups,
        samples=samples,
        notes="If this fails, your (graph_id, name) node key constraint may be missing or legacy data violates it.",
    )


def _id_prop_for_label(label: str) -> str:
    # Used only for sample readability.
    if label == "Concept":
        return "node_id"
    if label == "Lecture":
        return "lecture_id"
    if label == "Resource":
        return "resource_id"
    if label == "Quote":
        return "quote_id"
    if label == "Claim":
        return "claim_id"
    if label == "SourceChunk":
        return "chunk_id"
    if label == "SourceDocument":
        return "doc_id"
    if label == "Community":
        return "community_id"
    if label == "Branch":
        return "branch_id"
    if label == "Trail":
        return "trail_id"
    if label == "TrailStep":
        return "step_id"
    if label == "Snapshot":
        return "snapshot_id"
    return "id"


def run_all_checks(driver) -> Tuple[List[CheckResult], bool]:
    results: List[CheckResult] = []
    any_fail = False

    def _session_kwargs():
        return {"database": NEO4J_DATABASE} if NEO4J_DATABASE else {}

    with driver.session(**_session_kwargs()) as session:
        def work(tx):
            nonlocal results, any_fail

            # Baseline
            r = check_graphspace_exists(tx)
            results.append(r)
            any_fail = any_fail or (not r.ok)

            # Per-label checks
            for label in SCOPED_NODE_LABELS:
                r1 = check_scoped_nodes_have_graph_id(tx, label)
                r2 = check_scoped_nodes_have_belongs_to(tx, label)
                r3 = check_graph_id_matches_belongs_to(tx, label)
                for r in (r1, r2, r3):
                    results.append(r)
                    any_fail = any_fail or (not r.ok)

            # Branch scoping
            r = check_on_branches_for_branch_scoped(tx)
            results.append(r)
            any_fail = any_fail or (not r.ok)

            # Relationships
            for r in (
                check_concept_to_concept_rels_have_graph_id(tx),
                check_concept_to_concept_rels_match_node_graph_id(tx),
                check_no_cross_graph_concept_edges(tx),
                check_has_resource_scoped(tx),
                check_concept_name_duplicates_per_graph(tx),
            ):
                results.append(r)
                any_fail = any_fail or (not r.ok)

        session.execute_read(work)

    return results, (not any_fail)


def main() -> int:
    _print_header()

    driver = _connect()
    try:
        results, ok = run_all_checks(driver)
        for r in results:
            _print_result(r)

        print("-" * 80)
        if ok:
            print("Overall: PASS (no invariant violations found)")
            return 0
        print("Overall: FAIL (one or more invariant violations found)")
        return 2
    finally:
        driver.close()


if __name__ == "__main__":
    raise SystemExit(main())
