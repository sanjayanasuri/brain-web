/**
 * Graph and branch related API methods
 */

import { UnauthorizedError } from '../lib/UnauthorizedError';
import { API_BASE_URL, getApiHeaders } from './base';
import {
    GraphListResponse,
    CreateGraphOptions,
    GraphSelectResponse,
    BranchListResponse,
    BranchSummary,
    BranchCompareResponse,
    BranchLLMCompareResponse,
    SnapshotSummary,
    GraphData,
    Concept,
    GraphConceptsResponse
} from './types';
import { getGraphDataOfflineLazy } from '../../lib/offline/lazy';

export async function listGraphs(): Promise<GraphListResponse> {
    try {
        const response = await fetch(`${API_BASE_URL}/graphs/`, {
            headers: await getApiHeaders(),
        });
        if (response.status === 401) throw new UnauthorizedError();
        if (!response.ok) {
            throw new Error(`Failed to list graphs: ${response.statusText}`);
        }
        const data = await response.json();
        // Store active graph_id and branch_id for offline use
        if (typeof window !== 'undefined') {
            try {
                if (data.active_graph_id) {
                    sessionStorage.setItem('brainweb:activeGraphId', data.active_graph_id);
                }
                if (data.active_branch_id) {
                    sessionStorage.setItem('brainweb:activeBranchId', data.active_branch_id);
                }
            } catch { }
        }
        return data;
    } catch (error) {
        if (error instanceof UnauthorizedError) throw error;
        console.error('Error fetching graphs:', error);
        // Return demo graph as fallback
        return { active_graph_id: 'demo', active_branch_id: 'main', graphs: [{ graph_id: 'demo', name: 'Demo' }] };
    }
}

export async function createGraph(name: string, options?: CreateGraphOptions): Promise<GraphSelectResponse> {
    const res = await fetch(`${API_BASE_URL}/graphs/`, {
        method: 'POST',
        headers: await getApiHeaders(),
        body: JSON.stringify({ name, ...options }),
    });
    if (!res.ok) throw new Error(`Failed to create graph: ${res.statusText}`);
    return res.json();
}

export async function selectGraph(graphId: string): Promise<GraphSelectResponse> {
    const res = await fetch(`${API_BASE_URL}/graphs/${encodeURIComponent(graphId)}/select`, {
        method: 'POST',
        headers: await getApiHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to select graph: ${res.statusText}`);
    return res.json();
}

export async function listBranches(): Promise<BranchListResponse> {
    try {
        const res = await fetch(`${API_BASE_URL}/branches/`, {
            headers: await getApiHeaders(),
        });
        if (!res.ok) {
            throw new Error(`Failed to list branches: ${res.statusText}`);
        }
        return res.json();
    } catch (error) {
        console.error('Error fetching branches:', error);
        // Return default branch as fallback
        return { graph_id: 'demo', active_branch_id: 'main', branches: [{ branch_id: 'main', graph_id: 'demo', name: 'Main' }] };
    }
}

export async function createBranch(name: string): Promise<BranchSummary> {
    const res = await fetch(`${API_BASE_URL}/branches/create`, {
        method: 'POST',
        headers: await getApiHeaders(),
        body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(`Failed to create branch: ${res.statusText}`);
    return res.json();
}

export async function selectBranch(branchId: string): Promise<{ graph_id: string; active_branch_id: string }> {
    const res = await fetch(`${API_BASE_URL}/branches/${encodeURIComponent(branchId)}/select`, {
        method: 'POST',
        headers: await getApiHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to select branch: ${res.statusText}`);
    return res.json();
}

export async function forkBranchFromNode(
    branchId: string,
    nodeId: string,
    depth: number = 2,
): Promise<any> {
    const res = await fetch(
        `${API_BASE_URL}/branches/${encodeURIComponent(branchId)}/fork-from-node/${encodeURIComponent(nodeId)}`,
        {
            method: 'POST',
            headers: await getApiHeaders(),
            body: JSON.stringify({ depth }),
        },
    );
    if (!res.ok) throw new Error(`Failed to fork branch: ${res.statusText}`);
    return res.json();
}

export async function compareBranches(
    branchId: string,
    otherBranchId: string,
): Promise<BranchCompareResponse> {
    const res = await fetch(
        `${API_BASE_URL}/branches/${encodeURIComponent(branchId)}/compare/${encodeURIComponent(otherBranchId)}`,
        {
            method: 'POST',
            headers: await getApiHeaders(),
        },
    );
    if (!res.ok) throw new Error(`Failed to compare branches: ${res.statusText}`);
    return res.json();
}

export async function llmCompareBranches(payload: {
    branch_id: string;
    other_branch_id: string;
    question?: string | null;
}): Promise<BranchLLMCompareResponse> {
    const res = await fetch(`${API_BASE_URL}/branches/compare`, {
        method: 'POST',
        headers: await getApiHeaders(),
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`Failed LLM compare: ${res.statusText}${t ? ` - ${t}` : ''}`);
    }
    return res.json();
}

export async function createSnapshot(payload: {
    name: string;
    focused_node_id?: string | null;
    layout?: any;
}): Promise<SnapshotSummary> {
    const res = await fetch(`${API_BASE_URL}/snapshots/`, {
        method: 'POST',
        headers: await getApiHeaders(),
        body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Failed to create snapshot: ${res.statusText}`);
    return res.json();
}

export async function listSnapshots(limit: number = 50): Promise<{ snapshots: SnapshotSummary[] }> {
    const res = await fetch(`${API_BASE_URL}/snapshots/?limit=${limit}`, {
        headers: await getApiHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to list snapshots: ${res.statusText}`);
    return res.json();
}

export async function restoreSnapshot(snapshotId: string): Promise<any> {
    const res = await fetch(`${API_BASE_URL}/snapshots/${encodeURIComponent(snapshotId)}/restore`, {
        method: 'POST',
        headers: await getApiHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to restore snapshot: ${res.statusText}`);
    return res.json();
}

/**
 * Fetch graph overview (lightweight subset for fast loading)
 */
export async function getGraphOverview(
    graphId: string,
    limitNodes: number = 300,
    limitEdges: number = 600
): Promise<GraphData & { meta?: { node_count?: number; edge_count?: number; sampled?: boolean } }> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const getOffline = await getGraphDataOfflineLazy();
        const cached = await getOffline();
        if (cached) return { ...cached, meta: { sampled: true } };
    }

    try {
        const response = await fetch(
            `${API_BASE_URL}/graphs/${encodeURIComponent(graphId)}/overview?limit_nodes=${limitNodes}&limit_edges=${limitEdges}`,
            {
                headers: await getApiHeaders(),
            }
        );
        if (!response.ok) {
            const getOffline = await getGraphDataOfflineLazy();
            const cached = await getOffline();
            if (cached) return { ...cached, meta: { sampled: true } };
            throw new Error(`Failed to fetch graph overview: ${response.statusText}`);
        }
        const data = await response.json();
        return {
            nodes: data.nodes || [],
            links: (data.edges || []).map((link: any) => ({
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
            meta: data.meta,
        };
    } catch (error) {
        console.error('Error fetching graph overview:', error);
        return { nodes: [], links: [], meta: { sampled: false } };
    }
}

/**
 * Fetch neighbors of a concept within a specific graph
 */
export async function getGraphNeighbors(
    graphId: string,
    conceptId: string,
    hops: number = 1,
    limit: number = 80
): Promise<{
    center: Concept;
    nodes: Concept[];
    edges: Array<{
        source_id: string;
        target_id: string;
        predicate: string;
        status?: string;
        confidence?: number;
        method?: string;
        rationale?: string;
        relationship_source_id?: string;
        chunk_id?: string;
    }>;
}> {
    try {
        const response = await fetch(
            `${API_BASE_URL}/graphs/${encodeURIComponent(graphId)}/neighbors?concept_id=${encodeURIComponent(conceptId)}&hops=${hops}&limit=${limit}`,
            {
                headers: await getApiHeaders(),
            }
        );
        if (!response.ok) {
            throw new Error(`Failed to fetch neighbors: ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching neighbors:', error);
        throw error;
    }
}

export async function listGraphConcepts(
    graphId: string,
    options?: {
        query?: string;
        domain?: string;
        type?: string;
        sort?: 'alphabetical' | 'degree' | 'recent';
        limit?: number;
        offset?: number;
    }
): Promise<GraphConceptsResponse> {
    try {
        const params = new URLSearchParams();
        if (options?.query) params.set('query', options.query);
        if (options?.domain) params.set('domain', options.domain);
        if (options?.type) params.set('type', options.type);
        if (options?.sort) params.set('sort', options.sort);
        if (options?.limit) params.set('limit', options.limit.toString());
        if (options?.offset) params.set('offset', options.offset.toString());

        const response = await fetch(
            `${API_BASE_URL}/graphs/${encodeURIComponent(graphId)}/concepts?${params.toString()}`,
            {
                headers: await getApiHeaders(),
            }
        );
        if (!response.ok) {
            throw new Error(`Failed to fetch concepts: ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching graph concepts:', error);
        throw error;
    }
}
