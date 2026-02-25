'use client';

import { useEffect, useState } from 'react';
import { getHomeFeed, type HomeFeed } from '../../api/home';
import { dismissInterestSuggestion, markInterestSuggestionOpened } from '../../api/interest';

export default function HomeFeedCard() {
  const [feed, setFeed] = useState<HomeFeed | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await getHomeFeed();
        setFeed(data);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <div style={{ color: 'var(--muted)', fontSize: 14 }}>Loading your daily brief...</div>;
  }

  if (!feed) return null;

  return (
    <div style={{ width: '100%', maxWidth: 900, marginTop: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, background: 'var(--panel)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontWeight: 600 }}>Today</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Inbox: {feed.capture_inbox?.new_count ?? 0}</div>
        </div>
        {feed.today.tasks.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>No tasks queued for today.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {feed.today.tasks.slice(0, 3).map((t) => (
              <div key={t.id} style={{ fontSize: 13, border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                <div>• {t.title}</div>
                <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => window.location.assign('/home')}
                    style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12, cursor: 'pointer' }}
                  >
                    Focus
                  </button>
                  <button
                    onClick={() => window.location.assign('/profile-customization')}
                    style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12, cursor: 'pointer' }}
                  >
                    Plan
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, background: 'var(--panel)' }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Bujji Picks</div>
        {feed.picks.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>No picks yet. They’ll appear as memory builds.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {feed.picks.slice(0, 3).map((p, i) => (
              <div key={`${p.id ?? p.title}-${i}`} style={{ fontSize: 13, border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                <div>• {p.title}</div>
                <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                  <button
                    onClick={async () => {
                      if (p.id) await markInterestSuggestionOpened(p.id);
                      const q = p.query || p.title;
                      window.open(`https://duckduckgo.com/?q=${encodeURIComponent(q)}`, '_blank', 'noopener,noreferrer');
                    }}
                    style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12, cursor: 'pointer' }}
                  >
                    Open
                  </button>
                  {p.id && (
                    <button
                      onClick={async () => {
                        await dismissInterestSuggestion(p.id!);
                        setFeed((prev) => prev ? { ...prev, picks: prev.picks.filter(x => x.id !== p.id) } : prev);
                      }}
                      style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12, cursor: 'pointer' }}
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
