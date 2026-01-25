/**
 * Admin related API methods
 */

import { API_BASE_URL } from './base';
import {
    GraphFilesResponse,
    FilePreviewResponse,
    WorkflowStatusResponse
} from './types';

export async function getGraphFiles(): Promise<GraphFilesResponse> {
    const res = await fetch(`${API_BASE_URL}/admin/graph-files`);
    if (!res.ok) {
        throw new Error(`Failed to get graph files: ${res.statusText}`);
    }
    return res.json();
}

export async function previewGraphFile(filename: string, lines: number = 10): Promise<FilePreviewResponse> {
    const res = await fetch(`${API_BASE_URL}/admin/graph-files/preview/${encodeURIComponent(filename)}?lines=${lines}`);
    if (!res.ok) {
        throw new Error(`Failed to preview file: ${res.statusText}`);
    }
    return res.json();
}

export function downloadGraphFile(filename: string): void {
    const url = `${API_BASE_URL}/admin/graph-files/download/${encodeURIComponent(filename)}`;
    window.open(url, '_blank');
}

export async function triggerExport(perGraph: boolean = true): Promise<{ status: string; detail: string }> {
    const res = await fetch(`${API_BASE_URL}/admin/export?per_graph=${perGraph}`, {
        method: 'POST',
    });
    if (!res.ok) {
        throw new Error(`Failed to trigger export: ${res.statusText}`);
    }
    return res.json();
}

export async function getWorkflowStatus(): Promise<WorkflowStatusResponse> {
    const res = await fetch(`${API_BASE_URL}/workflows/status`);
    if (!res.ok) {
        throw new Error(`Failed to get workflow status: ${res.statusText}`);
    }
    return res.json();
}
