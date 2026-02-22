'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CanvasPhase } from '../../types/freeform-canvas';

interface PhasePanelProps {
  phases: CanvasPhase[];
  onGoToPhase: (phase: CanvasPhase) => void;
  onDeletePhase: (id: string) => void;
  onReorderPhase: (id: string, newOrder: number) => void;
}

export default function PhasePanel({
  phases,
  onGoToPhase,
  onDeletePhase,
  onReorderPhase,
}: PhasePanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [presentMode, setPresentMode] = useState(false);
  const [presentIndex, setPresentIndex] = useState(0);

  const orderedPhases = useMemo(() => [...phases].sort((a, b) => a.order - b.order), [phases]);

  useEffect(() => {
    if (!presentMode || orderedPhases.length === 0) return;
    onGoToPhase(orderedPhases[presentIndex % orderedPhases.length]);
  }, [orderedPhases, onGoToPhase, presentIndex, presentMode]);

  useEffect(() => {
    if (!presentMode || orderedPhases.length <= 1) return;
    const timer = window.setInterval(() => {
      setPresentIndex((idx) => (idx + 1) % orderedPhases.length);
    }, 3500);
    return () => window.clearInterval(timer);
  }, [orderedPhases.length, presentMode]);

  useEffect(() => {
    if (!presentMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setPresentIndex((idx) => Math.min(idx + 1, Math.max(0, orderedPhases.length - 1)));
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setPresentIndex((idx) => Math.max(idx - 1, 0));
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setPresentMode(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [orderedPhases.length, presentMode]);

  useEffect(() => {
    if (presentIndex > Math.max(0, orderedPhases.length - 1)) {
      setPresentIndex(Math.max(0, orderedPhases.length - 1));
    }
  }, [orderedPhases.length, presentIndex]);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        style={{
          position: 'fixed',
          right: 16,
          top: 24,
          zIndex: 45,
          borderRadius: 14,
          border: '1px solid var(--border)',
          background: 'var(--panel)',
          color: 'var(--ink)',
          boxShadow: 'var(--shadow)',
          padding: '10px 12px',
          cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        Phases ({orderedPhases.length})
      </button>
    );
  }

  return (
    <aside
      style={{
        position: 'fixed',
        right: 16,
        top: 16,
        width: 'min(360px, 92vw)',
        zIndex: 45,
        borderRadius: 18,
        border: '1px solid var(--border)',
        background: 'color-mix(in srgb, var(--panel) 94%, white 6%)',
        boxShadow: '0 20px 48px rgba(0,0,0,0.12)',
        backdropFilter: 'blur(12px)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '12px 14px',
          borderBottom: '1px solid var(--border)',
          background: 'rgba(255,255,255,0.35)',
        }}
      >
        <div>
          <div style={{ fontWeight: 700, color: 'var(--ink)' }}>Phases</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {orderedPhases.length} saved views
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => {
              if (!orderedPhases.length) return;
              setPresentIndex(0);
              setPresentMode((v) => !v);
            }}
            disabled={!orderedPhases.length}
            style={{
              padding: '8px 10px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: presentMode ? 'var(--accent)' : 'var(--surface)',
              color: presentMode ? 'white' : 'var(--ink)',
              fontWeight: 600,
              cursor: orderedPhases.length ? 'pointer' : 'default',
              opacity: orderedPhases.length ? 1 : 0.5,
            }}
          >
            {presentMode ? 'Stop' : 'Present'}
          </button>
          <button
            onClick={() => setCollapsed(true)}
            style={{
              padding: '8px 10px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--muted)',
              fontWeight: 700,
              cursor: 'pointer',
            }}
            aria-label="Collapse phases panel"
          >
            ×
          </button>
        </div>
      </div>

      <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: 10, display: 'grid', gap: 8 }}>
        {orderedPhases.length === 0 && (
          <div
            style={{
              border: '1px dashed var(--border)',
              borderRadius: 12,
              padding: 12,
              color: 'var(--muted)',
              fontSize: 13,
            }}
          >
            Use “+ Phase” in the toolbar to save the current viewport.
          </div>
        )}

        {orderedPhases.map((phase, idx) => (
          <div
            key={phase.id}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 10,
              background: presentMode && idx === presentIndex ? 'rgba(37,99,235,0.08)' : 'rgba(255,255,255,0.45)',
              display: 'grid',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', minWidth: 18 }}>{idx + 1}.</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'var(--ink)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {phase.label}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  zoom {phase.zoom.toFixed(2)} · ({Math.round(phase.viewX)}, {Math.round(phase.viewY)})
                </div>
              </div>
              <button
                onClick={() => onGoToPhase(phase)}
                title="Go to phase"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--accent)',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ▶
              </button>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => onReorderPhase(phase.id, idx - 1)}
                disabled={idx === 0}
                style={{
                  padding: '6px 10px',
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                  cursor: idx === 0 ? 'default' : 'pointer',
                  opacity: idx === 0 ? 0.4 : 1,
                }}
              >
                ↑
              </button>
              <button
                onClick={() => onReorderPhase(phase.id, idx + 1)}
                disabled={idx === orderedPhases.length - 1}
                style={{
                  padding: '6px 10px',
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                  cursor: idx === orderedPhases.length - 1 ? 'default' : 'pointer',
                  opacity: idx === orderedPhases.length - 1 ? 0.4 : 1,
                }}
              >
                ↓
              </button>
              <button
                onClick={() => onDeletePhase(phase.id)}
                style={{
                  marginLeft: 'auto',
                  padding: '6px 10px',
                  borderRadius: 10,
                  border: '1px solid rgba(220,38,38,0.2)',
                  background: 'rgba(220,38,38,0.06)',
                  color: '#b91c1c',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
