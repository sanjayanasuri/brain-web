'use client';

import { useEffect, useState } from 'react';
import { getHomeFeed, type HomeFeed } from '../../api/home';

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
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Today</div>
        {feed.today.tasks.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>No tasks queued for today.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {feed.today.tasks.slice(0, 3).map((t) => (
              <div key={t.id} style={{ fontSize: 13 }}>
                • {t.title}
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {feed.picks.slice(0, 3).map((p, i) => (
              <div key={`${p.title}-${i}`} style={{ fontSize: 13 }}>
                • {p.title}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
