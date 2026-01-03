'use client';

import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Editor } from '@tiptap/react';

interface FloatingToolbarProps {
  editor: Editor | null;
}

export function FloatingToolbar({ editor }: FloatingToolbarProps) {
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

  if (!hasSelection) {
    return null;
  }

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        boxShadow: 'var(--shadow)',
        display: 'flex',
        gap: '4px',
        padding: '6px',
        position: 'absolute',
        zIndex: 1000,
      }}
    >
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
        }}
        title="Quote"
      >
        "
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
        }}
        title="Code Block"
      >
        {'</>'}
      </button>
    </div>
  );
}

