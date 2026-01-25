/**
 * Voice related API methods
 */

import { API_BASE_URL } from './base';
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
    const res = await fetch(`${API_BASE_URL}/voice/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    const res = await fetch(`${API_BASE_URL}/voice/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to send voice command: ${res.statusText} - ${errorText}`);
    }
    return res.json();
}
