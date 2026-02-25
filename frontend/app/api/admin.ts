/**
 * Admin related API methods
 */

import { API_BASE_URL, getApiHeaders } from './base';
import {
    GraphFilesResponse,
    FilePreviewResponse,
    WorkflowStatusResponse
} from './types';

export async function getGraphFiles(): Promise<GraphFilesResponse> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/admin/graph-files`, { headers });
    if (!res.ok) {
        throw new Error(`Failed to get graph files: ${res.statusText}`);
    }
    return res.json();
}

export async function previewGraphFile(filename: string, lines: number = 10): Promise<FilePreviewResponse> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/admin/graph-files/preview/${encodeURIComponent(filename)}?lines=${lines}`, { headers });
    if (!res.ok) {
        throw new Error(`Failed to preview file: ${res.statusText}`);
    }
    return res.json();
}

export async function downloadGraphFile(filename: string): Promise<void> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/admin/graph-files/download/${encodeURIComponent(filename)}`, { headers });
    if (!res.ok) {
        throw new Error(`Failed to download file: ${res.statusText}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export async function triggerExport(perGraph: boolean = true): Promise<{ status: string; detail: string }> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/admin/export?per_graph=${perGraph}`, {
        method: 'POST',
        headers,
    });
    if (!res.ok) {
        throw new Error(`Failed to trigger export: ${res.statusText}`);
    }
    return res.json();
}

export async function getWorkflowStatus(): Promise<WorkflowStatusResponse> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/workflows/status`, { headers });
    if (!res.ok) {
        throw new Error(`Failed to get workflow status: ${res.statusText}`);
    }
    return res.json();
}
