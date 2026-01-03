// frontend/lib/offline/api_wrapper.ts
/**
 * Offline-aware API wrapper functions.
 * These functions check if we're offline and use cached data when available.
 */

import { readConcept, readBootstrap, listCachedArtifacts, readArtifactByUrl } from './cache_db';
import { getLastSession } from '../../app/lib/sessionState';

/**
 * Check if we're currently offline
 */
function isOffline(): boolean {
  if (typeof navigator === 'undefined') return false;
  return !navigator.onLine;
}

/**
 * Get current graph_id and branch_id from session
 */
function getCurrentContext(): { graph_id: string; branch_id: string } | null {
  const session = getLastSession();
  let graphId = session?.graph_id;
  let branchId = 'main';

  // Try to get graph_id from sessionStorage (set by listGraphs)
  if (typeof window !== 'undefined') {
    try {
      const cachedGraphId = sessionStorage.getItem('brainweb:activeGraphId');
      const cachedBranchId = sessionStorage.getItem('brainweb:activeBranchId');
      if (cachedGraphId) graphId = cachedGraphId;
      if (cachedBranchId) branchId = cachedBranchId;
    } catch {}
  }

  if (!graphId) return null;

  return {
    graph_id: graphId,
    branch_id: branchId,
  };
}

/**
 * Offline-aware wrapper for getConcept
 * Falls back to cached concept if offline
 */
export async function getConceptOffline(nodeId: string): Promise<any | null> {
  const context = getCurrentContext();
  if (!context) return null;

  // If offline, try cache
  if (isOffline()) {
    const cached = await readConcept(context.graph_id, context.branch_id, nodeId);
    if (cached) {
      return cached;
    }
    // Also check bootstrap for pinned concepts
    const bootstrap = await readBootstrap(context.graph_id, context.branch_id);
    if (bootstrap?.pinned_concepts) {
      const found = bootstrap.pinned_concepts.find((c: any) => c.node_id === nodeId);
      if (found) return found;
    }
    return null;
  }

  // Online: return null to let caller use API
  return null;
}

/**
 * Offline-aware wrapper for getResourcesForConcept
 * Falls back to cached artifacts if offline
 */
export async function getResourcesForConceptOffline(conceptId: string): Promise<any[]> {
  const context = getCurrentContext();
  if (!context) return [];

  // If offline, try to find artifacts related to this concept
  if (isOffline()) {
    const artifacts = await listCachedArtifacts(context.graph_id, context.branch_id);
    // Convert artifacts to resource-like format
    // Filter artifacts that might be related to this concept
    return artifacts
      .filter((a: any) => {
        // Check if artifact metadata references this concept
        const metadata = a.metadata || {};
        return metadata._concept_id === conceptId || 
               metadata.concept_id === conceptId ||
               (a.text && a.text.toLowerCase().includes(conceptId.toLowerCase()));
      })
      .map((a: any) => ({
        resource_id: a.artifact_id || a.url,
        kind: 'artifact',
        url: a.url,
        title: a.title,
        caption: a.domain,
        source: 'offline_cache',
        created_at: a.captured_at ? new Date(a.captured_at).toISOString() : undefined,
        metadata: a.metadata || {},
      }));
  }

  // Online: return empty to let caller use API
  return [];
}

/**
 * Offline-aware wrapper for graph data
 * Falls back to cached bootstrap data if offline
 */
export async function getGraphDataOffline(): Promise<any | null> {
  const context = getCurrentContext();
  if (!context) return null;

  if (isOffline()) {
    const bootstrap = await readBootstrap(context.graph_id, context.branch_id);
    if (bootstrap) {
      // Convert bootstrap to graph data format
      return {
        nodes: bootstrap.pinned_concepts || [],
        links: [], // Relationships not cached in bootstrap
      };
    }
  }

  return null;
}

/**
 * Check if we have offline data available for the current graph/branch
 */
export async function hasOfflineData(): Promise<boolean> {
  const context = getCurrentContext();
  if (!context) return false;

  const bootstrap = await readBootstrap(context.graph_id, context.branch_id);
  return !!bootstrap;
}

