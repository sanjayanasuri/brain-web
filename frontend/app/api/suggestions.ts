/**
 * Suggestions related API methods
 */

import { API_BASE_URL, getApiHeaders } from './base';
import { Suggestion, SuggestedPath } from './types';

export async function getSuggestions(
    limit: number = 20,
    graphId?: string,
    recentConcepts?: string[],
    conceptId?: string
): Promise<Suggestion[]> {
    const params = new URLSearchParams();
    params.set('limit', limit.toString());
    if (graphId) {
        params.set('graph_id', graphId);
    }
    if (recentConcepts && recentConcepts.length > 0) {
        params.set('recent_concepts', recentConcepts.join(','));
    }
    if (conceptId) {
        params.set('concept_id', conceptId);
    }
    const res = await fetch(`${API_BASE_URL}/suggestions?${params.toString()}`, {
        headers: await getApiHeaders(),
    });
    if (!res.ok) throw new Error('Failed to load suggestions');
    return res.json();
}

export async function getSuggestedPaths(
    graphId: string | undefined,
    conceptId: string | undefined,
    limit: number = 3
): Promise<SuggestedPath[]> {
    const params = new URLSearchParams();
    if (conceptId) params.set('concept_id', conceptId);
    params.set('limit', limit.toString());
    if (graphId) {
        params.set('graph_id', graphId);
    }
    const res = await fetch(`${API_BASE_URL}/suggestions/paths?${params.toString()}`, {
        headers: await getApiHeaders(),
    });
    if (!res.ok) throw new Error('Failed to load suggested paths');
    return res.json();
}
