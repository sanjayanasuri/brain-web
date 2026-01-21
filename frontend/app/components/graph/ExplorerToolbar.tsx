'use client';

import React, { useState, useEffect } from 'react';
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
    onSelectGraph: _onSelectGraph,
    onRequestCreateGraph: _onRequestCreateGraph,
    branches: _branches,
    activeBranchId: _activeBranchId,
    onSelectBranch: _onSelectBranch,
    graphSwitchError,
    canFocus: _canFocus,
    onFocus: _onFocus,
    canFork: _canFork,
    onFork: _onFork,
    canCompare: _canCompare,
    onCompare: _onCompare,
    onSaveState: _onSaveState,
    onRestore: _onRestore,
    nodesCount: _nodesCount,
    linksCount: _linksCount,
    domainsCount: _domainsCount,
    overviewMeta: _overviewMeta,
    loadingNeighbors: _loadingNeighbors,
    showContentIngest: _showContentIngest,
    onToggleContentIngest: _onToggleContentIngest,
    contentIngestPopover: _contentIngestPopover,
    showControls: _showControls,
    onToggleControls: _onToggleControls,
    focusMode: _focusMode,
    onToggleFocusMode: _onToggleFocusMode,
    showFilters: _showFilters,
    onToggleFilters: _onToggleFilters,
    sourceLayer: _sourceLayer,
    onSourceLayerChange: _onSourceLayerChange,
  } = props;

  const [actionStatus, setActionStatus] = useState<{ type: 'added' | 'deleted' | 'edited' | null; timestamp: number }>({ type: null, timestamp: 0 });

  // Listen for action events from window
  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;
    
    const handleAction = (event: CustomEvent) => {
      const actionType = event.detail?.type;
      if (actionType === 'added' || actionType === 'deleted' || actionType === 'edited') {
        // Clear any existing timeout
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        
        const timestamp = Date.now();
        setActionStatus({ type: actionType, timestamp });
        
        // Clear after 3 seconds
        timeoutId = setTimeout(() => {
          setActionStatus(prev => {
            // Only clear if this is still the same status
            if (prev.timestamp === timestamp) {
              return { type: null, timestamp: 0 };
            }
            return prev;
          });
        }, 3000);
      }
    };

    window.addEventListener('graph-action' as any, handleAction as EventListener);
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      window.removeEventListener('graph-action' as any, handleAction as EventListener);
    };
  }, []);

  return (
    <div className="explorer-toolbar">
      <div className="explorer-toolbar__row" style={{ display: 'flex', alignItems: 'center', gap: '16px', width: '100%' }}>
        {/* Center: Search box - takes up most of the space */}
        <div style={{ flex: 1, minWidth: 0, maxWidth: 'none' }}>
          <SearchBox
            activeGraphId={activeGraphId}
            graphs={graphs}
            placeholder="Search, add nodes, delete nodes, or type a command…"
          />
        </div>

        {/* Right: Confirmation button */}
        {!demoMode && actionStatus.type && (
          <div style={{ flexShrink: 0 }}>
            <button
              type="button"
              className="pill explorer-btn explorer-btn--primary"
              style={{
                minWidth: '120px',
                padding: '12px 24px',
                fontSize: '16px',
                fontWeight: '600',
                textTransform: 'capitalize',
              }}
            >
              {actionStatus.type}
            </button>
          </div>
        )}
      </div>

      {graphSwitchError ? (
        <div className="explorer-toolbar__error" title={graphSwitchError}>
          {graphSwitchError}
        </div>
      ) : null}
    </div>
  );
}

