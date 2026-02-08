/**
 * Lecture related API methods
 */

import { API_BASE_URL, getApiHeaders } from './base';
import {
    LectureIngestResult,
    LectureBlock,
    LectureBlockUpsert,
    LectureMention,
    LectureMentionCreate,
    LectureMentionUpdate,
    Lecture,
    LectureSegment,
    LectureLinkResolveRequest,
    LectureLinkResolveResponse,
    LectureLink,
    LectureLinkSourceType,
    LectureSection,
    NotebookPage
} from './types';

/**
 * Ingest a lecture by extracting concepts and relationships using LLM
 */
export async function ingestLecture(payload: {
    lecture_title: string;
    lecture_text: string;
    domain?: string;
}): Promise<LectureIngestResult> {
    const response = await fetch(`${API_BASE_URL}/lectures/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to ingest lecture: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

/**
 * Fetch all blocks for a lecture
 */
export async function getLectureBlocks(lectureId: string): Promise<LectureBlock[]> {
    const response = await fetch(`${API_BASE_URL}/lectures/${lectureId}/blocks`);
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch lecture blocks: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

/**
 * Upsert lecture blocks
 */
export async function upsertLectureBlocks(
    lectureId: string,
    blocks: LectureBlockUpsert[]
): Promise<LectureBlock[]> {
    const response = await fetch(`${API_BASE_URL}/lectures/${lectureId}/blocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks }),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to upsert lecture blocks: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

/**
 * Fetch all linked mentions for a lecture
 */
export async function getLectureMentions(lectureId: string): Promise<LectureMention[]> {
    const response = await fetch(`${API_BASE_URL}/lectures/${lectureId}/mentions`);
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch lecture mentions: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

/**
 * Create a linked mention
 */
export async function createLectureMention(payload: LectureMentionCreate): Promise<LectureMention> {
    const response = await fetch(`${API_BASE_URL}/mentions/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create lecture mention: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

/**
 * Update a linked mention
 */
export async function updateLectureMention(
    mentionId: string,
    payload: LectureMentionUpdate
): Promise<LectureMention> {
    const response = await fetch(`${API_BASE_URL}/mentions/${mentionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to update lecture mention: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

/**
 * Delete a linked mention
 */
export async function deleteLectureMention(mentionId: string): Promise<{ status: string; mention_id: string }> {
    const response = await fetch(`${API_BASE_URL}/mentions/${mentionId}`, {
        method: 'DELETE',
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to delete lecture mention: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

/**
 * Fetch concept backlinks from lecture mentions
 */
export async function getConceptMentions(conceptId: string): Promise<LectureMention[]> {
    const response = await fetch(`${API_BASE_URL}/concepts/${conceptId}/mentions`);
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch concept mentions: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

/**
 * List all lectures
 */
export async function listLectures(): Promise<Lecture[]> {
    const response = await fetch(`${API_BASE_URL}/lectures/`);
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to list lectures: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

export async function getLecture(lectureId: string): Promise<Lecture> {
    const response = await fetch(`${API_BASE_URL}/lectures/${lectureId}`);
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch lecture: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

/**
 * Create a new lecture
 */
export async function createLecture(payload: {
    title: string;
    description?: string | null;
    primary_concept?: string | null;
    level?: string | null;
    estimated_time?: number | null;
    slug?: string | null;
    raw_text?: string | null;
}): Promise<Lecture> {
    const response = await fetch(`${API_BASE_URL}/lectures/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create lecture: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

/**
 * Update a lecture's title, raw_text, metadata_json, and/or annotations
 */
export async function updateLecture(
    lectureId: string,
    payload: {
        title?: string | null;
        raw_text?: string | null;
        metadata_json?: string | null;
        annotations?: string | null;
    }
): Promise<Lecture> {
    const response = await fetch(`${API_BASE_URL}/lectures/${lectureId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to update lecture: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

/**
 * Fetch all segments for a lecture
 */
export async function getLectureSegments(lectureId: string): Promise<LectureSegment[]> {
    const response = await fetch(`${API_BASE_URL}/lectures/${lectureId}/segments`);
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch lecture segments: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

/**
 * Update a lecture segment's text and/or other fields
 */
export async function updateSegment(
    segmentId: string,
    payload: {
        text?: string | null;
        summary?: string | null;
        start_time_sec?: number | null;
        end_time_sec?: number | null;
        style_tags?: string[] | null;
    }
): Promise<LectureSegment> {
    const response = await fetch(`${API_BASE_URL}/lectures/segments/${segmentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to update segment: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

export async function resolveLectureLinks(
    payload: LectureLinkResolveRequest
): Promise<LectureLinkResolveResponse> {
    const response = await fetch(`${API_BASE_URL}/lecture-links/resolve`, {
        method: 'POST',
        headers: await getApiHeaders(),
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to resolve lecture links: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

export async function listLectureLinks(
    chatId: string,
    sourceType: LectureLinkSourceType,
    sourceId: string
): Promise<LectureLink[]> {
    const params = new URLSearchParams({
        chat_id: chatId,
        source_type: sourceType,
        source_id: sourceId,
    });
    const response = await fetch(`${API_BASE_URL}/lecture-links?${params.toString()}`, {
        headers: await getApiHeaders(),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to list lecture links: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

export async function getLectureSection(
    lectureId: string,
    sectionId: string,
    linkId?: string | null
): Promise<LectureSection> {
    const params = new URLSearchParams();
    if (linkId) {
        params.set('link_id', linkId);
    }
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const response = await fetch(`${API_BASE_URL}/lectures/${lectureId}/sections/${sectionId}${suffix}`, {
        headers: await getApiHeaders(),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch lecture section: ${response.statusText} - ${errorText}`);
    }
    const data = await response.json();
    return data.section || data;
}

export async function submitLectureLinkFeedback(
    linkId: string,
    action: 'dismiss' | 'helpful'
): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/lecture-links/${linkId}/feedback`, {
        method: 'POST',
        headers: await getApiHeaders(),
        body: JSON.stringify({ action }),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to submit lecture link feedback: ${response.statusText} - ${errorText}`);
    }
}

/**
 * Fetch segments by concept name
 */
export async function getSegmentsByConcept(conceptName: string): Promise<LectureSegment[]> {
    const encodedName = encodeURIComponent(conceptName);
    const response = await fetch(`${API_BASE_URL}/lectures/segments/by-concept/${encodedName}`);
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch segments by concept: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

/**
 * Fetch all notebook pages for a lecture
 */
export async function getNotebookPages(lectureId: string): Promise<NotebookPage[]> {
    const response = await fetch(`${API_BASE_URL}/lectures/${lectureId}/pages`);
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch notebook pages: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}

/**
 * Update or create a notebook page
 */
export async function updateNotebookPage(
    lectureId: string,
    payload: Partial<NotebookPage> & { page_number: number }
): Promise<NotebookPage> {
    const response = await fetch(`${API_BASE_URL}/lectures/${lectureId}/pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, lecture_id: lectureId }),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to update notebook page: ${response.statusText} - ${errorText}`);
    }
    return response.json();
}
