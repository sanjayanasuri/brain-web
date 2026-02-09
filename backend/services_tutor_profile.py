"""
TutorProfile service (Phase F).

Stores TutorProfile inside the existing UserProfile.learning_preferences JSON blob,
so it can be rolled out without DB migrations.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from neo4j import Session

from models_tutor_profile import TutorProfile, TutorProfilePatch
from services_graph import get_user_profile, patch_user_profile


TUTOR_PROFILE_KEY = "tutor_profile"


def _coerce_profile(raw: Any) -> Optional[TutorProfile]:
    if isinstance(raw, TutorProfile):
        return raw
    if isinstance(raw, dict):
        try:
            return TutorProfile(**raw)
        except Exception:
            return None
    return None


def get_tutor_profile(session: Session, user_id: str = "default") -> TutorProfile:
    """
    Fetch TutorProfile for the user.
    Falls back to default profile if missing or malformed.
    """
    user_profile = get_user_profile(session, user_id=user_id)
    learning_prefs: Dict[str, Any] = user_profile.learning_preferences or {}
    profile = _coerce_profile(learning_prefs.get(TUTOR_PROFILE_KEY))
    return profile or TutorProfile()


def set_tutor_profile(session: Session, user_id: str, profile: TutorProfile) -> TutorProfile:
    """
    Overwrite TutorProfile in learning_preferences.
    """
    patch_user_profile(
        session,
        updates={"learning_preferences": {TUTOR_PROFILE_KEY: profile.model_dump()}},
        user_id=user_id,
    )
    return profile


def patch_tutor_profile(session: Session, user_id: str, patch: TutorProfilePatch) -> TutorProfile:
    """
    Apply partial updates to TutorProfile and persist.
    """
    current = get_tutor_profile(session, user_id=user_id)
    merged = current.model_dump()
    merged.update(patch.model_dump(exclude_unset=True))
    updated = TutorProfile(**merged)
    return set_tutor_profile(session, user_id=user_id, profile=updated)

