/**
 * Preferences, Profile and Dashboard related API methods
 */

import { API_BASE_URL, getApiHeaders } from './base';
import {
    DashboardData,
    ExamData,
    ResponseStyleProfileWrapper,
    FocusArea,
    UserProfile,
    TutorProfile,
    TutorProfilePatch,
    UIPreferences,
    NotionConfig,
    TeachingStyleProfile
} from './types';

export async function getDashboardData(days: number = 7): Promise<DashboardData> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/dashboard/study-analytics?days=${days}`, {
        headers
    });
    if (!res.ok) throw new Error('Failed to load dashboard data');
    return res.json();
}

export async function createExam(payload: {
    title: string;
    exam_date: string;
    assessment_type?: string;
    required_concepts?: string[];
    domain?: string;
    description?: string;
}): Promise<ExamData> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/exams/`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Failed to create exam');
    return res.json();
}

export async function listExams(days_ahead: number = 90): Promise<ExamData[]> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/exams/?days_ahead=${days_ahead}`, {
        headers
    });
    if (!res.ok) throw new Error('Failed to load exams');
    return res.json();
}

export async function updateExam(examId: string, payload: {
    title?: string;
    exam_date?: string;
    required_concepts?: string[];
    domain?: string;
    description?: string;
}): Promise<ExamData> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/exams/${examId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Failed to update exam');
    return res.json();
}

export async function deleteExam(examId: string): Promise<void> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/exams/${examId}`, {
        method: 'DELETE',
        headers
    });
    if (!res.ok) throw new Error('Failed to delete exam');
}

export async function getResponseStyle(): Promise<ResponseStyleProfileWrapper> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/preferences/response-style`, {
        headers
    });
    if (!res.ok) throw new Error('Failed to load response style');
    return res.json();
}

export async function updateResponseStyle(
    wrapper: ResponseStyleProfileWrapper,
): Promise<ResponseStyleProfileWrapper> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/preferences/response-style`, {
        method: 'POST',
        headers,
        body: JSON.stringify(wrapper),
    });
    if (!res.ok) throw new Error('Failed to update response style');
    return res.json();
}

export async function getFocusAreas(): Promise<FocusArea[]> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/preferences/focus-areas`, {
        headers
    });
    if (!res.ok) throw new Error('Failed to load focus areas');
    return res.json();
}

export async function upsertFocusArea(
    area: FocusArea,
): Promise<FocusArea> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/preferences/focus-areas`, {
        method: 'POST',
        headers,
        body: JSON.stringify(area),
    });
    if (!res.ok) throw new Error('Failed to save focus area');
    return res.json();
}

export async function setFocusAreaActive(
    id: string,
    active: boolean,
): Promise<FocusArea> {
    const headers = await getApiHeaders();
    const res = await fetch(
        `${API_BASE_URL}/preferences/focus-areas/${encodeURIComponent(
            id,
        )}/active?active=${active}`,
        {
            method: 'POST',
            headers
        },
    );
    if (!res.ok) throw new Error('Failed to toggle focus area');
    return res.json();
}

export async function getUserProfile(): Promise<UserProfile> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/preferences/user-profile`, {
        headers
    });
    if (!res.ok) throw new Error('Failed to load user profile');
    return res.json();
}

export async function updateUserProfile(
    profile: UserProfile,
): Promise<UserProfile> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/preferences/user-profile`, {
        method: 'POST',
        headers,
        body: JSON.stringify(profile),
    });
    if (!res.ok) throw new Error('Failed to update user profile');
    return res.json();
}

export async function getTutorProfile(): Promise<TutorProfile> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/preferences/tutor-profile`, {
        headers
    });
    if (!res.ok) throw new Error('Failed to load tutor profile');
    return res.json();
}

export async function setTutorProfile(
    profile: TutorProfile,
): Promise<TutorProfile> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/preferences/tutor-profile`, {
        method: 'POST',
        headers,
        body: JSON.stringify(profile),
    });
    if (!res.ok) throw new Error('Failed to save tutor profile');
    return res.json();
}

export async function patchTutorProfile(
    patch: TutorProfilePatch,
): Promise<TutorProfile> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/preferences/tutor-profile`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('Failed to update tutor profile');
    return res.json();
}

export async function getUIPreferences(): Promise<UIPreferences> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/preferences/ui`, {
        headers
    });
    if (!res.ok) throw new Error('Failed to load UI preferences');
    return res.json();
}

export async function updateUIPreferences(
    prefs: UIPreferences,
): Promise<UIPreferences> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/preferences/ui`, {
        method: 'POST',
        headers,
        body: JSON.stringify(prefs),
    });
    if (!res.ok) throw new Error('Failed to update UI preferences');
    return res.json();
}

export async function getNotionConfig(): Promise<NotionConfig> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/admin/notion-config`, {
        headers
    });
    if (!res.ok) throw new Error('Failed to load Notion config');
    return res.json();
}

export async function updateNotionConfig(
    config: NotionConfig,
): Promise<NotionConfig> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/admin/notion-config`, {
        method: 'POST',
        headers,
        body: JSON.stringify(config),
    });
    if (!res.ok) throw new Error('Failed to update Notion config');
    return res.json();
}
