'use client';

import { useEffect, useState } from 'react';
import { Editor } from '@tiptap/react';

interface Heading {
  id: string;
  level: number;
  text: string;
  pos: number;
}

interface DocumentOutlineProps {
  editor: Editor | null;
}

export function DocumentOutline({ editor }: DocumentOutlineProps) {
  const [headings, setHeadings] = useState<Heading[]>([]);

  useEffect(() => {
    if (!editor) return;

    const updateHeadings = () => {
      const foundHeadings: Heading[] = [];
      const doc = editor.state.doc;

      doc.descendants((node, pos) => {
        if (node.type.name === 'heading') {
          const level = node.attrs.level;
          const text = node.textContent;
          foundHeadings.push({
            id: `heading-${pos}`,
            level,
            text,
            pos,
          });
        }
      });

      setHeadings(foundHeadings);
    };

    // Initial update
    updateHeadings();

    // Update on content changes
    editor.on('update', updateHeadings);
    editor.on('selectionUpdate', updateHeadings);

    return () => {
      editor.off('update', updateHeadings);
      editor.off('selectionUpdate', updateHeadings);
    };
  }, [editor]);

  const handleHeadingClick = (pos: number) => {
    if (!editor) return;
    editor.commands.setTextSelection(pos);
    editor.commands.scrollIntoView();
  };

  if (headings.length === 0) {
    return (
      <div
        style={{
          padding: '16px',
          color: 'var(--muted)',
          fontSize: '13px',
          textAlign: 'center',
        }}
      >
        No headings yet
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '12px',
        overflowY: 'auto',
        height: '100%',
      }}
    >
      <div
        style={{
          fontSize: '12px',
          fontWeight: 600,
          color: 'var(--muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginBottom: '12px',
          padding: '0 4px',
        }}
      >
        Outline
      </div>
      {headings.map((heading) => (
        <div
          key={heading.id}
          onClick={() => handleHeadingClick(heading.pos)}
          style={{
            padding: '6px 4px',
            paddingLeft: `${(heading.level - 1) * 12 + 4}px`,
            cursor: 'pointer',
            fontSize: '13px',
            color: 'var(--ink)',
            borderRadius: '4px',
            marginBottom: '2px',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--panel)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          {heading.text || 'Untitled'}
        </div>
      ))}
    </div>
  );
}

