/**
 * Feedback related API methods
 */

import { API_BASE_URL } from './base';

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
        headers: { 'Content-Type': 'application/json' },
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
