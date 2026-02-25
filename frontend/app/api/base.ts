import * as Sentry from '@sentry/nextjs';
import { getSession } from 'next-auth/react';
import { createRequestId, getOrCreateBrowserSessionId } from '../../lib/observability/correlation';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

// Cache for auth token
let authTokenCache: { token: string; expiresAt: number } | null = null;

/**
 * Get authentication token from the Next.js API route.
 * Caches the token to avoid repeated requests.
 */
export async function getAuthToken(): Promise<string | null> {
    try {
        const session = await getSession();
        if (session && (session as any).accessToken) {
            return (session as any).accessToken;
        }

        // Fallback for local development if endpoint exists
        const response = await fetch('/api/auth/token');
        if (response.ok) {
            const data = await response.json();
            return data.token;
        }

        return null;
    } catch (error) {
        console.warn('[API Client] Error getting auth token:', error);
        return null;
    }
}

/**
 * Get headers for API requests, including authentication if available.
 */
export async function getApiHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    // Correlation headers for observability (backend logs + Sentry tags)
    const requestId = createRequestId();
    headers['x-request-id'] = requestId;
    try {
        Sentry.setTag('request_id', requestId);
    } catch {
        // Sentry may be uninitialized (e.g. no DSN)
    }
    const sessionId = getOrCreateBrowserSessionId();
    if (sessionId) {
        headers['x-session-id'] = sessionId;
    }

    const token = await getAuthToken();
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
}
