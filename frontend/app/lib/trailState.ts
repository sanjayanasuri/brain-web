/**
 * Trail state management using localStorage
 * Tracks active trail ID across sessions
 */

const STORAGE_KEY = 'brainweb:activeTrailId';

/**
 * Get the active trail ID
 */
export function getActiveTrailId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Set the active trail ID
 */
export function setActiveTrailId(trailId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (trailId) {
      localStorage.setItem(STORAGE_KEY, trailId);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Clear the active trail ID
 */
export function clearActiveTrailId(): void {
  setActiveTrailId(null);
}

