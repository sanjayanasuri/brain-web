/**
 * Suggestion preferences and suppression utilities.
 * Stores user preferences in localStorage for dismissed, snoozed, and category preferences.
 */

import type { Suggestion, SuggestionType } from '../api-client';

const STORAGE_KEYS = {
  DISMISSED: 'brainweb:suggestions:dismissed',
  DISMISSED_WITH_TIMESTAMP: 'brainweb:suggestions:dismissed:timestamps',  // For quality suggestions with 7-day expiry
  SNOOZED: 'brainweb:suggestions:snoozed',
  PREFS: 'brainweb:suggestions:prefs',
} as const;

// Category groupings for UI
export const SUGGESTION_CATEGORIES = {
  GAPS: ['GAP_DEFINE', 'GAP_EVIDENCE', 'RECENT_LOW_COVERAGE'] as SuggestionType[],
  REVIEW: ['REVIEW_RELATIONSHIPS', 'REVIEW_BACKLOG'] as SuggestionType[],
  EVIDENCE_FRESHNESS: ['STALE_EVIDENCE', 'EVIDENCE_STALE'] as SuggestionType[],
  QUALITY: ['COVERAGE_LOW', 'EVIDENCE_STALE', 'GRAPH_HEALTH_ISSUE', 'REVIEW_BACKLOG'] as SuggestionType[],
} as const;

export type CategoryKey = keyof typeof SUGGESTION_CATEGORIES;

export interface SuggestionCategoryPrefs {
  GAPS: boolean;
  REVIEW: boolean;
  EVIDENCE_FRESHNESS: boolean;
  QUALITY: boolean;
}

export interface SnoozedSuggestion {
  until: string; // ISO date string
}

// Default preferences: all categories enabled
const DEFAULT_CATEGORY_PREFS: SuggestionCategoryPrefs = {
  GAPS: true,
  REVIEW: true,
  EVIDENCE_FRESHNESS: true,
  QUALITY: true,
};

/**
 * Get dismissed suggestion IDs from localStorage.
 * For quality suggestions, checks timestamps and removes expired dismissals (7 days).
 */
export function getDismissedSuggestionIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.DISMISSED);
    const dismissed = stored ? (JSON.parse(stored) || []) : [];
    
    // Check timestamps for quality suggestions (7-day expiry)
    const timestampsStored = localStorage.getItem(STORAGE_KEYS.DISMISSED_WITH_TIMESTAMP);
    if (timestampsStored) {
      try {
        const timestamps: Record<string, number> = JSON.parse(timestampsStored);
        const now = Date.now();
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        
        // Remove expired dismissals
        const validTimestamps: Record<string, number> = {};
        const stillDismissed: string[] = [];
        
        for (const id of dismissed) {
          const timestamp = timestamps[id];
          if (timestamp && (now - timestamp) < sevenDaysMs) {
            // Still within 7-day window
            validTimestamps[id] = timestamp;
            stillDismissed.push(id);
          }
          // If no timestamp or expired, don't include in dismissed list
        }
        
        // Update stored timestamps
        localStorage.setItem(STORAGE_KEYS.DISMISSED_WITH_TIMESTAMP, JSON.stringify(validTimestamps));
        localStorage.setItem(STORAGE_KEYS.DISMISSED, JSON.stringify(stillDismissed));
        
        return stillDismissed;
      } catch {
        // If timestamp parsing fails, just return regular dismissed list
      }
    }
    
    return Array.isArray(dismissed) ? dismissed : [];
  } catch {
    return [];
  }
}

/**
 * Dismiss a suggestion by ID.
 * For quality suggestions, stores timestamp for 7-day expiry.
 */
export function dismissSuggestion(id: string, suggestionType?: SuggestionType): void {
  if (typeof window === 'undefined') return;
  try {
    const dismissed = getDismissedSuggestionIds();
    if (!dismissed.includes(id)) {
      dismissed.push(id);
      localStorage.setItem(STORAGE_KEYS.DISMISSED, JSON.stringify(dismissed));
      
      // For quality suggestions, store timestamp for 7-day expiry
      const qualityTypes: SuggestionType[] = ['COVERAGE_LOW', 'EVIDENCE_STALE', 'GRAPH_HEALTH_ISSUE', 'REVIEW_BACKLOG'];
      if (suggestionType && qualityTypes.includes(suggestionType)) {
        const timestampsStored = localStorage.getItem(STORAGE_KEYS.DISMISSED_WITH_TIMESTAMP);
        const timestamps: Record<string, number> = timestampsStored ? JSON.parse(timestampsStored) : {};
        timestamps[id] = Date.now();
        localStorage.setItem(STORAGE_KEYS.DISMISSED_WITH_TIMESTAMP, JSON.stringify(timestamps));
      }
    }
  } catch (err) {
    console.warn('Failed to dismiss suggestion:', err);
  }
}

/**
 * Get snoozed suggestions from localStorage.
 */
export function getSnoozedSuggestions(): Record<string, SnoozedSuggestion> {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.SNOOZED);
    if (!stored) return {};
    const parsed = JSON.parse(stored);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Snooze a suggestion by ID for a given duration (in milliseconds).
 */
export function snoozeSuggestion(id: string, durationMs: number): void {
  if (typeof window === 'undefined') return;
  try {
    const snoozed = getSnoozedSuggestions();
    const until = new Date(Date.now() + durationMs).toISOString();
    snoozed[id] = { until };
    localStorage.setItem(STORAGE_KEYS.SNOOZED, JSON.stringify(snoozed));
  } catch (err) {
    console.warn('Failed to snooze suggestion:', err);
  }
}

/**
 * Get category preferences from localStorage.
 */
export function getSuggestionPrefs(): SuggestionCategoryPrefs {
  if (typeof window === 'undefined') return DEFAULT_CATEGORY_PREFS;
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.PREFS);
    if (!stored) return DEFAULT_CATEGORY_PREFS;
    const parsed = JSON.parse(stored);
    return { ...DEFAULT_CATEGORY_PREFS, ...parsed };
  } catch {
    return DEFAULT_CATEGORY_PREFS;
  }
}

/**
 * Set category preferences.
 */
export function setSuggestionPrefs(prefs: Partial<SuggestionCategoryPrefs>): void {
  if (typeof window === 'undefined') return;
  try {
    const current = getSuggestionPrefs();
    const updated = { ...current, ...prefs };
    localStorage.setItem(STORAGE_KEYS.PREFS, JSON.stringify(updated));
  } catch (err) {
    console.warn('Failed to set suggestion preferences:', err);
  }
}

/**
 * Check if a suggestion is suppressed (dismissed or snoozed).
 */
export function isSuggestionSuppressed(id: string, type: SuggestionType): boolean {
  // Check if dismissed
  const dismissed = getDismissedSuggestionIds();
  if (dismissed.includes(id)) {
    return true;
  }

  // Check if snoozed (and still within snooze period)
  const snoozed = getSnoozedSuggestions();
  const snoozeInfo = snoozed[id];
  if (snoozeInfo) {
    const until = new Date(snoozeInfo.until);
    if (until > new Date()) {
      return true; // Still snoozed
    }
    // Snooze expired, clean it up
    const updated = { ...snoozed };
    delete updated[id];
    try {
      localStorage.setItem(STORAGE_KEYS.SNOOZED, JSON.stringify(updated));
    } catch {
      // Ignore cleanup errors
    }
  }

  // Check category preferences
  const prefs = getSuggestionPrefs();
  for (const [categoryKey, types] of Object.entries(SUGGESTION_CATEGORIES)) {
    if (types.includes(type)) {
      const enabled = prefs[categoryKey as CategoryKey];
      if (!enabled) {
        return true; // Category is disabled
      }
      break;
    }
  }

  return false;
}

/**
 * Filter suggestions based on user preferences.
 * Returns only suggestions that should be shown.
 */
export function filterSuggestions(suggestions: Suggestion[]): Suggestion[] {
  return suggestions.filter(s => !isSuggestionSuppressed(s.id, s.type));
}

/**
 * Get snooze duration in milliseconds for common durations.
 */
export const SNOOZE_DURATIONS = {
  ONE_DAY: 24 * 60 * 60 * 1000,
  ONE_WEEK: 7 * 24 * 60 * 60 * 1000,
} as const;

