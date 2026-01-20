"""
Audit logging for security and compliance.

Logs:
- Data access (reads, exports)
- Resource downloads/views
- Evidence access
"""
import logging
from typing import Optional, Dict, Any
from datetime import datetime
from fastapi import Request

logger = logging.getLogger("brain_web")


def log_audit_event(
    request: Request,
    event_type: str,
    resource_type: str,
    resource_id: Optional[str] = None,
    graph_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    """
    Log an audit event for security/compliance tracking.
    
    Args:
        request: FastAPI request object
        event_type: Type of event (e.g., "RETRIEVAL", "RESOURCE_VIEW", "EXPORT")
        resource_type: Type of resource accessed (e.g., "concept", "evidence", "resource")
        resource_id: Optional resource identifier
        graph_id: Optional graph identifier
        metadata: Optional additional metadata
    """
    try:
        user_id = getattr(request.state, "user_id", None)
        tenant_id = getattr(request.state, "tenant_id", None)
        session_id = getattr(request.state, "session_id", None)
        client_ip = getattr(request.state, "client_ip", None)
        request_id = getattr(request.state, "request_id", None)
        
        audit_record = {
            "event": "audit",
            "event_type": event_type,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "graph_id": graph_id,
            "user_id": user_id,
            "tenant_id": tenant_id,
            "session_id": session_id,
            "client_ip": client_ip,
            "request_id": request_id,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "path": request.url.path if request else None,
            "method": request.method if request else None,
        }
        
        if metadata:
            audit_record["metadata"] = metadata
        
        # Log to structured logger (can be forwarded to CloudWatch, DynamoDB, etc.)
        logger.info(
            f"AUDIT: {event_type} | {resource_type} | user={user_id} | tenant={tenant_id} | resource={resource_id} | graph={graph_id}"
        )
        
        # In production, you might also write to DynamoDB or another audit store
        # For now, structured logging is sufficient
        
    except Exception as e:
        # Never fail the request due to audit logging
        logger.warning(f"Failed to log audit event: {e}")


def log_retrieval_access(
    request: Request,
    graph_id: str,
    branch_id: str,
    intent: Optional[str] = None,
    evidence_ids: Optional[list] = None,
    concept_ids: Optional[list] = None,
) -> None:
    """Log retrieval/read access for audit trail."""
    log_audit_event(
        request=request,
        event_type="RETRIEVAL",
        resource_type="evidence",
        graph_id=graph_id,
        metadata={
            "branch_id": branch_id,
            "intent": intent,
            "evidence_count": len(evidence_ids) if evidence_ids else 0,
            "concept_count": len(concept_ids) if concept_ids else 0,
        },
    )


def log_resource_access(
    request: Request,
    resource_id: str,
    access_type: str = "VIEW",  # "VIEW" or "DOWNLOAD"
    graph_id: Optional[str] = None,
) -> None:
    """Log resource access (view/download) for audit trail."""
    log_audit_event(
        request=request,
        event_type=f"RESOURCE_{access_type}",
        resource_type="resource",
        resource_id=resource_id,
        graph_id=graph_id,
    )


def log_export_access(
    request: Request,
    export_type: str,
    graph_id: Optional[str] = None,
    item_count: Optional[int] = None,
) -> None:
    """Log export operations for audit trail."""
    log_audit_event(
        request=request,
        event_type="EXPORT",
        resource_type=export_type,
        graph_id=graph_id,
        metadata={"item_count": item_count} if item_count else None,
    )

