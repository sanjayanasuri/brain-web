/**
 * Web Search and Discover API methods
 */

import { API_BASE_URL, getApiHeaders } from './base';

/**
 * Fetch top news across multiple categories for the Discover feed
 */
export async function fetchDiscoverNews(): Promise<Record<string, any[]>> {
    const headers = await getApiHeaders();
    const response = await fetch(`${API_BASE_URL}/web-search/discover-news`, {
        headers,
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch discover news: ${response.statusText}`);
    }
    return response.json();
}

/**
 * Fetch news for a specific category
 */
export async function fetchNewsByCategory(category: string, limit: number = 10): Promise<{ category: string, results: any[] }> {
    const headers = await getApiHeaders();
    const response = await fetch(`${API_BASE_URL}/web-search/news-category?category=${category}&limit=${limit}`, {
        headers,
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch news for ${category}: ${response.statusText}`);
    }
    return response.json();
}
