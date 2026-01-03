'use client';

import Link from 'next/link';
import type { NarrativeAction } from '../../lib/homeNarrative';

interface NarrativeCardProps {
  title: string;
  description: string;
  tag?: string;
  primaryAction: NarrativeAction;
  secondaryAction?: NarrativeAction;
}

export default function NarrativeCard({
  title,
  description,
  tag,
  primaryAction,
  secondaryAction,
}: NarrativeCardProps) {
  return (
    <div
      style={{
        padding: '16px',
        borderRadius: '8px',
        border: '1px solid var(--border)',
        background: 'var(--background)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
          <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--ink)', flex: 1 }}>
            {title}
          </div>
          {tag && (
            <div
              style={{
                display: 'inline-block',
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                color: 'var(--muted)',
                whiteSpace: 'nowrap',
              }}
            >
              {tag}
            </div>
          )}
        </div>
        <div style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: '1.5' }}>
          {description}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <Link
          href={primaryAction.href}
          style={{
            padding: '8px 16px',
            background: 'var(--accent)',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: '500',
            cursor: 'pointer',
            textDecoration: 'none',
            display: 'inline-block',
            whiteSpace: 'nowrap',
          }}
        >
          {primaryAction.label}
        </Link>
        {secondaryAction && (
          <Link
            href={secondaryAction.href}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              color: 'var(--accent)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: '500',
              cursor: 'pointer',
              textDecoration: 'none',
              display: 'inline-block',
              whiteSpace: 'nowrap',
            }}
          >
            {secondaryAction.label}
          </Link>
        )}
      </div>
    </div>
  );
}

