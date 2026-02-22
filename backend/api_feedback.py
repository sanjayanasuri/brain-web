"""
API endpoints for feedback on Brain Web answers.

This module handles:
- Submitting feedback (thumbs up/down) on answers
- Getting feedback summary for improving future responses
- Storing user-rewritten answers (revisions)
"""

import logging

from fastapi import APIRouter, BackgroundTasks, Depends

from auth import optional_auth
from models import ExplanationFeedback, FeedbackSummary, AnswerRevisionRequest, StyleFeedbackRequest
from db_neo4j import get_neo4j_session
from services_graph import store_feedback, get_recent_feedback_summary, store_revision, store_style_feedback, get_style_feedback_examples
from models import Revision
from services_feedback_classifier import apply_inferred_feedback_signals, should_run_feedback_classifier
from services_voice_style_profile import observe_explicit_feedback

router = APIRouter(prefix="/feedback", tags=["feedback"])
logger = logging.getLogger("brain_web")


@router.post("/", status_code=204)
def submit_feedback(
    fb: ExplanationFeedback,
    background_tasks: BackgroundTasks,
    auth: dict = Depends(optional_auth),
    session=Depends(get_neo4j_session),
):
    """
    Submit feedback on a specific answer.
    Feedback is used to improve future responses through feedback loops.
    """
    store_feedback(session, fb)
    user_id = auth.get("user_id")
    tenant_id = auth.get("tenant_id")
    if user_id and tenant_id:
        try:
            observe_explicit_feedback(
                user_id=str(user_id),
                tenant_id=str(tenant_id),
                rating=fb.rating,
                reasoning=fb.reasoning,
                verbosity=fb.verbosity,
                question_preference=fb.question_preference,
                humor_preference=fb.humor_preference,
            )
        except Exception as e:
            logger.warning(f"Failed to apply explicit feedback signal: {e}")
        try:
            if should_run_feedback_classifier(
                reasoning=fb.reasoning,
                verbosity=fb.verbosity,
                question_preference=fb.question_preference,
                humor_preference=fb.humor_preference,
            ):
                background_tasks.add_task(
                    apply_inferred_feedback_signals,
                    user_id=str(user_id),
                    tenant_id=str(tenant_id),
                    reasoning=str(fb.reasoning or ""),
                )
        except Exception as e:
            logger.debug(f"Failed to queue fallback feedback classifier: {e}")
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
def submit_style_feedback(
    fb: StyleFeedbackRequest,
    background_tasks: BackgroundTasks,
    auth: dict = Depends(optional_auth),
    session=Depends(get_neo4j_session),
):
    """
    Submit structured style feedback for learning user preferences.
    
    Format matches: "Test1: [original_response] Test1 Feedback: [feedback_notes]"
    
    This creates a training dataset for learning the user's style preferences.
    The feedback is used to automatically refine the style guide.
    """
    feedback_id = store_style_feedback(session, fb)
    user_id = auth.get("user_id")
    tenant_id = auth.get("tenant_id")
    if user_id and tenant_id:
        try:
            observe_explicit_feedback(
                user_id=str(user_id),
                tenant_id=str(tenant_id),
                reasoning=fb.feedback_notes,
                verbosity=fb.verbosity,
                question_preference=fb.question_preference,
                humor_preference=fb.humor_preference,
                original_response=fb.original_response,
                user_rewritten_version=fb.user_rewritten_version,
            )
        except Exception as e:
            logger.warning(f"Failed to apply style-feedback signal: {e}")
        try:
            if should_run_feedback_classifier(
                reasoning=fb.feedback_notes,
                verbosity=fb.verbosity,
                question_preference=fb.question_preference,
                humor_preference=fb.humor_preference,
                original_response=fb.original_response,
                user_rewritten_version=fb.user_rewritten_version,
            ):
                background_tasks.add_task(
                    apply_inferred_feedback_signals,
                    user_id=str(user_id),
                    tenant_id=str(tenant_id),
                    reasoning=str(fb.feedback_notes or ""),
                    original_response=fb.original_response,
                    user_rewritten_version=fb.user_rewritten_version,
                )
        except Exception as e:
            logger.debug(f"Failed to queue style fallback classifier: {e}")
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
