/**
 * Format confidence score into label and percentage text
 */
export function formatConfidence(conf?: number): { 
  label: 'High' | 'Med' | 'Low' | 'Unknown', 
  pctText?: string 
} {
  if (conf === undefined || conf === null || isNaN(conf)) {
    return { label: 'Unknown' };
  }

  // Ensure confidence is in 0..1 range
  const normalized = Math.max(0, Math.min(1, conf));
  const pct = Math.round(normalized * 100);
  const pctText = `${pct}%`;

  if (normalized >= 0.8) {
    return { label: 'High', pctText };
  } else if (normalized >= 0.5) {
    return { label: 'Med', pctText };
  } else {
    return { label: 'Low', pctText };
  }
}

