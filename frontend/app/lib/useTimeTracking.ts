/**
 * React hook for automatic time tracking.
 * 
 * Usage:
 *   useTimeTracking(lectureId, blockId, segmentId, conceptId, 'read', enabled);
 */
import { useEffect, useRef } from 'react';
import { startTimeTracking, stopTimeTracking } from './timeTracking';

export function useTimeTracking(
  documentId?: string,
  blockId?: string,
  segmentId?: string,
  conceptId?: string,
  action: 'read' | 'write' | 'review' | 'revisit' = 'read',
  enabled: boolean = true
): void {
  const sessionKeyRef = useRef<string | null>(null);
  
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }
    
    // Start tracking
    sessionKeyRef.current = startTimeTracking(documentId, blockId, segmentId, conceptId, action);
    
    // Stop tracking on unmount or when dependencies change
    return () => {
      if (sessionKeyRef.current) {
        stopTimeTracking(sessionKeyRef.current);
        sessionKeyRef.current = null;
      }
    };
  }, [documentId, blockId, segmentId, conceptId, action, enabled]);
}
