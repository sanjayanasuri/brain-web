/**
 * Note image ingestion (Phase D)
 */

import { API_BASE_URL, getApiHeaders } from './base';
import type { NoteImageIngestRequest, NoteImageIngestResponse } from './types';

export async function ingestNoteImage(payload: NoteImageIngestRequest): Promise<NoteImageIngestResponse> {
    const response = await fetch(`${API_BASE_URL}/note-images/ingest`, {
        method: 'POST',
        headers: await getApiHeaders(),
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to ingest note image: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

