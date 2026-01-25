/**
 * Finance related API methods
 */

import { API_BASE_URL } from './base';
import { FinanceTrackingConfig, Resource, LatestSnapshotMetadata } from './types';

/**
 * Fetch a finance snapshot for a ticker
 */
export async function fetchFinanceSnapshot(
    ticker: string,
    conceptId?: string,
    newsWindowDays: number = 7,
    maxNewsItems: number = 5,
): Promise<Resource> {
    const res = await fetch(`${API_BASE_URL}/finance/snapshot`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            ticker,
            concept_id: conceptId,
            news_window_days: newsWindowDays,
            max_news_items: maxNewsItems,
        }),
    });

    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to fetch finance snapshot: ${res.statusText} - ${errorText}`);
    }
    return res.json();
}

/**
 * Get tracking configuration for a ticker
 */
export async function getFinanceTracking(ticker: string): Promise<FinanceTrackingConfig | null> {
    const res = await fetch(`${API_BASE_URL}/finance/tracking?ticker=${encodeURIComponent(ticker)}`);
    if (!res.ok) {
        if (res.status === 404) {
            return null; // No tracking config exists
        }
        throw new Error(`Failed to get finance tracking: ${res.statusText}`);
    }
    return res.json();
}

/**
 * Set tracking configuration for a ticker
 */
export async function setFinanceTracking(config: FinanceTrackingConfig): Promise<FinanceTrackingConfig> {
    const res = await fetch(`${API_BASE_URL}/finance/tracking`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
    });

    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to set finance tracking: ${res.statusText} - ${errorText}`);
    }
    return res.json();
}

/**
 * List all tracked tickers
 */
export async function listFinanceTracking(): Promise<FinanceTrackingConfig[]> {
    const res = await fetch(`${API_BASE_URL}/finance/tracking/list`);
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to list finance tracking: ${res.statusText} - ${errorText}`);
    }
    const data = await res.json();
    return data.tickers || [];
}

/**
 * Get latest snapshot metadata for multiple tickers
 */
export async function getLatestFinanceSnapshots(tickers: string[]): Promise<LatestSnapshotMetadata[]> {
    if (tickers.length === 0) {
        return [];
    }
    const tickersParam = tickers.join(',');
    const res = await fetch(`${API_BASE_URL}/finance/snapshots/latest?tickers=${encodeURIComponent(tickersParam)}`);
    if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to get latest snapshots: ${res.statusText} - ${errorText}`);
    }
    const data = await res.json();
    return data.snapshots || [];
}
