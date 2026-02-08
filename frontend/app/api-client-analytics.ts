// frontend/app/api-client-analytics.ts
/**
 * API client for analytics endpoints.
 * Phase 4: Fetch performance data, recommendations, and insights.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Fetch performance trends
export async function fetchPerformanceTrends(days: number = 30) {
    const response = await fetch(`${API_BASE}/api/analytics/trends?days=${days}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error('Failed to fetch performance trends');
    }

    return response.json();
}

// Fetch concept mastery
export async function fetchConceptMastery(limit?: number) {
    const url = limit
        ? `${API_BASE}/api/analytics/mastery?limit=${limit}`
        : `${API_BASE}/api/analytics/mastery`;

    const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error('Failed to fetch concept mastery');
    }

    return response.json();
}

// Fetch learning velocity
export async function fetchLearningVelocity() {
    const response = await fetch(`${API_BASE}/api/analytics/velocity`, {
        method: 'GET',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error('Failed to fetch learning velocity');
    }

    return response.json();
}

// Fetch weak areas
export async function fetchWeakAreas() {
    const response = await fetch(`${API_BASE}/api/analytics/weak-areas`, {
        method: 'GET',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error('Failed to fetch weak areas');
    }

    return response.json();
}

// Fetch session stats
export async function fetchSessionStats() {
    const response = await fetch(`${API_BASE}/api/analytics/stats`, {
        method: 'GET',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error('Failed to fetch session stats');
    }

    return response.json();
}

// Fetch recommendations
export async function fetchRecommendations(limit: number = 5) {
    const response = await fetch(`${API_BASE}/api/analytics/recommendations?limit=${limit}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error('Failed to fetch recommendations');
    }

    return response.json();
}

// Dismiss recommendation
export async function dismissRecommendation(recId: string) {
    const response = await fetch(`${API_BASE}/api/analytics/recommendations/${recId}/dismiss`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error('Failed to dismiss recommendation');
    }

    return response.json();
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
