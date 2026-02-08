'use client';

import { Editor } from '@tiptap/react';

interface FloatingToolbarProps {
  editor: Editor | null;
  onLinkConcept?: () => void;
  onRemoveLink?: () => void;
  selectionError?: string | null;
  linkDisabledReason?: string | null;
  position?: { top: number; left: number; placement?: 'top' | 'bottom' } | null;
  onExplain?: () => void;
  onAddToChat?: () => void;
  onTutor?: () => void;
}

export function FloatingToolbar({
  editor,
  onLinkConcept,
  onRemoveLink,
  selectionError,
  linkDisabledReason,
  position,
  onExplain,
  onAddToChat,
  onTutor,
}: FloatingToolbarProps) {
  if (!editor) {
    return null;
  }

  const selection = editor.state.selection;
  const isEmpty = selection.empty;
  const hasSelection = !isEmpty;

  if (!hasSelection || !position) {
    return null;
  }

  // Position much higher above the text to avoid blocking the view
  const transform =
    position.placement === 'bottom' ? 'translate(-50%, 16px)' : 'translate(-50%, -48px)';

  return (
    <div
      style={{
        background: 'rgba(255, 255, 255, 0.98)',
        border: '1px solid rgba(0, 0, 0, 0.08)',
        borderRadius: '6px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
        display: 'flex',
        padding: '3px',
        position: 'absolute',
        top: position.top,
        left: position.left,
        transform,
        zIndex: 1000,
        pointerEvents: 'none',
      }}
    >
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center', pointerEvents: 'auto' }}>
        {onTutor && (
          <button
            onClick={onTutor}
            style={{
              background: 'linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%)',
              border: 'none',
              borderRadius: '4px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '10px',
              fontWeight: 600,
              padding: '4px 10px',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 4px rgba(139, 92, 246, 0.3)',
            }}
            title="Start Socratic Tutor Session"
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.05)';
              e.currentTarget.style.boxShadow = '0 3px 6px rgba(139, 92, 246, 0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = '0 2px 4px rgba(139, 92, 246, 0.3)';
            }}
          >
            ✨ Tutor
          </button>
        )}
        {onExplain && (
          <button
            onClick={onExplain}
            style={{
              background: 'var(--accent)',
              border: 'none',
              borderRadius: '4px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '10px',
              fontWeight: 600,
              padding: '4px 8px',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
            }}
            title="Explain this selection"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#1d4ed8';
              e.currentTarget.style.transform = 'scale(1.05)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--accent)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            Explain
          </button>
        )}
        {onAddToChat && (
          <button
            onClick={onAddToChat}
            style={{
              background: 'white',
              border: '1px solid var(--accent)',
              borderRadius: '4px',
              color: 'var(--accent)',
              cursor: 'pointer',
              fontSize: '10px',
              fontWeight: 600,
              padding: '4px 8px',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
            }}
            title="Add to chat"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--accent)';
              e.currentTarget.style.color = 'white';
              e.currentTarget.style.transform = 'scale(1.05)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'white';
              e.currentTarget.style.color = 'var(--accent)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            Add to Chat
          </button>
        )}
      </div>
    </div>
  );
}
