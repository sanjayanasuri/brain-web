"""
TutorProfile models (Phase F).

Index-first + additive only: TutorProfile is stored inside UserProfile.learning_preferences
under the key "tutor_profile" to avoid schema migrations.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Structured option types
# ---------------------------------------------------------------------------

# How complex and vocabulary-dense explanations should be
ComprehensionLevel = Literal["beginner", "intermediate", "advanced", "expert"]

# Overall voice/communication tone
Tone = Literal["casual", "balanced", "formal", "encouraging"]

# How fast the tutor moves through material
Pacing = Literal["slow", "moderate", "fast"]

# How the AI structures conversational turns
TurnTaking = Literal["socratic", "lecture", "dialogic", "on_demand"]

# How long/detailed responses should be
ResponseLength = Literal["concise", "balanced", "detailed"]

# Legacy aliases kept for backward compatibility
ResponseMode = Literal["compact", "hint", "normal", "deep"]
AskQuestionPolicy = Literal["never", "at_most_one", "ok"]


class TutorProfile(BaseModel):
    """
    Explicit, editable tutor behavior preferences applied across modalities.

    Stored at: UserProfile.learning_preferences["tutor_profile"].

    Priority:
      1. custom_instructions (free-form, overrides everything below)
      2. Structured fields (comprehension_level, tone, pacing, turn_taking, response_length)

    Voice mode overrides allow separate tuning for spoken vs. text responses.
    """

    version: str = Field(default="tutor_profile_v2")

    # ------------------------------------------------------------------
    # Free-form override (takes precedence over all structured fields)
    # ------------------------------------------------------------------
    custom_instructions: Optional[str] = Field(
        default=None,
        description=(
            "Custom tutor persona in natural language. If set, this overrides all "
            "structured fields below. Example: 'You are a Socratic tutor who asks "
            "probing questions instead of giving direct answers.'"
        ),
    )

    # ------------------------------------------------------------------
    # Core shared settings (apply to both voice and text unless overridden)
    # ------------------------------------------------------------------
    comprehension_level: ComprehensionLevel = Field(
        default="intermediate",
        description="Vocabulary and complexity level: beginner → expert.",
    )
    tone: Tone = Field(
        default="balanced",
        description="Communication register: casual, balanced, formal, or encouraging.",
    )
    pacing: Pacing = Field(
        default="moderate",
        description="How fast the tutor moves: slow (one concept at a time), moderate, fast.",
    )
    turn_taking: TurnTaking = Field(
        default="dialogic",
        description="Conversational structure: socratic, lecture, dialogic, or on_demand.",
    )
    response_length: ResponseLength = Field(
        default="balanced",
        description="Preferred response length/density: concise, balanced, or detailed.",
    )

    # ------------------------------------------------------------------
    # Voice-mode overrides (only apply when responding via voice/TTS)
    # ------------------------------------------------------------------
    voice_tone_override: Optional[Tone] = Field(
        default=None,
        description="Voice-specific tone override. Falls back to `tone` if not set.",
    )
    voice_speech_density: Optional[Literal["sparse", "normal", "dense"]] = Field(
        default=None,
        description=(
            "Voice verbosity: sparse (short spoken sentences), normal, dense. "
            "Falls back to response_length mapping if not set."
        ),
    )

    # ------------------------------------------------------------------
    # Behavioral booleans
    # ------------------------------------------------------------------
    no_glazing: bool = Field(
        default=True,
        description="Be direct; correct errors immediately rather than softening them.",
    )
    end_with_next_step: bool = Field(
        default=True,
        description="Always suggest a logical next step at the end of a response.",
    )


class TutorProfilePatch(BaseModel):
    """
    Partial updates for TutorProfile (PATCH semantics).
    All fields optional; only provided fields are merged.
    """

    custom_instructions: Optional[str] = None
    comprehension_level: Optional[ComprehensionLevel] = None
    tone: Optional[Tone] = None
    pacing: Optional[Pacing] = None
    turn_taking: Optional[TurnTaking] = None
    response_length: Optional[ResponseLength] = None
    voice_tone_override: Optional[Tone] = None
    voice_speech_density: Optional[Literal["sparse", "normal", "dense"]] = None
    no_glazing: Optional[bool] = None
    end_with_next_step: Optional[bool] = None


