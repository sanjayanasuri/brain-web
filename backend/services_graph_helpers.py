"""
Shared helpers for graph operations (tenant resolution, visibility policy).
Extracted from services_graph to reduce file size and improve maintainability.
"""
from typing import Optional, Tuple

from neo4j import Session

from services_branch_explorer import (
    ensure_graph_scoping_initialized,
    get_active_graph_context,
    get_request_graph_identity,
)


def resolve_required_tenant_id(tenant_id: Optional[str] = None, session: Optional[Session] = None) -> str:
    """Resolve tenant_id from argument or request context; require it for graph reads."""
    _, req_tenant_id = get_request_graph_identity()
    resolved_tenant_id = str(tenant_id).strip() if tenant_id else (str(req_tenant_id).strip() if req_tenant_id else "")
    if not resolved_tenant_id and session is not None:
        try:
            graph_id, _ = get_active_graph_context(session)
            rec = session.run(
                """
                MATCH (g:GraphSpace {graph_id: $graph_id})
                RETURN g.tenant_id AS tenant_id, g.graph_id AS graph_id
                LIMIT 1
                """,
                graph_id=graph_id,
            ).single()
            if rec:
                # Backward compatibility for legacy graph spaces without tenant_id.
                tenant = rec.get("tenant_id")
                resolved_tenant_id = str(tenant).strip() if tenant else "default"
        except Exception:
            pass
    if not resolved_tenant_id:
        raise ValueError("Tenant-scoped graph context is required")
    return resolved_tenant_id


def get_tenant_scoped_graph_context(
    session: Session,
    *,
    tenant_id: Optional[str] = None,
) -> Tuple[str, str, str]:
    resolved_tenant_id = resolve_required_tenant_id(tenant_id, session=session)
    graph_id, branch_id = get_active_graph_context(session, tenant_id=resolved_tenant_id)
    return graph_id, branch_id, resolved_tenant_id


def build_tenant_filter_clause(tenant_id: str) -> str:
    """Build strict tenant filter for GraphSpace."""
    if not tenant_id:
        raise ValueError("tenant_id is required for tenant filtering")
    return "AND g.tenant_id = $tenant_id"


def normalize_include_proposed(include_proposed: Optional[str]) -> str:
    """
    Normalize include_proposed parameter to valid values: 'auto', 'all', or 'none'.
    """
    if include_proposed in (None, "", "auto"):
        return "auto"
    if include_proposed in ("all", "none"):
        return include_proposed
    return "auto"


def build_edge_visibility_where_clause(include_proposed: str) -> str:
    """
    Build Cypher WHERE clause snippet for relationship visibility policy.
    include_proposed: 'auto' | 'all' | 'none'
    """
    if include_proposed == "none":
        return "(COALESCE(r.status, 'ACCEPTED') = 'ACCEPTED')"
    return """(
      COALESCE(r.status, 'ACCEPTED') = 'ACCEPTED'
      OR (
        COALESCE(r.status, 'ACCEPTED') = 'PROPOSED'
        AND (
          $include_proposed = 'all'
          OR ($include_proposed = 'auto' AND COALESCE(r.confidence, 0.0) >= $threshold)
        )
      )
    )"""
