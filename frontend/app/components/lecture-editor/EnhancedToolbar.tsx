'use client';

import { useState } from 'react';
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

const PAPER_TYPES = [
  { label: 'Blank', value: 'blank' },
  { label: 'Ruled', value: 'ruled' },
  { label: 'Grid', value: 'grid' },
  { label: 'Dot', value: 'dot' },
  { label: 'Split', value: 'split' },
  { label: 'Cream', value: 'cream' },
  { label: 'Dark', value: 'dark' },
];

const FONT_FAMILIES = [
  { label: 'Default', value: 'inherit' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times', value: 'Times New Roman, serif' },
  { label: 'Courier', value: 'Courier New, monospace' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
];

const FONT_SIZES = ['8px', '9px', '10px', '11px', '12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px', '36px', '48px'];

const COLORS = ['#000000', '#ff0000', '#0000ff', '#ffffff'];
const HIGHLIGHT_COLORS = ['#ffff00', '#ff0000', '#0000ff', '#ffffff']; // Keep yellow for highlight if preferred, but user said "red blue black white"

export function EnhancedToolbar({
  editor,
  wikipediaHoverEnabled = true,
  onToggleWikipediaHover,
  isPencilMode = false,
  onTogglePencilMode,
  paperType = 'blank',
  onPaperTypeChange,
  activeTool = 'pen',
  onToolChange,
  activeColor = '#000000',
  onColorChange,
  activeWidth = 2.5,
  onWidthChange,
  onUndo,
  onRedo,
}: EnhancedToolbarProps) {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const [showFontPicker, setShowFontPicker] = useState(false);

  const isActive = (name: string, options?: any) => {
    return editor?.isActive(name, options) ?? false;
  };

  const getCurrentColor = () => {
    return editor?.getAttributes('textStyle').color || '#000000';
  };

  const getCurrentHighlight = () => {
    return editor?.getAttributes('highlight').color || null;
  };

  const getCurrentFontFamily = () => {
    return editor?.getAttributes('textStyle').fontFamily || 'inherit';
  };

  return (
    <div
      style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        flexWrap: 'wrap',
      }}
    >
      {/* Group 1: General Tools (Simplified) */}
      <div style={{ display: 'flex', gap: '4px', background: 'rgba(0,0,0,0.03)', padding: '2px', borderRadius: '8px' }}>
        <button
          onClick={() => {
            // Reset to lasso/text mode but keep in the same layout
            onToolChange?.('lasso');
          }}
          style={{
            background: 'transparent', border: 'none', borderRadius: '6px',
            color: activeTool === 'lasso' ? 'var(--accent)' : 'var(--ink)',
            cursor: 'pointer', fontSize: '14px', padding: '6px 10px',
            display: 'flex', alignItems: 'center', gap: '4px',
          }}
          title="Text Selection Mode"
        >
          <Type size={18} />
        </button>
      </div>

      <div style={{ width: '1px', height: '24px', background: 'var(--border)' }} />

      {/* Group: Handwriting Tools (Unified Mode) */}
      <div style={{ display: 'flex', gap: '4px', background: 'rgba(0,0,0,0.03)', padding: '2px', borderRadius: '8px' }}>
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => {
              if (activeTool === 'pen') onToolChange?.('lasso');
              else onToolChange?.('pen');
            }}
            title="Pen Settings"
            style={{
              padding: '6px',
              borderRadius: '6px',
              border: 'none',
              background: activeTool === 'pen' ? '#fff' : 'transparent',
              boxShadow: activeTool === 'pen' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none',
              cursor: 'pointer',
              color: activeTool === 'pen' ? 'var(--primary)' : 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
          >
            <PenTool size={18} />
          </button>
          {activeTool === 'pen' && (
            <div
              style={{
                position: 'absolute', top: '100%', left: 0, marginTop: '8px',
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: '12px', padding: '12px', boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
                zIndex: 1000, width: '200px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 'bold' }}>Pen Details</span>
                <button
                  onClick={() => onToolChange?.('lasso')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '2px', fontSize: '14px' }}
                  title="Close Settings"
                >
                  ✕
                </button>
              </div>
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                  <span>Size</span>
                  <span>{activeWidth}px</span>
                </div>
                <input
                  type="range" min="1" max="20" step="0.5"
                  value={activeWidth}
                  onChange={(e) => onWidthChange?.(parseFloat(e.target.value))}
                  style={{ width: '100%', cursor: 'pointer' }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                {COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => onColorChange?.(c)}
                    style={{
                      width: '24px', height: '24px', borderRadius: '50%', background: c,
                      border: activeColor === c ? '2px solid #fff' : 'none',
                      boxShadow: activeColor === c ? `0 0 0 1px ${c}` : 'none',
                      cursor: 'pointer',
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ position: 'relative' }}>
          <button
            onClick={() => {
              if (activeTool === 'highlighter') onToolChange?.('lasso');
              else onToolChange?.('highlighter');
            }}
            title="Highlighter Settings"
            style={{
              padding: '6px',
              borderRadius: '6px',
              border: 'none',
              background: activeTool === 'highlighter' ? '#fff' : 'transparent',
              boxShadow: activeTool === 'highlighter' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none',
              cursor: 'pointer',
              color: activeTool === 'highlighter' ? 'var(--primary)' : 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
          >
            <Highlighter size={18} />
          </button>
          {activeTool === 'highlighter' && (
            <div
              style={{
                position: 'absolute', top: '100%', left: 0, marginTop: '8px',
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: '12px', padding: '12px', boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
                zIndex: 1000, width: '200px',
              }}
            >
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                  <span>Breadth</span>
                  <span>{activeWidth}px</span>
                </div>
                <input
                  type="range" min="5" max="40" step="1"
                  value={activeWidth}
                  onChange={(e) => onWidthChange?.(parseFloat(e.target.value))}
                  style={{ width: '100%', cursor: 'pointer' }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                {COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => onColorChange?.(c)}
                    style={{
                      width: '24px', height: '24px', borderRadius: '4px', background: c,
                      border: activeColor === c ? '2px solid #fff' : 'none',
                      boxShadow: activeColor === c ? `0 0 0 1px ${c}` : 'none',
                      cursor: 'pointer',
                      opacity: 0.6
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ position: 'relative' }}>
          <button
            onClick={() => {
              if (activeTool === 'eraser') onToolChange?.('lasso');
              else onToolChange?.('eraser');
            }}
            title="Eraser Settings"
            style={{
              padding: '6px',
              borderRadius: '6px',
              border: 'none',
              background: activeTool === 'eraser' ? '#fff' : 'transparent',
              boxShadow: activeTool === 'eraser' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none',
              cursor: 'pointer',
              color: activeTool === 'eraser' ? 'var(--primary)' : 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
          >
            <Eraser size={18} />
          </button>
          {activeTool === 'eraser' && (
            <div
              style={{
                position: 'absolute', top: '100%', left: 0, marginTop: '8px',
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: '12px', padding: '12px', boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
                zIndex: 1000, width: '200px',
              }}
            >
              <div style={{ marginBottom: '4px' }}>
                <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                  <span>Size</span>
                  <span>{activeWidth}px</span>
                </div>
                <input
                  type="range" min="5" max="100" step="5"
                  value={activeWidth}
                  onChange={(e) => onWidthChange?.(parseFloat(e.target.value))}
                  style={{ width: '100%', cursor: 'pointer' }}
                />
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => onToolChange?.('lasso')}
          title="Lasso Select"
          style={{
            padding: '6px',
            borderRadius: '6px',
            border: 'none',
            background: activeTool === 'lasso' ? '#fff' : 'transparent',
            boxShadow: activeTool === 'lasso' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none',
            cursor: 'pointer',
            color: activeTool === 'lasso' ? 'var(--primary)' : 'var(--text-secondary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
          <LassoSelect size={18} />
        </button>

        {activeTool !== 'eraser' && activeTool !== 'lasso' && (
          <div style={{ display: 'flex', gap: '4px', marginLeft: '4px', borderLeft: '1px solid rgba(0,0,0,0.1)', paddingLeft: '4px', alignItems: 'center' }}>
            <div
              style={{
                width: '16px', height: '16px',
                borderRadius: '50%', background: activeColor,
                border: '1px solid rgba(0,0,0,0.1)',
                cursor: 'pointer',
                margin: '0 4px'
              }}
              onClick={() => setShowColorPicker(!showColorPicker)}
              title="Current Color"
            />

            {showColorPicker && (
              <div
                style={{
                  position: 'absolute', top: '100%', left: 0, marginTop: '8px',
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: '12px', padding: '12px', boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
                  zIndex: 1000, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px', width: '160px',
                }}
                onMouseLeave={() => setShowColorPicker(false)}
              >
                {COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => { onColorChange?.(c); setShowColorPicker(false); }}
                    style={{
                      width: '24px', height: '24px', borderRadius: '50%', background: c,
                      border: activeColor === c ? '2px solid #fff' : 'none',
                      boxShadow: activeColor === c ? `0 0 0 1px ${c}` : 'none',
                      cursor: 'pointer',
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: '2px', marginLeft: '4px', borderLeft: '1px solid rgba(0,0,0,0.1)', paddingLeft: '4px' }}>
          <button
            onClick={() => onUndo?.()}
            title="Undo"
            style={{
              padding: '6px', borderRadius: '6px', border: 'none', background: 'transparent',
              cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center'
            }}
          >
            <Undo size={16} />
          </button>
          <button
            onClick={() => onRedo?.()}
            title="Redo"
            style={{
              padding: '6px', borderRadius: '6px', border: 'none', background: 'transparent',
              cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center'
            }}
          >
            <Redo size={16} />
          </button>
        </div>
      </div>

      <div style={{ width: '1px', height: '24px', background: 'var(--border)' }} />

      {/* Group 2: Text Formatting (The Essentials) */}
      <div style={{ display: 'flex', gap: '2px' }}>
        <button
          onClick={() => editor?.chain().focus().toggleBold().run()}
          disabled={!editor}
          style={{
            background: isActive('bold') ? 'rgba(37, 99, 235, 0.1)' : 'transparent',
            border: 'none', borderRadius: '6px',
            color: isActive('bold') ? 'var(--accent)' : 'var(--ink)',
            cursor: editor ? 'pointer' : 'default', padding: '6px',
            display: 'flex', alignItems: 'center',
            opacity: editor ? 1 : 0.5
          }}
          title="Bold (Cmd+B)"
        >
          <Bold size={16} />
        </button>
        <button
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          disabled={!editor}
          style={{
            background: isActive('italic') ? 'rgba(37, 99, 235, 0.1)' : 'transparent',
            border: 'none', borderRadius: '6px',
            color: isActive('italic') ? 'var(--accent)' : 'var(--ink)',
            cursor: editor ? 'pointer' : 'default', padding: '6px',
            display: 'flex', alignItems: 'center',
            opacity: editor ? 1 : 0.5
          }}
          title="Italic (Cmd+I)"
        >
          <Italic size={16} />
        </button>
      </div>

      <div style={{ width: '1px', height: '24px', background: 'var(--border)' }} />

      {/* Group 3: Headings Dropdown */}
      <select
        value={isActive('heading', { level: 1 }) ? '1' : isActive('heading', { level: 2 }) ? '2' : isActive('heading', { level: 3 }) ? '3' : 'paragraph'}
        disabled={!editor}
        onChange={(e) => {
          const val = e.target.value;
          if (val === 'paragraph') editor?.chain().focus().setParagraph().run();
          else editor?.chain().focus().toggleHeading({ level: parseInt(val) as any }).run();
        }}
        style={{
          padding: '6px 8px', border: 'none', borderRadius: '6px',
          background: 'rgba(0,0,0,0.03)', color: 'var(--ink)', fontSize: '13px', cursor: editor ? 'pointer' : 'default', outline: 'none',
          opacity: editor ? 1 : 0.5
        }}
      >
        <option value="paragraph">Text</option>
        <option value="1">Heading 1</option>
        <option value="2">Heading 2</option>
        <option value="3">Heading 3</option>
      </select>

      <div style={{ width: '1px', height: '24px', background: 'var(--border)' }} />

      {/* Group 4: Colors */}
      <div style={{ display: 'flex', gap: '4px' }}>
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => editor && setShowColorPicker(!showColorPicker)}
            disabled={!editor}
            style={{
              background: 'transparent', border: 'none', borderRadius: '6px',
              cursor: editor ? 'pointer' : 'default', padding: '6px', display: 'flex', alignItems: 'center', gap: '4px',
              borderBottom: `2px solid ${getCurrentColor()}`,
              opacity: editor ? 1 : 0.5
            }}
            title="Text Color"
          >
            <span style={{ fontSize: '18px', fontWeight: 'bold' }}>A</span>
          </button>
          {showColorPicker && editor && (
            <div
              style={{
                position: 'absolute', top: '100%', left: 0, marginTop: '8px',
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: '12px', padding: '12px', boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
                zIndex: 1000, display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '6px', width: '200px',
              }}
              onMouseLeave={() => setShowColorPicker(false)}
            >
              {COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => {
                    editor.chain().focus().setColor(color).run();
                    setShowColorPicker(false);
                  }}
                  style={{ width: '24px', height: '24px', background: color, border: '1px solid rgba(0,0,0,0.05)', borderRadius: '50%', cursor: 'pointer' }}
                />
              ))}
            </div>
          )}
        </div>

        <div style={{ position: 'relative' }}>
          <button
            onClick={() => editor && setShowHighlightPicker(!showHighlightPicker)}
            disabled={!editor}
            style={{
              background: isActive('highlight') ? 'rgba(255, 204, 0, 0.2)' : 'transparent',
              border: 'none', borderRadius: '6px',
              cursor: editor ? 'pointer' : 'default', padding: '6px', display: 'flex', alignItems: 'center',
              opacity: editor ? 1 : 0.5
            }}
            title="Text Highlight"
          >
            <Highlighter size={16} color={isActive('highlight') ? '#e67e22' : 'var(--text-secondary)'} />
          </button>
          {showHighlightPicker && editor && (
            <div
              style={{
                position: 'absolute', top: '100%', right: 0, marginTop: '8px',
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: '12px', padding: '12px', boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
                zIndex: 1000, display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '6px', width: '200px',
              }}
              onMouseLeave={() => setShowHighlightPicker(false)}
            >
              <button
                onClick={() => {
                  editor.chain().focus().unsetHighlight().run();
                  setShowHighlightPicker(false);
                }}
                style={{ gridColumn: '1 / -1', padding: '8px', background: 'var(--page-bg)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '11px', fontWeight: 600, marginBottom: '4px' }}
              >
                Clear Highlight
              </button>
              {COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => {
                    editor.chain().focus().toggleHighlight({ color }).run();
                    setShowHighlightPicker(false);
                  }}
                  style={{ width: '24px', height: '24px', background: color, border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ width: '1px', height: '24px', background: 'var(--border)' }} />

      {/* Group 5: Paper Selection */}
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
        <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Paper:</span>
        <select
          value={paperType}
          onChange={(e) => onPaperTypeChange?.(e.target.value)}
          style={{
            padding: '6px 8px', border: 'none', borderRadius: '6px',
            background: 'rgba(0,0,0,0.03)', color: 'var(--ink)', fontSize: '13px', cursor: 'pointer', outline: 'none',
          }}
        >
          {PAPER_TYPES.map(type => (
            <option key={type.value} value={type.value}>{type.label}</option>
          ))}
        </select>
      </div>

      <div style={{ width: '1px', height: '24px', background: 'var(--border)' }} />

      {/* Group 6: Lists & More */}
      <div style={{ display: 'flex', gap: '2px' }}>
        <button
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          disabled={!editor}
          style={{
            background: isActive('bulletList') ? 'rgba(0,0,0,0.05)' : 'transparent',
            border: 'none', borderRadius: '6px',
            color: 'var(--ink)', cursor: editor ? 'pointer' : 'default', fontSize: '14px', padding: '6px 10px',
            opacity: editor ? 1 : 0.5
          }}
          title="Bullet List"
        >•</button>
        <button
          onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
          disabled={!editor}
          style={{
            background: isActive('codeBlock') ? 'rgba(0,0,0,0.05)' : 'transparent',
            border: 'none', borderRadius: '6px',
            color: 'var(--ink)', cursor: editor ? 'pointer' : 'default', fontSize: '14px', padding: '6px 10px',
            opacity: editor ? 1 : 0.5
          }}
          title="Code Block"
        >{'</>'}</button>
      </div>
    </div>
  );
}

