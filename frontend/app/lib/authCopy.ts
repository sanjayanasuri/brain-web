/**
 * Shared copy and error mapping for auth (login, signup, welcome).
 * Keeps messaging personable and consistent without exposing internal errors.
 */

export const APP_NAME = 'Brain Web';

export const AUTH_TAGLINE = 'Unify your learning experience';

/** Map NextAuth or backend error keys to user-friendly messages. */
export function getLoginErrorMessage(error: string | undefined): string {
  if (!error) return '';
  const lower = error.toLowerCase();
  if (lower.includes('credentials') || lower.includes('incorrect') || lower.includes('password')) {
    return 'Incorrect email or password. Please try again.';
  }
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('synchronization')) {
    return "We couldn't reach the server. Check your connection and try again.";
  }
  if (lower.includes('session') || lower.includes('expired')) {
    return 'Your session expired. Please sign in again.';
  }
  return 'Something went wrong. Please try again.';
}

/** Map signup API detail to user-friendly message. */
export function getSignupErrorMessage(detail: string | undefined): string {
  if (!detail) return 'Something went wrong. Please try again.';
  const lower = String(detail).toLowerCase();
  if (lower.includes('already registered') || lower.includes('email')) {
    return 'This email is already registered. Sign in or use a different email.';
  }
  if (lower.includes('password') || lower.includes('invalid')) {
    return 'Please use a stronger password (at least 8 characters).';
  }
  return 'We couldn\'t create your account. Please try again.';
}
