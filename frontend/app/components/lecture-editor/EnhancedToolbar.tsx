'use client';

import { useState } from 'react';
import { Editor } from '@tiptap/react';

interface EnhancedToolbarProps {
  editor: Editor | null;
}

const FONT_FAMILIES = [
  { label: 'Default', value: 'inherit' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times', value: 'Times New Roman, serif' },
  { label: 'Courier', value: 'Courier New, monospace' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
];

const FONT_SIZES = ['8px', '9px', '10px', '11px', '12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px', '36px', '48px'];

const COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc',
  '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff', '#980000', '#ff0000',
  '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff',
  '#9900ff', '#ff00ff', '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc',
  '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc',
];

const HIGHLIGHT_COLORS = [
  '#ffff00', '#ffcc00', '#ff9900', '#ff6666', '#ff99cc', '#cc99ff',
  '#99ccff', '#66ccff', '#99ffcc', '#ccff99', '#ffff99', '#ffffff',
];

export function EnhancedToolbar({ editor }: EnhancedToolbarProps) {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const [showFontPicker, setShowFontPicker] = useState(false);

  if (!editor) {
    return null;
  }

  const isActive = (name: string, options?: any) => {
    return editor.isActive(name, options);
  };

  const getCurrentColor = () => {
    return editor.getAttributes('textStyle').color || '#000000';
  };

  const getCurrentHighlight = () => {
    return editor.getAttributes('highlight').color || null;
  };

  const getCurrentFontFamily = () => {
    return editor.getAttributes('textStyle').fontFamily || 'inherit';
  };

  return (
    <div
      style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexWrap: 'wrap',
      }}
    >
      {/* Font Family */}
      <div style={{ position: 'relative' }}>
        <select
          value={getCurrentFontFamily()}
          onChange={(e) => {
            editor.chain().focus().setFontFamily(e.target.value).run();
          }}
          style={{
            padding: '6px 8px',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            background: 'var(--surface)',
            color: 'var(--ink)',
            fontSize: '13px',
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          {FONT_FAMILIES.map((font) => (
            <option key={font.value} value={font.value}>
              {font.label}
            </option>
          ))}
        </select>
      </div>

      <div style={{ width: '1px', height: '24px', background: 'var(--border)' }} />

      {/* Text Formatting */}
      <button
        onClick={() => editor.chain().focus().toggleBold().run()}
        style={{
          background: isActive('bold') ? 'var(--accent)' : 'transparent',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          color: isActive('bold') ? 'white' : 'var(--ink)',
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: 600,
          padding: '6px 10px',
          minWidth: '32px',
        }}
        title="Bold (Cmd+B)"
      >
        <strong>B</strong>
      </button>
      <button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        style={{
          background: isActive('italic') ? 'var(--accent)' : 'transparent',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          color: isActive('italic') ? 'white' : 'var(--ink)',
          cursor: 'pointer',
          fontStyle: 'italic',
          fontSize: '14px',
          padding: '6px 10px',
          minWidth: '32px',
        }}
        title="Italic (Cmd+I)"
      >
        <em>I</em>
      </button>
      <button
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        style={{
          background: isActive('underline') ? 'var(--accent)' : 'transparent',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          color: isActive('underline') ? 'white' : 'var(--ink)',
          cursor: 'pointer',
          textDecoration: 'underline',
          fontSize: '14px',
          padding: '6px 10px',
          minWidth: '32px',
        }}
        title="Underline (Cmd+U)"
      >
        <u>U</u>
      </button>

      <div style={{ width: '1px', height: '24px', background: 'var(--border)' }} />

      {/* Text Color */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setShowColorPicker(!showColorPicker)}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            cursor: 'pointer',
            padding: '6px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
          title="Text Color"
        >
          <span style={{ fontSize: '14px' }}>A</span>
          <div
            style={{
              width: '16px',
              height: '16px',
              background: getCurrentColor(),
              border: '1px solid var(--border)',
              borderRadius: '3px',
            }}
          />
        </button>
        {showColorPicker && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: '4px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '8px',
              boxShadow: 'var(--shadow)',
              zIndex: 1000,
              display: 'grid',
              gridTemplateColumns: 'repeat(6, 1fr)',
              gap: '4px',
              width: '180px',
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
                style={{
                  width: '24px',
                  height: '24px',
                  background: color,
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Highlight Color */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setShowHighlightPicker(!showHighlightPicker)}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            cursor: 'pointer',
            padding: '6px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
          title="Highlight"
        >
          <span style={{ fontSize: '14px' }}>🖍️</span>
        </button>
        {showHighlightPicker && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: '4px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '8px',
              boxShadow: 'var(--shadow)',
              zIndex: 1000,
              display: 'grid',
              gridTemplateColumns: 'repeat(6, 1fr)',
              gap: '4px',
              width: '180px',
            }}
            onMouseLeave={() => setShowHighlightPicker(false)}
          >
            <button
              onClick={() => {
                editor.chain().focus().unsetHighlight().run();
                setShowHighlightPicker(false);
              }}
              style={{
                gridColumn: '1 / -1',
                padding: '6px',
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Remove Highlight
            </button>
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => {
                  editor.chain().focus().toggleHighlight({ color }).run();
                  setShowHighlightPicker(false);
                }}
                style={{
                  width: '24px',
                  height: '24px',
                  background: color,
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        )}
      </div>

      <div style={{ width: '1px', height: '24px', background: 'var(--border)' }} />

      {/* Headings */}
      <button
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        style={{
          background: isActive('heading', { level: 1 }) ? 'var(--accent)' : 'transparent',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          color: isActive('heading', { level: 1 }) ? 'white' : 'var(--ink)',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: 600,
          padding: '6px 10px',
        }}
        title="Heading 1"
      >
        H1
      </button>
      <button
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        style={{
          background: isActive('heading', { level: 2 }) ? 'var(--accent)' : 'transparent',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          color: isActive('heading', { level: 2 }) ? 'white' : 'var(--ink)',
          cursor: 'pointer',
          fontSize: '13px',
          padding: '6px 10px',
        }}
        title="Heading 2"
      >
        H2
      </button>
      <button
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        style={{
          background: isActive('heading', { level: 3 }) ? 'var(--accent)' : 'transparent',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          color: isActive('heading', { level: 3 }) ? 'white' : 'var(--ink)',
          cursor: 'pointer',
          fontSize: '13px',
          padding: '6px 10px',
        }}
        title="Heading 3"
      >
        H3
      </button>

      <div style={{ width: '1px', height: '24px', background: 'var(--border)' }} />

      {/* Lists */}
      <button
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        style={{
          background: isActive('bulletList') ? 'var(--accent)' : 'transparent',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          color: isActive('bulletList') ? 'white' : 'var(--ink)',
          cursor: 'pointer',
          fontSize: '14px',
          padding: '6px 10px',
        }}
        title="Bullet List"
      >
        •
      </button>
      <button
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        style={{
          background: isActive('orderedList') ? 'var(--accent)' : 'transparent',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          color: isActive('orderedList') ? 'white' : 'var(--ink)',
          cursor: 'pointer',
          fontSize: '14px',
          padding: '6px 10px',
        }}
        title="Numbered List"
      >
        1.
      </button>
      <button
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        style={{
          background: isActive('blockquote') ? 'var(--accent)' : 'transparent',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          color: isActive('blockquote') ? 'white' : 'var(--ink)',
          cursor: 'pointer',
          fontSize: '14px',
          padding: '6px 10px',
        }}
        title="Quote"
      >
        "
      </button>
      <button
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        style={{
          background: isActive('codeBlock') ? 'var(--accent)' : 'transparent',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          color: isActive('codeBlock') ? 'white' : 'var(--ink)',
          cursor: 'pointer',
          fontSize: '14px',
          fontFamily: 'monospace',
          padding: '6px 10px',
        }}
        title="Code Block"
      >
        {'</>'}
      </button>
    </div>
  );
}

