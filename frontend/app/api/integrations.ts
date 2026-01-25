/**
 * Integration related API methods (Notion, etc.)
 */

import { API_BASE_URL } from './base';
import {
    NotionSummaryResponse,
    LectureIngestResult,
    NotionIngestProgressEvent
} from './types';

/**
 * Get summary of Notion pages and databases
 */
export async function getNotionSummary(): Promise<NotionSummaryResponse> {
    const response = await fetch(`${API_BASE_URL}/notion/summary`);
    if (!response.ok) {
        throw new Error(`Failed to fetch Notion summary: ${response.statusText}`);
    }
    return response.json();
}

/**
 * Ingest specific Notion pages
 */
export async function ingestNotionPages(
    pageIds: string[],
    domain?: string
): Promise<LectureIngestResult[]> {
    const response = await fetch(`${API_BASE_URL}/notion/ingest-pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            page_ids: pageIds,
            domain: domain || 'Software Engineering',
        }),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to ingest Notion pages: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

/**
 * Ingest all Notion pages (original sequential method)
 */
export async function ingestAllNotionPages(
    mode: 'pages' | 'databases' | 'both' = 'pages',
    domain?: string
): Promise<LectureIngestResult[]> {
    const response = await fetch(`${API_BASE_URL}/notion/ingest-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            mode,
            domain: domain || 'Software Engineering',
        }),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to ingest all Notion pages: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

/**
 * Ingest all Notion pages with parallel processing and progress updates
 * Uses Server-Sent Events (SSE) to stream progress
 * Returns both the promise and the abort controller for cancellation
 */
export async function ingestAllNotionPagesParallel(
    mode: 'pages' | 'databases' | 'both' = 'pages',
    domain?: string,
    maxWorkers: number = 5,
    useParallel: boolean = true,
    onProgress?: (event: NotionIngestProgressEvent) => void,
    abortController?: AbortController
): Promise<LectureIngestResult[]> {
    return new Promise((resolve, reject) => {
        const controller = abortController || new AbortController();
        const results: LectureIngestResult[] = [];

        fetch(`${API_BASE_URL}/notion/ingest-all-parallel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mode,
                domain: domain || 'Software Engineering',
                max_workers: maxWorkers,
                use_parallel: useParallel,
            }),
            signal: controller.signal,
        })
            .then(async (response) => {
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Failed to start parallel ingestion: ${response.statusText} - ${errorText}`);
                }

                const reader = response.body?.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                if (!reader) {
                    throw new Error('Response body is not readable');
                }

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || ''; // Keep incomplete line in buffer

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const event: NotionIngestProgressEvent = JSON.parse(line.slice(6));

                                if (onProgress) {
                                    onProgress(event);
                                }

                                if (event.type === 'complete') {
                                    if (event.results) {
                                        // Convert dict results back to LectureIngestResult objects
                                        results.push(...event.results as any);
                                    }
                                    resolve(results);
                                    return;
                                } else if (event.type === 'error') {
                                    reject(new Error(event.message || 'Unknown error'));
                                    return;
                                }
                            } catch (e) {
                                console.error('Failed to parse SSE event:', e, line);
                            }
                        }
                    }
                }

                // If we exit the loop without a complete event, resolve with what we have
                resolve(results);
            })
            .catch((error) => {
                if (error.name === 'AbortError') {
                    // User cancelled - resolve with partial results
                    resolve(results);
                } else {
                    reject(error);
                }
            });
    });
}
