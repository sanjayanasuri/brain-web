const TOKEN_STORAGE_KEY = 'auth_token';

export async function getAuthToken(): Promise<string> {
  if (typeof window === 'undefined') return '';
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
