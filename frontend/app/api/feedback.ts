/**
 * Feedback related API methods
 */

import { API_BASE_URL, getApiHeaders } from './base';

export type FeedbackVerbosity = 'too_short' | 'too_verbose' | 'just_right';
export type FeedbackQuestionPreference = 'more_questions' | 'fewer_questions' | 'ok';
export type FeedbackHumorPreference = 'more_humor' | 'less_humor' | 'ok';

export interface SubmitFeedbackOptions {
    verbosity?: FeedbackVerbosity;
    questionPreference?: FeedbackQuestionPreference;
    humorPreference?: FeedbackHumorPreference;
}

/**
 * Submit feedback on a Brain Web answer
 */
export async function submitFeedback(
    answerId: string,
    rating: number,
    reasoning?: string | null,
    question?: string,
    options?: SubmitFeedbackOptions
): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/feedback/`, {
        method: 'POST',
        headers: await getApiHeaders(),
        body: JSON.stringify({
            answer_id: answerId,
            question: question || '',
            rating,
            reasoning: reasoning || '',
            verbosity: options?.verbosity,
            question_preference: options?.questionPreference,
            humor_preference: options?.humorPreference,
        }),
    });
    if (!response.ok) {
        throw new Error(`Failed to submit feedback: ${response.statusText}`);
    }
}
