/**
 * Continuation Engine - Lightweight, deterministic continuation candidates
 * Computes what the user should do next based on history, quality, and saved items
 */

import { fetchRecentEvents, type ActivityEvent } from './eventsClient';
import { getRecentConceptViews, type RecentConceptView } from './sessionState';
import { getSavedItems, type SavedItem } from './savedItems';
import { getConceptQuality, getGraphQuality, listProposedRelationships, getSuggestedPaths, type SuggestedPath } from '../api-client';
import { getLastSession } from './sessionState';

export type ContinuationKind = 
  | 'RESUME_PATH' 
  | 'IMPROVE_CONCEPT' 
  | 'REVIEW' 
  | 'OPEN_SAVED' 
  | 'START_PATH';

export type ContinuationPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ContinuationCandidate {
  id: string;
  kind: ContinuationKind;
  priority: ContinuationPriority;
  title: string;
  explanation: string;
  action: {
    label: string;
    target: string; // URL or action identifier
  };
  metadata?: {
    path_id?: string;
    concept_id?: string;
    saved_item_id?: string;
    path_title?: string;
    concept_name?: string;
  };
}

const DISMISS_STORAGE_KEY_PREFIX = 'brainweb:continuation:dismissed:';
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Check if a continuation candidate is dismissed
 */
export function isContinuationDismissed(id: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const key = `${DISMISS_STORAGE_KEY_PREFIX}${id}`;
    const dismissedAt = localStorage.getItem(key);
    if (!dismissedAt) return false;
    
    const dismissedTimestamp = parseInt(dismissedAt, 10);
    const now = Date.now();
    const age = now - dismissedTimestamp;
    
    // If dismissed more than 7 days ago, it's no longer dismissed
    return age < DISMISS_DURATION_MS;
  } catch {
    return false;
  }
}

/**
 * Dismiss a continuation candidate
 */
export function dismissContinuation(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    const key = `${DISMISS_STORAGE_KEY_PREFIX}${id}`;
    localStorage.setItem(key, Date.now().toString());
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Clear a continuation candidate (when action is executed)
 */
export function clearContinuation(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    const key = `${DISMISS_STORAGE_KEY_PREFIX}${id}`;
    localStorage.removeItem(key);
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Check for unfinished path (PATH_STARTED without PATH_EXITED)
 */
async function checkUnfinishedPath(
  graphId?: string
): Promise<ContinuationCandidate | null> {
  try {
    // First check localStorage for active path
    const saved = localStorage.getItem('brain-web-active-path');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        const pathId = data.path_id;
        if (pathId) {
          // Verify this path was started but not exited
          const events = await fetchRecentEvents({ 
            limit: 100, 
            graph_id: graphId 
          });
          
          const pathExits = new Set(
            events
              .filter(e => e.type === 'PATH_EXITED')
              .map(e => e.payload?.path_id)
              .filter(Boolean)
          );
          
          if (!pathExits.has(pathId)) {
            // Find the PATH_STARTED event to get the title
            const startEvent = events.find(
              e => e.type === 'PATH_STARTED' && e.payload?.path_id === pathId
            );
            
            return {
              id: `resume_path_${pathId}`,
              kind: 'RESUME_PATH',
              priority: 'HIGH',
              title: startEvent?.payload?.path_title || data.path_title || 'Resume path',
              explanation: 'You started this but didn\'t finish',
              action: {
                label: 'Resume',
                target: `path:${pathId}`, // Special format for path resumption
              },
              metadata: {
                path_id: pathId,
                path_title: startEvent?.payload?.path_title || data.path_title,
              },
            };
          }
        }
      } catch {
        // Ignore parse errors
      }
    }
    
    // Fallback: check events for PATH_STARTED without PATH_EXITED
    const events = await fetchRecentEvents({ 
      limit: 100, 
      graph_id: graphId 
    });
    
    const pathStarts = events.filter(e => e.type === 'PATH_STARTED');
    const pathExits = new Set(
      events
        .filter(e => e.type === 'PATH_EXITED')
        .map(e => e.payload?.path_id)
        .filter(Boolean)
    );
    
    for (const startEvent of pathStarts) {
      const pathId = startEvent.payload?.path_id;
      if (pathId && !pathExits.has(pathId)) {
        return {
          id: `resume_path_${pathId}`,
          kind: 'RESUME_PATH',
          priority: 'HIGH',
          title: startEvent.payload?.path_title || 'Resume path',
          explanation: 'You started this but didn\'t finish',
          action: {
            label: 'Resume',
            target: `path:${pathId}`, // Special format for path resumption
          },
          metadata: {
            path_id: pathId,
            path_title: startEvent.payload?.path_title,
          },
        };
      }
    }
    
    return null;
  } catch (error) {
    console.warn('[Continuation] Error checking unfinished path:', error);
    return null;
  }
}

/**
 * Check for thin or stale concepts recently viewed
 */
async function checkThinOrStaleConcepts(
  graphId?: string
): Promise<ContinuationCandidate[]> {
  const candidates: ContinuationCandidate[] = [];
  
  try {
    const recentViews = getRecentConceptViews();
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    
    // Check concepts viewed in last 7 days
    const recentConcepts = recentViews.filter(v => v.ts >= sevenDaysAgo);
    
    // Check quality for each recent concept (limit to first 5 to avoid too many API calls)
    for (const view of recentConcepts.slice(0, 5)) {
      try {
        const quality = await getConceptQuality(view.id, graphId);
        
        if (
          quality.coverage_score < 50 || 
          quality.freshness.level === 'Stale'
        ) {
          candidates.push({
            id: `improve_concept_${view.id}`,
            kind: 'IMPROVE_CONCEPT',
            priority: 'MEDIUM',
            title: view.name,
            explanation: quality.coverage_score < 50 
              ? 'This concept needs more evidence'
              : 'This concept has stale evidence',
            action: {
              label: 'Add evidence',
              target: `/concepts/${view.id}`,
            },
            metadata: {
              concept_id: view.id,
              concept_name: view.name,
            },
          });
        }
      } catch (error) {
        // Skip if quality check fails
        console.debug('[Continuation] Failed to check quality for concept:', view.id);
      }
    }
    
    return candidates;
  } catch (error) {
    console.warn('[Continuation] Error checking thin/stale concepts:', error);
    return [];
  }
}

/**
 * Check for unreviewed relationships
 */
async function checkUnreviewedRelationships(
  graphId?: string
): Promise<ContinuationCandidate | null> {
  if (!graphId) return null;
  
  try {
    const result = await listProposedRelationships(graphId, 'PROPOSED', 1, 0);
    const count = result.total || 0;
    
    if (count > 0) {
      return {
        id: 'review_relationships',
        kind: 'REVIEW',
        priority: 'MEDIUM',
        title: `Review ${count} proposed relationship${count !== 1 ? 's' : ''}`,
        explanation: 'Your graph has pending connections to accept or reject',
        action: {
          label: 'Review',
          target: '/review?status=PROPOSED',
        },
      };
    }
    
    return null;
  } catch (error) {
    console.warn('[Continuation] Error checking unreviewed relationships:', error);
    return null;
  }
}

/**
 * Check for saved items not opened
 */
function checkSavedItemsNotOpened(): ContinuationCandidate[] {
  const candidates: ContinuationCandidate[] = [];
  
  try {
    const savedItems = getSavedItems();
    const twoDaysAgo = Date.now() - (2 * 24 * 60 * 60 * 1000);
    
    // Check for saved items older than 2 days
    for (const item of savedItems) {
      const createdAt = new Date(item.created_at).getTime();
      if (createdAt < twoDaysAgo) {
        // Check if item was ever opened (we can't track this perfectly, so we'll use a heuristic)
        // For now, we'll show items that are saved but haven't been accessed recently
        const actionTarget = item.kind === 'PATH' 
          ? `/home?path_id=${item.path_id}`
          : item.kind === 'CONCEPT'
          ? `/concepts/${item.concept_id}`
          : '/home';
        
        candidates.push({
          id: `open_saved_${item.id}`,
          kind: 'OPEN_SAVED',
          priority: 'LOW',
          title: item.title,
          explanation: 'You saved this but haven\'t opened it recently',
          action: {
            label: 'Open',
            target: actionTarget,
          },
          metadata: {
            saved_item_id: item.id,
            path_id: item.path_id,
            concept_id: item.concept_id,
          },
        });
      }
    }
    
    return candidates;
  } catch (error) {
    console.warn('[Continuation] Error checking saved items:', error);
    return [];
  }
}

/**
 * Check for suggested paths not started
 */
async function checkSuggestedPathsNotStarted(
  graphId?: string
): Promise<ContinuationCandidate[]> {
  if (!graphId) return [];
  
  const candidates: ContinuationCandidate[] = [];
  
  try {
    // Get suggested paths
    const paths = await getSuggestedPaths(graphId, undefined, 10);
    
    // Check which paths have been started (by checking events)
    const events = await fetchRecentEvents({ limit: 100, graph_id: graphId });
    const startedPathIds = new Set(
      events
        .filter(e => e.type === 'PATH_STARTED')
        .map(e => e.payload?.path_id)
        .filter(Boolean)
    );
    
    // Find paths that were suggested but never started
    for (const path of paths.slice(0, 3)) {
      if (!startedPathIds.has(path.path_id)) {
        candidates.push({
          id: `start_path_${path.path_id}`,
          kind: 'START_PATH',
          priority: 'LOW',
          title: path.title,
          explanation: path.rationale || 'A suggested learning path',
          action: {
            label: 'Start path',
            target: `/home?path_id=${path.path_id}`,
          },
          metadata: {
            path_id: path.path_id,
            path_title: path.title,
          },
        });
      }
    }
    
    return candidates;
  } catch (error) {
    console.warn('[Continuation] Error checking suggested paths:', error);
    return [];
  }
}

/**
 * Compute all continuation candidates
 */
export async function computeContinuationCandidates(
  graphId?: string
): Promise<ContinuationCandidate[]> {
  const allCandidates: ContinuationCandidate[] = [];
  
  // 1. Unfinished path (HIGH priority)
  const unfinishedPath = await checkUnfinishedPath(graphId);
  if (unfinishedPath && !isContinuationDismissed(unfinishedPath.id)) {
    allCandidates.push(unfinishedPath);
  }
  
  // 2. Thin or stale concepts (MEDIUM priority)
  const thinConcepts = await checkThinOrStaleConcepts(graphId);
  for (const candidate of thinConcepts) {
    if (!isContinuationDismissed(candidate.id)) {
      allCandidates.push(candidate);
    }
  }
  
  // 3. Unreviewed relationships (MEDIUM priority)
  const unreviewed = await checkUnreviewedRelationships(graphId);
  if (unreviewed && !isContinuationDismissed(unreviewed.id)) {
    allCandidates.push(unreviewed);
  }
  
  // 4. Saved items not opened (LOW priority)
  const savedItems = checkSavedItemsNotOpened();
  for (const candidate of savedItems) {
    if (!isContinuationDismissed(candidate.id)) {
      allCandidates.push(candidate);
    }
  }
  
  // 5. Suggested paths not started (LOW priority)
  const suggestedPaths = await checkSuggestedPathsNotStarted(graphId);
  for (const candidate of suggestedPaths) {
    if (!isContinuationDismissed(candidate.id)) {
      allCandidates.push(candidate);
    }
  }
  
  // Sort by priority (HIGH > MEDIUM > LOW) and limit
  const sorted = allCandidates.sort((a, b) => {
    const priorityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    return priorityOrder[b.priority] - priorityOrder[a.priority];
  });
  
  // Apply limits: 1 HIGH, 2 MEDIUM, 2 LOW
  const high = sorted.filter(c => c.priority === 'HIGH').slice(0, 1);
  const medium = sorted.filter(c => c.priority === 'MEDIUM').slice(0, 2);
  const low = sorted.filter(c => c.priority === 'LOW').slice(0, 2);
  
  return [...high, ...medium, ...low].slice(0, 3); // Max 3 items total
}

