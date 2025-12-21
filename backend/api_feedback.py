"""
API endpoints for feedback on Brain Web answers.

This module handles:
- Submitting feedback (thumbs up/down) on answers
- Getting feedback summary for improving future responses
- Storing user-rewritten answers (revisions)
"""

from fastapi import APIRouter, Depends

from models import ExplanationFeedback, FeedbackSummary, AnswerRevisionRequest, StyleFeedbackRequest
from db_neo4j import get_neo4j_session
from services_graph import store_feedback, get_recent_feedback_summary, store_revision, store_style_feedback, get_style_feedback_examples
from models import Revision

router = APIRouter(prefix="/feedback", tags=["feedback"])


@router.post("/", status_code=204)
def submit_feedback(fb: ExplanationFeedback, session=Depends(get_neo4j_session)):
    """
    Submit feedback on a specific answer.
    Feedback is used to improve future responses through feedback loops.
    """
    store_feedback(session, fb)
    return


@router.post("/answer/revision", status_code=204)
def submit_revision(req: AnswerRevisionRequest, session=Depends(get_neo4j_session)):
    """
    Store a user-rewritten answer as a revision.
    Revisions are used as examples for style guidance in future answers.
    """
    revision = Revision(
        answer_id=req.answer_id,
        user_rewritten_answer=req.user_rewritten_answer,
    )
    store_revision(session, revision)
    return


@router.get("/summary", response_model=FeedbackSummary)
def get_feedback_summary(session=Depends(get_neo4j_session)):
    """
    Get a summary of recent feedback.
    Used to guide future responses and avoid patterns that produced negative feedback.
    """
    return get_recent_feedback_summary(session)


@router.post("/style", status_code=201)
def submit_style_feedback(fb: StyleFeedbackRequest, session=Depends(get_neo4j_session)):
    """
    Submit structured style feedback for learning user preferences.
    
    Format matches: "Test1: [original_response] Test1 Feedback: [feedback_notes]"
    
    This creates a training dataset for learning the user's style preferences.
    The feedback is used to automatically refine the style guide.
    """
    feedback_id = store_style_feedback(session, fb)
    return {"feedback_id": feedback_id, "message": "Style feedback stored successfully"}


@router.get("/style/examples")
def get_style_feedback_examples_endpoint(
    limit: int = 10,
    session=Depends(get_neo4j_session)
):
    """
    Get recent style feedback examples.
    Used to show user their feedback history and for style guide refinement.
    """
    return get_style_feedback_examples(session, limit=limit)
