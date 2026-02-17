/**
 * Feedback related API methods
 */

import { API_BASE_URL, getApiHeaders } from './base';

/**
 * Submit feedback on a Brain Web answer
 */
export async function submitFeedback(
    answerId: string,
    rating: number,
    reasoning?: string | null,
    question?: string
): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/feedback/`, {
        method: 'POST',
        headers: await getApiHeaders(),
        body: JSON.stringify({
            answer_id: answerId,
            question: question || '',
            rating,
            reasoning: reasoning || '',
        }),
    });
    if (!response.ok) {
        throw new Error(`Failed to submit feedback: ${response.statusText}`);
    }
}
