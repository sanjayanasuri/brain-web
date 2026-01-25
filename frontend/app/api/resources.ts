/**
 * Resource related API methods
 */

import { API_BASE_URL, getApiHeaders } from './base';
import {
    Resource,
    Claim,
    Source
} from './types';

/**
 * Search for resources by title or caption
 */
export async function searchResources(
    query: string,
    graphIdOrLimit?: string | number,
    limit?: number
): Promise<Resource[]> {
    const params = new URLSearchParams();
    params.set('query', query);

    let graphId: string | undefined;
    let actualLimit: number;

    if (typeof graphIdOrLimit === 'number') {
        actualLimit = graphIdOrLimit;
    } else if (typeof graphIdOrLimit === 'string') {
        graphId = graphIdOrLimit;
        actualLimit = limit ?? 20;
    } else {
        actualLimit = 20;
    }

    if (graphId) {
        params.set('graph_id', graphId);
    }
    params.set('limit', actualLimit.toString());
    const response = await fetch(`${API_BASE_URL}/resources/search?${params.toString()}`);
    if (!response.ok) {
        throw new Error(`Failed to search resources: ${response.statusText}`);
    }
    return response.json();
}

/**
 * Fetch all claims that mention a concept
 */
export async function getClaimsForConcept(nodeId: string, limit: number = 50): Promise<Claim[]> {
    const response = await fetch(`${API_BASE_URL}/concepts/${nodeId}/claims?limit=${limit}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch claims: ${response.statusText}`);
    }
    return response.json();
}

/**
 * Get all sources (documents/chunks) that mention a concept
 */
export async function getSourcesForConcept(nodeId: string, limit: number = 100): Promise<Source[]> {
    const response = await fetch(`${API_BASE_URL}/concepts/${nodeId}/sources?limit=${limit}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch sources: ${response.statusText}`);
    }
    return response.json();
}

/**
 * Fetch all resources attached to a concept
 */
export async function getResourcesForConcept(conceptId: string): Promise<Resource[]> {
    // Try offline cache first if offline
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const { getResourcesForConceptOffline } = await import('../../lib/offline/api_wrapper');
        const cached = await getResourcesForConceptOffline(conceptId);
        if (cached.length > 0) {
            return cached as Resource[];
        }
        return [];
    }

    try {
        const res = await fetch(`${API_BASE_URL}/resources/by-concept/${encodeURIComponent(conceptId)}`);
        if (!res.ok) {
            const { getResourcesForConceptOffline } = await import('../../lib/offline/api_wrapper');
            const cached = await getResourcesForConceptOffline(conceptId);
            if (cached.length > 0) {
                return cached as Resource[];
            }
            throw new Error(`Failed to fetch resources for concept ${conceptId}: ${res.statusText}`);
        }
        return res.json();
    } catch {
        const { getResourcesForConceptOffline } = await import('../../lib/offline/api_wrapper');
        const cached = await getResourcesForConceptOffline(conceptId);
        return cached as Resource[];
    }
}

/**
 * Upload a file and optionally attach it to a concept
 */
export async function uploadResourceForConcept(
    file: File,
    conceptId?: string,
    title?: string,
): Promise<Resource> {
    const formData = new FormData();
    formData.append('file', file);
    if (conceptId) formData.append('concept_id', conceptId);
    if (title) formData.append('title', title);

    const res = await fetch(`${API_BASE_URL}/resources/upload`, {
        method: 'POST',
        body: formData,
    });

    if (!res.ok) {
        throw new Error(`Failed to upload resource: ${res.statusText}`);
    }
    return res.json();
}

/**
 * Fetch confusions and pitfalls for a concept using Browser Use skill
 */
export async function fetchConfusionsForConcept(
    query: string,
    conceptId?: string,
    sources: string[] = ['stackoverflow', 'github', 'docs', 'blogs'],
    limit: number = 8,
): Promise<Resource> {
    const res = await fetch(`${API_BASE_URL}/resources/fetch/confusions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            query,
            concept_id: conceptId,
            sources,
            limit,
        }),
    });

    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to fetch confusions: ${res.statusText} - ${errorText}`);
    }
    return res.json();
}

/**
 * Get an artifact by its artifact_id
 */
export async function getArtifact(artifactId: string): Promise<any> {
    const response = await fetch(`${API_BASE_URL}/artifacts/${encodeURIComponent(artifactId)}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch artifact: ${response.statusText}`);
    }
    return response.json();
}

/**
 * Create or get an artifact
 */
export async function createOrGetArtifact(payload: {
    artifact_type: string;
    source_url?: string;
    source_id?: string;
    title?: string;
    text: string;
    metadata?: any;
    graph_id?: string;
}): Promise<any> {
    const response = await fetch(`${API_BASE_URL}/artifacts/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        throw new Error(`Failed to create or get artifact: ${response.statusText}`);
    }
    return response.json();
}
