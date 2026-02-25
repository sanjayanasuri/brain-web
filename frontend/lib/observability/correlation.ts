export function createRequestId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) {
    return uuid.replace(/-/g, '');
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`.slice(
    0,
    32
  );
}

export function getOrCreateBrowserSessionId(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const storage = window.localStorage;
    const key = 'bw_session_id';
    let sessionId = storage.getItem(key);
    if (!sessionId) {
      const uuid = globalThis.crypto?.randomUUID?.();
      sessionId = uuid ? `bw_${uuid.replace(/-/g, '')}` : `bw_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      storage.setItem(key, sessionId);
    }
    return sessionId;
  } catch {
    return null;
  }
}

