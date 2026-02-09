const TOKEN_STORAGE_KEY = 'auth_token';

export async function getAuthToken(): Promise<string> {
  if (typeof window === 'undefined') return '';

  // Unit tests often stub localStorage but not NextAuth; keep behavior deterministic in Jest.
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || '';
  }

  // Prefer NextAuth session token when logged in (real per-user identity).
  try {
    const { getSession } = await import('next-auth/react');
    const session = await getSession();
    const accessToken = (session as any)?.accessToken;
    if (typeof accessToken === 'string' && accessToken.length > 0) {
      return accessToken;
    }
  } catch {
    // Fall through to legacy dev-token path
  }

  const existing = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (existing) return existing;

  try {
    const response = await fetch('/api/auth/token');
    if (!response.ok) return '';
    const data = await response.json();
    const token = data?.token;
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
      return token;
    }
  } catch {
    // Ignore auth fetch errors.
  }
  return '';
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}
