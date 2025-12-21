/**
 * Shared utility for fetching evidence for concepts
 * Reuses the existing "Fetch confusions" endpoint
 */

import { fetchConfusionsForConcept, getResourcesForConcept, type Resource } from '../api-client';
import { trackEvidenceFetched } from './sessionState';
import { logEvent } from './eventsClient';

export interface FetchEvidenceResult {
  addedCount: number;
  resources?: Resource[];
  error?: string;
}

/**
 * Fetch evidence for a concept using the existing Browser Use skill endpoint
 * This is the same endpoint used by "Fetch confusions" in the Evidence tab
 */
export async function fetchEvidenceForConcept(
  conceptId: string,
  conceptName: string,
  graphId?: string
): Promise<FetchEvidenceResult> {
  try {
    // Call the existing endpoint (same as "Fetch confusions")
    const resource = await fetchConfusionsForConcept(
      conceptName,
      conceptId,
      ['stackoverflow', 'github', 'docs', 'blogs'],
      8
    );

    // After fetching, reload resources to get the updated list
    const resources = await getResourcesForConcept(conceptId);

    // Count sources from the newly created resource's metadata
    // The metadata contains confusions and pitfalls arrays with source information
    let addedCount = 0;
    if (resource.metadata) {
      const confusions = Array.isArray(resource.metadata.confusions) ? resource.metadata.confusions : [];
      const pitfalls = Array.isArray(resource.metadata.pitfalls) ? resource.metadata.pitfalls : [];
      // Count unique sources from confusions and pitfalls
      const sources = new Set<string>();
      [...confusions, ...pitfalls].forEach((item: any) => {
        if (item.url) sources.add(item.url);
      });
      addedCount = sources.size || (confusions.length + pitfalls.length) || 1; // Fallback to item count or 1
    } else {
      // Fallback: count browser_use resources (this includes previously fetched ones)
      const browserUseResources = resources.filter(r => r.source === 'browser_use');
      addedCount = browserUseResources.length;
    }
    
    // Track evidence fetched event if successful
    if (addedCount > 0) {
      trackEvidenceFetched(conceptId, conceptName, addedCount);
      // Log to backend
      logEvent({
        type: 'EVIDENCE_FETCHED',
        concept_id: conceptId,
        graph_id: graphId,
        payload: { addedCount },
      });
    }
    
    return {
      addedCount,
      resources,
    };
  } catch (error) {
    return {
      addedCount: 0,
      error: error instanceof Error ? error.message : 'Failed to fetch evidence',
    };
  }
}

