/**
 * Event logging client for backend-backed activity tracking
 * Enables multi-device "Recent activity" and future Sessions
 */

export type EventType =
  | 'CONCEPT_VIEWED'
  | 'RESOURCE_OPENED'
  | 'EVIDENCE_FETCHED'
  | 'ANSWER_CREATED'
  | 'GRAPH_SWITCHED'
  | 'PINNED'
  | 'EVIDENCE_CHIP_CLICKED'
  | 'SECTION_EVIDENCE_SHOWN'
  | 'GRAPH_LENS_CHANGED'
  | 'DIGEST_OPENED'
  | 'REMINDER_DISMISSED'
  | 'PATH_STARTED'
  | 'PATH_STEP_VIEWED'
  | 'PATH_EXITED'
  | 'REVIEW_OPENED';

export interface ActivityEvent {
  id: string;
  user_id: string;
  graph_id?: string;
  concept_id?: string;
  resource_id?: string;
  answer_id?: string;
  type: EventType;
  payload?: Record<string, any>;
  created_at: string;
}

export interface LogEventParams {
  type: EventType;
  graph_id?: string;
  concept_id?: string;
  resource_id?: string;
  answer_id?: string;
  payload?: Record<string, any>;
}

export interface FetchRecentEventsParams {
  limit?: number;
  graph_id?: string;
  concept_id?: string;
}

export interface TopConcept {
  concept_id: string;
  concept_name?: string;
}

export interface SessionCounts {
  concepts_viewed: number;
  resources_opened: number;
  evidence_fetched: number;
  answers_created: number;
}

export interface PathHighlight {
  path_id: string;
  title?: string;
}

export interface AnswerHighlight {
  answer_id: string;
}

export interface EvidenceHighlight {
  resource_id: string;
  resource_title?: string;
  concept_id?: string;
}

export interface SessionHighlights {
  concepts: TopConcept[];
  paths?: PathHighlight[];
  answers?: AnswerHighlight[];
  evidence?: EvidenceHighlight[];
}

export interface SessionSummary {
  session_id: string;
  start_at: string;
  end_at: string;
  graph_id?: string;
  summary: string;
  last_concept_id?: string;
  last_concept_name?: string;
  top_concepts: TopConcept[];
  counts: SessionCounts;
  highlights?: SessionHighlights;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

/**
 * Log an activity event to the backend.
 * Swallows errors - never blocks UX.
 */
export async function logEvent(event: LogEventParams): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/events/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    
    if (!response.ok) {
      console.debug('[EventsClient] Failed to log event:', response.status, event.type);
    }
  } catch (error) {
    // Swallow errors - never block UX
    console.debug('[EventsClient] Error logging event:', error);
  }
}

/**
 * Fetch recent activity events from the backend.
 */
export async function fetchRecentEvents(
  params: FetchRecentEventsParams = {}
): Promise<ActivityEvent[]> {
  try {
    const queryParams = new URLSearchParams();
    if (params.limit) {
      queryParams.set('limit', params.limit.toString());
    }
    if (params.graph_id) {
      queryParams.set('graph_id', params.graph_id);
    }
    if (params.concept_id) {
      queryParams.set('concept_id', params.concept_id);
    }
    
    const url = `${API_BASE_URL}/events/activity/recent${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      console.warn('[EventsClient] Failed to fetch recent events:', response.status);
      return [];
    }
    
    const events: ActivityEvent[] = await response.json();
    return events;
  } catch (error) {
    console.warn('[EventsClient] Error fetching recent events:', error);
    return [];
  }
}

/**
 * Fetch recent sessions from the backend.
 */
export async function fetchRecentSessions(
  limit: number = 10
): Promise<SessionSummary[]> {
  try {
    const queryParams = new URLSearchParams();
    queryParams.set('limit', limit.toString());
    
    const url = `${API_BASE_URL}/sessions/recent?${queryParams.toString()}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      console.warn('[EventsClient] Failed to fetch recent sessions:', response.status);
      return [];
    }
    
    const sessions: SessionSummary[] = await response.json();
    return sessions;
  } catch (error) {
    console.warn('[EventsClient] Error fetching recent sessions:', error);
    return [];
  }
}

