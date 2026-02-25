# Response style, user profile, focus areas, feedback, and memory summary models.
from datetime import datetime
from typing import Optional, List, Dict, Any, Literal

from pydantic import BaseModel, Field


class ResponseStyleProfile(BaseModel):
    tone: str
    teaching_style: str
    sentence_structure: str
    explanation_order: List[str]
    forbidden_styles: List[str]


class ResponseStyleProfileWrapper(BaseModel):
    id: str = "default"
    profile: ResponseStyleProfile


class ExplanationFeedback(BaseModel):
    answer_id: str
    question: str
    rating: int
    reasoning: Optional[str] = None
    verbosity: Optional[Literal["too_short", "too_verbose", "just_right"]] = None
    question_preference: Optional[Literal["more_questions", "fewer_questions", "ok"]] = None
    humor_preference: Optional[Literal["more_humor", "less_humor", "ok"]] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class FeedbackSummary(BaseModel):
    total: int
    positive: int
    negative: int
    common_reasons: Dict[str, int]


class FocusArea(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    active: bool = True


class UserProfile(BaseModel):
    id: str = "default"
    name: str = "Learner"
    email: Optional[str] = None
    signup_date: Optional[datetime] = None

    learning_goals: str = Field(default="", description="High-level goals.")
    domain_background: str = Field(default="", description="What the user already knows.")
    learning_style: Optional[str] = Field(default="Balanced")

    inferred_knowledge_tags: Dict[str, str] = Field(default_factory=dict)
    weak_areas: List[str] = Field(default_factory=list)

    learning_preferences: Dict[str, Any] = Field(default_factory=dict)
    ui_preferences: Dict[str, Any] = Field(default_factory=dict)
    interests: List[str] = []


class ReminderPreferences(BaseModel):
    weekly_digest: Dict[str, Any] = {
        "enabled": False,
        "day_of_week": 1,
        "hour": 9,
    }
    review_queue: Dict[str, Any] = {
        "enabled": False,
        "cadence_days": 3,
    }


class ConversationSummary(BaseModel):
    id: str
    timestamp: int
    question: str
    answer: str
    topics: List[str] = []
    summary: str = ""


class LearningTopic(BaseModel):
    id: str
    name: str
    first_mentioned: int
    last_mentioned: int
    mention_count: int = 1
    related_topics: List[str] = []
    notes: str = ""


class UIPreferences(BaseModel):
    active_lens: str = "NONE"
    reminders: ReminderPreferences = Field(default_factory=ReminderPreferences)


class NotionConfig(BaseModel):
    database_ids: List[str] = []
    enable_auto_sync: bool = False


class AnswerRecord(BaseModel):
    answer_id: str
    question: str
    raw_answer: str
    used_node_ids: List[str] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Revision(BaseModel):
    answer_id: str
    user_rewritten_answer: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AnswerRevisionRequest(BaseModel):
    answer_id: str
    user_rewritten_answer: str


class StyleFeedbackRequest(BaseModel):
    answer_id: str
    question: str
    original_response: str
    feedback_notes: str
    user_rewritten_version: Optional[str] = None
    test_label: Optional[str] = None
    verbosity: Optional[Literal["too_short", "too_verbose", "just_right"]] = None
    question_preference: Optional[Literal["more_questions", "fewer_questions", "ok"]] = None
    humor_preference: Optional[Literal["more_humor", "less_humor", "ok"]] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
