/**
 * PDF related API methods
 */

import { API_BASE_URL, getApiHeaders } from './base';
import { PDFIngestResponse } from './types';

/**
 * Ingest a PDF file into the knowledge graph
 */
export async function ingestPDF(
    file: File,
    options?: {
        domain?: string;
        use_ocr?: boolean;
        extract_tables?: boolean;
        extract_concepts?: boolean;
        extract_claims?: boolean;
    }
): Promise<PDFIngestResponse> {
    const formData = new FormData();
    formData.append('file', file);
    if (options?.domain) formData.append('domain', options.domain);
    if (options?.use_ocr !== undefined) formData.append('use_ocr', String(options.use_ocr));
    if (options?.extract_tables !== undefined) formData.append('extract_tables', String(options.extract_tables));
    if (options?.extract_concepts !== undefined) formData.append('extract_concepts', String(options.extract_concepts));
    if (options?.extract_claims !== undefined) formData.append('extract_claims', String(options.extract_claims));

    const headers = await getApiHeaders();
    // Remove Content-Type header for FormData (browser will set it with boundary)
    delete headers['Content-Type'];

    const res = await fetch(`${API_BASE_URL}/pdf/ingest`, {
        method: 'POST',
        headers,
        body: formData,
    });

    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to ingest PDF: ${res.statusText} - ${errorText}`);
    }
    return res.json();
}

/**
 * Stream PDF ingestion with real-time progress updates
 * Returns an async generator that yields progress events
 */
export async function* ingestPDFStream(
    file: File,
    options?: {
        domain?: string;
        use_ocr?: boolean;
        extract_tables?: boolean;
        extract_concepts?: boolean;
        extract_claims?: boolean;
    }
): AsyncGenerator<any, void, unknown> {
    const formData = new FormData();
    formData.append('file', file);
    if (options?.domain) formData.append('domain', options.domain);
    if (options?.use_ocr !== undefined) formData.append('use_ocr', String(options.use_ocr));
    if (options?.extract_tables !== undefined) formData.append('extract_tables', String(options.extract_tables));
    if (options?.extract_concepts !== undefined) formData.append('extract_concepts', String(options.extract_concepts));
    if (options?.extract_claims !== undefined) formData.append('extract_claims', String(options.extract_claims));

    const headers = await getApiHeaders();
    // Remove Content-Type header for FormData (browser will set it with boundary)
    delete headers['Content-Type'];

    console.log('Sending PDF ingestion request to:', `${API_BASE_URL}/pdf/ingest-stream`);

    // Add a timeout to detect if the request hangs
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort();
        console.error('PDF ingestion request timed out after 60 seconds');
    }, 60000); // 60 second timeout

    let res;
    try {
        res = await fetch(`${API_BASE_URL}/pdf/ingest-stream`, {
            method: 'POST',
            headers,
            body: formData,
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
    } catch (error: any) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error('PDF ingestion request timed out. The backend may be processing a large file.');
        }
        throw error;
    }

    console.log('Response status:', res.status, res.statusText);
    if (!res.ok) {
        const errorText = await res.text();
        console.error('PDF ingestion request failed:', res.status, errorText);
        throw new Error(`Failed to stream PDF ingestion: ${res.statusText} - ${errorText}`);
    }

    const reader = res.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
        console.error('Response body is not readable');
        throw new Error('Response body is not readable');
    }

    console.log('Stream reader obtained, starting to read events...');

    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            if (line.trim() && line.startsWith('data: ')) {
                try {
                    const jsonStr = line.slice(6).trim();
                    if (jsonStr) {
                        const data = JSON.parse(jsonStr);
                        console.log('Parsed SSE event:', data.type, data);
                        yield data;
                    }
                } catch (e) {
                    console.error('Failed to parse SSE data:', e, 'Line:', line);
                }
            } else if (line.trim() && !line.startsWith(':')) {
                // Log non-empty lines that aren't comments or data
                console.log('SSE line (not data):', line);
            }
        }
    }

    // Process remaining buffer
    if (buffer.trim()) {
        if (buffer.startsWith('data: ')) {
            try {
                const data = JSON.parse(buffer.slice(6));
                yield data;
            } catch (e) {
                console.error('Failed to parse final SSE data:', e);
            }
        }
    }
}
