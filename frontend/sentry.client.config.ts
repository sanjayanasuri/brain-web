import * as Sentry from '@sentry/nextjs';
import { getOrCreateBrowserSessionId } from './lib/observability/correlation';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  });

  // Attach a stable browser session id (shared with backend via `x-session-id`) for cross-surface correlation.
  try {
    const sessionId = getOrCreateBrowserSessionId();
    if (sessionId) Sentry.setTag('bw_session_id', sessionId);
  } catch {
    // Ignore storage errors (private mode, disabled storage, etc.)
  }
}
