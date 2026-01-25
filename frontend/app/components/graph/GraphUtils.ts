import type { Concept, Resource } from '../../api-client';
import { ActivityEvent } from './GraphTypes';

export const DOMAIN_PALETTE = [
    '#118ab2',
    '#ef476f',
    '#06d6a0',
    '#f4a261',
    '#ffb703',
    '#073b4c',
    '#f28482',
    '#7c6ff9',
    '#52b788',
    '#3a86ff',
];

/**
 * Format time ago string (e.g., "2 hours ago", "3 days ago")
 */
export function formatTimeAgo(date: Date | null): string {
    if (!date) return '';
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
        return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    } else if (diffHours > 0) {
        return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    } else if (diffMinutes > 0) {
        return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
    } else {
        return 'Just now';
    }
}

/**
 * Get source icon for evidence source type
 */
export function getSourceIcon(sourceType: string | undefined): string {
    switch (sourceType) {
        case 'browser_use':
            return '🌐';
        case 'upload':
            return '📄';
        case 'notion':
            return '📝';
        case 'sec':
            return '📊';
        case 'ir':
            return '💼';
        case 'news':
            return '📰';
        case 'finance':
            return '💰';
        default:
            return '📌';
    }
}

/**
 * Get human-readable source type name
 */
export function getSourceTypeName(sourceType: string | undefined): string {
    switch (sourceType) {
        case 'browser_use':
            return 'Web';
        case 'upload':
            return 'Upload';
        case 'notion':
            return 'Notion';
        case 'sec':
            return 'SEC';
        case 'ir':
            return 'IR';
        case 'news':
            return 'News';
        case 'finance':
            return 'Finance';
        default:
            return 'Unknown';
    }
}

/**
 * Derive activity events from selectedResources and selectedNode
 */
export function deriveActivityEvents(
    resources: Resource[],
    node: Concept | null,
    onViewEvidence: (resourceId: string) => void
): ActivityEvent[] {
    const events: ActivityEvent[] = [];

    for (const res of resources) {
        let timestamp: Date | null = null;
        if (res.created_at) {
            const date = new Date(res.created_at);
            if (!isNaN(date.getTime())) {
                timestamp = date;
            }
        } else if (res.metadata?.created_at) {
            const ts = res.metadata.created_at;
            if (typeof ts === 'string') {
                const date = new Date(ts);
                if (!isNaN(date.getTime())) {
                    timestamp = date;
                }
            } else if (typeof ts === 'number') {
                const date = new Date(ts);
                if (!isNaN(date.getTime())) {
                    timestamp = date;
                }
            }
        }

        const title = res.title || (res as any).kind || 'Resource';
        const caption = (res as any).caption ? ((res as any).caption.length > 100 ? (res as any).caption.substring(0, 100) + '...' : (res as any).caption) : undefined;

        events.push({
            id: `resource-${res.resource_id}`,
            type: 'RESOURCE_ATTACHED',
            title: `Resource attached: ${title}`,
            timestamp,
            detail: caption,
            resource_id: res.resource_id,
            url: res.url,
            source_badge: (res as any).source || undefined,
            action: {
                label: 'View evidence',
                onClick: () => onViewEvidence(res.resource_id),
            },
        });
    }

    events.sort((a, b) => {
        if (!a.timestamp && !b.timestamp) return 0;
        if (!a.timestamp) return 1;
        if (!b.timestamp) return -1;
        return b.timestamp.getTime() - a.timestamp.getTime();
    });

    return events;
}

/**
 * Normalize sources from metadata to a consistent format.
 */
export function normalizeSources(metadata: Record<string, any> | null | undefined): Array<{ url: string; snippet?: string }> {
    if (!metadata || !metadata.sources) {
        return [];
    }

    const sources = metadata.sources;
    if (!Array.isArray(sources)) {
        return [];
    }

    return sources.map((source: any) => {
        if (typeof source === 'string') {
            return { url: source };
        }
        if (typeof source === 'object' && source !== null && typeof source.url === 'string') {
            return {
                url: source.url,
                snippet: typeof source.snippet === 'string' ? source.snippet : undefined,
            };
        }
        return null;
    }).filter((s: any): s is { url: string; snippet?: string } => s !== null);
}

/**
 * Get confidence badge info
 */
export function getConfidenceBadge(metadata: Record<string, any> | null | undefined): { text: string; bgColor: string; color: string } | null {
    const confidence = metadata?.size?.confidence ?? metadata?.price?.confidence;

    if (confidence === null || confidence === undefined) {
        return null;
    }

    if (typeof confidence === 'number') {
        const percentage = (confidence * 100).toFixed(0);
        let bgColor: string;
        let color: string;

        if (confidence >= 0.7) {
            bgColor = 'rgba(34, 197, 94, 0.15)';
            color = '#22c55e';
        } else if (confidence >= 0.4) {
            bgColor = 'rgba(251, 191, 36, 0.15)';
            color = '#fbbf24';
        } else {
            bgColor = 'rgba(239, 68, 68, 0.15)';
            color = '#ef4444';
        }

        return {
            text: `Confidence: ${percentage}%`,
            bgColor,
            color,
        };
    }

    if (typeof confidence === 'string') {
        const lower = confidence.toLowerCase();
        let bgColor: string;
        let color: string;

        if (lower === 'high') {
            bgColor = 'rgba(34, 197, 94, 0.15)';
            color = '#22c55e';
        } else if (lower === 'medium') {
            bgColor = 'rgba(251, 191, 36, 0.15)';
            color = '#fbbf24';
        } else if (lower === 'low') {
            bgColor = 'rgba(239, 68, 68, 0.15)';
            color = '#ef4444';
        } else {
            bgColor = 'rgba(251, 191, 36, 0.15)';
            color = '#fbbf24';
        }

        return {
            text: `Confidence: ${confidence.charAt(0).toUpperCase() + confidence.slice(1)}`,
            bgColor,
            color,
        };
    }

    return null;
}

export function toRgba(hex: string, alpha: number) {
    let clean = hex.replace('#', '');
    if (clean.length === 3) {
        clean = clean
            .split('')
            .map(ch => ch + ch)
            .join('');
    }
    const num = parseInt(clean, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
