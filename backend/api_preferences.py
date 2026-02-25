"""
API endpoints for user preferences and personalization settings.

This module handles:
- Response style profile (how Brain Web should answer)
- Focus areas (current learning themes)
- User profile (background, interests, weak spots, learning preferences)
"""

from fastapi import APIRouter, Depends, Request
from typing import List, Optional
import uuid
from datetime import datetime

from models import (
    ResponseStyleProfileWrapper,
    FocusArea,
    UserProfile,
    UIPreferences,
    ConversationSummary,
    LearningTopic
)
from models_tutor_profile import TutorProfile, TutorProfilePatch
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
from services_tutor_profile import (
    get_tutor_profile as get_tutor_profile_service,
    set_tutor_profile as set_tutor_profile_service,
    patch_tutor_profile as patch_tutor_profile_service,
)
from auth import get_user_context_from_request

router = APIRouter(prefix="/preferences", tags=["preferences"])

def _get_request_user_id(request: Request) -> str:
    # Prefer middleware-authenticated state (works in demo mode elevation too)
    user_id = getattr(request.state, "user_id", None)
    if user_id:
        return str(user_id)
    # Fallback: parse token directly (legacy)
    user_context = get_user_context_from_request(request)
    token_user_id = user_context.get("user_id")
    return str(token_user_id) if token_user_id else "default"

def _get_request_tenant_id(request: Request) -> str:
    tenant_id = getattr(request.state, "tenant_id", None)
    if tenant_id:
        return str(tenant_id)
    user_context = get_user_context_from_request(request)
    token_tenant_id = user_context.get("tenant_id")
    return str(token_tenant_id) if token_tenant_id else "default"


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
    user_id = _get_request_user_id(request)
    return get_user_profile(session, user_id=user_id)


@router.post("/user-profile", response_model=UserProfile)
def set_profile(profile: UserProfile, request: Request, session=Depends(get_neo4j_session)):
    """
    Update the user profile.
    """
    user_id = _get_request_user_id(request)
    result = update_user_profile(session, profile, user_id=user_id)
    
    # Emit ActivityEvent for PROFILE_UPDATED
    try:
        from services_branch_explorer import get_active_graph_context
        tenant_id = _get_request_tenant_id(request)
        graph_id, _ = get_active_graph_context(session, tenant_id=tenant_id, user_id=user_id)
        
        event_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat() + "Z"
        session.run(
            """
            CREATE (e:ActivityEvent {
                id: $id,
                user_id: $user_id,
                graph_id: $graph_id,
                type: 'PROFILE_UPDATED',
                payload: $payload,
                created_at: $created_at
            })
            """,
            id=event_id,
            user_id=user_id,
            graph_id=graph_id,
            payload={"source": "user_profile"},
            created_at=now
        )
    except Exception as e:
        import logging
        logging.getLogger("brain_web").warning(f"Failed to emit PROFILE_UPDATED event: {e}")
        
    return result


@router.patch("/user-profile", response_model=UserProfile)
def patch_profile(update_dict: dict, request: Request, session=Depends(get_neo4j_session)):
    """
    Partial update of the user profile.
    """
    user_id = _get_request_user_id(request)
    return patch_user_profile(session, update_dict, user_id=user_id)

@router.get("/tutor-profile", response_model=TutorProfile)
def get_tutor_profile(request: Request, session=Depends(get_neo4j_session)):
    """
    Get the per-user TutorProfile (Phase F).
    Stored under UserProfile.learning_preferences["tutor_profile"].
    """
    user_id = _get_request_user_id(request)
    return get_tutor_profile_service(session, user_id=user_id)


@router.post("/tutor-profile", response_model=TutorProfile)
def set_tutor_profile(profile: TutorProfile, request: Request, session=Depends(get_neo4j_session)):
    """
    Set the per-user TutorProfile (overwrite).
    """
    user_id = _get_request_user_id(request)
    return set_tutor_profile_service(session, user_id=user_id, profile=profile)


@router.patch("/tutor-profile", response_model=TutorProfile)
def patch_tutor_profile(patch: TutorProfilePatch, request: Request, session=Depends(get_neo4j_session)):
    """
    Patch the per-user TutorProfile (partial update).
    """
    user_id = _get_request_user_id(request)
    result = patch_tutor_profile_service(session, user_id=user_id, patch=patch)
    
    # Emit ActivityEvent for PROFILE_UPDATED
    try:
        from services_branch_explorer import get_active_graph_context
        tenant_id = _get_request_tenant_id(request)
        graph_id, _ = get_active_graph_context(session, tenant_id=tenant_id, user_id=user_id)
        
        event_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat() + "Z"
        session.run(
            """
            CREATE (e:ActivityEvent {
                id: $id,
                user_id: $user_id,
                graph_id: $graph_id,
                type: 'PROFILE_UPDATED',
                payload: $payload,
                created_at: $created_at
            })
            """,
            id=event_id,
            user_id=user_id,
            graph_id=graph_id,
            payload={"source": "tutor_profile_patch"},
            created_at=now
        )
    except Exception as e:
        import logging
        logging.getLogger("brain_web").warning(f"Failed to emit PROFILE_UPDATED event: {e}")
        
    return result


@router.get("/ui", response_model=UIPreferences)
def get_ui_prefs(session=Depends(get_neo4j_session)):
    """
    Get UI preferences (lens system, etc.).
    """
    return get_ui_preferences(session)


@router.post("/ui", response_model=UIPreferences)
def set_ui_prefs(
    prefs: UIPreferences, 
    request: Request,
    auth: dict = Depends(require_auth),
    session=Depends(get_neo4j_session)
):
    """
    Update UI preferences (lens system, etc.).
    """
    result = update_ui_preferences(session, prefs)
    
    # Emit ActivityEvent for LENS_CHANGED
    try:
        user_id = _get_request_user_id(request)
        tenant_id = _get_request_tenant_id(request)
        from services_branch_explorer import get_active_graph_context
        graph_id, _ = get_active_graph_context(session, tenant_id=tenant_id, user_id=user_id)
        
        # We assume that if someone is calling this, they might be changing the lens
        # For simplicity, we'll emit LENS_CHANGED if an active_lens is present in the payload
        # This could be refined to check if it actually CHANGED.
        active_lens = getattr(prefs, "active_lens", None)
        if not active_lens and hasattr(prefs, "dict"):
             active_lens = prefs.dict().get("active_lens")
             
        if active_lens:
            event_id = str(uuid.uuid4())
            now = datetime.utcnow().isoformat() + "Z"
            session.run(
                """
                CREATE (e:ActivityEvent {
                    id: $id,
                    user_id: $user_id,
                    graph_id: $graph_id,
                    type: 'LENS_CHANGED',
                    payload: $payload,
                    created_at: $created_at
                })
                """,
                id=event_id,
                user_id=user_id,
                graph_id=graph_id,
                payload={"lens_name": active_lens},
                created_at=now
            )
    except Exception as e:
        import logging
        logging.getLogger("brain_web").warning(f"Failed to emit LENS_CHANGED event: {e}")
        
    return result


@router.post("/conversation-summaries", response_model=ConversationSummary)
def store_summary(summary: ConversationSummary, request: Request, session=Depends(get_neo4j_session)):
    """
    Store a conversation summary for long-term memory.
    """
    user_id = _get_request_user_id(request)
    tenant_id = _get_request_tenant_id(request)
    return store_conversation_summary(session, summary, user_id=user_id, tenant_id=tenant_id)


@router.get("/conversation-summaries", response_model=List[ConversationSummary])
def get_summaries(request: Request, limit: int = 10, session=Depends(get_neo4j_session)):
    """
    Get recent conversation summaries for context.
    """
    user_id = _get_request_user_id(request)
    tenant_id = _get_request_tenant_id(request)
    return get_recent_conversation_summaries(session, limit, user_id=user_id, tenant_id=tenant_id)


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
