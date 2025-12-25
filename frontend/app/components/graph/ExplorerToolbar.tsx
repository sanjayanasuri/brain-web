'use client';

import Link from 'next/link';
import React from 'react';
import type { BranchSummary, GraphSummary } from '../../api-client';
import SearchBox from '../topbar/SearchBox';

type Props = {
  demoMode: boolean;
  graphs: GraphSummary[];
  activeGraphId: string;
  onSelectGraph: (graphId: string) => void;
  onRequestCreateGraph: () => void;

  branches: BranchSummary[];
  activeBranchId: string;
  onSelectBranch: (branchId: string) => void;

  graphSwitchError?: string | null;

  canFocus: boolean;
  onFocus?: () => void;

  canFork: boolean;
  onFork: () => void;

  canCompare: boolean;
  onCompare: () => void;

  onSaveState: () => void;
  onRestore: () => void;

  nodesCount: number;
  linksCount: number;
  domainsCount: number;
  overviewMeta?: { node_count?: number; sampled?: boolean } | null;
  loadingNeighbors?: string | null;

  showContentIngest: boolean;
  onToggleContentIngest: () => void;
  contentIngestPopover?: React.ReactNode;

  showControls: boolean;
  onToggleControls: () => void;

  focusMode: boolean;
  onToggleFocusMode: () => void;

  showFilters?: boolean;
  onToggleFilters?: () => void;

  sourceLayer?: 'concepts' | 'evidence' | 'snapshots';
  onSourceLayerChange?: (layer: 'concepts' | 'evidence' | 'snapshots') => void;
};

export default function ExplorerToolbar(props: Props) {
  const {
    demoMode,
    graphs,
    activeGraphId,
    onSelectGraph,
    onRequestCreateGraph,
    branches,
    activeBranchId,
    onSelectBranch,
    graphSwitchError,
    canFocus,
    onFocus,
    canFork,
    onFork,
    canCompare,
    onCompare,
    onSaveState,
    onRestore,
    nodesCount,
    linksCount,
    domainsCount,
    overviewMeta,
    loadingNeighbors,
    showContentIngest,
    onToggleContentIngest,
    contentIngestPopover,
    showControls,
    onToggleControls,
    focusMode,
    onToggleFocusMode,
    showFilters,
    onToggleFilters,
    sourceLayer,
    onSourceLayerChange,
  } = props;

  return (
    <div className="explorer-toolbar">
      <div className="explorer-toolbar__row" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {/* Left: Stats (moved from right) */}
        <div className="explorer-toolbar__group" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <div className="explorer-toolbar__stats">
            <div className="explorer-stat">
              <div className="explorer-stat__label">Nodes</div>
              <div className="explorer-stat__value">{nodesCount}</div>
            </div>
            <div className="explorer-stat">
              <div className="explorer-stat__label">Links</div>
              <div className="explorer-stat__value">{linksCount}</div>
            </div>
            <div className="explorer-stat">
              <div className="explorer-stat__label">Domains</div>
              <div className="explorer-stat__value">{domainsCount}</div>
            </div>
            {overviewMeta?.sampled && (
              <div className="explorer-stat" style={{ fontSize: '11px', opacity: 0.7 }} title={`Overview loaded (${overviewMeta.node_count || '?'} total nodes)`}>
                Overview
              </div>
            )}
            {loadingNeighbors && (
              <div className="explorer-stat" style={{ fontSize: '11px', opacity: 0.7 }}>
                Loading neighbors...
              </div>
            )}
          </div>

          {/* Source Layer Toggle */}
          {onSourceLayerChange && (
            <div className="explorer-toolbar__field" style={{ marginLeft: '12px' }}>
              <label className="explorer-toolbar__label">View</label>
              <div className="explorer-toolbar__buttons" style={{ display: 'flex', gap: '4px' }}>
                <button
                  type="button"
                  className={`pill pill--small ${sourceLayer === 'concepts' ? 'pill--active' : 'pill--ghost'}`}
                  onClick={() => onSourceLayerChange('concepts')}
                  title="Show all concepts"
                >
                  Concepts
                </button>
                <button
                  type="button"
                  className={`pill pill--small ${sourceLayer === 'evidence' ? 'pill--active' : 'pill--ghost'}`}
                  onClick={() => onSourceLayerChange('evidence')}
                  title="Highlight nodes with attached resources"
                >
                  Evidence
                </button>
                <button
                  type="button"
                  className={`pill pill--small ${sourceLayer === 'snapshots' ? 'pill--active' : 'pill--ghost'}`}
                  onClick={() => onSourceLayerChange('snapshots')}
                  title="Show live snapshots and recency"
                >
                  Live
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Center: Search box */}
        <div style={{ flex: 1, maxWidth: '600px', margin: '0 auto', minWidth: 0 }}>
          <SearchBox
            activeGraphId={activeGraphId}
            graphs={graphs}
            placeholder="Search or type a command…"
          />
        </div>

        {/* Right: Controls */}
        <div className="explorer-toolbar__group explorer-toolbar__group--right" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <div className="explorer-toolbar__buttons" style={{ display: 'flex', gap: '6px' }}>
            {canFocus && (
              <button
                type="button"
                className="pill pill--ghost explorer-btn explorer-btn--ghost"
                onClick={onFocus}
                title="Center camera on selected node"
              >
                Focus
              </button>
            )}
            {demoMode ? null : (
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  className={`pill explorer-btn explorer-btn--ghost ${showContentIngest ? 'pill--active' : ''}`}
                  onClick={onToggleContentIngest}
                  aria-label={showContentIngest ? 'Hide add content panel' : 'Show add content panel'}
                  title={showContentIngest ? 'Hide add content panel' : 'Show add content panel'}
                >
                  {showContentIngest ? '−' : '+'} Add Content
                </button>
                {showContentIngest && contentIngestPopover}
              </div>
            )}

            <button
              type="button"
              className={`pill explorer-btn ${focusMode ? 'explorer-btn--primary' : 'explorer-btn--ghost'}`}
              onClick={onToggleFocusMode}
              title="Dim everything except the selected neighborhood"
            >
              Focus Mode
            </button>

            <button type="button" className="pill explorer-btn explorer-btn--ghost" onClick={onToggleControls}>
              {showControls ? 'Hide controls' : 'Show controls'}
            </button>

            {onToggleFilters && (
              <button 
                type="button" 
                className={`pill explorer-btn ${showFilters ? 'explorer-btn--primary' : 'explorer-btn--ghost'}`}
                onClick={onToggleFilters}
                title="Filter relationships by status, confidence, and source"
              >
                Filters
              </button>
            )}
          </div>
        </div>
      </div>

      {graphSwitchError ? (
        <div className="explorer-toolbar__error" title={graphSwitchError}>
          {graphSwitchError}
        </div>
      ) : null}
    </div>
  );
}

