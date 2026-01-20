'use client';

import { Editor } from '@tiptap/react';

interface FloatingToolbarProps {
  editor: Editor | null;
  onLinkConcept?: () => void;
  onRemoveLink?: () => void;
  selectionError?: string | null;
  linkDisabledReason?: string | null;
  position?: { top: number; left: number; placement?: 'top' | 'bottom' } | null;
}

export function FloatingToolbar({
  editor,
  onLinkConcept,
  onRemoveLink,
  selectionError,
  linkDisabledReason,
  position,
}: FloatingToolbarProps) {
  if (!editor) {
    return null;
  }

  const isActive = (name: string, options?: any) => {
    return editor.isActive(name, options);
  };

  const toggleFormat = (name: string, options?: any) => {
    if (name === 'bold') {
      editor.chain().focus().toggleBold().run();
    } else if (name === 'italic') {
      editor.chain().focus().toggleItalic().run();
    } else if (name === 'underline') {
      // StarterKit doesn't have underline, but we can add it later if needed
      return;
    } else if (name === 'heading') {
      if (isActive('heading', options)) {
        editor.chain().focus().setParagraph().run();
      } else {
        editor.chain().focus().toggleHeading(options).run();
      }
    } else if (name === 'bulletList') {
      editor.chain().focus().toggleBulletList().run();
    } else if (name === 'orderedList') {
      editor.chain().focus().toggleOrderedList().run();
    } else if (name === 'blockquote') {
      editor.chain().focus().toggleBlockquote().run();
    } else if (name === 'codeBlock') {
      editor.chain().focus().toggleCodeBlock().run();
    }
  };

  const selection = editor.state.selection;
  const isEmpty = selection.empty;
  const hasSelection = !isEmpty;

  if (!hasSelection || !position) {
    return null;
  }

  const showLink = Boolean(onLinkConcept || linkDisabledReason);
  const linkDisabled = !onLinkConcept || !!selectionError || !!linkDisabledReason;
  const removeDisabled = !onRemoveLink;
  const helperText = selectionError || linkDisabledReason;
  // Increased offset to hover more casually above/below text without intruding
  const transform =
    position.placement === 'bottom' ? 'translate(-50%, 16px)' : 'translate(-50%, -24px)';

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        boxShadow: 'var(--shadow)',
        display: 'flex',
        flexDirection: 'column',
        padding: '6px',
        position: 'absolute',
        top: position.top,
        left: position.left,
        transform,
        zIndex: 1000,
        // Allow pointer events to pass through container, but enable them on buttons
        pointerEvents: 'none',
      }}
    >
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center', pointerEvents: 'auto' }}>
        <button
          onClick={() => toggleFormat('bold')}
          style={{
            background: isActive('bold') ? 'var(--accent)' : 'transparent',
            border: 'none',
            borderRadius: '4px',
            color: isActive('bold') ? 'white' : 'var(--ink)',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: isActive('bold') ? 600 : 400,
            padding: '6px 10px',
            pointerEvents: 'auto',
          }}
          title="Bold (Cmd+B)"
        >
          <strong>B</strong>
        </button>
        <button
          onClick={() => toggleFormat('italic')}
          style={{
            background: isActive('italic') ? 'var(--accent)' : 'transparent',
            border: 'none',
            borderRadius: '4px',
            color: isActive('italic') ? 'white' : 'var(--ink)',
            cursor: 'pointer',
            fontStyle: 'italic',
            fontSize: '14px',
            padding: '6px 10px',
            pointerEvents: 'auto',
          }}
          title="Italic (Cmd+I)"
        >
          <em>I</em>
        </button>
        <div
          style={{
            background: 'var(--border)',
            height: '24px',
            margin: '0 4px',
            width: '1px',
          }}
        />
        <button
          onClick={() => toggleFormat('heading', { level: 1 })}
          style={{
            background: isActive('heading', { level: 1 }) ? 'var(--accent)' : 'transparent',
            border: 'none',
            borderRadius: '4px',
            color: isActive('heading', { level: 1 }) ? 'white' : 'var(--ink)',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 600,
            padding: '6px 10px',
            pointerEvents: 'auto',
          }}
          title="Heading 1"
        >
          H1
        </button>
        <button
          onClick={() => toggleFormat('heading', { level: 2 })}
          style={{
            background: isActive('heading', { level: 2 }) ? 'var(--accent)' : 'transparent',
            border: 'none',
            borderRadius: '4px',
            color: isActive('heading', { level: 2 }) ? 'white' : 'var(--ink)',
            cursor: 'pointer',
            fontSize: '14px',
            padding: '6px 10px',
            pointerEvents: 'auto',
          }}
          title="Heading 2"
        >
          H2
        </button>
        <button
          onClick={() => toggleFormat('heading', { level: 3 })}
          style={{
            background: isActive('heading', { level: 3 }) ? 'var(--accent)' : 'transparent',
            border: 'none',
            borderRadius: '4px',
            color: isActive('heading', { level: 3 }) ? 'white' : 'var(--ink)',
            cursor: 'pointer',
            fontSize: '14px',
            padding: '6px 10px',
            pointerEvents: 'auto',
          }}
          title="Heading 3"
        >
          H3
        </button>
        <div
          style={{
            background: 'var(--border)',
            height: '24px',
            margin: '0 4px',
            width: '1px',
          }}
        />
        <button
          onClick={() => toggleFormat('bulletList')}
          style={{
            background: isActive('bulletList') ? 'var(--accent)' : 'transparent',
            border: 'none',
            borderRadius: '4px',
            color: isActive('bulletList') ? 'white' : 'var(--ink)',
            cursor: 'pointer',
            fontSize: '14px',
            padding: '6px 10px',
            pointerEvents: 'auto',
          }}
          title="Bullet List"
        >
          •
        </button>
        <button
          onClick={() => toggleFormat('orderedList')}
          style={{
            background: isActive('orderedList') ? 'var(--accent)' : 'transparent',
            border: 'none',
            borderRadius: '4px',
            color: isActive('orderedList') ? 'white' : 'var(--ink)',
            cursor: 'pointer',
            fontSize: '14px',
            padding: '6px 10px',
            pointerEvents: 'auto',
          }}
          title="Numbered List"
        >
          1.
        </button>
        <button
          onClick={() => toggleFormat('blockquote')}
          style={{
            background: isActive('blockquote') ? 'var(--accent)' : 'transparent',
            border: 'none',
            borderRadius: '4px',
            color: isActive('blockquote') ? 'white' : 'var(--ink)',
            cursor: 'pointer',
            fontSize: '14px',
            padding: '6px 10px',
            pointerEvents: 'auto',
          }}
          title="Quote"
        >
          &quot;
        </button>
        <button
          onClick={() => toggleFormat('codeBlock')}
          style={{
            background: isActive('codeBlock') ? 'var(--accent)' : 'transparent',
            border: 'none',
            borderRadius: '4px',
            color: isActive('codeBlock') ? 'white' : 'var(--ink)',
            cursor: 'pointer',
            fontSize: '14px',
            fontFamily: 'monospace',
            padding: '6px 10px',
            pointerEvents: 'auto',
          }}
          title="Code Block"
        >
          {'</>'}
        </button>
        {(showLink || onRemoveLink) && (
          <div
            style={{
              background: 'var(--border)',
              height: '24px',
              margin: '0 4px',
              width: '1px',
            }}
          />
        )}
        {showLink && (
          <button
            onClick={onLinkConcept}
            disabled={linkDisabled}
            style={{
              background: linkDisabled ? 'transparent' : 'var(--accent)',
              border: 'none',
              borderRadius: '4px',
              color: linkDisabled ? 'var(--muted)' : 'white',
              cursor: linkDisabled ? 'not-allowed' : 'pointer',
              fontSize: '12px',
              fontWeight: 600,
              padding: '6px 10px',
              opacity: linkDisabled ? 0.6 : 1,
            }}
            title={helperText || 'Link to concept'}
          >
            Link
          </button>
        )}
        {onRemoveLink && (
          <button
            onClick={onRemoveLink}
            disabled={removeDisabled}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              color: 'var(--ink)',
              cursor: removeDisabled ? 'not-allowed' : 'pointer',
              fontSize: '12px',
              fontWeight: 600,
              padding: '6px 10px',
              opacity: removeDisabled ? 0.6 : 1,
            }}
            title="Remove link"
          >
            Unlink
          </button>
        )}
      </div>
      {helperText && (
        <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--accent-2)' }}>
          {helperText}
        </div>
      )}
    </div>
  );
}
