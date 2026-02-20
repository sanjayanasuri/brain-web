'use client';

import { useState, useRef, useEffect } from 'react';
import { Editor } from '@tiptap/react';
import {
  PenTool, Highlighter, Eraser, LassoSelect,
  Undo, Redo, Bold, Italic, Type
} from 'lucide-react';

interface EnhancedToolbarProps {
  editor: Editor | null;
  wikipediaHoverEnabled?: boolean;
  onToggleWikipediaHover?: () => void;
  isPencilMode?: boolean;
  onTogglePencilMode?: () => void;
  paperType?: string;
  onPaperTypeChange?: (type: string) => void;

  // Handwriting tools
  activeTool?: 'pen' | 'highlighter' | 'eraser' | 'lasso';
  onToolChange?: (tool: 'pen' | 'highlighter' | 'eraser' | 'lasso') => void;
  activeColor?: string;
  onColorChange?: (color: string) => void;
  activeWidth?: number;
  onWidthChange?: (width: number) => void;
  onUndo?: () => void;
  onRedo?: () => void;
}

// Only paper types that are actually rendered by RuledPaper/NotebookPage
const PAPER_TYPES = [
  { label: 'Ruled', value: 'ruled' },
  { label: 'Grid', value: 'grid' },
  { label: 'Blank', value: 'blank' },
  { label: 'Dotted', value: 'dotted' },
  { label: 'Dark', value: 'dark' },
];

// Ink / text colors
const INK_COLORS = [
  { label: 'Black', value: '#000000' },
  { label: 'Blue', value: '#1d4ed8' },
  { label: 'Red', value: '#dc2626' },
  { label: 'Green', value: '#16a34a' },
  { label: 'Purple', value: '#7c3aed' },
  { label: 'White', value: '#ffffff' },
];

// Highlight colors — semi-transparent so text shows through
const HIGHLIGHT_COLORS = [
  { label: 'Yellow', value: '#fef08a' },
  { label: 'Green', value: '#bbf7d0' },
  { label: 'Blue', value: '#bfdbfe' },
  { label: 'Pink', value: '#fbcfe8' },
  { label: 'Orange', value: '#fed7aa' },
  { label: 'None', value: '' },
];

// Stroke widths for pen/eraser — shown as a quick row
const WIDTHS = [1, 2, 4, 8, 16];

const btnBase: React.CSSProperties = {
  padding: '5px 8px',
  borderRadius: '6px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.15s ease',
};

const activeBg = 'rgba(37, 99, 235, 0.1)';
const activeColor = '#2563eb';
const inactiveColor = 'var(--ink, #333)';

export function EnhancedToolbar({
  editor,
  isPencilMode = false,
  onTogglePencilMode,
  paperType = 'ruled',
  onPaperTypeChange,
  activeTool = 'lasso',
  onToolChange,
  activeColor: inkColor = '#000000',
  onColorChange,
  activeWidth = 2.5,
  onWidthChange,
  onUndo,
  onRedo,
}: EnhancedToolbarProps) {
  const [showInkColors, setShowInkColors] = useState(false);
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const [showTextColors, setShowTextColors] = useState(false);
  const inkRef = useRef<HTMLDivElement>(null);
  const hlRef = useRef<HTMLDivElement>(null);
  const txtRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (showInkColors && inkRef.current && !inkRef.current.contains(e.target as Node)) setShowInkColors(false);
      if (showHighlightPicker && hlRef.current && !hlRef.current.contains(e.target as Node)) setShowHighlightPicker(false);
      if (showTextColors && txtRef.current && !txtRef.current.contains(e.target as Node)) setShowTextColors(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showInkColors, showHighlightPicker, showTextColors]);

  const isActive = (name: string, options?: any) => editor?.isActive(name, options) ?? false;
  const getCurrentColor = () => editor?.getAttributes('textStyle').color || '#000000';

  const dropdownStyle: React.CSSProperties = {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    left: 0,
    background: 'var(--surface, #fff)',
    border: '1px solid var(--border, #e5e7eb)',
    borderRadius: '10px',
    padding: '8px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
    zIndex: 2000,
    minWidth: '160px',
  };

  return (
    <div
      style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        padding: '6px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flexWrap: 'wrap',
        userSelect: 'none',
      }}
    >
      {/* ── SECTION: Text/Lasso mode ── */}
      <button
        onClick={() => onToolChange?.('lasso')}
        title="Text / Select mode"
        style={{ ...btnBase, background: activeTool === 'lasso' ? activeBg : 'transparent', color: activeTool === 'lasso' ? activeColor : inactiveColor }}
      >
        <Type size={17} />
      </button>

      <Divider />

      {/* ── SECTION: Handwriting tools (compact — no floating settings panels) ── */}
      <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
        {/* Pen */}
        <button
          onClick={() => { onToolChange?.(activeTool === 'pen' ? 'lasso' : 'pen'); }}
          title="Pen"
          style={{ ...btnBase, background: activeTool === 'pen' ? activeBg : 'transparent', color: activeTool === 'pen' ? activeColor : inactiveColor }}
        >
          <PenTool size={17} />
        </button>

        {/* Highlighter (ink layer) */}
        <button
          onClick={() => { onToolChange?.(activeTool === 'highlighter' ? 'lasso' : 'highlighter'); }}
          title="Highlighter (ink)"
          style={{ ...btnBase, background: activeTool === 'highlighter' ? 'rgba(254,240,138,0.4)' : 'transparent', color: activeTool === 'highlighter' ? '#b45309' : inactiveColor }}
        >
          <Highlighter size={17} />
        </button>

        {/* Eraser */}
        <button
          onClick={() => { onToolChange?.(activeTool === 'eraser' ? 'lasso' : 'eraser'); }}
          title="Eraser"
          style={{ ...btnBase, background: activeTool === 'eraser' ? activeBg : 'transparent', color: activeTool === 'eraser' ? activeColor : inactiveColor }}
        >
          <Eraser size={17} />
        </button>

        {/* Lasso */}
        <button
          onClick={() => onToolChange?.('lasso')}
          title="Lasso Select"
          style={{ ...btnBase, background: activeTool === 'lasso' ? activeBg : 'transparent', color: activeTool === 'lasso' ? activeColor : inactiveColor }}
        >
          <LassoSelect size={17} />
        </button>
      </div>

      {/* Ink color swatch + compact dropdown — only shown when pen/highlighter is active */}
      {(activeTool === 'pen' || activeTool === 'highlighter') && (
        <div ref={inkRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setShowInkColors(!showInkColors)}
            title="Ink color"
            style={{
              width: 22, height: 22, borderRadius: '50%',
              background: inkColor,
              border: '2px solid rgba(0,0,0,0.15)',
              cursor: 'pointer',
              boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
            }}
          />
          {showInkColors && (
            <div style={{ ...dropdownStyle, display: 'flex', gap: '6px', flexWrap: 'wrap', minWidth: 'auto', padding: '8px' }}>
              {INK_COLORS.map(c => (
                <button
                  key={c.value}
                  onClick={() => { onColorChange?.(c.value); setShowInkColors(false); }}
                  title={c.label}
                  style={{
                    width: 22, height: 22, borderRadius: '50%',
                    background: c.value,
                    border: inkColor === c.value ? '2px solid #2563eb' : '1px solid rgba(0,0,0,0.15)',
                    cursor: 'pointer',
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stroke width — compact dots, shown when pen/eraser/highlighter active */}
      {(activeTool === 'pen' || activeTool === 'eraser' || activeTool === 'highlighter') && (
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginLeft: '2px' }}>
          {WIDTHS.map(w => (
            <button
              key={w}
              onClick={() => onWidthChange?.(w)}
              title={`${w}px`}
              style={{
                width: Math.min(18, 6 + w * 1.2),
                height: Math.min(18, 6 + w * 1.2),
                borderRadius: '50%',
                border: activeWidth === w ? '2px solid #2563eb' : '1px solid rgba(0,0,0,0.15)',
                background: activeWidth === w ? '#2563eb' : 'rgba(0,0,0,0.25)',
                cursor: 'pointer',
                padding: 0,
              }}
            />
          ))}
        </div>
      )}

      {/* Undo / Redo */}
      <div style={{ display: 'flex', gap: '2px' }}>
        <button onClick={() => onUndo?.()} title="Undo" style={{ ...btnBase, color: inactiveColor }}>
          <Undo size={16} />
        </button>
        <button onClick={() => onRedo?.()} title="Redo" style={{ ...btnBase, color: inactiveColor }}>
          <Redo size={16} />
        </button>
      </div>

      <Divider />

      {/* ── SECTION: Text Formatting ── */}
      <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
        <button
          onClick={() => editor?.chain().focus().toggleBold().run()}
          disabled={!editor}
          title="Bold (Cmd+B)"
          style={{ ...btnBase, background: isActive('bold') ? activeBg : 'transparent', color: isActive('bold') ? activeColor : inactiveColor, opacity: editor ? 1 : 0.4 }}
        >
          <Bold size={16} />
        </button>
        <button
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          disabled={!editor}
          title="Italic (Cmd+I)"
          style={{ ...btnBase, background: isActive('italic') ? activeBg : 'transparent', color: isActive('italic') ? activeColor : inactiveColor, opacity: editor ? 1 : 0.4 }}
        >
          <Italic size={16} />
        </button>
      </div>

      {/* Heading selector */}
      <select
        value={
          isActive('heading', { level: 1 }) ? '1'
            : isActive('heading', { level: 2 }) ? '2'
              : isActive('heading', { level: 3 }) ? '3'
                : 'paragraph'
        }
        disabled={!editor}
        onChange={(e) => {
          const val = e.target.value;
          if (val === 'paragraph') editor?.chain().focus().setParagraph().run();
          else editor?.chain().focus().toggleHeading({ level: parseInt(val) as any }).run();
        }}
        style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--surface)', color: 'var(--ink)', fontSize: '12px', cursor: editor ? 'pointer' : 'default', outline: 'none', opacity: editor ? 1 : 0.4 }}
      >
        <option value="paragraph">Text</option>
        <option value="1">H1</option>
        <option value="2">H2</option>
        <option value="3">H3</option>
      </select>

      <Divider />

      {/* ── SECTION: Text Color & Highlight ── */}
      {/* Text color */}
      <div ref={txtRef} style={{ position: 'relative' }}>
        <button
          onClick={() => editor && setShowTextColors(!showTextColors)}
          disabled={!editor}
          title="Text color"
          style={{ ...btnBase, flexDirection: 'column', opacity: editor ? 1 : 0.4, gap: 1 }}
        >
          <span style={{ fontSize: '15px', fontWeight: 'bold', lineHeight: 1, color: 'var(--ink)' }}>A</span>
          <span style={{ width: 16, height: 3, borderRadius: 2, background: getCurrentColor(), display: 'block' }} />
        </button>
        {showTextColors && editor && (
          <div style={{ ...dropdownStyle, display: 'flex', gap: '6px', flexWrap: 'wrap', minWidth: 'auto', padding: '8px' }}>
            {INK_COLORS.map(c => (
              <button
                key={c.value}
                onClick={() => { editor.chain().focus().setColor(c.value).run(); setShowTextColors(false); }}
                title={c.label}
                style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: c.value,
                  border: getCurrentColor() === c.value ? '2px solid #2563eb' : '1px solid rgba(0,0,0,0.15)',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Text highlight */}
      <div ref={hlRef} style={{ position: 'relative' }}>
        <button
          onClick={() => editor && setShowHighlightPicker(!showHighlightPicker)}
          disabled={!editor}
          title="Highlight text"
          style={{ ...btnBase, background: isActive('highlight') ? 'rgba(254,240,138,0.4)' : 'transparent', color: isActive('highlight') ? '#b45309' : inactiveColor, opacity: editor ? 1 : 0.4 }}
        >
          <Highlighter size={16} />
        </button>
        {showHighlightPicker && editor && (
          <div style={{ ...dropdownStyle, display: 'flex', gap: '6px', flexWrap: 'wrap', minWidth: 'auto', padding: '8px' }}>
            {HIGHLIGHT_COLORS.map(c => (
              <button
                key={c.value || 'none'}
                onClick={() => {
                  if (c.value === '') {
                    editor.chain().focus().unsetHighlight().run();
                  } else {
                    editor.chain().focus().toggleHighlight({ color: c.value }).run();
                  }
                  setShowHighlightPicker(false);
                }}
                title={c.label}
                style={{
                  width: 22, height: 22, borderRadius: '4px',
                  background: c.value || 'transparent',
                  border: c.value === '' ? '1.5px dashed #999' : '1px solid rgba(0,0,0,0.15)',
                  cursor: 'pointer',
                  fontSize: c.value === '' ? 10 : 0,
                  color: '#666',
                }}
              >
                {c.value === '' ? '✕' : ''}
              </button>
            ))}
          </div>
        )}
      </div>

      <Divider />

      {/* ── SECTION: Lists ── */}
      <button
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
        disabled={!editor}
        title="Bullet list"
        style={{ ...btnBase, background: isActive('bulletList') ? activeBg : 'transparent', color: isActive('bulletList') ? activeColor : inactiveColor, opacity: editor ? 1 : 0.4, fontSize: 16 }}
      >
        •
      </button>
      <button
        onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
        disabled={!editor}
        title="Code block"
        style={{ ...btnBase, background: isActive('codeBlock') ? activeBg : 'transparent', color: isActive('codeBlock') ? activeColor : inactiveColor, opacity: editor ? 1 : 0.4, fontSize: 12 }}
      >
        {'</>'}
      </button>

      <Divider />

      {/* ── SECTION: Paper type ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Paper</span>
        <select
          value={paperType}
          onChange={(e) => onPaperTypeChange?.(e.target.value)}
          style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: '6px', background: 'var(--surface)', color: 'var(--ink)', fontSize: '12px', cursor: 'pointer', outline: 'none' }}
        >
          {PAPER_TYPES.map(type => (
            <option key={type.value} value={type.value}>{type.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 22, background: 'var(--border, #e5e7eb)', flexShrink: 0 }} />;
}
