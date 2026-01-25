/**
 * Ingestion related API methods
 */

import { API_BASE_URL } from './base';
import {
    IngestionRun,
    IngestionRunChanges,
    UndoRunResponse,
    RestoreRunResponse
} from './types';

export async function listIngestionRuns(
    limit: number = 20,
    offset: number = 0
): Promise<IngestionRun[]> {
    const res = await fetch(
        `${API_BASE_URL}/ingestion/runs?limit=${limit}&offset=${offset}`
    );
    if (!res.ok) throw new Error('Failed to load ingestion runs');
    return res.json();
}

export async function getIngestionRun(runId: string): Promise<IngestionRun> {
    const res = await fetch(`${API_BASE_URL}/ingestion/runs/${encodeURIComponent(runId)}`);
    if (!res.ok) throw new Error('Failed to load ingestion run');
    return res.json();
}

export async function getIngestionRunChanges(runId: string): Promise<IngestionRunChanges> {
    const res = await fetch(`${API_BASE_URL}/ingestion/runs/${encodeURIComponent(runId)}/changes`);
    if (!res.ok) throw new Error('Failed to load ingestion run changes');
    return res.json();
}

export async function undoIngestionRun(
    runId: string,
    mode: 'SAFE' | 'RELATIONSHIPS_ONLY' = 'SAFE'
): Promise<UndoRunResponse> {
    const res = await fetch(`${API_BASE_URL}/ingestion/runs/${encodeURIComponent(runId)}/undo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
    });
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to undo ingestion run: ${res.statusText} - ${errorText}`);
    }
    return res.json();
}

export async function restoreIngestionRun(runId: string): Promise<RestoreRunResponse> {
    const res = await fetch(`${API_BASE_URL}/ingestion/runs/${encodeURIComponent(runId)}/restore`, {
        method: 'POST',
    });
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to restore ingestion run: ${res.statusText} - ${errorText}`);
    }
    return res.json();
}
