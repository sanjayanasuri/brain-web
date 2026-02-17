/**
 * Scheduler related API methods
 */

import { API_BASE_URL, getApiHeaders } from './base';
import {
    TaskListResponse,
    TaskCreate,
    Task,
    TaskUpdate,
    FreeBlocksResponse,
    SuggestionsResponse,
    BackgroundTask
} from './types';

/**
 * List tasks
 */
export async function listTasks(rangeDays: number = 7): Promise<TaskListResponse> {
    const headers = await getApiHeaders();
    const response = await fetch(`${API_BASE_URL}/tasks?range=${rangeDays}`, { headers });
    if (!response.ok) {
        throw new Error(`Failed to list tasks: ${response.statusText}`);
    }
    return response.json();
}

/**
 * Create a task
 */
export async function createTask(payload: TaskCreate): Promise<Task> {
    const headers = await getApiHeaders();
    const response = await fetch(`${API_BASE_URL}/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create task: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

/**
 * Update a task
 */
export async function updateTask(taskId: string, payload: TaskUpdate): Promise<Task> {
    const headers = await getApiHeaders();
    const response = await fetch(`${API_BASE_URL}/tasks/${taskId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to update task: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

/**
 * Delete a task
 */
export async function deleteTask(taskId: string): Promise<{ status: string; task_id: string }> {
    const headers = await getApiHeaders();
    const response = await fetch(`${API_BASE_URL}/tasks/${taskId}`, {
        method: 'DELETE',
        headers,
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to delete task: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

/**
 * List free time blocks
 */
export async function listFreeBlocks(start: string, end: string): Promise<FreeBlocksResponse> {
    const headers = await getApiHeaders();
    const response = await fetch(`${API_BASE_URL}/schedule/free-blocks?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, { headers });
    if (!response.ok) {
        throw new Error(`Failed to list free blocks: ${response.statusText}`);
    }
    return response.json();
}

/**
 * Generate plan suggestions
 */
export async function generateSuggestions(start: string, end: string): Promise<SuggestionsResponse> {
    const headers = await getApiHeaders();
    const response = await fetch(`${API_BASE_URL}/schedule/suggestions?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, {
        method: 'POST',
        headers,
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to generate suggestions: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

/**
 * List existing suggestions
 */
export async function listSuggestions(start: string, end: string): Promise<SuggestionsResponse> {
    const headers = await getApiHeaders();
    const response = await fetch(`${API_BASE_URL}/schedule/suggestions?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, { headers });
    if (!response.ok) {
        throw new Error(`Failed to list suggestions: ${response.statusText}`);
    }
    return response.json();
}

/**
 * Accept a suggestion
 */
export async function acceptSuggestion(suggestionId: string): Promise<{ status: string; suggestion_id: string }> {
    const headers = await getApiHeaders();
    const response = await fetch(`${API_BASE_URL}/schedule/suggestions/${suggestionId}/accept`, {
        method: 'POST',
        headers,
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to accept suggestion: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

/**
 * Reject a suggestion
 */
export async function rejectSuggestion(suggestionId: string): Promise<{ status: string; suggestion_id: string }> {
    const headers = await getApiHeaders();
    const response = await fetch(`${API_BASE_URL}/schedule/suggestions/${suggestionId}/reject`, {
        method: 'POST',
        headers,
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to reject suggestion: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

/**
 * Mark a suggestion as completed
 */
export async function completeSuggestion(suggestionId: string): Promise<{ status: string; suggestion_id: string }> {
    const headers = await getApiHeaders();
    const response = await fetch(`${API_BASE_URL}/schedule/suggestions/${suggestionId}/complete`, {
        method: 'POST',
        headers,
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to complete suggestion: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

export async function getTask(taskId: string): Promise<BackgroundTask> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/tasks/${taskId}`, { headers });
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to get task: ${res.statusText} - ${errorText}`);
    }
    return res.json();
}
