'use client';

import React, { useState, useEffect } from 'react';
import type { BranchSummary, GraphSummary } from '../../api-client';
import SearchBox from '../topbar/SearchBox';
import {
  MousePointer2,
  Lasso,
  Pencil,
  PlusCircle,
  Maximize2
} from 'lucide-react';

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

  onToggleMemorySettings: () => void;
  showMemorySettings: boolean;
};

export default function ExplorerToolbar(props: Props & {
  mode: 'select' | 'lasso' | 'handwriting';
  onModeChange: (mode: 'select' | 'lasso' | 'handwriting') => void;
  color: string;
  onColorChange: (color: string) => void;
  onAddNode: () => void;
  onResetView: () => void;
  showLegend: boolean;
  onToggleLegend: () => void;
}) {
  const {
    graphs,
    activeGraphId,
    graphSwitchError,
    activeBranchId,
    onSelectBranch,
    canFocus,
    onFocus,
    mode,
    onModeChange,
    color,
    onColorChange,
    onAddNode,
    onResetView,
    showLegend,
    onToggleLegend
  } = props;

  const INK_COLORS = ['#2980b9', '#c0392b', '#27ae60', '#1c1c1e'];

  return (
    <div className="explorer-toolbar" style={{
      display: 'flex',
      flexDirection: 'row', // Horizontal
      alignItems: 'center',
      gap: '8px', // Gap between Search and Tools
      padding: '8px 4px', // Minimal padding to stretch left
      width: '100%',
      // Remove maxWidth constraint to allow stretching? It has width 100% already.
    }}>
      {/* Search Bar Group */}
      <div style={{ flexShrink: 0, width: '300px', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <SearchBox
          activeGraphId={activeGraphId}
          graphs={graphs}
          placeholder="Search..."
          style={{ width: '100%' }}
        />

        {canFocus && onFocus && (
          <button
            onClick={onFocus}
            className="pill"
            title="Center on selection"
            style={{ padding: '6px 12px', height: '36px' }}
          >
            Focus
          </button>
        )}
      </div>

      <div style={{ width: '1px', height: '24px', background: 'var(--border)', margin: '0 4px' }} />

      {/* Tools Group (Right Side) */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <GraphToolButton
          active={mode === 'select'}
          onClick={() => onModeChange('select')}
          icon={<MousePointer2 size={22} />}
          label="Select"
        />
        <GraphToolButton
          active={mode === 'lasso'}
          onClick={() => onModeChange(mode === 'lasso' ? 'select' : 'lasso')}
          icon={<Lasso size={22} />}
          label="Lasso by drawing"
        />

        <div style={{ position: 'relative' }}>
          <GraphToolButton
            active={mode === 'handwriting'}
            onClick={() => onModeChange(mode === 'handwriting' ? 'select' : 'handwriting')}
            icon={<Pencil size={22} />}
            label="Sketch"
          />
          {mode === 'handwriting' && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: '8px',
              background: 'var(--panel)',
              padding: '6px',
              borderRadius: '12px',
              border: '1px solid var(--border)',
              display: 'flex',
              gap: '4px',
              zIndex: 100,
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
            }}>
              {INK_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => onColorChange(c)}
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    background: c,
                    border: color === c ? '2px solid #fff' : 'none',
                    boxShadow: color === c ? `0 0 0 2px ${c}` : 'none',
                    cursor: 'pointer'
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <div style={{ width: '1px', height: '20px', background: 'var(--border)', margin: '0 4px' }} />

        <GraphToolButton
          active={false}
          onClick={onAddNode}
          icon={<PlusCircle size={22} />}
          label="Add Node"
        />

        <GraphToolButton
          active={false}
          onClick={onResetView}
          icon={<Maximize2 size={22} />}
          label="Fit to View"
        />
      </div>

      {graphSwitchError && (
        <div style={{
          fontSize: '12px',
          color: '#ef4444',
          padding: '4px 12px',
          background: 'rgba(239, 68, 68, 0.1)',
          borderRadius: '6px',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          marginLeft: 'auto' // Push error to far right
        }}>
          {graphSwitchError}
        </div>
      )}
    </div>
  );
}

function GraphToolButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={label}
      style={{
        width: '42px', // Enlarge button
        height: '42px', // Enlarge button
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '10px',
        border: active ? '1px solid var(--accent)' : '1px solid transparent', // Keep transparent border for inactive to avoid jitter
        // Use a more visible background/color for inactive state
        background: active ? 'var(--accent-faint)' : 'rgba(0, 0, 0, 0.05)',
        color: active ? 'var(--accent)' : '#374151', // Even darker gray
        cursor: 'pointer',
        transition: 'all 0.2s ease',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'rgba(0, 0, 0, 0.1)';
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'rgba(0, 0, 0, 0.05)';
      }}
    >
      {icon}
    </button>
  );
}

