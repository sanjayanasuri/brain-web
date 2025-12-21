import type { Resource } from '../api-client';

/**
 * Type guard to check if a resource is a finance snapshot resource.
 * A finance snapshot resource has:
 * - source === "browser_use"
 * - metadata with keys: identity, size, price, news, comparables
 */
export function isFinanceSnapshotResource(res: Resource): boolean {
  if (res.source !== 'browser_use') {
    return false;
  }
  
  if (!res.metadata || typeof res.metadata !== 'object') {
    return false;
  }
  
  const meta = res.metadata;
  return (
    typeof meta.identity === 'object' &&
    typeof meta.size === 'object' &&
    typeof meta.price === 'object' &&
    Array.isArray(meta.news) &&
    Array.isArray(meta.comparables)
  );
}

/**
 * Extract the as_of date from a finance snapshot resource.
 * Tries price.as_of first, then size.as_of.
 * Returns null if not found or invalid.
 */
export function getSnapshotAsOf(res: Resource): Date | null {
  if (!isFinanceSnapshotResource(res)) {
    return null;
  }
  
  const meta = res.metadata!;
  const asOfStr = meta.price?.as_of || meta.size?.as_of;
  
  if (!asOfStr || typeof asOfStr !== 'string') {
    return null;
  }
  
  const date = new Date(asOfStr);
  if (isNaN(date.getTime())) {
    return null;
  }
  
  return date;
}

/**
 * Get freshness badge info for a snapshot date.
 * Returns: { label: string, color: string, bgColor: string }
 */
export function getFreshnessBadge(asOf: Date | null): { label: string; color: string; bgColor: string } {
  if (!asOf) {
    return { label: 'Unknown', color: '#6b7280', bgColor: 'rgba(107, 114, 128, 0.15)' };
  }
  
  const now = new Date();
  const diffMs = now.getTime() - asOf.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays <= 3) {
    return { label: 'Fresh', color: '#22c55e', bgColor: 'rgba(34, 197, 94, 0.15)' };
  } else if (diffDays <= 7) {
    return { label: 'Aging', color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.15)' };
  } else {
    return { label: 'Stale', color: '#ef4444', bgColor: 'rgba(239, 68, 68, 0.15)' };
  }
}

/**
 * Format a date for display (e.g., "Jan 15, 2024").
 */
export function formatSnapshotDate(date: Date | null): string {
  if (!date) return 'Unknown';
  
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Get confidence display value, handling both string and numeric formats.
 */
export function getConfidenceDisplay(confidence: any): string | null {
  if (confidence === null || confidence === undefined) {
    return null;
  }
  
  if (typeof confidence === 'string') {
    // Handle "high", "medium", "low"
    return confidence.charAt(0).toUpperCase() + confidence.slice(1);
  }
  
  if (typeof confidence === 'number') {
    // Handle numeric 0-1 scale
    return `${(confidence * 100).toFixed(0)}%`;
  }
  
  return null;
}

