/**
 * Trails related API methods
 */

import { API_BASE_URL } from './base';
import {
    TrailSummary,
    Trail
} from './types';

export async function listTrails(status?: string, limit: number = 10): Promise<{ trails: TrailSummary[] }> {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    params.append('limit', limit.toString());

    const res = await fetch(`${API_BASE_URL}/trails?${params.toString()}`);
    if (!res.ok) {
        throw new Error(`Failed to list trails: ${res.statusText}`);
    }
    return res.json();
}

export async function getTrail(trailId: string): Promise<Trail> {
    const res = await fetch(`${API_BASE_URL}/trails/${trailId}`);
    if (!res.ok) {
        throw new Error(`Failed to get trail: ${res.statusText}`);
    }
    return res.json();
}

export async function createTrail(title: string, pinned: boolean = false): Promise<{ trail_id: string; title: string; status: string }> {
    const res = await fetch(`${API_BASE_URL}/trails/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, pinned }),
    });
    if (!res.ok) {
        throw new Error(`Failed to create trail: ${res.statusText}`);
    }
    return res.json();
}

export async function resumeTrail(trailId: string): Promise<{ trail_id: string; status: string; last_step_id?: string; last_step_index?: number; last_step_kind?: string; last_step_ref_id?: string }> {
    const res = await fetch(`${API_BASE_URL}/trails/${trailId}/resume`, {
        method: 'POST',
    });
    if (!res.ok) {
        throw new Error(`Failed to resume trail: ${res.statusText}`);
    }
    return res.json();
}

export async function archiveTrail(trailId: string): Promise<any> {
    const res = await fetch(`${API_BASE_URL}/trails/${trailId}/archive`, {
        method: 'POST',
    });
    if (!res.ok) {
        throw new Error(`Failed to archive trail: ${res.statusText}`);
    }
    return res.json();
}

export async function appendTrailStep(
    trailId: string,
    kind: string,
    refId: string,
    title?: string,
    note?: string,
    meta?: Record<string, any>
): Promise<{ step_id: string; index: number }> {
    const res = await fetch(`${API_BASE_URL}/trails/${trailId}/append`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, ref_id: refId, title, note, meta }),
    });
    if (!res.ok) {
        throw new Error(`Failed to append step: ${res.statusText}`);
    }
    return res.json();
}
