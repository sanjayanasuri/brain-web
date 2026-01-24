'use client';

interface BridgingHint {
  id: string;
  hint_text: string;
  target_offset: number;
}

interface BridgingHintsProps {
  hints: BridgingHint[];
  parentMessageContent: string;
  onHintClick?: (offset: number) => void;
}

export default function BridgingHints({ hints, parentMessageContent, onHintClick }: BridgingHintsProps) {
  if (!hints || hints.length === 0) {
    return null;
  }

  return (
    <div style={{
      marginTop: '12px',
      padding: '12px',
      background: 'var(--panel)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      fontSize: '13px',
    }}>
      <div style={{
        fontSize: '11px',
        fontWeight: 600,
        color: 'var(--muted)',
        textTransform: 'uppercase',
        marginBottom: '8px',
      }}>
        Bridging Hints
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {hints.map((hint) => (
          <div
            key={hint.id}
            style={{
              padding: '8px',
              background: 'var(--surface)',
              borderRadius: '6px',
              cursor: onHintClick ? 'pointer' : 'default',
            }}
            onClick={() => onHintClick?.(hint.target_offset)}
            onMouseEnter={(e) => {
              if (onHintClick) {
                e.currentTarget.style.background = 'var(--accent)';
                e.currentTarget.style.color = 'white';
              }
            }}
            onMouseLeave={(e) => {
              if (onHintClick) {
                e.currentTarget.style.background = 'var(--surface)';
                e.currentTarget.style.color = 'var(--ink)';
              }
            }}
          >
            {hint.hint_text}
          </div>
        ))}
      </div>
    </div>
  );
}
