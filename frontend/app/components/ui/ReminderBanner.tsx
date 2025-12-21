'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import type { ReminderBanner } from '../../lib/reminders';
import { dismissBanner } from '../../lib/reminders';
import { logEvent } from '../../lib/eventsClient';

interface ReminderBannerProps {
  banner: ReminderBanner;
  onDismiss: () => void;
}

export default function ReminderBanner({ banner, onDismiss }: ReminderBannerProps) {
  const router = useRouter();

  const handleDismiss = () => {
    dismissBanner(banner.id);
    logEvent({
      type: 'REMINDER_DISMISSED',
      payload: { banner_id: banner.id, banner_type: banner.type },
    }).catch(() => {});
    onDismiss();
  };

  const handleCTA = () => {
    router.push(banner.cta.target);
  };

  return (
    <div style={{
      padding: '12px 16px',
      background: 'var(--accent)',
      color: 'white',
      borderRadius: '8px',
      marginBottom: '16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '14px',
          fontWeight: '600',
          marginBottom: '4px',
        }}>
          {banner.title}
        </div>
        <div style={{
          fontSize: '12px',
          opacity: 0.9,
        }}>
          {banner.body}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <button
          onClick={handleCTA}
          style={{
            padding: '6px 12px',
            background: 'rgba(255, 255, 255, 0.2)',
            color: 'white',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: '600',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            transition: 'background 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.3)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
          }}
        >
          {banner.cta.label}
        </button>
        <button
          onClick={handleDismiss}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'white',
            cursor: 'pointer',
            padding: '4px',
            fontSize: '18px',
            lineHeight: 1,
            opacity: 0.8,
            transition: 'opacity 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '24px',
            height: '24px',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '1';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '0.8';
          }}
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}

