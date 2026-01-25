/**
 * Review related API methods
 */

import { API_BASE_URL } from './base';
import {
    RelationshipReviewListResponse,
    RelationshipReviewActionResponse
} from './types';

export async function listProposedRelationships(
    graphId: string,
    status: string = 'PROPOSED',
    limit: number = 50,
    offset: number = 0,
    ingestionRunId?: string
): Promise<RelationshipReviewListResponse> {
    const params = new URLSearchParams({
        graph_id: graphId,
        status,
        limit: limit.toString(),
        offset: offset.toString(),
    });
    if (ingestionRunId) {
        params.append('ingestion_run_id', ingestionRunId);
    }
    const res = await fetch(
        `${API_BASE_URL}/review/relationships?${params.toString()}`
    );
    if (!res.ok) throw new Error('Failed to load relationships for review');
    return res.json();
}

export async function acceptRelationships(
    graphId: string | null,
    edges: Array<{ src_node_id: string; dst_node_id: string; rel_type: string }>,
    reviewedBy?: string
): Promise<RelationshipReviewActionResponse> {
    const res = await fetch(`${API_BASE_URL}/review/relationships/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            graph_id: graphId,
            edges,
            reviewed_by: reviewedBy,
        }),
    });
    if (!res.ok) throw new Error('Failed to accept relationships');
    return res.json();
}

export async function rejectRelationships(
    graphId: string | null,
    edges: Array<{ src_node_id: string; dst_node_id: string; rel_type: string }>,
    reviewedBy?: string
): Promise<RelationshipReviewActionResponse> {
    const res = await fetch(`${API_BASE_URL}/review/relationships/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            graph_id: graphId,
            edges,
            reviewed_by: reviewedBy,
        }),
    });
    if (!res.ok) throw new Error('Failed to reject relationships');
    return res.json();
}

export async function editRelationship(
    graphId: string | null,
    srcNodeId: string,
    dstNodeId: string,
    oldRelType: string,
    newRelType: string,
    reviewedBy?: string
): Promise<RelationshipReviewActionResponse> {
    const res = await fetch(`${API_BASE_URL}/review/relationships/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            graph_id: graphId,
            src_node_id: srcNodeId,
            dst_node_id: dstNodeId,
            old_rel_type: oldRelType,
            new_rel_type: newRelType,
            reviewed_by: reviewedBy,
        }),
    });
    if (!res.ok) throw new Error('Failed to edit relationship');
    return res.json();
}
