// frontend/app/api-client-analytics.ts
/**
 * API client for analytics endpoints.
 * Phase 4: Fetch performance data, recommendations, and insights.
 */

import { API_BASE_URL, getApiHeaders } from './api/base';

const API_BASE = API_BASE_URL.replace(/\/+$/, '');

async function fetchAnalytics(path: string, init: RequestInit = {}) {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
            ...headers,
            ...(init.headers || {}),
        },
    });
    if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw new Error(errorText || `Analytics request failed: ${res.status} ${res.statusText}`);
    }
    return res.json();
}

// Fetch performance trends
export async function fetchPerformanceTrends(days: number = 30) {
    return fetchAnalytics(`/analytics/trends?days=${days}`, { method: 'GET' });
}

// Fetch concept mastery
export async function fetchConceptMastery(limit?: number) {
    const path = limit != null ? `/analytics/mastery?limit=${limit}` : `/analytics/mastery`;
    return fetchAnalytics(path, { method: 'GET' });
}

// Fetch learning velocity
export async function fetchLearningVelocity() {
    return fetchAnalytics(`/analytics/velocity`, { method: 'GET' });
}

// Fetch weak areas
export async function fetchWeakAreas() {
    return fetchAnalytics(`/analytics/weak-areas`, { method: 'GET' });
}

// Fetch session stats
export async function fetchSessionStats() {
    return fetchAnalytics(`/analytics/stats`, { method: 'GET' });
}

// Fetch recommendations
export async function fetchRecommendations(limit: number = 5) {
    return fetchAnalytics(`/analytics/recommendations?limit=${limit}`, { method: 'GET' });
}

// Dismiss recommendation
export async function dismissRecommendation(recId: string) {
    return fetchAnalytics(`/analytics/recommendations/${encodeURIComponent(recId)}/dismiss`, { method: 'POST' });
}

// Fetch all analytics data at once
export async function fetchAllAnalytics(days: number = 30) {
    const [trends, mastery, velocity, weakAreas, recommendations, stats] = await Promise.all([
        fetchPerformanceTrends(days),
        fetchConceptMastery(),
        fetchLearningVelocity(),
        fetchWeakAreas(),
        fetchRecommendations(),
        fetchSessionStats(),
    ]);

    return {
        trends,
        mastery,
        velocity,
        weakAreas,
        recommendations,
        stats,
    };
}
