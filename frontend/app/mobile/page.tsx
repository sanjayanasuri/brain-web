'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';

const VoiceAgentPanel = dynamic(
  () => import('../components/voice/VoiceAgentPanel'),
  { ssr: false, loading: () => <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '40px' }}>Loading voice...</div> }
);

export default function MobilePage() {
  const router = useRouter();
  const [mode, setMode] = useState<'home' | 'voice' | 'chat'>('home');
  const [isMounted, setIsMounted] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => { setIsMounted(true); }, []);

  const handleQuickChat = useCallback(() => {
    if (!query.trim()) return;
    router.push(`/home?q=${encodeURIComponent(query.trim())}`);
  }, [query, router]);

  if (!isMounted) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', background: 'var(--page-bg, #f9fafb)' }}>
        <div style={{ color: 'var(--muted, #6b7280)' }}>Loading...</div>
      </div>
    );
  }

  if (mode === 'voice') {
    return (
      <div style={{ position: 'fixed', inset: 0, height: '100dvh', width: '100vw', overflow: 'hidden', background: 'var(--page-bg)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
          <button onClick={() => setMode('home')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: 'var(--accent)', fontWeight: 600 }}>
            ← Back
          </button>
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ink)' }}>Voice Mode</span>
          <div style={{ width: '48px' }} />
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <VoiceAgentPanel graphId="default" branchId="main" />
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, height: '100dvh', width: '100vw',
      background: 'var(--page-bg, #f9fafb)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--ink)' }}>Brain Web</div>
        <div style={{ fontSize: '13px', color: 'var(--muted)' }}>Your study companion</div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', gap: '24px' }}>

        {/* Voice CTA — Primary action */}
        <button
          onClick={() => setMode('voice')}
          style={{
            width: '160px', height: '160px', borderRadius: '50%',
            background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
            border: 'none', cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: '8px', color: 'white',
            boxShadow: '0 8px 32px rgba(37, 99, 235, 0.35)',
            transition: 'transform 0.2s, box-shadow 0.2s',
          }}
          onTouchStart={e => { e.currentTarget.style.transform = 'scale(0.95)'; }}
          onTouchEnd={e => { e.currentTarget.style.transform = 'scale(1)'; }}
        >
          <span style={{ fontSize: '48px' }}>🎙️</span>
          <span style={{ fontSize: '14px', fontWeight: 600 }}>Talk to Brain Web</span>
        </button>

        <div style={{ fontSize: '13px', color: 'var(--muted)', textAlign: 'center', maxWidth: '280px' }}>
          Tap to start a voice conversation. Ask questions, take voice notes, or get quizzed on your topics.
        </div>

        {/* Quick text input */}
        <div style={{ width: '100%', maxWidth: '400px', display: 'flex', gap: '8px' }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleQuickChat(); }}
            placeholder="Quick thought or question..."
            style={{
              flex: 1, padding: '12px 16px', fontSize: '15px',
              border: '1px solid var(--border)', borderRadius: '12px',
              background: 'var(--panel)', color: 'var(--ink)', outline: 'none',
            }}
          />
          <button
            onClick={handleQuickChat}
            disabled={!query.trim()}
            style={{
              padding: '12px 16px', borderRadius: '12px', border: 'none',
              background: query.trim() ? 'var(--accent)' : 'var(--border)',
              color: 'white', cursor: query.trim() ? 'pointer' : 'not-allowed',
              fontWeight: 600, fontSize: '14px',
            }}
          >
            Send
          </button>
        </div>
      </div>

      {/* Bottom nav */}
      <div style={{
        display: 'flex', borderTop: '1px solid var(--border)', padding: '8px 0',
        background: 'var(--surface)', justifyContent: 'space-around',
      }}>
        {[
          { label: 'Home', icon: '🏠', href: '/home' },
          { label: 'Explorer', icon: '🗺️', href: '/explorer' },
          { label: 'Notes', icon: '📝', href: '/lecture-editor' },
          { label: 'Studio', icon: '📚', href: '/lecture-studio' },
        ].map(item => (
          <button
            key={item.label}
            onClick={() => router.push(item.href)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
              background: 'none', border: 'none', cursor: 'pointer', padding: '8px 16px',
              fontSize: '11px', color: 'var(--muted)', fontWeight: 500,
            }}
          >
            <span style={{ fontSize: '20px' }}>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
