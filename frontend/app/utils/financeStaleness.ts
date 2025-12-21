/**
 * Compute snapshot staleness based on fetched time and cadence.
 * 
 * Staleness thresholds:
 * - daily: Fresh <12h, Aging 12-24h, Stale >24h
 * - weekly: Fresh <3d, Aging 3-7d, Stale >7d
 * - monthly: Fresh <14d, Aging 14-30d, Stale >30d
 */
export function computeSnapshotStaleness(
  fetchedAtIso: string | undefined,
  cadence: 'daily' | 'weekly' | 'monthly'
): {
  status: 'Fresh' | 'Aging' | 'Stale' | 'Unknown';
  ageHours?: number;
  ageDays?: number;
  display: string;
} {
  if (!fetchedAtIso) {
    return {
      status: 'Unknown',
      display: 'Unknown',
    };
  }

  try {
    const fetchedAt = new Date(fetchedAtIso);
    const now = new Date();
    const diffMs = now.getTime() - fetchedAt.getTime();
    const ageHours = diffMs / (1000 * 60 * 60);
    const ageDays = ageHours / 24;

    let status: 'Fresh' | 'Aging' | 'Stale';
    let display: string;

    if (cadence === 'daily') {
      if (ageHours < 12) {
        status = 'Fresh';
      } else if (ageHours < 24) {
        status = 'Aging';
      } else {
        status = 'Stale';
      }
      if (ageHours < 1) {
        display = `${Math.round(ageHours * 60)}m ago`;
      } else if (ageHours < 24) {
        display = `${Math.round(ageHours)}h ago`;
      } else {
        display = `${Math.round(ageDays)}d ago`;
      }
    } else if (cadence === 'weekly') {
      if (ageDays < 3) {
        status = 'Fresh';
      } else if (ageDays < 7) {
        status = 'Aging';
      } else {
        status = 'Stale';
      }
      if (ageDays < 1) {
        display = `${Math.round(ageHours)}h ago`;
      } else {
        display = `${Math.round(ageDays)}d ago`;
      }
    } else {
      // monthly
      if (ageDays < 14) {
        status = 'Fresh';
      } else if (ageDays < 30) {
        status = 'Aging';
      } else {
        status = 'Stale';
      }
      display = `${Math.round(ageDays)}d ago`;
    }

    return {
      status,
      ageHours,
      ageDays,
      display,
    };
  } catch (e) {
    return {
      status: 'Unknown',
      display: 'Invalid date',
    };
  }
}

/**
 * Get badge styling for staleness status.
 */
export function getStalenessBadgeStyle(status: 'Fresh' | 'Aging' | 'Stale' | 'Unknown'): {
  color: string;
  bgColor: string;
} {
  switch (status) {
    case 'Fresh':
      return { color: '#22c55e', bgColor: 'rgba(34, 197, 94, 0.15)' };
    case 'Aging':
      return { color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.15)' };
    case 'Stale':
      return { color: '#ef4444', bgColor: 'rgba(239, 68, 68, 0.15)' };
    default:
      return { color: '#6b7280', bgColor: 'rgba(107, 114, 128, 0.15)' };
  }
}

