/**
 * Calendar related API methods
 */

import { API_BASE_URL, getApiHeaders } from './base';
import {
    CalendarEventListResponse,
    ListCalendarEventsOptions,
    CalendarEvent,
    CalendarEventCreate,
    CalendarEventUpdate,
    GetLocationSuggestionsOptions,
    LocationSuggestionsResponse
} from './types';

export async function listCalendarEvents(options: ListCalendarEventsOptions = {}): Promise<CalendarEventListResponse> {
    const params = new URLSearchParams();
    if (options.start_date) params.append('start_date', options.start_date);
    if (options.end_date) params.append('end_date', options.end_date);

    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/calendar/events?${params.toString()}`, {
        headers,
    });
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to list calendar events: ${res.statusText} - ${errorText}`);
    }
    return res.json();
}

export async function getCalendarEvent(eventId: string): Promise<CalendarEvent> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/calendar/events/${eventId}`, {
        headers,
    });
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to get calendar event: ${res.statusText} - ${errorText}`);
    }
    return res.json();
}

export async function createCalendarEvent(event: CalendarEventCreate): Promise<CalendarEvent> {
    const res = await fetch(`${API_BASE_URL}/calendar/events`, {
        method: 'POST',
        headers: await getApiHeaders(),
        body: JSON.stringify(event),
    });
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to create calendar event: ${res.statusText} - ${errorText}`);
    }
    return res.json();
}

export async function updateCalendarEvent(eventId: string, event: CalendarEventUpdate): Promise<CalendarEvent> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/calendar/events/${eventId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(event),
    });
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to update calendar event: ${res.statusText} - ${errorText}`);
    }
    return res.json();
}

export async function deleteCalendarEvent(eventId: string): Promise<{ status: string; event_id: string }> {
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/calendar/events/${eventId}`, {
        method: 'DELETE',
        headers,
    });
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to delete calendar event: ${res.statusText} - ${errorText}`);
    }
    return res.json();
}

export async function getLocationSuggestions(options: GetLocationSuggestionsOptions = {}): Promise<LocationSuggestionsResponse> {
    const params = new URLSearchParams();
    if (options.query) params.append('query', options.query);
    if (options.context) params.append('context', options.context);
    if (options.currentLat !== undefined) params.append('current_lat', options.currentLat.toString());
    if (options.currentLon !== undefined) params.append('current_lon', options.currentLon.toString());

    // Location suggestions work without auth, but include it if available
    const headers = await getApiHeaders();
    const res = await fetch(`${API_BASE_URL}/calendar/locations/suggestions?${params.toString()}`, {
        headers,
    });
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to get location suggestions: ${res.statusText} - ${errorText}`);
    }
    return res.json();
}
