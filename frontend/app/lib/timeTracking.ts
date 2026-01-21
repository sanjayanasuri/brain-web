/**
 * Automatic time tracking for study sessions.
 * 
 * Tracks time spent viewing documents, reading segments, and working on concepts.
 * Automatically creates TimeSignal signals in the background.
 */
// SignalType enum values
const SignalType = {
  TIME: 'TIME',
} as const;

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';

interface TimeTrackingSession {
  documentId?: string;
  blockId?: string;
  segmentId?: string;
  conceptId?: string;
  startTime: number;
  action: 'read' | 'write' | 'review' | 'revisit';
}

// Active tracking sessions
const activeSessions = new Map<string, TimeTrackingSession>();

// Debounced signal creation (batch time signals every 30 seconds)
let pendingSignals: Array<{ session: TimeTrackingSession; duration: number }> = [];
let flushTimer: NodeJS.Timeout | null = null;

const FLUSH_INTERVAL = 30000; // 30 seconds
const MIN_DURATION_MS = 5000; // Only track sessions longer than 5 seconds

/**
 * Start tracking time for a document/block/concept.
 */
export function startTimeTracking(
  documentId?: string,
  blockId?: string,
  segmentId?: string,
  conceptId?: string,
  action: 'read' | 'write' | 'review' | 'revisit' = 'read'
): string {
  const sessionKey = `${documentId || ''}_${blockId || ''}_${segmentId || ''}_${conceptId || ''}_${action}`;
  
  // If already tracking, don't restart
  if (activeSessions.has(sessionKey)) {
    return sessionKey;
  }
  
  const session: TimeTrackingSession = {
    documentId,
    blockId,
    segmentId,
    conceptId,
    startTime: Date.now(),
    action,
  };
  
  activeSessions.set(sessionKey, session);
  return sessionKey;
}

/**
 * Stop tracking time for a session.
 */
export function stopTimeTracking(sessionKey: string): void {
  const session = activeSessions.get(sessionKey);
  if (!session) {
    return;
  }
  
  const duration = Date.now() - session.startTime;
  activeSessions.delete(sessionKey);
  
  // Only track if duration is meaningful
  if (duration >= MIN_DURATION_MS) {
    pendingSignals.push({ session, duration });
    scheduleFlush();
  }
}

/**
 * Stop all active tracking sessions (e.g., on page unload).
 */
export function stopAllTracking(): void {
  const now = Date.now();
  for (const [sessionKey, session] of Array.from(activeSessions.entries())) {
    const duration = now - session.startTime;
    if (duration >= MIN_DURATION_MS) {
      pendingSignals.push({ session, duration });
    }
  }
  activeSessions.clear();
  flushSignals(); // Immediate flush on unload
}

/**
 * Schedule a flush of pending signals.
 */
function scheduleFlush(): void {
  if (flushTimer) {
    return; // Already scheduled
  }
  
  flushTimer = setTimeout(() => {
    flushSignals();
    flushTimer = null;
  }, FLUSH_INTERVAL);
}

/**
 * Flush all pending time signals to the backend.
 */
async function flushSignals(): Promise<void> {
  if (pendingSignals.length === 0) {
    return;
  }
  
  const signalsToSend = [...pendingSignals];
  pendingSignals = [];
  
  // Get session ID from localStorage or generate one
  const sessionId = getOrCreateSessionId();
  
  // Send signals in batch
  try {
    for (const { session, duration } of signalsToSend) {
      await createTimeSignal({
        document_id: session.documentId,
        block_id: session.blockId,
        segment_id: session.segmentId,
        concept_id: session.conceptId,
        duration_ms: duration,
        action: session.action,
        session_id: sessionId,
      });
    }
  } catch (error) {
    console.error('Failed to send time signals:', error);
    // Re-queue failed signals (up to a limit)
    if (pendingSignals.length < 100) {
      pendingSignals.unshift(...signalsToSend);
    }
  }
}

/**
 * Create a TimeSignal via the API.
 */
async function createTimeSignal(payload: {
  document_id?: string;
  block_id?: string;
  segment_id?: string;
  concept_id?: string;
  duration_ms: number;
  action: string;
  session_id: string;
}): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/signals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signal_type: SignalType.TIME,
      document_id: payload.document_id,
      block_id: payload.block_id,
      concept_id: payload.concept_id,
      payload: {
        duration_ms: payload.duration_ms,
        action: payload.action,
        segment_id: payload.segment_id,
      },
      session_id: payload.session_id,
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to create time signal: ${response.statusText}`);
  }
}

/**
 * Get or create a session ID.
 */
function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') {
    return 'unknown';
  }
  
  let sessionId = localStorage.getItem('bw_session_id');
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('bw_session_id', sessionId);
  }
  return sessionId;
}

/**
 * Track page visibility changes (pause/resume tracking).
 */
if (typeof window !== 'undefined') {
  let visibilityStartTime: number | null = null;
  
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Page hidden - pause all tracking
      visibilityStartTime = Date.now();
      // Note: We keep sessions active but will adjust duration when page becomes visible again
    } else {
      // Page visible - resume tracking
      if (visibilityStartTime) {
        const hiddenDuration = Date.now() - visibilityStartTime;
        // Adjust all active session start times
        for (const session of Array.from(activeSessions.values())) {
          session.startTime += hiddenDuration;
        }
        visibilityStartTime = null;
      }
    }
  });
  
  // Flush on page unload
  window.addEventListener('beforeunload', () => {
    stopAllTracking();
  });
}

/**
 * React hook for automatic time tracking.
 * NOTE: This is a legacy implementation. Use useTimeTracking from ./useTimeTracking.ts instead.
 * This function is kept for backward compatibility but should not be used in new code.
 * @deprecated Use the hook from ./useTimeTracking.ts instead
 */
export function useTimeTracking(
  documentId?: string,
  blockId?: string,
  segmentId?: string,
  conceptId?: string,
  action: 'read' | 'write' | 'review' | 'revisit' = 'read',
  enabled: boolean = true
): void {
  // This is not a proper React hook - it's a regular function
  // The actual hook implementation is in ./useTimeTracking.ts
  // This function is kept for backward compatibility
  console.warn('useTimeTracking from timeTracking.ts is deprecated. Use the hook from ./useTimeTracking.ts instead.');
  
  if (typeof window === 'undefined' || !enabled) {
    return;
  }
  
  // Use a simple interval-based tracking
  const trackingKey = `${documentId || ''}_${blockId || ''}_${segmentId || ''}_${conceptId || ''}_${action}`;
  
  // Start tracking when component mounts or dependencies change
  const startKey = startTimeTracking(documentId, blockId, segmentId, conceptId, action);
  
  // Store in a way that can be cleaned up
  if (typeof window !== 'undefined') {
    (window as any).__timeTracking = (window as any).__timeTracking || {};
    (window as any).__timeTracking[trackingKey] = startKey;
  }
  
  // Note: This function cannot return a cleanup function because it's not a React hook
  // Components using this should manually call stopTimeTracking on unmount
}
