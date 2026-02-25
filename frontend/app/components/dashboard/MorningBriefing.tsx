'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { API_BASE_URL, getApiHeaders } from '../../api/base';

interface BriefingItem {
  label: string;
  detail?: string;
  type: string;
  concept_id?: string;
  url?: string;
}

interface BriefingSection {
  title: string;
  icon: string;
  items: BriefingItem[];
}

interface DailyBriefing {
  greeting: string;
  generated_at: string;
  sections: BriefingSection[];
}

const BRIEFING_CACHE_KEY = 'brainweb_daily_briefing';
const BRIEFING_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export default function MorningBriefing() {
  const router = useRouter();
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    async function loadBriefing() {
      // Check cache first
      try {
        const cached = localStorage.getItem(BRIEFING_CACHE_KEY);
        if (cached) {
          const { data, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < BRIEFING_CACHE_TTL) {
            setBriefing(data);
            setLoading(false);
            return;
          }
        }
      } catch { /* ignore cache errors */ }

      try {
        const headers = await getApiHeaders();
        const res = await fetch(`${API_BASE_URL}/briefing/daily`, { headers });
        if (res.ok) {
          const data = await res.json();
          setBriefing(data);
          // Cache it
          try {
            localStorage.setItem(BRIEFING_CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
          } catch { /* ignore */ }
        }
      } catch {
        // Silently fail — briefing is optional
      } finally {
        setLoading(false);
      }
    }

    loadBriefing();
  }, []);

  if (dismissed || loading || !briefing || briefing.sections.length === 0) return null;

  return (
    <div style={{
      width: '100%',
      maxWidth: '600px',
      margin: '0 auto 16px',
      background: 'var(--panel)',
      borderRadius: '16px',
      border: '1px solid var(--border)',
      overflow: 'hidden',
      boxShadow: '0 2px 12px rgba(0, 0, 0, 0.06)',
    }}>
      {/* Header */}
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          padding: '16px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.05), rgba(37, 99, 235, 0.02))',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '20px' }}>☀️</span>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ink)' }}>{briefing.greeting}</div>
            <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={(e) => { e.stopPropagation(); setDismissed(true); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: '14px', padding: '4px' }}
            title="Dismiss"
          >
            ✕
          </button>
          <span style={{ fontSize: '12px', color: 'var(--muted)', transition: 'transform 0.2s', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
            ▼
          </span>
        </div>
      </div>

      {/* Sections */}
      {!collapsed && (
        <div style={{ padding: '0 16px 16px' }}>
          {briefing.sections.map((section, si) => (
            <div key={si} style={{ marginTop: si === 0 ? '8px' : '14px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>{section.icon}</span> {section.title}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {section.items.map((item, ii) => (
                  <div
                    key={ii}
                    onClick={() => {
                      if (item.concept_id) router.push(`/concepts/${item.concept_id}`);
                      else if (item.url) window.open(item.url, '_blank');
                      else if (item.type === 'review') router.push('/explorer');
                    }}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: 'var(--surface)',
                      cursor: item.concept_id || item.url || item.type === 'review' ? 'pointer' : 'default',
                      transition: 'all 0.15s',
                      border: '1px solid transparent',
                    }}
                    onMouseEnter={e => { if (item.concept_id || item.url || item.type === 'review') e.currentTarget.style.borderColor = 'var(--border)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; }}
                  >
                    <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--ink)' }}>{item.label}</div>
                    {item.detail && <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '1px' }}>{item.detail}</div>}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Quick actions */}
          <div style={{ display: 'flex', gap: '8px', marginTop: '14px', justifyContent: 'center' }}>
            <button
              onClick={() => router.push('/explorer')}
              style={{ padding: '6px 14px', fontSize: '12px', fontWeight: 500, background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
            >
              📚 Start Studying
            </button>
            <button
              onClick={() => router.push('/lecture-editor')}
              style={{ padding: '6px 14px', fontSize: '12px', fontWeight: 500, background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--border)', borderRadius: '8px', cursor: 'pointer' }}
            >
              ✏️ Take Notes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
