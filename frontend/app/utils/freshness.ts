/**
 * Compute freshness label and age from ISO timestamp
 */
export function computeFreshness(createdAtIso?: string): { 
  label: 'Fresh' | 'Aging' | 'Stale' | 'Unknown', 
  ageDays?: number,
  displayText: string
} {
  if (!createdAtIso) {
    return { label: 'Unknown', displayText: 'Unknown' };
  }

  try {
    const created = new Date(createdAtIso);
    if (isNaN(created.getTime())) {
      return { label: 'Unknown', displayText: 'Unknown' };
    }

    const now = new Date();
    const diffMs = now.getTime() - created.getTime();
    const ageDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    let label: 'Fresh' | 'Aging' | 'Stale';
    let displayText: string;

    if (ageDays <= 7) {
      label = 'Fresh';
      if (ageDays === 0) {
        displayText = 'Today';
      } else if (ageDays === 1) {
        displayText = '1d ago';
      } else {
        displayText = `${ageDays}d ago`;
      }
    } else if (ageDays <= 30) {
      label = 'Aging';
      displayText = `${ageDays}d ago`;
    } else {
      label = 'Stale';
      displayText = `${ageDays}d ago`;
    }

    return { label, ageDays, displayText };
  } catch {
    return { label: 'Unknown', displayText: 'Unknown' };
  }
}

