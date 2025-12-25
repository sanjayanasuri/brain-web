'use client';

import { useState } from 'react';

interface CollapsibleSectionProps {
  title: string;
  subtitle?: string;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}

export default function CollapsibleSection({
  title,
  subtitle,
  defaultCollapsed = true,
  children,
}: CollapsibleSectionProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  return (
    <div
      style={{
        background: 'var(--panel)',
        borderRadius: '12px',
        padding: '24px',
        boxShadow: 'var(--shadow)',
      }}
    >
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          marginBottom: isCollapsed ? 0 : '16px',
        }}
      >
        <div style={{ textAlign: 'left' }}>
          <h2 style={{ fontSize: '20px', fontWeight: '600', margin: 0, marginBottom: subtitle ? '4px' : 0 }}>
            {title}
          </h2>
          {subtitle && (
            <p style={{ fontSize: '14px', color: 'var(--muted)', margin: 0 }}>
              {subtitle}
            </p>
          )}
        </div>
        <div
          style={{
            fontSize: '18px',
            color: 'var(--muted)',
            transform: isCollapsed ? 'rotate(0deg)' : 'rotate(180deg)',
            transition: 'transform 0.2s',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          ▼
        </div>
      </button>
      {!isCollapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {children}
        </div>
      )}
    </div>
  );
}

