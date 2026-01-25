/**
 * Common type definitions for the Brain Web API client
 */

export interface Concept {
    node_id: string;
    name: string;
    domain: string;
    type: string;
    description?: string | null;
    tags?: string[] | null;
    notes_key?: string | null;
    lecture_key?: string | null; // Deprecated: kept for backward compatibility
    url_slug?: string | null;

    // Multi-source tracking fields
    lecture_sources?: string[] | null;
    created_by?: string | null;
    last_updated_by?: string | null;
}

export type ConceptNote = {
    id: string;
    chat_id: string;
    section_id: string;
    section_title: string;
    summary_text: string;
    source_type: string;
    confidence_level: number | null;
    created_at: string;
    related_node_ids: string[];
};

export interface Relationship {
    source_id: string;
    predicate: string;
    target_id: string;
}

export interface GraphData {
    nodes: Concept[];
    links: Array<{
        source: string;
        target: string;
        predicate: string;
        relationship_status?: string;
        relationship_confidence?: number;
        relationship_method?: string;
        rationale?: string;
        relationship_source_id?: string;
        relationship_chunk_id?: string;
    }>;
}

export interface GraphSummary {
    graph_id: string;
    name?: string | null;
    description?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
    node_count?: number;
    edge_count?: number;
    template_id?: string | null;
    template_label?: string | null;
    template_description?: string | null;
    template_tags?: string[] | null;
    intent?: string | null;
}

export interface GraphListResponse {
    graphs: GraphSummary[];
    active_graph_id: string;
    active_branch_id: string;
}

export interface GraphSelectResponse {
    active_graph_id: string;
    active_branch_id: string;
    graph: any;
}

export interface CreateGraphOptions {
    template_id?: string;
    template_label?: string;
    template_description?: string;
    template_tags?: string[];
    intent?: string;
}

export interface BranchSummary {
    branch_id: string;
    graph_id: string;
    name?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
    source_node_id?: string | null;
}

export interface BranchListResponse {
    graph_id: string;
    active_branch_id: string;
    branches: BranchSummary[];
}

export interface BranchCompareResponse {
    graph_id: string;
    branch_id: string;
    other_branch_id: string;
    node_ids_only_in_branch: string[];
    node_ids_only_in_other: string[];
    links_only_in_branch: Array<{ source_id: string; predicate: string; target_id: string }>;
    links_only_in_other: Array<{ source_id: string; predicate: string; target_id: string }>;
}

export interface BranchLLMCompareResponse {
    similarities: string[];
    differences: string[];
    contradictions: string[];
    missing_steps: string[];
    recommendations: string[];
}

export interface SnapshotSummary {
    snapshot_id: string;
    graph_id: string;
    branch_id: string;
    name: string;
    created_at: string;
    focused_node_id?: string | null;
}

/**
 * Resource type
 */
export interface Resource {
    resource_id: string;
    kind?: 'image' | 'pdf' | 'audio' | 'web_link' | 'notion_block' | 'generated_image' | 'file' | string;
    url: string;
    title?: string | null;
    mime_type?: string | null;
    caption?: string | null;
    source?: string | null;
    content?: string;
    metadata?: Record<string, any> | null;
    created_at?: string | null; // ISO format timestamp
}

export interface GraphConceptItem {
    concept_id: string;
    name: string;
    domain: string;
    type: string;
    degree?: number;
}

export interface GraphConceptsResponse {
    items: GraphConceptItem[];
    total: number;
}

/**
 * Claim type
 */
export interface Claim {
    claim_id: string;
    text: string;
    confidence: number;
    source_id?: string | null;
    source_span?: string | null;
    method?: string | null;
    chunk_id?: string | null;
    source_type?: string | null;
    source_url?: string | null;
    doc_type?: string | null;
    company_ticker?: string | null;
}

/**
 * Source type
 */
export interface Source {
    doc_id: string;
    source_type: string;
    external_id?: string | null;
    url?: string | null;
    doc_type?: string | null;
    company_ticker?: string | null;
    published_at?: number | null;
    metadata?: any;
    chunks?: Array<{
        chunk_id: string;
        chunk_index: number;
        text_preview: string;
    }>;
    claim_count: number;
}

/**
 * Analogy type
 */
export interface Analogy {
    analogy_id: string;
    label: string;
    description?: string | null;
    tags?: string[] | null;
}

/**
 * Lecture Segment type
 */
export interface LectureSegment {
    segment_id: string;
    lecture_id: string;
    segment_index: number;
    start_time_sec?: number | null;
    end_time_sec?: number | null;
    text: string;
    summary?: string | null;
    style_tags?: string[] | null;
    covered_concepts: Concept[];
    analogies: Analogy[];
    lecture_title?: string | null;  // Title of the lecture this segment belongs to
}

export interface LectureBlock {
    block_id: string;
    lecture_id: string;
    block_index: number;
    block_type: string;
    text: string;
}

export interface LectureBlockUpsert {
    block_id?: string | null;
    block_index: number;
    block_type: string;
    text: string;
}

export interface LectureMention {
    mention_id: string;
    lecture_id: string;
    block_id: string;
    start_offset: number;
    end_offset: number;
    surface_text: string;
    context_note?: string | null;
    sense_label?: string | null;
    lecture_title?: string | null;
    block_text?: string | null;
    concept: Concept;
}

export interface LectureMentionCreate {
    lecture_id: string;
    block_id: string;
    start_offset: number;
    end_offset: number;
    surface_text: string;
    concept_id: string;
    context_note?: string | null;
    sense_label?: string | null;
}

export interface LectureMentionUpdate {
    concept_id?: string | null;
    start_offset?: number | null;
    end_offset?: number | null;
    surface_text?: string | null;
    context_note?: string | null;
    sense_label?: string | null;
}

export interface LectureIngestResult {
    lecture_id: string;
    nodes_created: Concept[];
    nodes_updated: Concept[];
    links_created: Array<{
        source_id: string;
        target_id: string;
        predicate: string;
    }>;
    segments: LectureSegment[];
    created_concept_ids?: string[];
    updated_concept_ids?: string[];
    created_relationship_count?: number;
    created_claim_ids?: string[];
}

export type LectureLinkSourceType = 'main_chat_event' | 'branch' | 'bridging_hint' | 'notes_entry';
export type LectureLinkMethod = 'keyword' | 'embedding' | 'hybrid';

export interface LectureLink {
    id: string;
    chat_id: string;
    source_type: LectureLinkSourceType;
    source_id: string;
    lecture_document_id: string;
    lecture_section_id: string;
    start_offset: number;
    end_offset: number;
    confidence_score: number;
    method: LectureLinkMethod;
    justification_text: string;
    created_at?: string | null;
}

export interface LectureLinkResolveRequest {
    chat_id: string;
    source_type: LectureLinkSourceType;
    source_id: string;
    lecture_document_ids?: string[] | null;
    top_n?: number | null;
}

export interface LectureLinkResolveResponse {
    links: LectureLink[];
    weak: boolean;
}

export interface LectureSection {
    id: string;
    lecture_document_id: string;
    section_index: number;
    title?: string | null;
    raw_text: string;
    source_uri?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
}

export interface Lecture {
    segment_count?: number;  // Number of segments (for performance, included in list responses)
    lecture_id: string;
    title: string;
    description?: string | null;
    primary_concept?: string | null;
    level?: string | null;
    estimated_time?: number | null;
    slug?: string | null;
    raw_text?: string | null;
    metadata_json?: string | null;
}

/**
 * Notion integration types
 */
export interface NotionPageSummary {
    id: string;
    title: string;
    url?: string;
}

export interface NotionDatabaseSummary {
    id: string;
    title: string;
    url?: string;
}

export interface NotionSummaryResponse {
    pages: NotionPageSummary[];
    databases: NotionDatabaseSummary[];
}

export interface NotionIngestProgressEvent {
    type: 'start' | 'progress' | 'complete' | 'error';
    total?: number;
    processed?: number;
    current_page?: string;
    success?: boolean;
    message?: string;
    succeeded?: number;
    failed?: number;
    results?: LectureIngestResult[];
    summary?: {
        nodes: number;
        links: number;
        segments: number;
    };
    errors?: string[];
}

export interface ResponseStyleProfile {
    tone: string;
    teaching_style: string;
    sentence_structure: string;
    explanation_order: string[];
    forbidden_styles: string[];
}

export interface ResponseStyleProfileWrapper {
    id: string;
    profile: ResponseStyleProfile;
}

export interface StudyTimeData {
    domain: string;
    hours: number;
    minutes: number;
    total_ms: number;
}

export interface ExamData {
    exam_id: string;
    title: string;
    date: string;
    days_until: number;
    required_concepts: string[];
    domain?: string;
}

export interface StudyRecommendation {
    concept_id: string;
    concept_name: string;
    priority: 'high' | 'medium' | 'low';
    reason: string;
    suggested_documents: Array<{
        document_id: string;
        title: string;
        section: string;
        url: string;
    }>;
    estimated_time_min: number;
}

export interface ResumePoint {
    document_id: string;
    document_title: string;
    block_id?: string;
    segment_id?: string;
    concept_id?: string;
    last_accessed: string;
    document_type: string;
    url: string;
}

export interface DashboardData {
    study_time_by_domain: StudyTimeData[];
    upcoming_exams: ExamData[];
    study_recommendations: StudyRecommendation[];
    resume_points: ResumePoint[];
    total_study_hours: number;
    days_looked_back: number;
}

export interface FocusArea {
    id: string;
    name: string;
    description?: string | null;
    active: boolean;
}

export interface UserProfile {
    id: string;
    name: string;
    background: string[];
    interests: string[];
    weak_spots: string[];
    learning_preferences: Record<string, any>;
}

export interface ReminderPreferences {
    weekly_digest: {
        enabled: boolean;
        day_of_week: number;
        hour?: number;
    };
    review_queue: {
        enabled: boolean;
        cadence_days: number;
    };
    finance_stale: {
        enabled: boolean;
        cadence_days: number;
    };
}

export interface UIPreferences {
    active_lens: 'NONE' | 'LEARNING' | 'FINANCE';
    reminders?: ReminderPreferences;
}

export interface NotionConfig {
    database_ids: string[];
    enable_auto_sync: boolean;
}

export interface PDFIngestResponse {
    status: 'COMPLETED' | 'PARTIAL' | 'FAILED';
    artifact_id?: string | null;
    run_id?: string | null;
    concepts_created: number;
    concepts_updated: number;
    links_created: number;
    chunks_created: number;
    claims_created: number;
    page_count: number;
    extraction_method?: string | null;
    warnings: string[];
    errors: string[];
}

export interface FinanceTrackingConfig {
    ticker: string;
    enabled: boolean;
    cadence: 'daily' | 'weekly' | 'monthly';
}

export interface LatestSnapshotMetadata {
    ticker: string;
    resource_id?: string;
    snapshot_fetched_at?: string;
    market_as_of?: string;
    company_name?: string;
}

export interface TeachingStyleProfile {
    id: string;
    tone: string;
    teaching_style: string;
    sentence_structure: string;
    explanation_order: string[];
    forbidden_styles: string[];
}

export interface GapsOverview {
    missing_descriptions: Array<{
        node_id: string;
        name: string;
        domain: string;
    }>;
    low_connectivity: Array<{
        node_id: string;
        name: string;
        degree: number;
        domain: string;
    }>;
    high_interest_low_coverage: Array<{
        node_id: string;
        name: string;
        question_count: number;
        lecture_count: number;
        domain: string;
    }>;
}

export type SuggestionType = 'GAP_DEFINE' | 'GAP_EVIDENCE' | 'REVIEW_RELATIONSHIPS' | 'STALE_EVIDENCE' | 'RECENT_LOW_COVERAGE' | 'COVERAGE_LOW' | 'EVIDENCE_STALE' | 'GRAPH_HEALTH_ISSUE' | 'REVIEW_BACKLOG';

export type SuggestionActionKind = 'OPEN_CONCEPT' | 'OPEN_REVIEW' | 'FETCH_EVIDENCE' | 'OPEN_GAPS' | 'OPEN_DIGEST';

export type SuggestionSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface SuggestionAction {
    label?: string;
    kind: SuggestionActionKind;
    href?: string;
    payload?: any;
}

export interface Suggestion {
    id: string;
    type: SuggestionType;
    title: string;
    rationale: string;
    priority: number;
    concept_id?: string;
    concept_name?: string;
    resource_id?: string;
    graph_id?: string;
    kind?: string;
    explanation?: string;
    severity?: SuggestionSeverity;
    primary_action?: SuggestionAction;
    secondary_action?: SuggestionAction;
    action: SuggestionAction;
}

export interface RelationshipReviewItem {
    src_node_id: string;
    src_name: string;
    dst_node_id: string;
    dst_name: string;
    rel_type: string;
    confidence: number;
    method: string;
    rationale?: string | null;
    source_id?: string | null;
    chunk_id?: string | null;
    claim_id?: string | null;
    model_version?: string | null;
    created_at?: number | null;
    updated_at?: number | null;
    reviewed_at?: number | null;
    reviewed_by?: string | null;
}

export interface RelationshipReviewListResponse {
    relationships: RelationshipReviewItem[];
    total: number;
    graph_id: string;
    status: string;
}

export interface RelationshipReviewActionResponse {
    status: string;
    action: string;
    count: number;
    graph_id: string;
}

export interface IngestionRun {
    run_id: string;
    graph_id: string;
    source_type: string;
    source_label?: string | null;
    status: string;
    started_at: string;
    completed_at?: string | null;
    summary_counts?: {
        concepts_created?: number;
        concepts_updated?: number;
        resources_created?: number;
        relationships_proposed?: number;
    } | null;
    error_count?: number | null;
    errors?: string[] | null;
    undone_at?: string | null;
    undo_mode?: string | null;
    undo_summary?: {
        archived?: {
            relationships?: number;
            concepts?: number;
            resources?: number;
        };
        skipped?: {
            concepts?: Array<{ concept_id: string; reason: string }>;
            resources?: Array<{ resource_id: string; reason: string }>;
            relationships?: Array<{ relationship_id: string; reason: string }>;
        };
    } | null;
    restored_at?: string | null;
}

export interface IngestionRunChanges {
    run: IngestionRun;
    concepts_created: Array<{
        concept_id: string;
        name: string;
        domain: string;
        type: string;
    }>;
    concepts_updated: Array<{
        concept_id: string;
        name: string;
        domain: string;
        type: string;
    }>;
    resources_created: Array<{
        resource_id: string;
        title: string;
        source_type: string;
        concept_id?: string | null;
    }>;
    relationships_proposed: Array<{
        relationship_id: string;
        from_concept_id: string;
        to_concept_id: string;
        predicate: string;
        status: string;
    }>;
}

export interface UndoRunResponse {
    run_id: string;
    archived: {
        relationships: number;
        concepts: number;
        resources: number;
    };
    skipped: {
        concepts: Array<{ concept_id: string; reason: string }>;
        resources: Array<{ resource_id: string; reason: string }>;
        relationships: Array<{ relationship_id: string; reason: string }>;
    };
}

export interface RestoreRunResponse {
    run_id: string;
    restored: {
        relationships: number;
        concepts: number;
        resources: number;
    };
    skipped: {
        concepts: Array<{ concept_id: string; reason: string }>;
        resources: Array<{ resource_id: string; reason: string }>;
        relationships: Array<{ relationship_id: string; reason: string }>;
    };
}

export interface PathStep {
    concept_id: string;
    name: string;
    domain?: string;
    type?: string;
}

export interface SuggestedPath {
    path_id: string;
    title: string;
    rationale: string;
    steps: PathStep[];
    start_concept_id: string;
}

export interface ConceptQuality {
    concept_id: string;
    coverage_score: number;
    coverage_breakdown: {
        has_description: boolean;
        evidence_count: number;
        degree: number;
        reviewed_ratio?: number | null;
    };
    freshness: {
        level: 'Fresh' | 'Aging' | 'Stale' | 'No evidence';
        newest_evidence_at?: string | null;
    };
}

export interface GraphQuality {
    graph_id: string;
    health: 'HEALTHY' | 'NEEDS_ATTENTION' | 'POOR';
    stats: {
        concepts_total: number;
        missing_description_pct: number;
        no_evidence_pct: number;
        stale_evidence_pct: number;
        proposed_relationships_count: number;
    };
}

export interface NarrativeMetrics {
    recencyWeight: number;
    mentionFrequency: number;
    centralityDelta: number;
}

export interface NarrativeMetricsResponse {
    [conceptId: string]: NarrativeMetrics;
}

export interface GraphFile {
    name: string;
    path: string;
    size: number;
    size_formatted: string;
    modified: string;
    modified_formatted: string;
    type: string;
    description: string;
    graph_id?: string | null;
    graph_name?: string | null;
    recently_changed?: boolean;
}

export interface FilePreviewResponse {
    filename: string;
    total_lines: number;
    preview_lines: string[][];
    headers: string[] | null;
    previewed_lines: number;
}

export interface GraphFilesResponse {
    status: string;
    graph_dir?: string;
    files: GraphFile[];
    total_files: number;
    total_size: number;
    total_size_formatted: string;
    message?: string;
}

export interface TrailStep {
    step_id: string;
    index: number;
    kind: string;
    ref_id: string;
    title?: string | null;
    note?: string | null;
    meta?: Record<string, any> | null;
    created_at?: number | null;
}

export interface Trail {
    trail_id: string;
    title: string;
    status: string;
    pinned: boolean;
    created_at: number;
    updated_at: number;
    steps: TrailStep[];
}

export interface TrailSummary {
    trail_id: string;
    title: string;
    status: string;
    pinned: boolean;
    created_at: number;
    updated_at: number;
    step_count: number;
}

export interface VoiceCaptureRequest {
    transcript: string;
    block_id?: string;
    concept_id?: string;
    classification?: 'reflection' | 'confusion' | 'explanation';
    document_id?: string;
}

export interface VoiceCommandRequest {
    transcript: string;
    intent: 'generate_answers' | 'summarize' | 'explain' | 'gap_analysis' | 'retrieve_context' | 'extract_concepts';
    params?: Record<string, any>;
    document_id?: string;
    block_id?: string;
    concept_id?: string;
}

export interface VoiceCommandResponse {
    status: string;
    signal_id: string;
    task_id: string;
    task_type: string;
    message: string;
}

export interface Task {
    id: string;
    title: string;
    notes?: string | null;
    estimated_minutes: number;
    due_date?: string | null;
    priority: string;
    energy: string;
    tags: string[];
    preferred_time_windows?: string[] | null;
    dependencies: string[];
    location?: string | null;
    location_lat?: number | null;
    location_lon?: number | null;
    created_at?: string | null;
    updated_at?: string | null;
}

export interface TaskCreate {
    title: string;
    notes?: string | null;
    estimated_minutes: number;
    due_date?: string | null;
    priority?: string;
    energy?: string;
    tags?: string[] | null;
    preferred_time_windows?: string[] | null;
    dependencies?: string[] | null;
    location?: string | null;
    location_lat?: number | null;
    location_lon?: number | null;
}

export interface TaskUpdate {
    title?: string | null;
    notes?: string | null;
    estimated_minutes?: number | null;
    due_date?: string | null;
    priority?: string | null;
    energy?: string | null;
    tags?: string[] | null;
    preferred_time_windows?: string[] | null;
    dependencies?: string[] | null;
    location?: string | null;
    location_lat?: number | null;
    location_lon?: number | null;
}

export interface PlanSuggestion {
    id: string;
    task_id: string;
    task_title: string;
    start: string;
    end: string;
    confidence: number;
    reasons: string[];
    status: string;
    created_at?: string | null;
}

export interface SuggestionGroupedByDay {
    date: string;
    suggestions: PlanSuggestion[];
}

export interface SuggestionsResponse {
    suggestions_by_day: SuggestionGroupedByDay[];
    total: number;
}

export interface FreeBlock {
    start: string;
    end: string;
    duration_minutes: number;
    date: string;
}

export interface FreeBlocksResponse {
    blocks: FreeBlock[];
    total: number;
}

export interface TaskListResponse {
    tasks: Task[];
    total: number;
}

export interface BackgroundTask {
    task_id: string;
    task_type: string;
    status: 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED' | 'CANCELLED';
    created_at: number;
    started_at?: number;
    completed_at?: number;
    result?: Record<string, any>;
    error?: string;
}

export type SignalType =
    | 'TEXT_AUTHORING'
    | 'SPAN_LINK'
    | 'EMPHASIS'
    | 'FILE_INGESTION'
    | 'VOICE_CAPTURE'
    | 'VOICE_COMMAND'
    | 'QUESTION'
    | 'TIME'
    | 'ASSESSMENT';

export interface Signal {
    signal_id: string;
    signal_type: SignalType;
    timestamp: number; // Unix timestamp in milliseconds
    graph_id: string;
    branch_id: string;
    document_id?: string | null;
    block_id?: string | null;
    concept_id?: string | null;
    payload: Record<string, any>;
    session_id?: string | null;
    user_id?: string | null;
    created_at?: string | null; // ISO timestamp
}

export interface SignalListResponse {
    signals: Signal[];
    total: number;
}

export interface ListSignalsOptions {
    signal_type?: SignalType;
    document_id?: string;
    block_id?: string;
    concept_id?: string;
    limit?: number;
    offset?: number;
}

export interface WorkflowStatus {
    available: boolean;
    types: string[];
    graph_id: string;
    branch_id: string;
}

export interface WorkflowStatusResponse {
    capture: WorkflowStatus;
    explore: WorkflowStatus;
    synthesize: WorkflowStatus;
}

export interface CalendarEvent {
    event_id: string;
    title: string;
    description?: string | null;
    location?: string | null;
    start_date: string; // ISO date string (YYYY-MM-DD)
    end_date?: string | null; // ISO date string (YYYY-MM-DD)
    start_time?: string | null; // ISO time string (HH:MM) or full datetime
    end_time?: string | null; // ISO time string (HH:MM) or full datetime
    all_day: boolean;
    color?: string | null; // Hex color code
    created_at?: string | null; // ISO timestamp
    updated_at?: string | null; // ISO timestamp
}

export interface CalendarEventCreate {
    title: string;
    description?: string | null;
    location?: string | null;
    start_date: string;
    end_date?: string | null;
    start_time?: string | null;
    end_time?: string | null;
    all_day?: boolean;
    color?: string | null;
}

export interface CalendarEventUpdate {
    title?: string | null;
    description?: string | null;
    location?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    start_time?: string | null;
    end_time?: string | null;
    all_day?: boolean | null;
    color?: string | null;
}

export interface CalendarEventListResponse {
    events: CalendarEvent[];
    total: number;
}

export interface ListCalendarEventsOptions {
    start_date?: string; // YYYY-MM-DD
    end_date?: string; // YYYY-MM-DD
}

export interface LocationSuggestion {
    name: string;
    full_address?: string | null; // Full address for geocoded locations
    distance?: number | null; // Distance in miles
    lat?: number;
    lon?: number;
    type?: string; // "geocoded" for real locations, "common" for predefined
}

export interface LocationSuggestionsResponse {
    suggestions: LocationSuggestion[];
}

export interface GetLocationSuggestionsOptions {
    query?: string;
    context?: string; // e.g., 'purdue', 'default'
    currentLat?: number;
    currentLon?: number;
}

export interface DeepResearchRequest {
    topic: string;
    breadth?: number;
    depth?: number;
    intent?: string;
    graph_id?: string;
    branch_id?: string;
}

export interface DeepResearchResponse {
    status: string;
    message: string;
    data: any;
}
