from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from auth import require_auth
from db_neo4j import get_neo4j_session
from services_templates import (
    clone_template,
    create_template,
    delete_template,
    export_template,
    get_template,
    import_template,
    list_templates,
    update_template,
)

router = APIRouter(prefix="/templates", tags=["templates"])


def _require_identity(request: Request) -> tuple[str, str]:
    user_id = getattr(request.state, "user_id", None)
    tenant_id = getattr(request.state, "tenant_id", None)
    if not user_id or not tenant_id:
        raise HTTPException(status_code=401, detail="Authentication with tenant context is required")
    return str(user_id), str(tenant_id)


class TemplatePayload(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    vertical: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    intent: Optional[str] = None
    node_types: List[str] = Field(default_factory=list)
    starter_nodes: List[str] = Field(default_factory=list)
    node_layout: Optional[Dict[str, Any]] = None
    default_checks: List[str] = Field(default_factory=list)
    connection_patterns: List[str] = Field(default_factory=list)
    refresh_defaults: Optional[Dict[str, Any]] = None


class TemplateUpdatePayload(BaseModel):
    label: Optional[str] = None
    description: Optional[str] = None
    vertical: Optional[str] = None
    tags: Optional[List[str]] = None
    intent: Optional[str] = None
    node_types: Optional[List[str]] = None
    starter_nodes: Optional[List[str]] = None
    node_layout: Optional[Dict[str, Any]] = None
    default_checks: Optional[List[str]] = None
    connection_patterns: Optional[List[str]] = None
    refresh_defaults: Optional[Dict[str, Any]] = None


class CloneTemplatePayload(BaseModel):
    mode: str = Field(default="clone", pattern="^(clone|version)$")
    label: Optional[str] = None


class ImportTemplatePayload(BaseModel):
    export_payload: Dict[str, Any]
    mode: str = Field(default="clone", pattern="^(clone|version)$")
    label_override: Optional[str] = None


@router.get("/")
def list_templates_endpoint(
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    user_id, tenant_id = _require_identity(request)
    try:
        return {"templates": list_templates(session, tenant_id=tenant_id, user_id=user_id)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list templates: {str(e)}")


@router.get("/{template_id}")
def get_template_endpoint(
    template_id: str,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    _, tenant_id = _require_identity(request)
    try:
        return get_template(session, template_id=template_id, tenant_id=tenant_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch template: {str(e)}")


@router.post("/")
def create_template_endpoint(
    payload: TemplatePayload,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    user_id, tenant_id = _require_identity(request)
    try:
        return create_template(
            session,
            tenant_id=tenant_id,
            user_id=user_id,
            payload=payload.dict(),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create template: {str(e)}")


@router.patch("/{template_id}")
def update_template_endpoint(
    template_id: str,
    payload: TemplateUpdatePayload,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    user_id, tenant_id = _require_identity(request)
    try:
        return update_template(
            session,
            template_id=template_id,
            tenant_id=tenant_id,
            user_id=user_id,
            payload=payload.dict(exclude_unset=True),
        )
    except ValueError as e:
        code = 404 if "not found" in str(e).lower() else 400
        raise HTTPException(status_code=code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update template: {str(e)}")


@router.delete("/{template_id}")
def delete_template_endpoint(
    template_id: str,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    _, tenant_id = _require_identity(request)
    try:
        delete_template(session, template_id=template_id, tenant_id=tenant_id)
        return {"ok": True, "template_id": template_id}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete template: {str(e)}")


@router.post("/{template_id}/clone")
def clone_template_endpoint(
    template_id: str,
    payload: CloneTemplatePayload,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    user_id, tenant_id = _require_identity(request)
    try:
        return clone_template(
            session,
            template_id=template_id,
            tenant_id=tenant_id,
            user_id=user_id,
            mode=payload.mode,
            label=payload.label,
        )
    except ValueError as e:
        code = 404 if "not found" in str(e).lower() else 400
        raise HTTPException(status_code=code, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clone template: {str(e)}")


@router.get("/{template_id}/export")
def export_template_endpoint(
    template_id: str,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    _, tenant_id = _require_identity(request)
    try:
        return export_template(session, template_id=template_id, tenant_id=tenant_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to export template: {str(e)}")


@router.post("/import")
def import_template_endpoint(
    payload: ImportTemplatePayload,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    user_id, tenant_id = _require_identity(request)
    try:
        return import_template(
            session,
            tenant_id=tenant_id,
            user_id=user_id,
            export_payload=payload.export_payload,
            mode=payload.mode,
            label_override=payload.label_override,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to import template: {str(e)}")
