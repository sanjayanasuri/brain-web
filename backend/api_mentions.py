from fastapi import APIRouter, Depends, HTTPException

from db_neo4j import get_neo4j_session
from models import LectureMention, LectureMentionCreate, LectureMentionUpdate
from services_lecture_mentions import (
    create_lecture_mention,
    update_lecture_mention,
    delete_lecture_mention,
)

router = APIRouter(prefix="/mentions", tags=["mentions"])


@router.post("/", response_model=LectureMention)
def create_mention_endpoint(
    payload: LectureMentionCreate,
    session=Depends(get_neo4j_session),
):
    try:
        return create_lecture_mention(session, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/{mention_id}", response_model=LectureMention)
def update_mention_endpoint(
    mention_id: str,
    payload: LectureMentionUpdate,
    session=Depends(get_neo4j_session),
):
    mention = update_lecture_mention(session, mention_id, payload)
    if not mention:
        raise HTTPException(status_code=404, detail="Mention not found")
    return mention


@router.delete("/{mention_id}")
def delete_mention_endpoint(mention_id: str, session=Depends(get_neo4j_session)):
    deleted = delete_lecture_mention(session, mention_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Mention not found")
    return {"status": "deleted", "mention_id": mention_id}
