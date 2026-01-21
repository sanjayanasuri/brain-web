'use client';

import { useState } from 'react';
import { computeSnapshotStaleness, getStalenessBadgeStyle } from '../../utils/financeStaleness';
import type { LatestSnapshotMetadata } from '../../api-client';

interface TrackedCompany {
  ticker: string;
  cadence: 'daily' | 'weekly' | 'monthly';
  company_name?: string;
  snapshot?: LatestSnapshotMetadata;
}

interface TrackedCompaniesPanelProps {
  tracked: Array<{ ticker: string; cadence: 'daily' | 'weekly' | 'monthly'; company_name?: string }>;
  latestSnapshots: Record<string, LatestSnapshotMetadata>;
  onRefresh: (ticker: string) => Promise<void>;
  onOpen: (ticker: string) => void;
  refreshingTickers?: Set<string>;
}

export default function TrackedCompaniesPanel({
  tracked,
  latestSnapshots,
  onRefresh,
  onOpen,
  refreshingTickers = new Set(),
}: TrackedCompaniesPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (tracked.length === 0) {
    return null;
  }

  // Build company list with snapshot data
  const companies: TrackedCompany[] = tracked.map((t) => ({
    ticker: t.ticker,
    cadence: t.cadence,
    company_name: t.company_name,
    snapshot: latestSnapshots[t.ticker],
  }));

  // Compute staleness for each company
  const companiesWithStaleness = companies.map((company) => {
    const staleness = computeSnapshotStaleness(
      company.snapshot?.snapshot_fetched_at,
      company.cadence
    );
    return { company, staleness };
  });

  // Sort: Stale first, then Aging, then Fresh; within each by most-outdated fetched time
  companiesWithStaleness.sort((a, b) => {
    const statusOrder = { Stale: 0, Aging: 1, Fresh: 2, Unknown: 3 };
    const statusDiff = statusOrder[a.staleness.status] - statusOrder[b.staleness.status];
    if (statusDiff !== 0) return statusDiff;

    // Within same status, sort by most outdated (oldest first)
    const timeA = a.company.snapshot?.snapshot_fetched_at;
    const timeB = b.company.snapshot?.snapshot_fetched_at;
    if (!timeA && !timeB) return 0;
    if (!timeA) return 1;
    if (!timeB) return -1;
    return new Date(timeA).getTime() - new Date(timeB).getTime();
  });

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: '8px',
        marginBottom: '16px',
        background: 'var(--background)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: isCollapsed ? 'none' : '1px solid var(--border)',
          cursor: 'pointer',
        }}
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <h4 style={{ fontSize: '14px', fontWeight: '600', margin: 0, color: 'var(--ink)' }}>
          Tracked Companies ({tracked.length})
        </h4>
        <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
          {isCollapsed ? '▼' : '▲'}
        </span>
      </div>

      {!isCollapsed && (
        <div style={{ padding: '12px' }}>
          {companiesWithStaleness.length === 0 ? (
            <p style={{ fontSize: '12px', color: 'var(--muted)', margin: 0, textAlign: 'center' }}>
              No tracked companies
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {companiesWithStaleness.map(({ company, staleness }) => {
                const isRefreshing = refreshingTickers.has(company.ticker);
                const badgeStyle = getStalenessBadgeStyle(staleness.status);

                return (
                  <div
                    key={company.ticker}
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      padding: '10px',
                      background: 'var(--background)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                          <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--ink)' }}>
                            {company.ticker}
                          </span>
                          {company.company_name && (
                            <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                              {company.company_name}
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <span
                            className="badge badge--soft"
                            style={{
                              fontSize: '10px',
                              background: badgeStyle.bgColor,
                              color: badgeStyle.color,
                            }}
                          >
                            {staleness.status}
                          </span>
                          <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                            {company.cadence}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onRefresh(company.ticker);
                          }}
                          disabled={isRefreshing}
                          style={{
                            fontSize: '11px',
                            padding: '4px 8px',
                            background: isRefreshing ? 'var(--muted)' : 'var(--accent)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: isRefreshing ? 'not-allowed' : 'pointer',
                            opacity: isRefreshing ? 0.6 : 1,
                          }}
                        >
                          {isRefreshing ? 'Refreshing...' : 'Refresh'}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpen(company.ticker);
                          }}
                          style={{
                            fontSize: '11px',
                            padding: '4px 8px',
                            background: 'transparent',
                            color: 'var(--accent)',
                            border: '1px solid var(--accent)',
                            borderRadius: '4px',
                            cursor: 'pointer',
                          }}
                        >
                          Open
                        </button>
                      </div>
                    </div>
                    {company.snapshot?.snapshot_fetched_at && (
                      <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
                        Last fetched: {staleness.display}
                      </div>
                    )}
                    {company.snapshot?.market_as_of && (
                      <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                        Market as-of: {new Date(company.snapshot.market_as_of).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

