# the platform module is a built-in python library that provides functions to access underlying details about the system.
# in this case, we are using the node function to return the network name (hostname) of the computer where the script is running.
# this is useful for system identification in a network. 
# first, it helps us log and configure. 
# second, it helps us check for compatibility. we can see information like system architecture, processor, OS.
# third, knowign the hostname is necessary for things like service discovery and distributed system connection.
from platform import node

# typing is a module that contains generic types to ensure type safety. 
from typing import Optional, List, Dict, Any, Literal
# pydantic is a python library that converts JSON data into Python objects.
# It also serializes Pydantic models back into JSON.
# Famous in FastAPI development to ensure user input is clean. 

from pydantic import BaseModel, Field
# BaseModel is the core Pydantic class that lets you define structured data models with validation. 
# It has automatic validation. If someone inputs, age = "abc", the request will instantly be rejected.
# It automatically converts input types to the right Python types where possible. 

# The datetime module provides classes for working with dates and times. 
# We can use methods like datetime.now() to get the current date and time.
from datetime import datetime

"""
what are decorators?
"""

# decorators are a design pattern and language feature that allows a user to modify or extend the behavior of a function.
# decorators don't change the source code. they are functions that take another function as argument.
# it adds some functionality and returns a new function with extended behavior.

""""
let's get into the code
"""

# this class is how each node is defined. it contains methods. 
# methods can be class methods, static methods, or instance methods.
# instance methods are the most common. they require an instance of the class to be created. 
# by default, instance methods take Self as their first argument. 
# there are also class methods, which are defined using the @classmethod decorator.
# they can only access class attributes, not instance attributes. 
# they are commonly used to provide alternative constructors or factory methods.
# finally, static methods are general utility functions that are logically related to the class.
# static methods are defined using the @staticmethod decorator.
# they behave like normal functions, but are kept within the class for organizational purposes.

class Concept (BaseModel):

    # these are required fields.
    node_id: str 
    name: str 
    domain: str
    type: str 

    # these are optional fields. 
    # want to make a change to what is required and optional for node fields? here is the place.
    description: Optional[str] = None 
    tags: Optional[List[str]] = None 
    notes_key: Optional[str] = None
    node_key: Optional[str] = None  
    url_slug: Optional[str] = None
    
    # Create a list of lecture sources.
    lecture_sources: List[str] = []  
    created_by: Optional[str] = None  
    last_updated_by: Optional[str] = None
    # Ingestion run tracking
    created_by_run_id: Optional[str] = None  # ingestion_run_id for new concepts
    last_updated_by_run_id: Optional[str] = None  # ingestion_run_id for updates
    # Aliases for concept matching (Phase 2)
    aliases: List[str] = []  # Alternative names for this concept  

class ConceptCreate(BaseModel):
    name: str
    domain: str
    type: str = "concept"
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    notes_key: Optional[str] = None
    lecture_key: Optional[str] = None  # Deprecated: kept for backward compatibility
    url_slug: Optional[str] = None
    
    # Multi-source tracking fields
    lecture_sources: Optional[List[str]] = None
    created_by: Optional[str] = None
    last_updated_by: Optional[str] = None
    # Ingestion run tracking
    created_by_run_id: Optional[str] = None  # ingestion_run_id for new concepts
    last_updated_by_run_id: Optional[str] = None  # ingestion_run_id for updates


class ConceptUpdate(BaseModel):
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    domain: Optional[str] = None
    type: Optional[str] = None
    aliases: Optional[List[str]] = None  # Phase 2: Support updating aliases


class RelationshipCreate(BaseModel):
    source_name: str
    predicate: str
    target_name: str

"""

THIS IS THE MAIN API ENDPOINT.

from here on out, we will be defining models for different api endpoints. 
the first use case is lecture ingestion.
we assume that people will be doing educational exploration through this system.
as such, there needs to be a structured way to represent lectures.
where do lectures come from? what are their names? how difficult are they to learn? what are the primary concepts?
"""

"""
the lecture class defines how lectures are structured.
lectures have id's, titles, descriptions, primary concepts, levels, estimated times, and slugs.
"""

class Lecture(BaseModel):
    lecture_id: str
    title: str
    description: Optional[str] = None
    primary_concept: Optional[str] = None  # node_id or name later if you want
    level: Optional[str] = None            # e.g. "beginner", "intermediate"
    estimated_time: Optional[int] = None   # minutes
    slug: Optional[str] = None

"""
the lecture create class defines how lectures are created.
to create a lecture, you need to provide a title, description, primary concept, level, estimated time, and slug.
"""

class LectureCreate(BaseModel):
    title: str
    description: Optional[str] = None
    primary_concept: Optional[str] = None
    level: Optional[str] = None
    estimated_time: Optional[int] = None
    slug: Optional[str] = None

"""
the lecture step create class defines how lecture steps are created.
do the steps need have order? yes, they do.
"""

class LectureStepCreate(BaseModel):
    concept_id: str   # Concept.node_id
    step_order: int   # order within the lecture

"""
how are lecture steps actually defined?
they are designed by the lecture step class. 
"""

class LectureStep(BaseModel):
    lecture_id: str
    step_order: int
    node: node

"""
we have seperate payload shapes for different parts of the ingestion flow.
a payload shape defines the structure for data being sent 
extracted nodes are one concept found in a lecture by the LLM.
"""

class ExtractedNode(BaseModel):
    name: str
    description: Optional[str] = None
    domain: Optional[str] = None
    type: Optional[str] = "concept"
    examples: List[str] = []
    tags: List[str] = []

"""
extract links are one relationship found in a lecture by the LLM.
"""

class ExtractedLink(BaseModel):
    source_name: str
    target_name: str
    predicate: str
    explanation: Optional[str] = None
    confidence: float = 0.8

"""
combined result from the llm for a single lecture
has the title as well as the lists of extracted nodes and links.
"""

class LectureExtraction(BaseModel):
    lecture_title: str
    nodes: List[ExtractedNode]
    links: List[ExtractedLink]

"""
this request is what the API recieves from the client. 
this is the raw lecture title/text. 
it is the request body used by the lecture ingestion endpoint.
when a client calls that route, fastAPI validates the JSON against this model and hands it to ingest_lecture.
in api_lectures.py, there is an ingest_lecture_endpoint. 
this endpoint takes in lectureIngestRequest as a parameter. 
this runs the LLM extraction flow and returns a LectureIngestResult. 

"""

class LectureIngestRequest(BaseModel):
    lecture_title: str
    lecture_text: str
    domain: Optional[str] = None

"""
analogies are one relationships found in a lecture by the LLM.
they are a part of a lecture segment. 
see LECTURE_SEGMENTATION_PROMPT in prompts.py for more information.
the model is instructed to break the lectures into segments
for each segment, it includes an analogies array with label and description. 
"""

class Analogy(BaseModel):
    analogy_id: str # "analogy_123"
    label: str # "dj reading the crowd"
    description: Optional[str] = None  # longer explanation of analogy
    tags: Optional[List[str]] = None   # e.g. machine-learning

"""
lecture segments contain the text, the concepts covered, and the analogies used. 
"""

class LectureSegment(BaseModel):
    """A segment within a lecture, with concept + analogy links."""
    segment_id: str
    lecture_id: str
    segment_index: int                       # 0-based or 1-based order
    start_time_sec: Optional[float] = None   # optional, for audio/video later
    end_time_sec: Optional[float] = None
    text: str
    summary: Optional[str] = None
    style_tags: Optional[List[str]] = None   # e.g. ["analogy-heavy", "story"]
    covered_concepts: List[Concept] = []     # resolved concept objects
    analogies: List[Analogy] = []            # analogies used in this segment
    lecture_title: Optional[str] = None      # Title of the lecture this segment belongs to


class LectureIngestResult(BaseModel):
    """Response from lecture ingestion endpoint"""
    lecture_id: str
    nodes_created: List[Concept]
    nodes_updated: List[Concept]
    links_created: List[dict]  # List of {source_id, target_id, predicate}
    segments: List[LectureSegment] = []  # NEW: segmented, annotated version of the lecture
    run_id: Optional[str] = None  # ingestion_run_id for this ingestion
    # Enrichment fields for tracking created/updated IDs
    created_concept_ids: List[str] = []
    updated_concept_ids: List[str] = []
    created_relationship_count: int = 0
    created_claim_ids: List[str] = []


# ---------- Basic AI Chat Models ----------

class AIChatRequest(BaseModel):
    message: str


class AIChatResponse(BaseModel):
    reply: str
    # later: operations: List[dict]


class SemanticSearchRequest(BaseModel):
    message: str
    limit: int = 5


class SemanticSearchResponse(BaseModel):
    nodes: List[Concept]
    scores: List[float]


class SemanticSearchCommunitiesRequest(BaseModel):
    message: str
    limit: int = 5
    graph_id: str
    branch_id: str


class CommunitySearchResult(BaseModel):
    community_id: str
    name: str
    score: float
    summary: Optional[str] = None


class SemanticSearchCommunitiesResponse(BaseModel):
    communities: List[CommunitySearchResult]


class GraphRAGContextRequest(BaseModel):
    message: str
    graph_id: str
    branch_id: str
    vertical: Optional[str] = "general"  # "general" | "finance"
    lens: Optional[str] = None  # For finance: "fundamentals" | "catalysts" | "competition" | "risks" | "narrative"
    recency_days: Optional[int] = None
    evidence_strictness: Optional[str] = "medium"  # "high" | "medium" | "low"
    include_proposed_edges: Optional[bool] = True


class GraphRAGContextResponse(BaseModel):
    context_text: str
    debug: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None  # Vertical-specific metadata


# ---------- Intent-Based Retrieval Models ----------

from enum import Enum

class Intent(str, Enum):
    """Intent types for deterministic retrieval plans."""
    DEFINITION_OVERVIEW = "DEFINITION_OVERVIEW"
    TIMELINE = "TIMELINE"
    CAUSAL_CHAIN = "CAUSAL_CHAIN"
    COMPARE = "COMPARE"
    WHO_NETWORK = "WHO_NETWORK"
    EVIDENCE_CHECK = "EVIDENCE_CHECK"
    EXPLORE_NEXT = "EXPLORE_NEXT"
    WHAT_CHANGED = "WHAT_CHANGED"


class RetrievalTraceStep(BaseModel):
    """A single step in the retrieval plan execution."""
    step: str
    params: Dict[str, Any] = {}
    counts: Dict[str, Any] = {}


class RetrievalResult(BaseModel):
    """Complete retrieval result with intent, trace, and context."""
    intent: str
    trace: List[RetrievalTraceStep]
    context: Dict[str, Any]  # Structured payload with focus_entities, claims, chunks, etc.
    plan_version: str = "intent_plans_v1"


class IntentResult(BaseModel):
    """Result from intent router."""
    intent: str
    confidence: float
    reasoning: str  # Short explanation of why this intent was chosen


class RetrievalRequest(BaseModel):
    """Request for intent-based retrieval."""
    message: str
    mode: str = "graphrag"
    limit: int = 5
    intent: Optional[str] = None  # If provided, skip router and use this intent
    graph_id: Optional[str] = None
    branch_id: Optional[str] = None
    detail_level: str = "summary"  # "summary" or "full"
    limit_claims: Optional[int] = None  # Override default caps
    limit_entities: Optional[int] = None
    limit_sources: Optional[int] = None
    trail_id: Optional[str] = None  # Phase A: Trail session state
    focus_concept_id: Optional[str] = None  # Phase A: Focus context
    focus_quote_id: Optional[str] = None  # Phase A: Focus context
    focus_page_url: Optional[str] = None  # Phase A: Focus context


# ---------- Personalization Models ----------

class ResponseStyleProfile(BaseModel):
    """
    Style profile that tells the LLM how to sound and structure explanations.
    This enables Brain Web to answer in a consistent "voice" without fine-tuning.
    """
    tone: str
    teaching_style: str
    sentence_structure: str
    explanation_order: List[str]
    forbidden_styles: List[str]


class ResponseStyleProfileWrapper(BaseModel):
    """Wrapper used by API endpoints for response style profile."""
    id: str = "default"
    profile: ResponseStyleProfile


class ExplanationFeedback(BaseModel):
    """
    Feedback on a specific answer returned by Brain Web.
    Used to improve future responses through feedback loops.
    """
    answer_id: str
    question: str
    rating: int  # +1 or -1
    reasoning: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class FeedbackSummary(BaseModel):
    """
    Summarized feedback used when building prompts.
    Aggregates recent feedback to guide future responses.
    """
    total: int
    positive: int
    negative: int
    common_reasons: Dict[str, int]


class FocusArea(BaseModel):
    """
    Represents a current focus area (e.g., Distributed Systems, CUDA, Web Foundations).
    Active focus areas bias answers toward these themes.
    """
    id: str
    name: str
    description: Optional[str] = None
    active: bool = True


class UserProfile(BaseModel):
    """
    Long-term personal preferences encoding background, interests, weak spots, and learning preferences.
    Used to personalize explanations and avoid re-explaining fundamentals.
    """
    id: str = "default"
    name: str
    background: List[str] = []
    interests: List[str] = []
    weak_spots: List[str] = []
    learning_preferences: Dict[str, Any] = {}


class ReminderPreferences(BaseModel):
    """Preferences for reminder notifications."""
    weekly_digest: Dict[str, Any] = {
        "enabled": False,
        "day_of_week": 1,  # 1-7 (Monday=1, Sunday=7)
        "hour": 9  # 0-23
    }
    review_queue: Dict[str, Any] = {
        "enabled": False,
        "cadence_days": 3
    }
    finance_stale: Dict[str, Any] = {
        "enabled": False,
        "cadence_days": 7
    }


class UIPreferences(BaseModel):
    """
    UI preferences for lens system and other UI customizations.
    """
    active_lens: str = "NONE"  # "NONE" | "LEARNING" | "FINANCE"
    reminders: ReminderPreferences = Field(default_factory=ReminderPreferences)


class NotionConfig(BaseModel):
    """
    Configuration for Notion integration.
    """
    database_ids: List[str] = []
    enable_auto_sync: bool = False


# ---------- Answer and Revision Models ----------

class AnswerRecord(BaseModel):
    """
    Stores a Brain Web answer for tracking and feedback.
    """
    answer_id: str
    question: str
    raw_answer: str
    used_node_ids: List[str] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Revision(BaseModel):
    """
    A user-rewritten answer stored as a revision of an AnswerRecord.
    Used as style examples for future answers.
    """
    answer_id: str
    user_rewritten_answer: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AnswerRevisionRequest(BaseModel):
    """Request to store a user-rewritten answer"""
    answer_id: str
    user_rewritten_answer: str


class StyleFeedbackRequest(BaseModel):
    """
    Structured feedback for style learning.
    Matches the format: "Test1: [response] Test1 Feedback: [notes]"
    """
    answer_id: str
    question: str
    original_response: str  # Exact original response
    feedback_notes: str  # User's feedback/notes about what could be different
    user_rewritten_version: Optional[str] = None  # User's version if they rewrote it
    test_label: Optional[str] = None  # Optional label like "Test1", "Test2", etc.
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ---------- Teaching Style Profile Models ----------

class TeachingStyleProfile(BaseModel):
    """Canonical representation of the user's teaching / writing style."""
    id: str = "default"  # for now, a single profile
    tone: str
    teaching_style: str
    sentence_structure: str
    explanation_order: List[str]
    forbidden_styles: List[str]


class TeachingStyleUpdateRequest(BaseModel):
    """Partial update / manual override for teaching style."""
    tone: Optional[str] = None
    teaching_style: Optional[str] = None
    sentence_structure: Optional[str] = None
    explanation_order: Optional[List[str]] = None
    forbidden_styles: Optional[List[str]] = None


# ---------- Resource Models ----------

class Resource(BaseModel):
    """A resource (image, PDF, link, etc.) attached to a concept"""
    resource_id: str
    kind: str  # 'image', 'pdf', 'audio', 'web_link', 'notion_block', 'generated_image', 'file'
    url: str
    title: Optional[str] = None
    mime_type: Optional[str] = None
    caption: Optional[str] = None
    source: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None  # NEW
    created_at: Optional[str] = None  # ISO format timestamp
    ingestion_run_id: Optional[str] = None  # ingestion_run_id for resources created during ingestion


class ResourceCreate(BaseModel):
    """Request to create a resource"""
    kind: str
    url: str
    title: Optional[str] = None
    mime_type: Optional[str] = None
    caption: Optional[str] = None
    source: Optional[str] = "upload"
    metadata: Optional[Dict[str, Any]] = None  # NEW
    ingestion_run_id: Optional[str] = None  # ingestion_run_id for resources created during ingestion


# ---------- Artifact Models ----------

class Artifact(BaseModel):
    """Represents an ingested artifact (webpage, document, etc.)"""
    artifact_id: str
    graph_id: str
    branch_id: str
    artifact_type: Literal["webpage"]
    url: str
    title: Optional[str] = None
    domain: Optional[str] = None
    captured_at: int  # Unix timestamp in milliseconds
    content_hash: str
    text: str  # Full text content
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_by_run_id: Optional[str] = None


class WebpageIngestRequest(BaseModel):
    """Request to ingest a webpage"""
    url: str
    graph_id: str
    branch_id: str
    title: Optional[str] = None
    domain: Optional[str] = None
    text: str
    metadata: Optional[Dict[str, Any]] = None
    extract_claims: bool = False  # Optional: extract claims for evidence system


class WebpageIngestResponse(BaseModel):
    """Response from webpage ingestion endpoint"""
    artifact_id: str
    reused_existing: bool
    run_id: Optional[str] = None
    counts: Dict[str, int] = Field(default_factory=dict)  # {concepts_created, concepts_updated, edges_created, claims_created, chunks_created}


class ArtifactGraphPreview(BaseModel):
    """Graph preview node for artifact"""
    id: str
    type: str = "artifact"
    url: str
    title: Optional[str] = None
    domain: Optional[str] = None


class ConceptGraphPreview(BaseModel):
    """Graph preview node for concept"""
    id: str
    type: str = "concept"
    name: str
    domain: Optional[str] = None
    description: Optional[str] = None


class GraphEdgePreview(BaseModel):
    """Graph preview edge"""
    source: str
    target: str
    type: str
    status: Optional[str] = None


class ArtifactViewResponse(BaseModel):
    """Response for artifact view with graph preview"""
    artifact: Dict[str, Any]  # artifact fields
    concepts: List[ConceptGraphPreview]  # top linked concepts
    nodes: List[Dict[str, Any]]  # artifact + concepts for graph
    edges: List[GraphEdgePreview]  # MENTIONS + concept-to-concept edges


# ---------- Branch Explorer (Graphs / Branches / Snapshots) ----------


class GraphSummary(BaseModel):
    graph_id: str
    name: Optional[str] = None
    description: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    node_count: int = 0
    edge_count: int = 0
    template_id: Optional[str] = None
    template_label: Optional[str] = None
    template_description: Optional[str] = None
    template_tags: Optional[List[str]] = None
    intent: Optional[str] = None


class GraphCreateRequest(BaseModel):
    name: str
    template_id: Optional[str] = None
    template_label: Optional[str] = None
    template_description: Optional[str] = None
    template_tags: Optional[List[str]] = None
    intent: Optional[str] = None


class GraphRenameRequest(BaseModel):
    name: str


class GraphListResponse(BaseModel):
    graphs: List[GraphSummary]
    active_graph_id: str
    active_branch_id: str


class GraphSelectResponse(BaseModel):
    active_graph_id: str
    active_branch_id: str
    graph: Dict[str, Any]


class BranchSummary(BaseModel):
    branch_id: str
    graph_id: str
    name: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    source_node_id: Optional[str] = None


class BranchCreateRequest(BaseModel):
    name: str


class BranchForkRequest(BaseModel):
    depth: int = 2


class BranchCompareResponse(BaseModel):
    graph_id: str
    branch_id: str
    other_branch_id: str
    node_ids_only_in_branch: List[str] = []
    node_ids_only_in_other: List[str] = []
    links_only_in_branch: List[Dict[str, Any]] = []
    links_only_in_other: List[Dict[str, Any]] = []


class BranchLLMCompareRequest(BaseModel):
    branch_id: str
    other_branch_id: str
    question: Optional[str] = None


class BranchLLMCompareResponse(BaseModel):
    similarities: List[str] = []
    differences: List[str] = []
    contradictions: List[str] = []
    missing_steps: List[str] = []
    recommendations: List[str] = []


class SnapshotCreateRequest(BaseModel):
    name: str
    focused_node_id: Optional[str] = None
    layout: Optional[Dict[str, Any]] = None  # optional node positions etc.


class SnapshotSummary(BaseModel):
    snapshot_id: str
    graph_id: str
    branch_id: str
    name: str


# ---------- Ingestion Run Models ----------

class IngestionRun(BaseModel):
    """Represents a single ingestion run that tags all created/updated objects."""
    run_id: str  # UUID
    graph_id: str
    source_type: str  # "LECTURE" | "NOTION" | "FINANCE" | "UPLOAD" | "URL"
    source_label: Optional[str] = None  # e.g., lecture title, Notion page title, ticker
    status: str  # "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED"
    started_at: str  # ISO timestamp
    completed_at: Optional[str] = None  # ISO timestamp
    summary_counts: Optional[Dict[str, int]] = None  # {concepts_created, concepts_updated, resources_created, relationships_proposed}
    error_count: Optional[int] = None
    errors: Optional[List[str]] = None  # List of error messages
    undone_at: Optional[str] = None  # ISO timestamp when run was undone
    undo_mode: Optional[str] = None  # "SAFE" | "RELATIONSHIPS_ONLY"
    undo_summary: Optional[Dict[str, Any]] = None  # Archive counts and skipped items
    restored_at: Optional[str] = None  # ISO timestamp when run was restored


class IngestionRunCreate(BaseModel):
    """Request to create a new ingestion run."""
    source_type: str
    source_label: Optional[str] = None
    created_at: str
    focused_node_id: Optional[str] = None


class SnapshotListResponse(BaseModel):
    snapshots: List[SnapshotSummary]


class SnapshotRestoreResponse(BaseModel):
    status: str
    restored_branch_id: Optional[str] = None
    graph_id: str
    snapshot_id: str


# ---------- Relationship Review Models ----------

class RelationshipEdge(BaseModel):
    """Edge specification for relationship review operations."""
    src_node_id: str
    dst_node_id: str
    rel_type: str


class RelationshipReviewItem(BaseModel):
    """A single relationship item in the review queue."""
    src_node_id: str
    src_name: str
    dst_node_id: str
    dst_name: str
    rel_type: str
    confidence: float
    method: str
    rationale: Optional[str] = None
    source_id: Optional[str] = None
    chunk_id: Optional[str] = None
    claim_id: Optional[str] = None
    model_version: Optional[str] = None
    created_at: Optional[int] = None
    updated_at: Optional[int] = None
    reviewed_at: Optional[int] = None
    reviewed_by: Optional[str] = None


class RelationshipReviewListResponse(BaseModel):
    """Response for listing relationships for review."""
    relationships: List[RelationshipReviewItem]
    total: int
    graph_id: str
    status: str


class RelationshipAcceptRequest(BaseModel):
    """Request to accept relationships."""
    graph_id: Optional[str] = None  # If not provided, uses active graph context
    edges: List[RelationshipEdge]
    reviewed_by: Optional[str] = None


class RelationshipRejectRequest(BaseModel):
    """Request to reject relationships."""
    graph_id: Optional[str] = None  # If not provided, uses active graph context
    edges: List[RelationshipEdge]
    reviewed_by: Optional[str] = None


class RelationshipEditRequest(BaseModel):
    """Request to edit a relationship."""
    graph_id: Optional[str] = None  # If not provided, uses active graph context
    src_node_id: str
    dst_node_id: str
    old_rel_type: str
    new_rel_type: str
    reviewed_by: Optional[str] = None


class RelationshipReviewActionResponse(BaseModel):
    """Response for accept/reject/edit actions."""
    status: str
    action: str
    count: int
    graph_id: str


# ---------- Entity Merge Review Models ----------

class MergeCandidateItem(BaseModel):
    """A single merge candidate in the review queue."""
    candidate_id: str
    score: float
    method: str
    rationale: str
    status: str
    created_at: Optional[int] = None
    updated_at: Optional[int] = None
    reviewed_at: Optional[int] = None
    reviewed_by: Optional[str] = None
    src_concept: Dict[str, Any]
    dst_concept: Dict[str, Any]


class MergeCandidateListResponse(BaseModel):
    """Response for listing merge candidates."""
    candidates: List[MergeCandidateItem]
    total: int
    graph_id: str
    status: str


class MergeCandidateAcceptRequest(BaseModel):
    """Request to accept merge candidates."""
    graph_id: str
    candidate_ids: List[str]
    reviewed_by: Optional[str] = None


class MergeCandidateRejectRequest(BaseModel):
    """Request to reject merge candidates."""
    graph_id: str
    candidate_ids: List[str]
    reviewed_by: Optional[str] = None


class MergeExecuteRequest(BaseModel):
    """Request to execute a merge."""
    graph_id: str
    keep_node_id: str
    merge_node_id: str
    reviewed_by: Optional[str] = None


class MergeExecuteResponse(BaseModel):
    """Response for merge execution."""
    status: str
    keep_node_id: str
    merge_node_id: str
    relationships_redirected: int
    relationships_skipped: int
    relationships_deleted: int
    graph_id: str
