'use client';

import { useState } from 'react';
import { ConceptQuality, GraphQuality } from '../../api-client';

interface CoveragePillProps {
  coverageScore: number;
  breakdown: ConceptQuality['coverage_breakdown'];
}

export function CoveragePill({ coverageScore, breakdown }: CoveragePillProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  
  // Color scale: low (red) < 50, medium (yellow) 50-75, high (green) > 75
  const getColor = (score: number) => {
    if (score < 50) return { bg: 'rgba(239, 68, 68, 0.1)', color: '#dc2626', label: 'Low' };
    if (score < 75) return { bg: 'rgba(234, 179, 8, 0.1)', color: '#ca8a04', label: 'Medium' };
    return { bg: 'rgba(34, 197, 94, 0.1)', color: '#16a34a', label: 'High' };
  };
  
  const color = getColor(coverageScore);
  
  const tooltipContent = (
    <div style={{
      position: 'absolute',
      bottom: '100%',
      left: '50%',
      transform: 'translateX(-50%)',
      marginBottom: '4px',
      padding: '8px 12px',
      background: 'var(--ink)',
      color: 'var(--background)',
      borderRadius: '6px',
      fontSize: '12px',
      whiteSpace: 'nowrap',
      zIndex: 1000,
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      pointerEvents: 'none',
    }}>
      <div style={{ fontWeight: '600', marginBottom: '4px' }}>Coverage: {coverageScore}/100</div>
      <div style={{ fontSize: '11px', opacity: 0.9 }}>
        {breakdown.has_description ? '✓' : '✗'} Description ({breakdown.has_description ? 30 : 0} pts)<br/>
        Evidence: {breakdown.evidence_count} ({breakdown.evidence_count === 0 ? 0 : breakdown.evidence_count <= 2 ? 15 : 25} pts)<br/>
        Connections: {breakdown.degree} ({breakdown.degree >= 5 ? 25 : breakdown.degree >= 2 ? 15 : 5} pts)
        {breakdown.reviewed_ratio !== null && breakdown.reviewed_ratio !== undefined && (
          <>
            <br/>
            Reviewed: {Math.round(breakdown.reviewed_ratio * 100)}% ({Math.round(breakdown.reviewed_ratio * 20)} pts)
          </>
        )}
      </div>
    </div>
  );
  
  return (
    <div
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '4px 10px',
          borderRadius: '12px',
          fontSize: '11px',
          fontWeight: '500',
          background: color.bg,
          color: color.color,
          cursor: 'help',
        }}
      >
        Coverage: {coverageScore}
      </span>
      {showTooltip && tooltipContent}
    </div>
  );
}

interface FreshnessPillProps {
  freshness: ConceptQuality['freshness'];
}

export function FreshnessPill({ freshness }: FreshnessPillProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  
  const getColor = (level: string) => {
    switch (level) {
      case 'Fresh':
        return { bg: 'rgba(34, 197, 94, 0.1)', color: '#16a34a' };
      case 'Aging':
        return { bg: 'rgba(234, 179, 8, 0.1)', color: '#ca8a04' };
      case 'Stale':
        return { bg: 'rgba(239, 68, 68, 0.1)', color: '#dc2626' };
      default:
        return { bg: 'rgba(107, 114, 128, 0.1)', color: '#6b7280' };
    }
  };
  
  const color = getColor(freshness.level);
  
  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return 'Unknown';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString();
    } catch {
      return 'Unknown';
    }
  };
  
  const tooltipContent = freshness.level === 'No evidence' ? (
    <div style={{
      position: 'absolute',
      bottom: '100%',
      left: '50%',
      transform: 'translateX(-50%)',
      marginBottom: '4px',
      padding: '8px 12px',
      background: 'var(--ink)',
      color: 'var(--background)',
      borderRadius: '6px',
      fontSize: '12px',
      whiteSpace: 'nowrap',
      zIndex: 1000,
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      pointerEvents: 'none',
    }}>
      No evidence found for this concept
    </div>
  ) : (
    <div style={{
      position: 'absolute',
      bottom: '100%',
      left: '50%',
      transform: 'translateX(-50%)',
      marginBottom: '4px',
      padding: '8px 12px',
      background: 'var(--ink)',
      color: 'var(--background)',
      borderRadius: '6px',
      fontSize: '12px',
      whiteSpace: 'nowrap',
      zIndex: 1000,
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      pointerEvents: 'none',
    }}>
      <div style={{ fontWeight: '600', marginBottom: '4px' }}>Freshness: {freshness.level}</div>
      <div style={{ fontSize: '11px', opacity: 0.9 }}>
        Newest evidence: {formatDate(freshness.newest_evidence_at)}<br/>
        {freshness.level === 'Fresh' && '≤ 30 days old'}<br/>
        {freshness.level === 'Aging' && '31-120 days old'}<br/>
        {freshness.level === 'Stale' && '> 120 days old'}
      </div>
    </div>
  );
  
  return (
    <div
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '4px 10px',
          borderRadius: '12px',
          fontSize: '11px',
          fontWeight: '500',
          background: color.bg,
          color: color.color,
          cursor: 'help',
        }}
      >
        {freshness.level}
      </span>
      {showTooltip && tooltipContent}
    </div>
  );
}

interface GraphHealthBadgeProps {
  quality: GraphQuality;
}

export function GraphHealthBadge({ quality }: GraphHealthBadgeProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  
  const getColor = (health: string) => {
    switch (health) {
      case 'HEALTHY':
        return { bg: 'rgba(34, 197, 94, 0.1)', color: '#16a34a' };
      case 'NEEDS_ATTENTION':
        return { bg: 'rgba(234, 179, 8, 0.1)', color: '#ca8a04' };
      case 'POOR':
        return { bg: 'rgba(239, 68, 68, 0.1)', color: '#dc2626' };
      default:
        return { bg: 'rgba(107, 114, 128, 0.1)', color: '#6b7280' };
    }
  };
  
  const color = getColor(quality.health);
  const stats = quality.stats;
  
  const tooltipContent = (
    <div style={{
      position: 'absolute',
      bottom: '100%',
      left: '50%',
      transform: 'translateX(-50%)',
      marginBottom: '4px',
      padding: '8px 12px',
      background: 'var(--ink)',
      color: 'var(--background)',
      borderRadius: '6px',
      fontSize: '12px',
      whiteSpace: 'nowrap',
      zIndex: 1000,
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      pointerEvents: 'none',
    }}>
      <div style={{ fontWeight: '600', marginBottom: '4px' }}>Graph Health: {quality.health}</div>
      <div style={{ fontSize: '11px', opacity: 0.9 }}>
        {stats.concepts_total} concepts<br/>
        {stats.missing_description_pct}% missing descriptions<br/>
        {stats.no_evidence_pct}% with no evidence<br/>
        {stats.stale_evidence_pct}% with stale evidence<br/>
        {stats.proposed_relationships_count} proposed relationships
      </div>
    </div>
  );
  
  return (
    <div
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '4px 10px',
          borderRadius: '12px',
          fontSize: '11px',
          fontWeight: '500',
          background: color.bg,
          color: color.color,
          cursor: 'help',
        }}
      >
        {quality.health.replace('_', ' ')}
      </span>
      {showTooltip && tooltipContent}
    </div>
  );
}

