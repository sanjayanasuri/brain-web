// frontend/app/api-client-study.ts
/**
 * Study API client functions for adaptive learning system.
 * Phase 1: Context building and clarification.
 */

import { API_BASE_URL, getApiHeaders } from './api/base';

export interface ContextRequest {
    selection_id: string;
    radius?: number;
    include_related?: boolean;
}

export interface ClarifyRequest {
    selection_id: string;
    radius?: number;
    include_related?: boolean;
}

/**
 * Get context pack from a selection.
 */
export async function getContextFromSelection(req: ContextRequest) {
    const headers = await getApiHeaders();
    const response = await fetch(`${API_BASE_URL}/study/context/from-selection`, {
        method: 'POST',
        headers,
        body: JSON.stringify(req),
    });

    if (!response.ok) {
        throw new Error(`Failed to get context: ${response.statusText}`);
    }

    return response.json();
}

/**
 * Clarify a selection with grounded explanation.
 */
export async function clarifySelection(req: ClarifyRequest) {
    const headers = await getApiHeaders();
    const response = await fetch(`${API_BASE_URL}/study/clarify`, {
        method: 'POST',
        headers,
        body: JSON.stringify(req),
    });

    if (!response.ok) {
        throw new Error(`Failed to clarify: ${response.statusText}`);
    }

    return response.json();
}


// ---------- Phase 2: Session Management ----------

export async function startStudySession(
    intent: string,
    topicId?: string,
    selectionId?: string,
    currentMode: string = 'explain'
) {
    const headers = await getApiHeaders();
    const response = await fetch(`${API_BASE_URL}/study/session/start`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            intent,
            topic_id: topicId,
            selection_id: selectionId,
            current_mode: currentMode,
        }),
    });

    if (!response.ok) {
        let detail = '';
        try {
            detail = await response.text();
        } catch {
            // ignore read errors
        }
        const statusLine = `${response.status} ${response.statusText}`.trim();
        throw new Error(
            `Failed to start session${statusLine ? ` (${statusLine})` : ''}${
                detail ? `: ${detail}` : ''
            }`
        );
    }

    return response.json();
}

export async function getNextTask(sessionId: string, currentMode?: string) {
    const headers = await getApiHeaders();
    const url = `${API_BASE_URL}/study/session/${sessionId}/next${currentMode ? `?current_mode=${currentMode}` : ''}`;

    const response = await fetch(url, {
        method: 'POST',
        headers,
    });

    if (!response.ok) {
        throw new Error('Failed to get next task');
    }

    return response.json();
}

export async function submitAttempt(taskId: string, responseText: string, selfConfidence?: number) {
    const headers = await getApiHeaders();
    const response = await fetch(`${API_BASE_URL}/study/task/${taskId}/attempt`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            response_text: responseText,
            self_confidence: selfConfidence,
        }),
    });

    if (!response.ok) {
        throw new Error('Failed to submit attempt');
    }

    return response.json();
}

export async function endStudySession(sessionId: string) {
    const headers = await getApiHeaders();
    const response = await fetch(`${API_BASE_URL}/study/session/${sessionId}/end`, {
        method: 'POST',
        headers,
    });

    if (!response.ok) {
        throw new Error('Failed to end session');
    }

    return response.json();
}

export async function getSessionState(sessionId: string) {
    const headers = await getApiHeaders();
    const response = await fetch(`${API_BASE_URL}/study/session/${sessionId}`, {
        method: 'GET',
        headers,
    });

    if (!response.ok) {
        throw new Error('Failed to get session state');
    }

    return response.json();
}
