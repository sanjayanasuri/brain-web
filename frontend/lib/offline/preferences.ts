// frontend/lib/offline/preferences.ts
const OFFLINE_SEARCH_ENABLED_KEY = 'brainweb:offlineSearchEnabled';

export function getOfflineSearchEnabled(): boolean {
  if (typeof window === 'undefined') return true; // default enabled
  try {
    const stored = localStorage.getItem(OFFLINE_SEARCH_ENABLED_KEY);
    return stored !== 'false'; // default to true if not set
  } catch {
    return true;
  }
}

export function setOfflineSearchEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(OFFLINE_SEARCH_ENABLED_KEY, String(enabled));
  } catch {
    // ignore storage errors
  }
}

