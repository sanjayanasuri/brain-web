from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional

from auth import require_auth
from models_lecture_links import (
    LectureLink,
    LectureLinkResolveRequest,
    LectureLinkResolveResponse,
    LectureLinkFeedbackRequest,
    LectureSectionResponse,
)
from services_lecture_links import (
    resolve_lecture_links,
    list_lecture_links,
    save_lecture_link_feedback,
    get_lecture_section,
    _hydrate_sections_from_neo4j,
)

try:
    from services_logging import log_event
except ImportError:
    def log_event(event_type: str, data: dict):
        print(f"[Event] {event_type}: {data}")


router = APIRouter(prefix="/lecture-links", tags=["lecture-links"])
sections_router = APIRouter(prefix="/lectures", tags=["lectures"])


@router.post("/resolve", response_model=LectureLinkResolveResponse)
def resolve_lecture_links_endpoint(
    payload: LectureLinkResolveRequest,
    auth: dict = Depends(require_auth),
):
    links, weak = resolve_lecture_links(
        chat_id=payload.chat_id,
        source_type=payload.source_type,
        source_id=payload.source_id,
        lecture_document_ids=payload.lecture_document_ids,
        top_n=payload.top_n or 5,
    )
    return LectureLinkResolveResponse(links=links, weak=weak)


@router.get("", response_model=List[LectureLink])
def list_lecture_links_endpoint(
    chat_id: str = Query(...),
    source_type: str = Query(...),
    source_id: str = Query(...),
    auth: dict = Depends(require_auth),
):
    return list_lecture_links(chat_id, source_type, source_id)


@router.post("/{link_id}/feedback", status_code=204)
def lecture_link_feedback_endpoint(
    link_id: str,
    payload: LectureLinkFeedbackRequest,
    auth: dict = Depends(require_auth),
):
    save_lecture_link_feedback(link_id, payload.action)
    return None


@sections_router.get("/{lecture_id}/sections/{section_id}", response_model=LectureSectionResponse)
def get_lecture_section_endpoint(
    lecture_id: str,
    section_id: str,
    link_id: Optional[str] = Query(default=None),
    auth: dict = Depends(require_auth),
):
    section = get_lecture_section(lecture_id, section_id)
    if not section:
        _hydrate_sections_from_neo4j(lecture_id)
        section = get_lecture_section(lecture_id, section_id)
    if not section:
        raise HTTPException(status_code=404, detail="Lecture section not found")

    if link_id:
        log_event("lecture_link_clicked", {
            "link_id": link_id,
            "lecture_document_id": lecture_id,
            "lecture_section_id": section_id,
        })

    return LectureSectionResponse(section=section)
