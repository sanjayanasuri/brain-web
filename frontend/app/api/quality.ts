/**
 * Quality related API methods
 */

import { API_BASE_URL } from './base';
import {
    GapsOverview,
    ConceptQuality,
    GraphQuality,
    NarrativeMetricsResponse
} from './types';

export async function getGapsOverview(limit: number = 10): Promise<GapsOverview> {
    const res = await fetch(`${API_BASE_URL}/gaps/overview?limit=${limit}`);
    if (!res.ok) throw new Error('Failed to load gaps overview');
    return res.json();
}

export async function getConceptQuality(
    conceptId: string,
    graphId?: string
): Promise<ConceptQuality> {
    const params = new URLSearchParams();
    if (graphId) {
        params.set('graph_id', graphId);
    }
    const res = await fetch(
        `${API_BASE_URL}/quality/concepts/${encodeURIComponent(conceptId)}?${params.toString()}`
    );
    if (!res.ok) {
        throw new Error(`Failed to get concept quality: ${res.statusText}`);
    }
    return res.json();
}

export async function getGraphQuality(graphId: string): Promise<GraphQuality> {
    const res = await fetch(`${API_BASE_URL}/quality/graphs/${encodeURIComponent(graphId)}`);
    if (!res.ok) {
        throw new Error(`Failed to get graph quality: ${res.statusText}`);
    }
    return res.json();
}

export async function getNarrativeMetrics(
    conceptIds: string[],
    graphId?: string
): Promise<NarrativeMetricsResponse> {
    if (conceptIds.length === 0) {
        return {};
    }
    const params = new URLSearchParams();
    if (graphId) {
        params.set('graph_id', graphId);
    }
    const res = await fetch(`${API_BASE_URL}/quality/narrative-metrics?${params.toString()}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ concept_ids: conceptIds }),
    });
    if (!res.ok) {
        throw new Error(`Failed to get narrative metrics: ${res.statusText}`);
    }
    return res.json();
}
