/**
 * Base configuration and authentication for the Brain Web API client
 */

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

// Cache for auth token
let authTokenCache: { token: string; expiresAt: number } | null = null;

/**
 * Get authentication token from the Next.js API route.
 * Caches the token to avoid repeated requests.
 */
export async function getAuthToken(): Promise<string | null> {
    // Check cache first
    if (authTokenCache && authTokenCache.expiresAt > Date.now()) {
        return authTokenCache.token;
    }

    try {
        const response = await fetch('/api/auth/token');
        if (!response.ok) {
            console.warn('[API Client] Failed to get auth token, continuing without auth');
            return null;
        }
        const data = await response.json();
        const token = data.token;

        // Cache token (expires in 30 days, but refresh after 25 days to be safe)
        authTokenCache = {
            token,
            expiresAt: Date.now() + (25 * 24 * 60 * 60 * 1000), // 25 days
        };

        return token;
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

    const token = await getAuthToken();
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
}
