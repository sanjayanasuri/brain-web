/**
 * Session state management using localStorage
 * Tracks user's last session, recent views, pinned items, and activity
 */

export interface LastSession {
  graph_id?: string;
  graph_name?: string;
  concept_id?: string;
  concept_name?: string;
  last_chat_id?: string;
  timestamp?: number;
}

export interface RecentConceptView {
  id: string;
  name: string;
  ts: number;
}

export interface PinnedConcept {
  id: string;
  name: string;
}

export interface PinnedAnswer {
  answer_id: string;
  question: string;
  ts: number;
}

const STORAGE_KEYS = {
  LAST_SESSION: 'brainweb:lastSession',
  RECENT_VIEWS: 'brainweb:recentConceptViews',
  PINNED_CONCEPTS: 'brainweb:pinnedConcepts',
  PINNED_ANSWERS: 'brainweb:pinnedAnswers',
  ACTIVITY_EVENTS: 'brainweb:activityEvents',
} as const;

const MAX_RECENT_VIEWS = 20;
const MAX_ACTIVITY_EVENTS = 20; // Keep only last 20 events for exploration signals

/**
 * Get the last session state
 */
export function getLastSession(): LastSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.LAST_SESSION);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

/**
 * Update last session state (partial update)
 */
export function setLastSession(partial: Partial<LastSession>): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = getLastSession() || {};
    const updated: LastSession = {
      ...existing,
      ...partial,
      timestamp: Date.now(),
    };
    localStorage.setItem(STORAGE_KEYS.LAST_SESSION, JSON.stringify(updated));
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Push a concept view to recent views (dedupe, keep last 20)
 */
export function pushRecentConceptView(view: { id: string; name: string }): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = getRecentConceptViews();
    // Remove any existing entry with same id
    const filtered = existing.filter(v => v.id !== view.id);
    // Add new entry at the front
    const updated: RecentConceptView[] = [
      { ...view, ts: Date.now() },
      ...filtered,
    ].slice(0, MAX_RECENT_VIEWS);
    localStorage.setItem(STORAGE_KEYS.RECENT_VIEWS, JSON.stringify(updated));
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Get recent concept views (most recent first)
 */
export function getRecentConceptViews(): RecentConceptView[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.RECENT_VIEWS);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

/**
 * Toggle pin state for a concept
 */
export function togglePinConcept(concept: { id: string; name: string }, graphId?: string): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = getPinnedConcepts();
    const isPinned = existing.some(c => c.id === concept.id);
    
    if (isPinned) {
      // Unpin
      const updated = existing.filter(c => c.id !== concept.id);
      localStorage.setItem(STORAGE_KEYS.PINNED_CONCEPTS, JSON.stringify(updated));
    } else {
      // Pin
      const updated = [...existing, concept];
      localStorage.setItem(STORAGE_KEYS.PINNED_CONCEPTS, JSON.stringify(updated));
      
      // Log pin event (only when pinning, not unpinning)
      import('./eventsClient').then(({ logEvent }) => {
        logEvent({
          type: 'PINNED',
          concept_id: concept.id,
          graph_id: graphId,
          payload: { targetType: 'CONCEPT', targetId: concept.id },
        });
      }).catch(() => {
        // Ignore import errors
      });
    }
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Get pinned concepts
 */
export function getPinnedConcepts(): PinnedConcept[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.PINNED_CONCEPTS);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

/**
 * Check if a concept is pinned
 */
export function isConceptPinned(conceptId: string): boolean {
  return getPinnedConcepts().some(c => c.id === conceptId);
}

/**
 * Track a generic activity event (lightweight)
 */
export function trackEvent(type: string, payload?: Record<string, any>): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = getActivityEvents();
    const event = {
      type,
      payload: payload || {},
      ts: Date.now(),
    };
    const updated = [event, ...existing].slice(0, MAX_ACTIVITY_EVENTS);
    localStorage.setItem(STORAGE_KEYS.ACTIVITY_EVENTS, JSON.stringify(updated));
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Get recent activity events (most recent first)
 */
export function getActivityEvents(limit: number = 10): Array<{
  type: string;
  payload: Record<string, any>;
  ts: number;
}> {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.ACTIVITY_EVENTS);
    if (!stored) return [];
    const events = JSON.parse(stored);
    return events.slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Format timestamp as relative time (e.g., "2h ago")
 */
export function formatRelativeTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'Just now';
}

// Exploration signal event types
export const EXPLORATION_EVENT_TYPES = {
  CONCEPT_VIEWED: 'CONCEPT_VIEWED',
  RESOURCE_OPENED: 'RESOURCE_OPENED',
  EVIDENCE_FETCHED: 'EVIDENCE_FETCHED',
} as const;

export type ExplorationEventType = typeof EXPLORATION_EVENT_TYPES[keyof typeof EXPLORATION_EVENT_TYPES];

export interface ExplorationSignal {
  type: ExplorationEventType;
  concept_id: string;
  concept_name?: string;
  resource_id?: string; // For RESOURCE_OPENED
  count?: number; // For EVIDENCE_FETCHED
  ts: number;
}

/**
 * Track a concept view event
 */
export function trackConceptViewed(conceptId: string, conceptName: string): void {
  trackEvent(EXPLORATION_EVENT_TYPES.CONCEPT_VIEWED, {
    concept_id: conceptId,
    concept_name: conceptName,
  });
  pushRecentConceptView({ id: conceptId, name: conceptName });
}

/**
 * Track a resource opened event
 */
export function trackResourceOpened(conceptId: string, conceptName: string, resourceId: string): void {
  trackEvent(EXPLORATION_EVENT_TYPES.RESOURCE_OPENED, {
    concept_id: conceptId,
    concept_name: conceptName,
    resource_id: resourceId,
  });
}

/**
 * Track an evidence fetched event
 */
export function trackEvidenceFetched(conceptId: string, conceptName: string, count: number): void {
  trackEvent(EXPLORATION_EVENT_TYPES.EVIDENCE_FETCHED, {
    concept_id: conceptId,
    concept_name: conceptName,
    count,
  });
}

/**
 * Get recent exploration signals (last 3-6 events of specific types)
 */
export function getRecentExplorationSignals(limit: number = 6): ExplorationSignal[] {
  if (typeof window === 'undefined') return [];
  try {
    const events = getActivityEvents(MAX_ACTIVITY_EVENTS);
    const validTypes = Object.values(EXPLORATION_EVENT_TYPES);
    
    const signals: ExplorationSignal[] = events
      .filter(e => validTypes.includes(e.type as ExplorationEventType))
      .slice(0, limit)
      .map(e => ({
        type: e.type as ExplorationEventType,
        concept_id: e.payload.concept_id || '',
        concept_name: e.payload.concept_name,
        resource_id: e.payload.resource_id,
        count: e.payload.count,
        ts: e.ts,
      }))
      .filter(s => s.concept_id); // Only include events with concept_id
    
    return signals;
  } catch {
    return [];
  }
}

