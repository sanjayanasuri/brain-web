'use client';

interface BranchChipProps {
  branchId: string;
  selectedText: string;
  onClick: () => void;
}

export default function BranchChip({ branchId, selectedText, onClick }: BranchChipProps) {
  const preview = selectedText.length > 30
    ? selectedText.substring(0, 30) + '...'
    : selectedText;

  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        marginTop: '8px',
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        fontSize: '12px',
        color: 'var(--ink)',
        cursor: 'pointer',
        transition: 'all 0.2s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--accent)';
        e.currentTarget.style.color = 'white';
        e.currentTarget.style.borderColor = 'var(--accent)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--panel)';
        e.currentTarget.style.color = 'var(--ink)';
        e.currentTarget.style.borderColor = 'var(--border)';
      }}
    >
      <span>{preview}</span>
    </button>
  );
}
