type LectureLinkReturnState = {
  path: string;
  chatScrollTop?: number;
  windowScrollTop?: number;
  timestamp: number;
};

const STORAGE_KEY = 'brainweb:lectureLinkReturn';

export function storeLectureLinkReturn(state: {
  path: string;
  chatScrollTop?: number;
  windowScrollTop?: number;
}): void {
  if (typeof window === 'undefined') return;
  const payload: LectureLinkReturnState = {
    ...state,
    timestamp: Date.now(),
  };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage errors.
  }
}

export function consumeLectureLinkReturn(currentPath?: string): LectureLinkReturnState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw) as LectureLinkReturnState;
    if (currentPath && payload.path !== currentPath) {
      return null;
    }
    sessionStorage.removeItem(STORAGE_KEY);
    return payload;
  } catch {
    return null;
  }
}
