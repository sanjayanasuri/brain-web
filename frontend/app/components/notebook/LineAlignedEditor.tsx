'use client';

import React, { useState, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';

interface LineAlignedEditorProps {
  content: string;
  onUpdate: (content: string) => void;
  placeholder?: string;
  editable?: boolean;
  onEditorReady?: (editor: any) => void;
  onFocus?: (editor: any) => void;
  /** Used to set correct text color on dark vs light paper */
  paperType?: 'ruled' | 'grid' | 'blank' | 'dotted' | 'dark';
  /** If true, this is page 1 — auto-focus cursor on mount */
  autoFocus?: boolean;
}

export function LineAlignedEditor({
  content,
  onUpdate,
  placeholder = 'Start typing on the first line...',
  editable = true,
  onEditorReady,
  onFocus,
  paperType = 'ruled',
  autoFocus = false,
}: LineAlignedEditorProps) {
  const [isMounted, setIsMounted] = useState(false);
  const isDark = paperType === 'dark';
  const textColor = isDark ? '#e8e8e8' : '#000000';
  const placeholderColor = isDark ? '#666' : '#aaa';
  const selectionColor = isDark ? 'rgba(96, 165, 250, 0.3)' : 'rgba(37, 99, 235, 0.2)';

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        paragraph: {
          HTMLAttributes: {
            class: 'notebook-paragraph',
          },
        },
        heading: {
          levels: [1, 2, 3],
          HTMLAttributes: {
            class: 'notebook-heading',
          },
        },
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: 'is-editor-empty',
      }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'notebook-link',
        },
      }),
    ],
    content,
    editable,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onUpdate(html);
    },
    onFocus: ({ editor }) => {
      onFocus?.(editor);
    },
    editorProps: {
      attributes: {
        class: 'line-aligned-editor',
      },
    },
  });

  const lastReportedEditor = React.useRef<any>(null);

  useEffect(() => {
    // Only report if we have an editor and it's different from the last one we reported
    if (editor && editor !== lastReportedEditor.current && onEditorReady) {
      lastReportedEditor.current = editor;
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  // Auto-focus: put cursor on line 1 of page 1 as soon as the editor is ready
  const didAutoFocus = React.useRef(false);
  useEffect(() => {
    if (autoFocus && editor && !didAutoFocus.current) {
      didAutoFocus.current = true;
      // Small timeout lets the DOM settle before focusing
      setTimeout(() => {
        editor.commands.focus('start');
      }, 80);
    }
  }, [editor, autoFocus]);

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  return (
    <>
      <EditorContent editor={editor} />

      <style jsx global>{`
        .line-aligned-editor {
          --editor-text-color: ${textColor};
          --editor-placeholder-color: ${placeholderColor};
          --editor-selection-color: ${selectionColor};
          width: 100%;
          height: 100%;
          padding-left: 90px; /* Respect margin line (80px + 10px padding) */
          padding-right: 50px;
          padding-top: 65px; /* Start below header line (60px + 5px) */
          padding-bottom: 40px; /* Space for page number */
          outline: none;
          font-family: 'Crimson Pro', 'Georgia', serif;
          font-size: 16px;
          line-height: 28px; /* Match ruled line spacing */
          color: var(--editor-text-color, #000000);
          caret-color: var(--editor-text-color, #000000);
          cursor: text;
        }

        .line-aligned-editor .ProseMirror {
          outline: none;
          min-height: 100%;
          color: var(--editor-text-color, #000000);
          caret-color: var(--editor-text-color, #000000);
        }

        /* Paragraph styling - aligned to lines */
        .line-aligned-editor .notebook-paragraph {
          margin: 0;
          padding: 0;
          min-height: 28px; /* Ensure empty lines take up space */
          line-height: 28px;
        }

        /* Heading styling - still aligned to line grid */
        .line-aligned-editor .notebook-heading {
          margin: 0;
          padding: 0;
          font-weight: 700;
          line-height: 28px;
        }

        .line-aligned-editor h1.notebook-heading {
          font-size: 24px;
          line-height: 56px; /* 2 lines */
          margin-bottom: 0;
        }

        .line-aligned-editor h2.notebook-heading {
          font-size: 20px;
          line-height: 56px; /* 2 lines */
          margin-bottom: 0;
        }

        .line-aligned-editor h3.notebook-heading {
          font-size: 18px;
          line-height: 28px; /* 1 line */
          margin-bottom: 0;
        }

        /* Placeholder styling */
        .line-aligned-editor .is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: var(--editor-placeholder-color, #aaa);
          pointer-events: none;
          height: 0;
        }

        /* Lists - maintain line alignment */
        .line-aligned-editor ul,
        .line-aligned-editor ol {
          margin: 0;
          padding-left: 20px;
        }

        .line-aligned-editor li {
          line-height: 28px;
          margin: 0;
          padding: 0;
        }

        /* Code blocks */
        .line-aligned-editor pre {
          background: rgba(0, 0, 0, 0.03);
          border-radius: 4px;
          padding: 8px 12px;
          margin: 0;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 14px;
          line-height: 28px;
        }

        .line-aligned-editor code {
          background: rgba(0, 0, 0, 0.05);
          border-radius: 3px;
          padding: 2px 6px;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 14px;
        }

        /* Blockquotes */
        .line-aligned-editor blockquote {
          border-left: 3px solid #2563eb;
          margin: 0;
          padding-left: 16px;
          color: #555;
          font-style: italic;
        }

        /* Selection */
        .line-aligned-editor ::selection {
          background: var(--editor-selection-color, rgba(37, 99, 235, 0.2));
        }

        /* Strong and emphasis */
        .line-aligned-editor strong {
          font-weight: 700;
        }

        .line-aligned-editor em {
          font-style: italic;
        }

        .notebook-link {
          color: #2563eb;
          text-decoration: underline;
          cursor: pointer;
        }

        .notebook-link:hover {
          color: #1d4ed8;
        }
      `}</style>
    </>
  );
}
