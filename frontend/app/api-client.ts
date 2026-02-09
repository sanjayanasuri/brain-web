/**
 * Brain Web API Client
 * Modular structure for better maintainability and performance.
 */

export * from './api/types';
export * from './api/base';
export * from './api/concepts';
export * from './api/graphs';
export * from './api/lectures';
export * from './api/resources';
export * from './api/pdf';
export * from './api/preferences';
export * from './api/integrations';
export * from './api/quality';
export * from './api/suggestions';
export * from './api/review';
export * from './api/ingestion';
export * from './api/trails';
export * from './api/voice';
export * from './api/scheduler';
export * from './api/calendar';
export * from './api/research';
export * from './api/admin';
export * from './api/feedback';
export * from './api/signals';
export * from './api/web-search';
export * from './api/note-images';
export * from './api/fill';

export async function createAnchorBranch(payload: {
    artifact: any;
    bbox: any;
    snippet_image_data_url?: string;
    preview?: string;
    context?: string;
    chat_id?: string;
}): Promise<any> {
    const response = await fetch('/api/contextual-branches/anchor', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error(`Failed to create anchor branch: ${response.statusText}`);
    }

    return response.json();
}
