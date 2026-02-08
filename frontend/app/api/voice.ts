import { API_BASE_URL, getApiHeaders } from './base';
import {
    VoiceCaptureRequest,
    Signal,
    VoiceCommandRequest,
    VoiceCommandResponse
} from './types';

/**
 * Send voice capture (Mode A: Passive transcription for learning state)
 */
export async function sendVoiceCapture(payload: VoiceCaptureRequest): Promise<Signal> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/voice/capture`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to send voice capture: ${res.statusText} - ${errorText}`);
    }
    return res.json();
}

/**
 * Send voice command (Mode B: Active control for system orchestration)
 */
export async function sendVoiceCommand(payload: VoiceCommandRequest): Promise<VoiceCommandResponse> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/voice/command`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to send voice command: ${res.statusText} - ${errorText}`);
    }
    return res.json();
}

/**
 * Start a new voice agent session
 */
export async function startVoiceSession(graphId: string, branchId: string, metadata?: any): Promise<any> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/voice-agent/session/start`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ graph_id: graphId, branch_id: branchId, metadata }),
    });
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to start voice session: ${res.statusText} - ${errorText}`);
    }
    return res.json();
}

/**
 * Stop an active voice agent session
 */
export async function stopVoiceSession(sessionId: string, durationSeconds: number, tokensUsed: number): Promise<any> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/voice-agent/session/stop/${sessionId}?duration_seconds=${durationSeconds}&tokens_used=${tokensUsed}`, {
        method: 'POST',
        headers,
    });
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to stop voice session: ${res.statusText} - ${errorText}`);
    }
    return res.json();
}

/**
 * Get interaction context for voice agent
 */
export async function getInteractionContext(graphId: string, branchId: string, transcript: string, isScribeMode: boolean = false, sessionId: string | null = null): Promise<any> {
    const headers = await getApiHeaders();
    let url = `${API_BASE_URL}/voice-agent/interaction/context?graph_id=${graphId}&branch_id=${branchId}&transcript=${encodeURIComponent(transcript)}&is_scribe_mode=${isScribeMode}`;
    if (sessionId) {
        url += `&session_id=${sessionId}`;
    }

    const res = await fetch(url, {
        method: 'POST',
        headers,
    });
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to get interaction context: ${res.statusText} - ${errorText}`);
    }
    return res.json();
}
