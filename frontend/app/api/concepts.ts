/**
 * Concept and Relationship related API methods
 */

import { API_BASE_URL, getApiHeaders } from './base';
import {
    Concept,
    ConceptNote,
    GraphData
} from './types';

export async function getConceptNotes(nodeId: string, limit = 10, offset = 0): Promise<ConceptNote[]> {
    const headers = await getApiHeaders();
    const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
    });
    const res = await fetch(`${API_BASE_URL}/concepts/${encodeURIComponent(nodeId)}/notes?${params.toString()}`, {
        headers,
    });
    if (!res.ok) {
        if (res.status === 404) {
            return [];
        }
        const errorText = await res.text();
        throw new Error(`Failed to get concept notes: ${res.statusText}${errorText ? ` - ${errorText}` : ''}`);
    }
    return res.json();
}

/**
 * Fetch a concept by its node_id
 */
export async function getConcept(nodeId: string): Promise<Concept> {
    // Try offline cache first if offline
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const { getConceptOffline } = await import('../../lib/offline/api_wrapper');
        const cached = await getConceptOffline(nodeId);
        if (cached) {
            return cached as Concept;
        }
        // If no cache, throw error
        throw new Error('Concept not available offline');
    }

    const response = await fetch(`${API_BASE_URL}/concepts/${nodeId}`);
    if (!response.ok) {
        // If online request fails, try offline cache as fallback
        const { getConceptOffline } = await import('../../lib/offline/api_wrapper');
        const cached = await getConceptOffline(nodeId);
        if (cached) {
            return cached as Concept;
        }
        throw new Error(`Failed to fetch concept: ${response.statusText}`);
    }
    return response.json();
}

/**
 * Fetch a concept by name
 */
export async function getConceptByName(name: string): Promise<Concept> {
    const encodedName = encodeURIComponent(name);
    const response = await fetch(`${API_BASE_URL}/concepts/by-name/${encodedName}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch concept: ${response.statusText}`);
    }
    return response.json();
}

/**
 * Fetch a concept by URL slug (Wikipedia-style)
 */
export async function getConceptBySlug(slug: string): Promise<Concept> {
    const encodedSlug = encodeURIComponent(slug);
    const response = await fetch(`${API_BASE_URL}/concepts/by-slug/${encodedSlug}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch concept by slug: ${response.statusText}`);
    }
    return response.json();
}

/**
 * Update a concept (partial update)
 */
export async function updateConcept(
    nodeId: string,
    updates: {
        description?: string;
        tags?: string[];
        domain?: string;
        type?: string;
    }
): Promise<Concept> {
    const response = await fetch(`${API_BASE_URL}/concepts/${nodeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
    });
    if (!response.ok) {
        throw new Error(`Failed to update concept: ${response.statusText}`);
    }
    return response.json();
}

/**
 * Fetch neighbors of a concept
 */
export async function getNeighbors(nodeId: string): Promise<Concept[]> {
    const response = await fetch(`${API_BASE_URL}/concepts/${nodeId}/neighbors`);
    if (!response.ok) {
        throw new Error(`Failed to fetch neighbors: ${response.statusText}`);
    }
    return response.json();
}

/**
 * Fetch neighbors with their relationship types
 */
export async function getNeighborsWithRelationships(nodeId: string): Promise<Array<{
    concept: Concept;
    predicate: string;
    is_outgoing: boolean;
    relationship_status?: string;
    relationship_confidence?: number;
    relationship_method?: string;
    relationship_rationale?: string;
    relationship_source_id?: string;
    relationship_chunk_id?: string;
}>> {
    const response = await fetch(`${API_BASE_URL}/concepts/${nodeId}/neighbors-with-relationships`);
    if (!response.ok) {
        throw new Error(`Failed to fetch neighbors with relationships: ${response.statusText}`);
    }
    return response.json();
}

/**
 * Fetch the full graph starting from a root node
 * This recursively fetches neighbors to build a complete subgraph
 * OPTIMIZED: Parallelizes fetching at each depth level for faster loading
 */
export async function fetchGraphData(rootNodeId: string, maxDepth: number = 2): Promise<GraphData> {
    const nodes = new Map<string, Concept>();
    const links: Array<{
        source: string;
        target: string;
        predicate: string;
        relationship_status?: string;
        relationship_confidence?: number;
        relationship_method?: string;
        rationale?: string;
        relationship_source_id?: string;
        relationship_chunk_id?: string;
    }> = [];
    const linkSet = new Set<string>(); // Track links to avoid duplicates
    const visited = new Set<string>();

    /**
     * Fetch a single node and its neighbors, then return the neighbor IDs for next level
     * This allows us to parallelize all fetches at the same depth
     */
    async function fetchNodeAndNeighbors(nodeId: string): Promise<string[]> {
        if (visited.has(nodeId)) {
            return [];
        }
        visited.add(nodeId);

        try {
            // Fetch node and neighbors in parallel (they're independent)
            const [node, neighborsWithRels] = await Promise.all([
                getConcept(nodeId),
                getNeighborsWithRelationships(nodeId)
            ]);

            nodes.set(nodeId, node);
            const neighborIds: string[] = [];

            // Process all neighbors
            for (const { concept, predicate, is_outgoing, relationship_status, relationship_confidence, relationship_method, relationship_rationale, relationship_source_id, relationship_chunk_id } of neighborsWithRels) {
                nodes.set(concept.node_id, concept);
                neighborIds.push(concept.node_id);

                // Create link with proper direction and predicate
                const linkKey = is_outgoing
                    ? `${nodeId}->${concept.node_id}:${predicate}`
                    : `${concept.node_id}->${nodeId}:${predicate}`;

                if (!linkSet.has(linkKey)) {
                    linkSet.add(linkKey);
                    links.push({
                        source: is_outgoing ? nodeId : concept.node_id,
                        target: is_outgoing ? concept.node_id : nodeId,
                        predicate,
                        relationship_status,
                        relationship_confidence,
                        relationship_method,
                        rationale: relationship_rationale,
                        relationship_source_id,
                        relationship_chunk_id,
                    });
                }
            }

            return neighborIds;
        } catch (error) {
            console.error(`Error fetching node ${nodeId}:`, error);
            return [];
        }
    }

    /**
     * Fetch all nodes at a given depth level in parallel
     */
    async function fetchLevel(nodeIds: string[], depth: number): Promise<void> {
        if (depth > maxDepth || nodeIds.length === 0) {
            return;
        }

        // Fetch all nodes at this level in parallel
        const neighborIdArrays = await Promise.all(
            nodeIds.map(nodeId => fetchNodeAndNeighbors(nodeId))
        );

        // Collect all unique neighbor IDs for the next level
        const nextLevelNodeIds = new Set<string>();
        for (const neighborIds of neighborIdArrays) {
            for (const neighborId of neighborIds) {
                if (!visited.has(neighborId)) {
                    nextLevelNodeIds.add(neighborId);
                }
            }
        }

        // Recursively fetch the next level
        if (nextLevelNodeIds.size > 0) {
            await fetchLevel(Array.from(nextLevelNodeIds), depth + 1);
        }
    }

    // Start fetching from the root node
    await fetchLevel([rootNodeId], 0);

    return {
        nodes: Array.from(nodes.values()),
        links,
    };
}

/**
 * Fetch all graph data (nodes and relationships)
 * NOTE: For large graphs, consider using getGraphOverview instead.
 */
export async function getAllGraphData(): Promise<GraphData> {
    try {
        const response = await fetch(`${API_BASE_URL}/concepts/all/graph`);
        if (!response.ok) {
            throw new Error(`Failed to fetch graph data: ${response.statusText}`);
        }
        const data = await response.json();
        return {
            nodes: data.nodes || [],
            links: (data.links || []).map((link: any) => ({
                source: link.source_id,
                target: link.target_id,
                predicate: link.predicate,
                relationship_status: link.status,
                relationship_confidence: link.confidence,
                relationship_method: link.method,
                rationale: link.rationale,
                relationship_source_id: link.relationship_source_id,
                relationship_chunk_id: link.chunk_id,
            })),
        };
    } catch (error) {
        console.error('Error fetching graph data:', error);
        // Return empty graph data instead of throwing to prevent UI crashes
        return { nodes: [], links: [] };
    }
}

/**
 * Create a relationship between two nodes by their IDs
 */
export async function createRelationshipByIds(
    sourceId: string,
    targetId: string,
    predicate: string
): Promise<void> {
    const params = new URLSearchParams({
        source_id: sourceId,
        target_id: targetId,
        predicate: predicate,
    });
    const response = await fetch(`${API_BASE_URL}/concepts/relationship-by-ids?${params}`, {
        method: 'POST',
    });
    if (!response.ok) {
        throw new Error(`Failed to create relationship: ${response.statusText}`);
    }
}

/**
 * Propose a relationship between two concepts (creates PROPOSED status)
 */
export async function proposeRelationship(
    sourceId: string,
    targetId: string,
    predicate: string,
    rationale?: string
): Promise<{ status: string; message: string; exists: boolean }> {
    const params = new URLSearchParams({
        source_id: sourceId,
        target_id: targetId,
        predicate: predicate,
    });
    if (rationale) {
        params.append('rationale', rationale);
    }
    const response = await fetch(`${API_BASE_URL}/concepts/relationship/propose?${params}`, {
        method: 'POST',
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: response.statusText }));
        throw new Error(error.detail || `Failed to propose relationship: ${response.statusText}`);
    }
    return response.json();
}

/**
 * Check if a relationship exists between two concepts
 */
export async function checkRelationshipExists(
    sourceId: string,
    targetId: string,
    predicate: string
): Promise<boolean> {
    const params = new URLSearchParams({
        source_id: sourceId,
        target_id: targetId,
        predicate: predicate,
    });
    const response = await fetch(`${API_BASE_URL}/concepts/relationship/check?${params}`);
    if (!response.ok) {
        throw new Error(`Failed to check relationship: ${response.statusText}`);
    }
    const data = await response.json();
    return data.exists;
}

/**
 * Create a new concept
 */
export async function createConcept(concept: {
    name: string;
    domain: string;
    type?: string;
    description?: string | null;
    notes_key?: string | null;
    lecture_key?: string | null;
    url_slug?: string | null;
    graph_id?: string | null;
    add_to_global?: boolean;
}): Promise<Concept> {
    const params = new URLSearchParams();
    if (concept.graph_id) {
        params.append('graph_id', concept.graph_id);
    }
    if (concept.add_to_global) {
        params.append('add_to_global', 'true');
    }
    const url = `${API_BASE_URL}/concepts/${params.toString() ? '?' + params.toString() : ''}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: concept.name,
            domain: concept.domain,
            type: concept.type,
            description: concept.description,
            notes_key: concept.notes_key,
            lecture_key: concept.lecture_key,
            url_slug: concept.url_slug,
        }),
    });
    if (!response.ok) {
        throw new Error(`Failed to create concept: ${response.statusText}`);
    }
    return response.json();
}

/**
 * Get all instances of a concept across all graphs by matching the concept name
 */
export async function getCrossGraphInstances(nodeId: string): Promise<{
    concept_name: string;
    instances: Array<{
        node_id: string;
        name: string;
        domain: string;
        type: string;
        description: string | null;
        graph_id: string;
        graph_name: string;
        created_by: string | null;
        last_updated_by: string | null;
    }>;
    total_instances: number;
}> {
    const response = await fetch(`${API_BASE_URL}/concepts/${encodeURIComponent(nodeId)}/cross-graph-instances`);
    if (!response.ok) {
        throw new Error(`Failed to get cross-graph instances: ${response.statusText}`);
    }
    return response.json();
}

/**
 * Link two concept instances across graphs
 */
export async function linkCrossGraphInstances(
    sourceNodeId: string,
    targetNodeId: string,
    linkType: 'user_linked' | 'manual_merge' | 'auto_detected' = 'user_linked'
): Promise<{
    source_node_id: string;
    target_node_id: string;
    source_graph_id: string;
    target_graph_id: string;
    link_type: string;
    linked_at: string;
    linked_by: string;
}> {
    const params = new URLSearchParams();
    params.append('target_node_id', targetNodeId);
    params.append('link_type', linkType);
    const response = await fetch(
        `${API_BASE_URL}/concepts/${encodeURIComponent(sourceNodeId)}/link-cross-graph?${params.toString()}`,
        { method: 'POST' }
    );
    if (!response.ok) {
        throw new Error(`Failed to link cross-graph instances: ${response.statusText}`);
    }
    return response.json();
}

/**
 * Get all linked cross-graph instances for a concept
 */
export async function getLinkedInstances(nodeId: string): Promise<{
    instances: Array<{
        node_id: string;
        name: string;
        domain: string;
        type: string;
        description: string | null;
        graph_id: string;
        graph_name: string;
        link_type: string;
        linked_at: string;
        linked_by: string;
    }>;
    total: number;
}> {
    const response = await fetch(`${API_BASE_URL}/concepts/${encodeURIComponent(nodeId)}/linked-instances`);
    if (!response.ok) {
        throw new Error(`Failed to get linked instances: ${response.statusText}`);
    }
    return response.json();
}

/**
 * Delete a concept
 */
export async function deleteConcept(nodeId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/concepts/${nodeId}`, {
        method: 'DELETE',
    });
    if (!response.ok) {
        throw new Error(`Failed to delete concept: ${response.statusText}`);
    }
}

/**
 * Delete a relationship
 */
export async function deleteRelationship(
    sourceId: string,
    targetId: string,
    predicate: string
): Promise<void> {
    const params = new URLSearchParams({
        source_id: sourceId,
        target_id: targetId,
        predicate: predicate,
    });
    const response = await fetch(`${API_BASE_URL}/concepts/relationship?${params}`, {
        method: 'DELETE',
    });
    if (!response.ok) {
        throw new Error(`Failed to delete relationship: ${response.statusText}`);
    }
}

/**
 * Search for concepts by name (keyword search)
 */
export async function searchConcepts(
    query: string,
    graphId?: string,
    limit: number = 20
): Promise<{
    query: string;
    results: Concept[];
    count: number;
}> {
    const params = new URLSearchParams();
    params.set('q', query);
    if (graphId) {
        params.set('graph_id', graphId);
    }
    params.set('limit', limit.toString());
    const response = await fetch(`${API_BASE_URL}/concepts/search?${params.toString()}`);
    if (!response.ok) {
        throw new Error(`Failed to search concepts: ${response.statusText}`);
    }
    return response.json();
}

/**
 * Cleanup test data
 */
export async function cleanupTestData(): Promise<{ message: string }> {
    const response = await fetch(`${API_BASE_URL}/concepts/cleanup-test-data`, {
        method: 'POST',
    });
    if (!response.ok) {
        throw new Error(`Failed to cleanup test data: ${response.statusText}`);
    }
    return response.json();
}
