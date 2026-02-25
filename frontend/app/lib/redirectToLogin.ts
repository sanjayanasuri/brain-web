/**
 * Redirect to login on session expiry (401). Call from API response checks or global error handlers.
 * Client-only; no-op on server.
 */

export async function redirectToLogin(reason?: 'session_expired'): Promise<void> {
  if (typeof window === 'undefined') return;

  const params = new URLSearchParams();
  if (reason) params.set('reason', reason);
  const callbackUrl = window.location.pathname + window.location.search;
  if (callbackUrl && callbackUrl !== '/' && callbackUrl !== '/login') {
    params.set('callbackUrl', callbackUrl);
  }
  const loginUrl = `/login?${params.toString()}`;

  try {
    const { signOut } = await import('next-auth/react');
    await signOut({ callbackUrl: loginUrl, redirect: true });
  } catch {
    window.location.href = loginUrl;
  }
}
