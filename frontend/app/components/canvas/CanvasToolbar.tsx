'use client';

import { useEffect, useRef, useState } from 'react';
import type { ToolType } from '../../types/freeform-canvas';

interface CanvasToolbarProps {
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;
  color: string;
  setColor: (color: string) => void;
  brushSize: number;
  setBrushSize: (size: number) => void;
  onUndo: () => void;
  onAddPhase: (label: string) => void;
  onCapture: () => void;
  canvasTitle: string;
  setCanvasTitle: (title: string) => void;
  isCapturing?: boolean;
}

const PEN_COLORS = ['#111827', '#2563eb', '#dc2626', '#059669', '#7c3aed'];
const HIGHLIGHTER_COLORS = ['#facc15', '#fb7185', '#34d399', '#60a5fa'];

export default function CanvasToolbar({
  activeTool,
  setActiveTool,
  color,
  setColor,
  brushSize,
  setBrushSize,
  onUndo,
  onAddPhase,
  onCapture,
  canvasTitle,
  setCanvasTitle,
  isCapturing,
}: CanvasToolbarProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x: 18, y: 18 });
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [showPhaseInput, setShowPhaseInput] = useState(false);
  const [phaseLabel, setPhaseLabel] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('freeform-canvas-toolbar-pos');
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
        setPos(parsed);
      }
    } catch {
      // ignore malformed saved position
    }
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      setPos({ x: Math.max(8, e.clientX - dragOffset.x), y: Math.max(8, e.clientY - dragOffset.y) });
    };
    const onUp = () => {
      setDragging(false);
      localStorage.setItem('freeform-canvas-toolbar-pos', JSON.stringify(pos));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, dragOffset.x, dragOffset.y, pos]);

  const swatches = activeTool === 'highlighter' ? HIGHLIGHTER_COLORS : PEN_COLORS;

  return (
    <div
      ref={rootRef}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 50,
        width: 'min(92vw, 560px)',
        background: 'color-mix(in srgb, var(--panel) 92%, white 8%)',
        border: '1px solid var(--border)',
        borderRadius: 18,
        boxShadow: '0 18px 48px rgba(0,0,0,0.12)',
        backdropFilter: 'blur(12px)',
        padding: 10,
      }}
    >
      <div
        onMouseDown={(e) => {
          if (!(e.target as HTMLElement).closest('[data-drag-handle]')) return;
          const rect = rootRef.current?.getBoundingClientRect();
          setDragOffset({
            x: e.clientX - (rect?.left ?? 0),
            y: e.clientY - (rect?.top ?? 0),
          });
          setDragging(true);
        }}
        style={{ display: 'grid', gap: 10 }}
      >
        <div
          data-drag-handle
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            cursor: 'grab',
            padding: '4px 6px',
            borderRadius: 12,
            background: 'rgba(255,255,255,0.45)',
          }}
          title="Drag toolbar"
        >
          <span style={{ fontSize: 12, color: 'var(--muted)', userSelect: 'none' }}>Freeform</span>
          <input
            value={canvasTitle}
            onChange={(e) => setCanvasTitle(e.target.value)}
            placeholder="Untitled Canvas"
            style={{
              flex: 1,
              minWidth: 0,
              border: 'none',
              background: 'transparent',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--ink)',
              outline: 'none',
            }}
          />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {([
            ['pen', '✏️', 'Pen (P)'],
            ['highlighter', '🖍️', 'Highlighter (H)'],
            ['eraser', '🧹', 'Eraser (E)'],
            ['text', 'Aa', 'Text (T)'],
            ['select', '👆', 'Select (V)'],
          ] as [ToolType, string, string][]).map(([tool, icon, tooltip]) => (
            <button
              key={tool}
              onClick={() => setActiveTool(tool)}
              title={tooltip}
              style={{
                minWidth: 42,
                padding: '8px 10px',
                borderRadius: 12,
                border: activeTool === tool ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: activeTool === tool ? 'var(--surface)' : 'rgba(255,255,255,0.35)',
                color: activeTool === tool ? 'var(--accent)' : 'var(--ink)',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {icon}
            </button>
          ))}

          <div style={{ display: 'flex', gap: 6, marginLeft: 4 }}>
            {swatches.map((swatch) => (
              <button
                key={swatch}
                onClick={() => setColor(swatch)}
                title={swatch}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  border: color === swatch ? '2px solid var(--ink)' : '1px solid rgba(0,0,0,0.15)',
                  background: swatch,
                  cursor: 'pointer',
                  boxShadow: color === swatch ? '0 0 0 2px rgba(37,99,235,0.25)' : 'none',
                }}
              />
            ))}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Size</span>
            <input
              type="range"
              min={activeTool === 'highlighter' ? 8 : 2}
              max={activeTool === 'highlighter' ? 36 : 18}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              style={{ width: 96 }}
            />
          </label>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button
            onClick={onUndo}
            style={{
              padding: '8px 12px',
              borderRadius: 12,
              border: '1px solid var(--border)',
              background: 'rgba(255,255,255,0.4)',
              cursor: 'pointer',
              fontWeight: 600,
              color: 'var(--ink)',
            }}
          >
            Undo
          </button>

          {!showPhaseInput ? (
            <button
              onClick={() => setShowPhaseInput(true)}
              style={{
                padding: '8px 12px',
                borderRadius: 12,
                border: '1px solid var(--border)',
                background: 'rgba(255,255,255,0.4)',
                cursor: 'pointer',
                fontWeight: 600,
                color: 'var(--ink)',
              }}
            >
              + Phase
            </button>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: 6,
                borderRadius: 12,
                border: '1px solid var(--border)',
                background: 'rgba(255,255,255,0.62)',
              }}
            >
              <input
                autoFocus
                value={phaseLabel}
                onChange={(e) => setPhaseLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    onAddPhase(phaseLabel);
                    setPhaseLabel('');
                    setShowPhaseInput(false);
                  }
                  if (e.key === 'Escape') {
                    setShowPhaseInput(false);
                    setPhaseLabel('');
                  }
                }}
                placeholder="Phase name"
                style={{
                  border: 'none',
                  background: 'transparent',
                  outline: 'none',
                  fontSize: 13,
                  width: 130,
                  color: 'var(--ink)',
                }}
              />
              <button
                onClick={() => {
                  onAddPhase(phaseLabel);
                  setPhaseLabel('');
                  setShowPhaseInput(false);
                }}
                style={{
                  padding: '6px 10px',
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Save
              </button>
            </div>
          )}

          <button
            onClick={onCapture}
            disabled={!!isCapturing}
            style={{
              marginLeft: 'auto',
              padding: '10px 16px',
              borderRadius: 999,
              border: 'none',
              background: isCapturing ? 'color-mix(in srgb, var(--accent) 60%, white 40%)' : 'var(--accent)',
              color: 'white',
              cursor: isCapturing ? 'default' : 'pointer',
              fontWeight: 700,
              boxShadow: '0 8px 24px rgba(37,99,235,0.22)',
            }}
          >
            {isCapturing ? 'Capturing...' : 'Capture'}
          </button>
        </div>
      </div>
    </div>
  );
}
