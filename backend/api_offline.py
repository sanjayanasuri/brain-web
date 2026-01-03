# backend/api_offline.py
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from neo4j import Session
from pydantic import BaseModel, Field

from db_neo4j import get_neo4j_session
from services_branch_explorer import (
    ensure_branch_exists,
    ensure_graphspace_exists,
    ensure_schema_constraints,
)

router = APIRouter(prefix="/offline", tags=["offline"])


# ---------------------------
# Helpers
# ---------------------------

def _now_iso() -> str:
    # Use the same helper shape you already use in services_branch_explorer.py
    import datetime
    return datetime.datetime.utcnow().replace(tzinfo=datetime.timezone.utc).isoformat()


def _json_load(x: Any) -> Any:
    if x is None:
        return None
    if isinstance(x, (dict, list)):
        return x
    if isinstance(x, str):
        try:
            return json.loads(x)
        except Exception:
            return None
    return None


def _to_iso_str(x: Any) -> Optional[str]:
    if not x:
        return None
    if hasattr(x, "to_native"):
        try:
            return x.to_native().isoformat()
        except Exception:
            return str(x)
    return str(x)


# ---------------------------
# Models
# ---------------------------

class OfflineBootstrapResponse(BaseModel):
    graph_id: str
    branch_id: str
    recent_artifacts: List[Dict[str, Any]] = Field(default_factory=list)
    pinned_concepts: List[Dict[str, Any]] = Field(default_factory=list)
    recent_trails: List[Dict[str, Any]] = Field(default_factory=list)
    server_time: str


class OfflineManifestResponse(BaseModel):
    graph_id: str
    branch_id: str
    graph_updated_at: Optional[str] = None
    branch_updated_at: Optional[str] = None
    counts: Dict[str, int] = Field(default_factory=dict)
    server_time: str


class OfflineWarmRequest(BaseModel):
    graph_id: str
    branch_id: str
    trail_id: Optional[str] = None
    artifact_ids: Optional[List[str]] = None
    urls: Optional[List[str]] = None
    limit: int = 50


class OfflineWarmResponse(BaseModel):
    graph_id: str
    branch_id: str
    artifacts: List[Dict[str, Any]] = Field(default_factory=list)
    resources: List[Dict[str, Any]] = Field(default_factory=list)
    concepts: List[Dict[str, Any]] = Field(default_factory=list)


# ---------------------------
# Endpoints
# ---------------------------

@router.get("/bootstrap", response_model=OfflineBootstrapResponse)
def offline_bootstrap(
    graph_id: str,
    branch_id: str,
    limit_artifacts: int = 25,
    limit_concepts: int = 25,
    limit_trails: int = 25,
    session: Session = Depends(get_neo4j_session),
):
    """
    Minimal offline bootstrap payload for a graph+branch.

    Includes:
    - recent_artifacts: Artifact nodes (text + metadata_json)
    - pinned_concepts: Concepts that are on this branch (most recently updated)
    - recent_trails: Trails on this branch (if you have Trail model)
    """
    ensure_schema_constraints(session)
    ensure_graphspace_exists(session, graph_id)
    ensure_branch_exists(session, graph_id, branch_id)

    limit_artifacts = max(1, min(int(limit_artifacts), 200))
    limit_concepts = max(1, min(int(limit_concepts), 200))
    limit_trails = max(1, min(int(limit_trails), 200))

    # Artifacts (graph-scoped). Branch scoping for artifacts is optional in your current model;
    # we still return graph-scoped artifacts since they are safe for offline reading.
    artifacts = []
    for rec in session.run(
        """
        MATCH (a:Artifact {graph_id: $graph_id})
        RETURN a
        ORDER BY COALESCE(a.captured_at, 0) DESC
        LIMIT $limit
        """,
        graph_id=graph_id,
        limit=limit_artifacts,
    ):
        a = rec["a"]
        artifacts.append(
            {
                "artifact_id": a.get("artifact_id"),
                "graph_id": a.get("graph_id"),
                "branch_id": a.get("branch_id"),
                "artifact_type": a.get("artifact_type"),
                "url": a.get("url"),
                "title": a.get("title"),
                "domain": a.get("domain"),
                "captured_at": a.get("captured_at"),
                "content_hash": a.get("content_hash"),
                "text": a.get("text"),
                "metadata": _json_load(a.get("metadata_json")),
            }
        )

    # Concepts (branch-scoped)
    pinned_concepts = []
    for rec in session.run(
        """
        MATCH (c:Concept {graph_id: $graph_id})
        WHERE $branch_id IN COALESCE(c.on_branches, [])
        RETURN c
        ORDER BY COALESCE(c.updated_at, c.created_at, '') DESC
        LIMIT $limit
        """,
        graph_id=graph_id,
        branch_id=branch_id,
        limit=limit_concepts,
    ):
        c = rec["c"]
        pinned_concepts.append(
            {
                "node_id": c.get("node_id"),
                "name": c.get("name"),
                "domain": c.get("domain"),
                "type": c.get("type"),
                "description": c.get("description"),
                "tags": c.get("tags"),
                "url_slug": c.get("url_slug"),
                "notes_key": c.get("notes_key"),
            }
        )

    # Trails (branch-scoped). If you don’t have Trail nodes in your DB yet, this returns empty.
    trails = []
    for rec in session.run(
        """
        MATCH (t:Trail {graph_id: $graph_id})
        WHERE $branch_id IN COALESCE(t.on_branches, [])
        RETURN t
        ORDER BY COALESCE(t.updated_at, t.created_at, '') DESC
        LIMIT $limit
        """,
        graph_id=graph_id,
        branch_id=branch_id,
        limit=limit_trails,
    ):
        t = rec["t"]
        trails.append(
            {
                "trail_id": t.get("trail_id"),
                "graph_id": t.get("graph_id"),
                "name": t.get("name"),
                "created_at": _to_iso_str(t.get("created_at")),
                "updated_at": _to_iso_str(t.get("updated_at")),
            }
        )

    return OfflineBootstrapResponse(
        graph_id=graph_id,
        branch_id=branch_id,
        recent_artifacts=artifacts,
        pinned_concepts=pinned_concepts,
        recent_trails=trails,
        server_time=_now_iso(),
    )


@router.get("/manifest", response_model=OfflineManifestResponse)
def offline_manifest(
    graph_id: str,
    branch_id: str,
    session: Session = Depends(get_neo4j_session),
):
    """
    Cheap cache invalidation signal.
    If this changes, client should re-bootstrap.
    """
    ensure_schema_constraints(session)
    ensure_graphspace_exists(session, graph_id)
    ensure_branch_exists(session, graph_id, branch_id)

    rec = session.run(
        """
        MATCH (g:GraphSpace {graph_id: $graph_id})
        MATCH (b:Branch {graph_id: $graph_id, branch_id: $branch_id})
        OPTIONAL MATCH (a:Artifact {graph_id: $graph_id})
        OPTIONAL MATCH (c:Concept {graph_id: $graph_id})
        OPTIONAL MATCH (t:Trail {graph_id: $graph_id})
        OPTIONAL MATCH (r:Resource {graph_id: $graph_id})
        WITH g, b,
             count(DISTINCT a) AS artifacts,
             count(DISTINCT c) AS concepts,
             count(DISTINCT t) AS trails,
             count(DISTINCT r) AS resources
        RETURN g.updated_at AS g_updated,
               b.updated_at AS b_updated,
               artifacts, concepts, trails, resources
        """,
        graph_id=graph_id,
        branch_id=branch_id,
    ).single()

    if not rec:
        raise HTTPException(status_code=404, detail="Graph/branch not found")

    return OfflineManifestResponse(
        graph_id=graph_id,
        branch_id=branch_id,
        graph_updated_at=_to_iso_str(rec["g_updated"]),
        branch_updated_at=_to_iso_str(rec["b_updated"]),
        counts={
            "artifacts": int(rec["artifacts"] or 0),
            "concepts": int(rec["concepts"] or 0),
            "trails": int(rec["trails"] or 0),
            "resources": int(rec["resources"] or 0),
        },
        server_time=_now_iso(),
    )


@router.post("/warm", response_model=OfflineWarmResponse)
def offline_warm(
    req: OfflineWarmRequest,
    session: Session = Depends(get_neo4j_session),
):
    """
    Targeted bundle warm-up.

    Provide ONE:
    - trail_id: warms artifacts referenced by TrailStep.page_url
    - artifact_ids: warms these artifacts
    - urls: warms artifacts by url
    """
    ensure_schema_constraints(session)
    ensure_graphspace_exists(session, req.graph_id)
    ensure_branch_exists(session, req.graph_id, req.branch_id)

    graph_id = req.graph_id
    branch_id = req.branch_id
    limit = max(1, min(int(req.limit or 50), 200))

    artifact_rows: List[Dict[str, Any]] = []

    if req.trail_id:
        artifact_rows = session.run(
            """
            MATCH (t:Trail {graph_id: $graph_id, trail_id: $trail_id})
            OPTIONAL MATCH (t)-[hs:HAS_STEP {graph_id: $graph_id}]->(s:TrailStep {graph_id: $graph_id})
            WHERE $branch_id IN COALESCE(hs.on_branches, [])
            WITH collect(DISTINCT s.page_url) AS urls
            UNWIND urls AS u
            MATCH (a:Artifact {graph_id: $graph_id, url: u})
            RETURN a
            ORDER BY COALESCE(a.captured_at, 0) DESC
            LIMIT $limit
            """,
            graph_id=graph_id,
            branch_id=branch_id,
            trail_id=req.trail_id,
            limit=limit,
        ).data()

    elif req.artifact_ids:
        artifact_rows = session.run(
            """
            MATCH (a:Artifact {graph_id: $graph_id})
            WHERE a.artifact_id IN $artifact_ids
            RETURN a
            """,
            graph_id=graph_id,
            artifact_ids=req.artifact_ids[:limit],
        ).data()

    elif req.urls:
        artifact_rows = session.run(
            """
            MATCH (a:Artifact {graph_id: $graph_id})
            WHERE a.url IN $urls
            RETURN a
            """,
            graph_id=graph_id,
            urls=req.urls[:limit],
        ).data()

    else:
        raise HTTPException(status_code=400, detail="Provide trail_id, artifact_ids, or urls")

    artifacts: List[Dict[str, Any]] = []
    urls: List[str] = []

    for row in artifact_rows:
        a = row.get("a")
        if not a:
            continue
        urls.append(a.get("url"))
        artifacts.append(
            {
                "artifact_id": a.get("artifact_id"),
                "url": a.get("url"),
                "title": a.get("title"),
                "domain": a.get("domain"),
                "captured_at": a.get("captured_at"),
                "content_hash": a.get("content_hash"),
                "text": a.get("text"),
                "metadata": _json_load(a.get("metadata_json")),
            }
        )

    # Optional enrichment if you have Artifact-[:MENTIONS]->Concept edges in your graph.
    resources: List[Dict[str, Any]] = []
    concepts: List[Dict[str, Any]] = []

    rec = session.run(
        """
        UNWIND $urls AS u
        MATCH (a:Artifact {graph_id: $graph_id, url: u})
        OPTIONAL MATCH (a)-[:MENTIONS]->(c:Concept {graph_id: $graph_id})
        WHERE $branch_id IN COALESCE(c.on_branches, [])
        OPTIONAL MATCH (c)-[:HAS_RESOURCE]->(r:Resource {graph_id: $graph_id})
        WITH collect(DISTINCT c) AS cs, collect(DISTINCT r) AS rs
        RETURN cs, rs
        """,
        urls=urls,
        graph_id=graph_id,
        branch_id=branch_id,
    ).single()

    if rec:
        cs = rec.get("cs") or []
        rs = rec.get("rs") or []

        for c in cs:
            if not c:
                continue
            concepts.append(
                {
                    "node_id": c.get("node_id"),
                    "name": c.get("name"),
                    "domain": c.get("domain"),
                    "type": c.get("type"),
                    "description": c.get("description"),
                    "tags": c.get("tags"),
                    "url_slug": c.get("url_slug"),
                }
            )

        for r in rs:
            if not r:
                continue
            resources.append(
                {
                    "resource_id": r.get("resource_id"),
                    "kind": r.get("kind"),
                    "url": r.get("url"),
                    "title": r.get("title"),
                    "mime_type": r.get("mime_type"),
                    "caption": r.get("caption"),
                    "source": r.get("source"),
                    "metadata": _json_load(r.get("metadata_json")),
                    "created_at": _to_iso_str(r.get("created_at")),
                }
            )

    return OfflineWarmResponse(
        graph_id=graph_id,
        branch_id=branch_id,
        artifacts=artifacts,
        resources=resources,
        concepts=concepts,
    )
