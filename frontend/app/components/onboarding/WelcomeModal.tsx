'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const ONBOARDING_KEY = 'brainweb_onboarded';

export default function WelcomeModal() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onboarded = localStorage.getItem(ONBOARDING_KEY);
    if (!onboarded) {
      setVisible(true);
    }
  }, []);

  function dismiss() {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    setVisible(false);
  }

  function goTo(path: string) {
    dismiss();
    router.push(path);
  }

  if (!visible) return null;

  const steps = [
    {
      emoji: '👋',
      title: 'Welcome to Brain Web',
      body: 'Brain Web turns your notes, documents, and conversations into a connected study map — so you can see how ideas relate and never lose track of what you\'ve learned.',
      action: () => setStep(1),
      actionLabel: 'Get Started',
    },
    {
      emoji: '🚀',
      title: 'What would you like to do first?',
      body: 'Pick an action below to jump right in, or close this to explore on your own.',
      choices: [
        { emoji: '💬', label: 'Ask a question', desc: 'Chat with AI about any topic', action: () => dismiss() },
        { emoji: '📝', label: 'Write notes', desc: 'Start a new document with rich text and handwriting', action: () => goTo('/lecture-editor') },
        { emoji: '📄', label: 'Import a document', desc: 'Upload a PDF and auto-extract concepts', action: () => goTo('/ingest') },
        { emoji: '🗺️', label: 'Explore the study map', desc: 'See your knowledge graph visualized', action: () => goTo('/explorer') },
      ],
    },
  ];

  const current = steps[step];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(15, 23, 42, 0.5)',
        backdropFilter: 'blur(4px)',
        padding: '24px',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
    >
      <div
        style={{
          backgroundColor: 'var(--surface, #fff)',
          borderRadius: '20px',
          padding: '40px',
          maxWidth: '520px',
          width: '100%',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.2)',
          textAlign: 'center',
          position: 'relative',
          animation: 'fadeInScale 0.25s ease-out',
        }}
      >
        <button
          onClick={dismiss}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            background: 'transparent',
            border: 'none',
            fontSize: '20px',
            cursor: 'pointer',
            color: 'var(--muted)',
            padding: '4px 8px',
            borderRadius: '6px',
          }}
        >
          ✕
        </button>

        <div style={{ fontSize: '48px', marginBottom: '16px' }}>{current.emoji}</div>
        <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px', color: 'var(--ink)' }}>
          {current.title}
        </h2>
        <p style={{ fontSize: '15px', color: 'var(--muted)', lineHeight: 1.6, marginBottom: '24px' }}>
          {current.body}
        </p>

        {current.action && (
          <button
            onClick={current.action}
            style={{
              padding: '12px 32px',
              fontSize: '16px',
              fontWeight: 600,
              background: 'var(--accent, #3b82f6)',
              color: 'white',
              border: 'none',
              borderRadius: '12px',
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(37, 99, 235, 0.3)',
            }}
          >
            {current.actionLabel}
          </button>
        )}

        {current.choices && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'left' }}>
            {current.choices.map((c) => (
              <button
                key={c.label}
                onClick={c.action}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px',
                  padding: '14px 18px',
                  background: 'var(--panel, #f9fafb)',
                  border: '1px solid var(--border, #e5e7eb)',
                  borderRadius: '14px',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  textAlign: 'left',
                  width: '100%',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--accent, #3b82f6)';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(37, 99, 235, 0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border, #e5e7eb)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <span style={{ fontSize: '24px', flexShrink: 0 }}>{c.emoji}</span>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ink)' }}>{c.label}</div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{c.desc}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {step > 0 && (
          <button
            onClick={dismiss}
            style={{
              marginTop: '16px',
              background: 'transparent',
              border: 'none',
              color: 'var(--muted)',
              fontSize: '13px',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            Skip — I'll explore on my own
          </button>
        )}
      </div>

      <style jsx global>{`
        @keyframes fadeInScale {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
