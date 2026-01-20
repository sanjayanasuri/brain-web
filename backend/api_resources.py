"""
API endpoints for Resource management.

Handles:
- Uploading files and creating Resource nodes
- Listing resources attached to concepts
- Linking resources to concepts
- Searching resources within the active graph + branch
"""

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, Request
from typing import List, Optional, Dict, Any, Tuple
import mimetypes
import os

from models import Resource
from db_neo4j import get_neo4j_session
from auth import require_auth
from storage import save_file, read_file, get_file_url
from audit_log import log_resource_access
from services_resources import (
    create_resource,
    get_resources_for_concept,
    link_resource_to_concept,
    search_resources,
)
from services_resource_ai import (
    generate_image_caption,
    extract_pdf_text,
    summarize_pdf_text,
)
from services_browser_use import execute_skill, BrowserUseAPIError
from config import BROWSER_USE_CONFUSION_SKILL_ID
from pydantic import BaseModel

router = APIRouter(prefix="/resources", tags=["resources"])


class ConfusionSkillRequest(BaseModel):
    concept_id: Optional[str] = None
    query: str
    sources: List[str] = ["stackoverflow", "github", "docs", "blogs"]
    limit: int = 8


def _save_upload(file: UploadFile, tenant_id: Optional[str] = None) -> Tuple[str, str]:
    """
    Save uploaded file using configured storage backend (local or S3).
    
    Returns:
        (url_path, storage_path) tuple
    """
    file_content = file.file.read()
    filename = file.filename or "upload"
    url_path, storage_path = save_file(file_content, filename, tenant_id=tenant_id)
    return url_path, storage_path


@router.get("/by-concept/{concept_id}", response_model=List[Resource])
def list_resources_for_concept(
    concept_id: str,
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    resources = get_resources_for_concept(session=session, concept_id=concept_id)
    # Log access to resources for audit trail
    for resource in resources:
        try:
            log_resource_access(request, resource.resource_id, access_type="VIEW")
        except Exception:
            pass  # Don't fail on audit logging
    return resources


@router.get("/search", response_model=List[Resource])
def search_resources_endpoint(
    query: str,
    request: Request,
    limit: int = 20,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    """
    Search resources in the active graph + branch by title/caption/url.
    """
    resources = search_resources(
        session=session,
        query=query,
        limit=limit,
    )
    # Log access to resources for audit trail
    for resource in resources:
        try:
            log_resource_access(request, resource.resource_id, access_type="VIEW")
        except Exception:
            pass  # Don't fail on audit logging
    return resources


@router.post("/upload", response_model=Resource)
async def upload_resource(
    file: UploadFile = File(...),
    concept_id: Optional[str] = Form(None),
    title: Optional[str] = Form(None),
    source: Optional[str] = Form("upload"),
    request: Request = None,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")

    tenant_id = getattr(request.state, "tenant_id", None) if request else None
    url, storage_path = _save_upload(file, tenant_id=tenant_id)

    mime_type = file.content_type or mimetypes.guess_type(file.filename)[0] or "application/octet-stream"
    kind = (
        "image" if mime_type.startswith("image/") else
        "pdf" if mime_type == "application/pdf" else
        "audio" if mime_type.startswith("audio/") else
        "file"
    )

    caption = None
    try:
        # Read file for AI processing (works with both local and S3)
        file_content = read_file(storage_path)
        
        # Generate captions using bytes (works with both local and S3)
        if kind == "image":
            caption = generate_image_caption(storage_path, image_bytes=file_content)
        elif kind == "pdf":
            # PDF processing can work with bytes
            pdf_text = extract_pdf_text(storage_path, pdf_bytes=file_content)
            if pdf_text:
                caption = summarize_pdf_text(pdf_text)
    except Exception as e:
        import logging
        logging.getLogger("brain_web").warning(f"Failed to generate caption: {e}")
        caption = None

    resource = create_resource(
        session=session,
        kind=kind,
        url=url,
        title=title or file.filename,
        mime_type=mime_type,
        caption=caption,
        source=source,
    )

    if concept_id:
        try:
            link_resource_to_concept(session=session, concept_id=concept_id, resource_id=resource.resource_id)
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    return resource




def _caption_from_confusion_output(out: Dict[str, Any]) -> str:
    confusions = out.get("confusions", [])[:5]
    pitfalls = out.get("pitfalls", [])[:5]

    lines = []
    if confusions:
        lines.append("Common confusions:")
        for c in confusions:
            lines.append(f"- {c.get('title','').strip()}: {c.get('summary','').strip()}")
    if pitfalls:
        lines.append("Common pitfalls:")
        for p in pitfalls:
            lines.append(f"- {p.get('title','').strip()}: {p.get('summary','').strip()}")

    return "\n".join(lines).strip() or "Browser Use skill output attached."


@router.post("/fetch/confusions", response_model=Resource)
def fetch_confusions(
    req: ConfusionSkillRequest,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session),
):
    if not BROWSER_USE_CONFUSION_SKILL_ID:
        raise HTTPException(
            status_code=500,
            detail="BROWSER_USE_CONFUSION_SKILL_ID not configured. Please set it in .env.local and restart backend."
        )

    try:
        skill_out = execute_skill(
            BROWSER_USE_CONFUSION_SKILL_ID,
            parameters={
                "query": req.query,
                "sources": req.sources,
                "limit": req.limit,
            },
        )
    except BrowserUseAPIError as e:
        if e.status_code and 400 <= e.status_code < 500:
            raise HTTPException(status_code=400, detail=f"Browser Use error: {str(e)}")
        if e.status_code and 500 <= e.status_code < 600:
            raise HTTPException(status_code=502, detail=f"Browser Use error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Browser Use error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to execute Browser Use skill: {str(e)}")

    resource = create_resource(
        session=session,
        kind="web_link",
        url=f"browseruse://skills/{BROWSER_USE_CONFUSION_SKILL_ID}?q={req.query}",
        title=f"Confusions & pitfalls: {req.query}",
        caption=_caption_from_confusion_output(skill_out),
        source="browser_use",
        metadata=skill_out,
    )

    if req.concept_id:
        try:
            link_resource_to_concept(
                session=session,
                concept_id=req.concept_id,
                resource_id=resource.resource_id,
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

    return resource
