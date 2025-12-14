'use client';

import Link from 'next/link';
import React from 'react';
import type { BranchSummary, GraphSummary } from '../api-client';

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

  showLectureIngest: boolean;
  onToggleLectureIngest: () => void;
  lecturePopover?: React.ReactNode;

  showControls: boolean;
  onToggleControls: () => void;

  focusMode: boolean;
  onToggleFocusMode: () => void;
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
    showLectureIngest,
    onToggleLectureIngest,
    lecturePopover,
    showControls,
    onToggleControls,
    focusMode,
    onToggleFocusMode,
  } = props;

  return (
    <div className="explorer-toolbar">
      <div className="explorer-toolbar__row">
        {/* Group 1: Meta & profile */}
        <div className="explorer-toolbar__group">
          <div className="explorer-toolbar__field">
            <label className="explorer-toolbar__label">Graph</label>
            <select
              value={activeGraphId}
              disabled={demoMode}
              onChange={(e) => {
                const next = e.target.value;
                if (next === '__new__') {
                  onRequestCreateGraph();
                  return;
                }
                onSelectGraph(next);
              }}
              className="explorer-toolbar__select"
              title="Switch graphs"
            >
              {graphs.map((g, idx) => (
                <option key={g.graph_id} value={g.graph_id}>
                  {idx < 9 ? `${idx + 1}. ` : ''}
                  {g.name || g.graph_id}
                </option>
              ))}
              {demoMode ? null : <option value="__new__">+ Create new…</option>}
            </select>
          </div>

          <div className="explorer-toolbar__buttons">
            <Link href="/profile-customization" className="pill pill--ghost explorer-btn explorer-btn--ghost">
              Profile
            </Link>
            <Link href="/source-management" className="pill pill--ghost explorer-btn explorer-btn--ghost">
              Sources
            </Link>
            <Link href="/gaps" className="pill pill--ghost explorer-btn explorer-btn--ghost">
              Gaps
            </Link>
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
          </div>
        </div>

        <div className="explorer-toolbar__divider" />

        {/* Group 2: Branch controls (PRIMARY) */}
        <div className="explorer-toolbar__group">
          <div className="explorer-toolbar__field">
            <label className="explorer-toolbar__label">Branch</label>
            <select
              value={activeBranchId}
              disabled={demoMode}
              onChange={(e) => onSelectBranch(e.target.value)}
              className="explorer-toolbar__select"
              title="Switch branches"
            >
              {branches.map((b) => (
                <option key={b.branch_id} value={b.branch_id}>
                  {b.name || b.branch_id}
                </option>
              ))}
            </select>
          </div>

          {demoMode ? (
            <div className="explorer-toolbar__buttons">
              <span className="pill pill--ghost" title="Demo mode - Full functionality enabled">
                Demo Mode
              </span>
            </div>
          ) : (
            <div className="explorer-toolbar__buttons">
            <button
              type="button"
              className={`pill explorer-btn explorer-btn--primary ${canFork ? '' : 'explorer-btn--disabled'}`}
              onClick={onFork}
              disabled={!canFork}
              title="Fork a branch from the selected node"
            >
              Fork
            </button>
            <button
              type="button"
              className={`pill explorer-btn explorer-btn--primary ${canCompare ? '' : 'explorer-btn--disabled'}`}
              onClick={onCompare}
              disabled={!canCompare}
              title="Compare this branch to another"
            >
              Compare
            </button>
            <button type="button" className="pill explorer-btn explorer-btn--primary" onClick={onSaveState} title="Save snapshot">
              Save State
            </button>
            <button
              type="button"
              className="pill explorer-btn explorer-btn--primary"
              onClick={onRestore}
              title="Restore snapshot (creates a new branch)"
            >
              Restore
            </button>
            </div>
          )}
        </div>

        <div className="explorer-toolbar__divider" />

        {/* Group 3: Stats & creation */}
        <div className="explorer-toolbar__group explorer-toolbar__group--right">
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
          </div>

          <div className="explorer-toolbar__buttons">
            {demoMode ? null : (
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  className={`pill explorer-btn explorer-btn--ghost ${showLectureIngest ? 'pill--active' : ''}`}
                  onClick={onToggleLectureIngest}
                >
                  {showLectureIngest ? '−' : '+'} Lecture
                </button>
                {showLectureIngest && lecturePopover}
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

