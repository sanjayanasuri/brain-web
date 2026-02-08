"""
API endpoints for user preferences and personalization settings.

This module handles:
- Response style profile (how Brain Web should answer)
- Focus areas (current learning themes)
- User profile (background, interests, weak spots, learning preferences)
"""

from fastapi import APIRouter, Depends, Request
from typing import List

from models import (
    ResponseStyleProfileWrapper,
    FocusArea,
    UserProfile,
    UIPreferences,
    ConversationSummary,
    LearningTopic
)
from db_neo4j import get_neo4j_session
from services_graph import (
    get_response_style_profile,
    update_response_style_profile,
    get_focus_areas,
    upsert_focus_area,
    set_focus_area_active,
    get_user_profile,
    update_user_profile,
    get_ui_preferences,
    update_ui_preferences,
    store_conversation_summary,
    get_recent_conversation_summaries,
    upsert_learning_topic,
    get_active_learning_topics,
    patch_user_profile
)
from auth import get_user_context_from_request

router = APIRouter(prefix="/preferences", tags=["preferences"])


@router.get("/response-style", response_model=ResponseStyleProfileWrapper)
def get_response_style(session=Depends(get_neo4j_session)):
    """
    Get the current response style profile.
    This profile shapes how Brain Web answers questions.
    """
    return get_response_style_profile(session)


@router.post("/response-style", response_model=ResponseStyleProfileWrapper)
def set_response_style(wrapper: ResponseStyleProfileWrapper, session=Depends(get_neo4j_session)):
    """
    Update the response style profile.
    """
    return update_response_style_profile(session, wrapper)


@router.get("/focus-areas", response_model=List[FocusArea])
def list_focus_areas(session=Depends(get_neo4j_session)):
    """
    Get all focus areas.
    Focus areas represent current learning themes that bias answers.
    """
    return get_focus_areas(session)


@router.post("/focus-areas", response_model=FocusArea)
def create_or_update_focus_area(fa: FocusArea, session=Depends(get_neo4j_session)):
    """
    Create or update a focus area.
    """
    return upsert_focus_area(session, fa)


@router.post("/focus-areas/{focus_id}/active", response_model=FocusArea)
def toggle_focus_area(focus_id: str, active: bool, session=Depends(get_neo4j_session)):
    """
    Toggle the active status of a focus area.
    Only active focus areas bias answers.
    """
    return set_focus_area_active(session, focus_id, active)


@router.get("/user-profile", response_model=UserProfile)
def get_profile(request: Request, session=Depends(get_neo4j_session)):
    """
    Get the user profile.
    The profile encodes background, interests, weak spots, and learning preferences.
    """
    user_context = get_user_context_from_request(request)
    user_id = user_context.get("user_id", "default")
    return get_user_profile(session, user_id=user_id)


@router.post("/user-profile", response_model=UserProfile)
def set_profile(profile: UserProfile, request: Request, session=Depends(get_neo4j_session)):
    """
    Update the user profile.
    """
    user_context = get_user_context_from_request(request)
    user_id = user_context.get("user_id", "default")
    return update_user_profile(session, profile, user_id=user_id)


@router.patch("/user-profile", response_model=UserProfile)
def patch_profile(update_dict: dict, request: Request, session=Depends(get_neo4j_session)):
    """
    Partial update of the user profile.
    """
    user_context = get_user_context_from_request(request)
    user_id = user_context.get("user_id", "default")
    return patch_user_profile(session, update_dict, user_id=user_id)


@router.get("/ui", response_model=UIPreferences)
def get_ui_prefs(session=Depends(get_neo4j_session)):
    """
    Get UI preferences (lens system, etc.).
    """
    return get_ui_preferences(session)


@router.post("/ui", response_model=UIPreferences)
def set_ui_prefs(prefs: UIPreferences, session=Depends(get_neo4j_session)):
    """
    Update UI preferences (lens system, etc.).
    """
    return update_ui_preferences(session, prefs)


@router.post("/conversation-summaries", response_model=ConversationSummary)
def store_summary(summary: ConversationSummary, session=Depends(get_neo4j_session)):
    """
    Store a conversation summary for long-term memory.
    """
    return store_conversation_summary(session, summary)


@router.get("/conversation-summaries", response_model=List[ConversationSummary])
def get_summaries(limit: int = 10, session=Depends(get_neo4j_session)):
    """
    Get recent conversation summaries for context.
    """
    return get_recent_conversation_summaries(session, limit)


@router.post("/learning-topics", response_model=LearningTopic)
def upsert_topic(topic: LearningTopic, session=Depends(get_neo4j_session)):
    """
    Create or update a learning topic.
    """
    return upsert_learning_topic(session, topic)


@router.get("/learning-topics", response_model=List[LearningTopic])
def get_topics(limit: int = 20, session=Depends(get_neo4j_session)):
    """
    Get active learning topics (recently mentioned).
    """
    return get_active_learning_topics(session, limit)
