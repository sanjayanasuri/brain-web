"""
API endpoints for Resource management.

Handles:
- Uploading files and creating Resource nodes
- Listing resources attached to concepts
- Linking resources to concepts
"""

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from typing import List, Optional
import mimetypes
import uuid
import os

from models import Resource, ResourceCreate
from db_neo4j import get_neo4j_session
from services_resources import (
    create_resource,
    get_resources_for_concept,
    link_resource_to_concept,
)
from services_resource_ai import (
    generate_image_caption,
    extract_pdf_text,
    summarize_pdf_text,
    extract_concepts_from_text,
)

router = APIRouter(prefix="/resources", tags=["resources"])

# Upload directory for storing files
# TODO: integrate with your real static file / S3 system
UPLOAD_DIR = os.environ.get("RESOURCE_UPLOAD_DIR", "uploaded_resources")


def _save_upload_to_disk(file: UploadFile) -> str:
    """
    Save uploaded file to disk and return the URL path.
    
    In production, this would be an S3 URL or static URL.
    For now, saves to a local directory and returns a relative path.
    """
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename or "")[1]
    filename = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(UPLOAD_DIR, filename)
    with open(path, "wb") as f:
        f.write(file.file.read())
    # In production, this would be an S3 URL or static URL
    return f"/static/resources/{filename}"


@router.get("/by-concept/{concept_id}", response_model=List[Resource])
def list_resources_for_concept(
    concept_id: str,
    session=Depends(get_neo4j_session),
):
    """
    Get all resources attached to a concept.
    """
    return get_resources_for_concept(session=session, concept_id=concept_id)


@router.post("/upload", response_model=Resource)
async def upload_resource(
    file: UploadFile = File(...),
    concept_id: Optional[str] = Form(None),
    title: Optional[str] = Form(None),
    source: Optional[str] = Form("upload"),
    session=Depends(get_neo4j_session),
):
    """
    Upload a file, create a Resource node, and optionally link it to a Concept.
    
    Automatically generates captions for images and PDFs using AI:
    - Images: GPT-4 Vision generates descriptive captions
    - PDFs: Extracts text and generates summaries
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")

    # Save the file somewhere (disk or S3)
    url = _save_upload_to_disk(file)
    
    # Get the actual file path for AI processing
    ext = os.path.splitext(file.filename or "")[1]
    filename = url.split("/")[-1]  # Extract filename from URL
    file_path = os.path.join(UPLOAD_DIR, filename)

    mime_type = file.content_type or mimetypes.guess_type(file.filename)[0] or "application/octet-stream"
    kind = "image" if mime_type.startswith("image/") else \
           "pdf" if mime_type == "application/pdf" else \
           "audio" if mime_type.startswith("audio/") else \
           "file"

    # Generate caption using AI
    caption = None
    if kind == "image":
        # Generate image caption using GPT-4 Vision
        caption = generate_image_caption(file_path)
    elif kind == "pdf":
        # Extract text and generate summary
        pdf_text = extract_pdf_text(file_path)
        if pdf_text:
            caption = summarize_pdf_text(pdf_text)
            # Optionally: extract concepts and suggest linking
            # concepts = extract_concepts_from_text(pdf_text)
            # Could return this in response or store separately

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
        link_resource_to_concept(session=session, concept_id=concept_id, resource_id=resource.resource_id)

    return resource
