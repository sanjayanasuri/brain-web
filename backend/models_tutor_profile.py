"""
TutorProfile models (Phase F).

Index-first + additive only: TutorProfile is stored inside UserProfile.learning_preferences
under the key "tutor_profile" to avoid schema migrations.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


# Keep Literal types for structured settings
ResponseMode = Literal["compact", "hint", "normal", "deep"]
AskQuestionPolicy = Literal["never", "at_most_one", "ok"]
Pacing = Literal["slow", "normal", "fast"]
TurnTaking = Literal["normal", "no_interrupt"]


class TutorProfile(BaseModel):
    """
    Explicit, editable tutor behavior preferences applied across modalities.

    Stored at: UserProfile.learning_preferences["tutor_profile"].
    
    Users can either:
    1. Use custom_instructions to define their own persona in natural language
    2. Use predefined audience_mode and voice_id (fallback if custom_instructions is not set)
    """

    version: str = Field(default="tutor_profile_v1")

    # Custom persona instructions (takes precedence over predefined modes)
    custom_instructions: Optional[str] = Field(
        default=None,
        description="Custom tutor persona in natural language. If set, this overrides audience_mode and voice_id. Example: 'You are a Socratic tutor who asks probing questions instead of giving direct answers.'"
    )

    # Predefined modes (optional fallbacks, now accept any string)
    audience_mode: str = Field(
        default="default",
        description="Predefined audience mode: 'default', 'eli5', 'ceo_pitch', 'recruiter_interview', 'technical', or any custom value"
    )
    voice_id: str = Field(
        default="neutral",
        description="Predefined voice style: 'neutral', 'friendly', 'direct', 'playful', or any custom value"
    )

    # Structured settings (keep as Literal for validation)
    response_mode: ResponseMode = Field(default="compact")
    ask_question_policy: AskQuestionPolicy = Field(default="at_most_one")
    end_with_next_step: bool = Field(default=True)

    pacing: Pacing = Field(default="normal")
    turn_taking: TurnTaking = Field(default="normal")
    no_glazing: bool = Field(default=True)


class TutorProfilePatch(BaseModel):
    """
    Partial updates for TutorProfile (PATCH semantics).
    """

    custom_instructions: Optional[str] = None
    audience_mode: Optional[str] = None
    voice_id: Optional[str] = None
    response_mode: Optional[ResponseMode] = None
    ask_question_policy: Optional[AskQuestionPolicy] = None
    end_with_next_step: Optional[bool] = None
    pacing: Optional[Pacing] = None
    turn_taking: Optional[TurnTaking] = None
    no_glazing: Optional[bool] = None

