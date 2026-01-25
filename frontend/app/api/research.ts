/**
 * Deep Research related API methods
 */

import { API_BASE_URL, getApiHeaders } from './base';
import {
    DeepResearchRequest,
    DeepResearchResponse
} from './types';

/**
 * Run Deep Research
 */
export async function runDeepResearch(payload: DeepResearchRequest): Promise<DeepResearchResponse> {
    const headers = await getApiHeaders();
    const response = await fetch(`${API_BASE_URL}/deep-research/run`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: response.statusText }));
        throw new Error(error.detail || `Failed to run deep research: ${response.statusText}`);
    }
    return response.json();
}
