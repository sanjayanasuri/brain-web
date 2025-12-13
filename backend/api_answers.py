"""
API endpoints for storing and retrieving answers.
"""

from fastapi import APIRouter, Depends
from typing import List, Dict, Any

from models import AnswerRecord
from db_neo4j import get_neo4j_session
from services_graph import store_answer, get_example_answers
from neo4j import Session

router = APIRouter(prefix="/answers", tags=["answers"])


@router.post("/store", status_code=204)
def store_answer_endpoint(answer: AnswerRecord, session: Session = Depends(get_neo4j_session)):
    """
    Store an answer record in Neo4j.
    """
    store_answer(session, answer)
    return


@router.get("/examples")
def get_examples_endpoint(
    limit: int = 5,
    session: Session = Depends(get_neo4j_session),
) -> List[Dict[str, Any]]:
    """
    Get recent user-rewritten answers to use as style examples.
    """
    return get_example_answers(session, limit=limit)
