"""
Focus areas and user profile (Neo4j + Postgres sync), episodic context.
"""
import json
from typing import List, Dict, Any

from neo4j import Session

from models import FocusArea, UserProfile
from services_user import get_user_by_id, update_user

from .memory import get_active_learning_topics, get_recent_conversation_summaries


def get_focus_areas(session: Session) -> List[FocusArea]:
    """
    Get all focus areas from Neo4j.
    Focus areas represent current learning themes that bias answers.
    """
    query = """
    MATCH (f:FocusArea)
    RETURN f
    """
    records = session.run(query)
    areas = []
    for rec in records:
        node = rec["f"]
        areas.append(FocusArea(
            id=node.get("id") or node.get("name", ""),
            name=node.get("name", ""),
            description=node.get("description"),
            active=node.get("active", True),
        ))
    return areas


def upsert_focus_area(session: Session, fa: FocusArea) -> FocusArea:
    """
    Create or update a focus area in Neo4j.
    """
    query = """
    MERGE (f:FocusArea {id: $id})
    SET f.name = $name,
        f.description = $description,
        f.active = $active
    RETURN f
    """
    rec = session.run(query, **fa.dict()).single()
    node = rec["f"]
    return FocusArea(
        id=node.get("id", fa.id),
        name=node.get("name", fa.name),
        description=node.get("description"),
        active=node.get("active", True),
    )


def set_focus_area_active(session: Session, focus_id: str, active: bool) -> FocusArea:
    """
    Toggle the active status of a focus area.
    """
    query = """
    MATCH (f:FocusArea {id: $focus_id})
    SET f.active = $active
    RETURN f
    """
    rec = session.run(query, focus_id=focus_id, active=active).single()
    if not rec:
        raise ValueError(f"Focus area with id {focus_id} not found")
    node = rec["f"]
    return FocusArea(
        id=node.get("id", focus_id),
        name=node.get("name", ""),
        description=node.get("description"),
        active=node.get("active", True),
    )


def get_user_profile(session: Session, user_id: str = "default") -> UserProfile:
    """
    Get the user profile from Neo4j, synced with Postgres user data.
    If none exists, create a default one.
    The profile encodes background, interests, weak spots, and learning preferences.
    """
    postgres_user = None
    default_name = "Sanjay"
    default_email = None

    if user_id != "default":
        try:
            postgres_user = get_user_by_id(user_id)
        except Exception:
            postgres_user = None
        if postgres_user:
            default_name = postgres_user.get("full_name") or "User"
            default_email = postgres_user.get("email")

    query = """
    MERGE (u:UserProfile {id: $user_id})
    ON CREATE SET u.name = $default_name,
                  u.email = $default_email,
                  u.signup_date = datetime(),
                  u.background = [],
                  u.interests = [],
                  u.weak_spots = [],
                  u.learning_preferences = $empty_json
    RETURN u
    """
    empty_json = json.dumps({})
    empty_static = json.dumps({"occupation": "", "core_skills": [], "learning_style": "", "verified_expertise": []})
    empty_episodic = json.dumps({"current_projects": [], "active_topics": [], "recent_searches": [], "last_updated": None})

    params = {
        "user_id": user_id,
        "default_name": default_name,
        "default_email": default_email,
        "empty_json": empty_json,
    }

    rec = session.run(query, **params).single()
    u = rec["u"]

    learning_prefs = u.get("learning_preferences", {})
    if isinstance(learning_prefs, str):
        learning_prefs = json.loads(learning_prefs)

    static_profile = u.get("static_profile", empty_static)
    if isinstance(static_profile, str):
        static_profile = json.loads(static_profile)
    elif static_profile is None:
        static_profile = json.loads(empty_static)

    episodic_context = u.get("episodic_context", empty_episodic)
    if isinstance(episodic_context, str):
        episodic_context = json.loads(episodic_context)
    elif episodic_context is None:
        episodic_context = json.loads(empty_episodic)

    final_name = postgres_user.get("full_name") if postgres_user else u.get("name", "Sanjay")
    final_email = postgres_user.get("email") if postgres_user else u.get("email")

    signup = u.get("signup_date")
    if signup and hasattr(signup, "to_native"):
        signup = signup.to_native()

    return UserProfile(
        id=user_id,
        name=final_name or "User",
        email=final_email,
        signup_date=signup,
        background=u.get("background", []),
        interests=u.get("interests", []),
        weak_spots=u.get("weak_spots", []),
        learning_preferences=learning_prefs,
        static_profile=static_profile,
        episodic_context=episodic_context,
    )


def update_user_profile(session: Session, profile: UserProfile, user_id: str = "default") -> UserProfile:
    """
    Update the user profile in Neo4j and Postgres.
    """
    target_id = user_id
    if target_id == "default" and profile.id and profile.id != "default":
        target_id = profile.id

    profile.id = target_id

    if target_id != "default":
        try:
            update_user(target_id, email=profile.email, full_name=profile.name)
        except Exception:
            pass

    query = """
    MERGE (u:UserProfile {id: $id})
    SET u.name = $name,
        u.email = $email,
        u.signup_date = $signup_date,
        u.background = $background,
        u.interests = $interests,
        u.weak_spots = $weak_spots,
        u.learning_preferences = $learning_preferences,
        u.static_profile = $static_profile,
        u.episodic_context = $episodic_context
    RETURN u
    """
    profile_dict = profile.dict()
    profile_dict["learning_preferences"] = json.dumps(profile_dict["learning_preferences"])
    profile_dict["static_profile"] = json.dumps(profile_dict["static_profile"])
    profile_dict["episodic_context"] = json.dumps(profile_dict["episodic_context"])

    rec = session.run(query, **profile_dict).single()
    u = rec["u"]

    learning_prefs = u.get("learning_preferences", {})
    if isinstance(learning_prefs, str):
        learning_prefs = json.loads(learning_prefs)

    static_profile = u.get("static_profile", {})
    if isinstance(static_profile, str):
        static_profile = json.loads(static_profile)

    episodic_context = u.get("episodic_context", {})
    if isinstance(episodic_context, str):
        episodic_context = json.loads(episodic_context)

    signup = u.get("signup_date")
    if signup and hasattr(signup, "to_native"):
        signup = signup.to_native()

    return UserProfile(
        id=u["id"],
        name=u["name"],
        email=u.get("email"),
        signup_date=signup,
        background=u.get("background", []),
        interests=u.get("interests", []),
        weak_spots=u.get("weak_spots", []),
        learning_preferences=learning_prefs,
        static_profile=static_profile,
        episodic_context=episodic_context,
    )


def patch_user_profile(session: Session, updates: Dict[str, Any], user_id: str = "default") -> UserProfile:
    """
    Partial update of user profile. Merges lists and dicts safely.
    """
    current = get_user_profile(session, user_id=user_id)
    current_dict = current.dict()

    for list_field in ["background", "interests", "weak_spots"]:
        if list_field in updates and isinstance(updates[list_field], list):
            combined = current_dict.get(list_field, []) + updates[list_field]
            current_dict[list_field] = list(dict.fromkeys(combined))

    for dict_field in ["learning_preferences", "static_profile", "episodic_context"]:
        if dict_field in updates and isinstance(updates[dict_field], dict):
            merged = current_dict.get(dict_field, {})
            merged.update(updates[dict_field])
            current_dict[dict_field] = merged

    if "name" in updates:
        current_dict["name"] = updates["name"]
    if "email" in updates:
        current_dict["email"] = updates["email"]

    updated_profile = UserProfile(**current_dict)
    return update_user_profile(session, updated_profile, user_id=user_id)


def update_episodic_context(session: Session) -> UserProfile:
    """
    Auto-update episodic context based on recent activity.
    Fetches recent learning topics and conversation summaries to populate:
    - current_projects
    - active_topics
    - recent_searches
    """
    import time

    profile = get_user_profile(session)
    topics = get_active_learning_topics(session, limit=10)
    active_topics = [t.name for t in topics[:5]]
    current_projects = [t.name for t in topics if t.mention_count >= 3][:3]
    summaries = get_recent_conversation_summaries(session, limit=5)
    recent_searches = [s.summary for s in summaries if s.summary][:3]

    profile.episodic_context = {
        "current_projects": current_projects,
        "active_topics": active_topics,
        "recent_searches": recent_searches,
        "last_updated": int(time.time()),
    }
    return update_user_profile(session, profile)
