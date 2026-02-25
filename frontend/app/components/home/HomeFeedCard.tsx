'use client';

import { useEffect, useState } from 'react';
import { getHomeFeed, type HomeFeed } from '../../api/home';
import { dismissInterestSuggestion, markInterestSuggestionOpened } from '../../api/interest';
import { createCapture, listCapture, promoteCapture, type CaptureItem } from '../../api/capture';
import { getIndexingHealth, type IndexingHealth } from '../../api/indexing';

export default function HomeFeedCard() {
  const [feed, setFeed] = useState<HomeFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [captureText, setCaptureText] = useState('');
  const [captureItems, setCaptureItems] = useState<CaptureItem[]>([]);
  const [captureSaving, setCaptureSaving] = useState(false);
  const [indexing, setIndexing] = useState<IndexingHealth | null>(null);

  async function refreshHomeAndCapture() {
    const [homeData, captures, health] = await Promise.all([
      getHomeFeed(),
      listCapture('new', 5),
      getIndexingHealth().catch(() => null),
    ]);
    setFeed(homeData);
    setCaptureItems(captures);
    setIndexing(health);
  }

  useEffect(() => {
    (async () => {
      try {
        await refreshHomeAndCapture();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <div className="page-subtitle">Loading your daily brief...</div>;
  }

  if (!feed) return null;

  const submitCapture = async () => {
    const text = captureText.trim();
    if (!text) return;
    try {
      setCaptureSaving(true);
      await createCapture(text, 'text');
      setCaptureText('');
      await refreshHomeAndCapture();
    } finally {
      setCaptureSaving(false);
    }
  };

  const promoteToTask = async (item: CaptureItem) => {
    await promoteCapture(item.id, 'task');
    await refreshHomeAndCapture();
  };

  return (
    <div style={{ width: '100%', maxWidth: 900, marginTop: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="ui-card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontWeight: 600 }}>Quick Capture</div>
          {indexing && (
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              OCR7d {indexing.ocr.success_7d}/{indexing.ocr.total_7d} · Tx24h {indexing.transcripts.chunks_24h}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input
            className="ui-input"
            value={captureText}
            onChange={(e) => setCaptureText(e.target.value)}
            placeholder="Capture an idea, reminder, or note..."
            style={{ flex: 1 }}
            onKeyDown={(e) => { if (e.key === 'Enter') submitCapture(); }}
          />
          <button
            className="ui-button"
            onClick={submitCapture}
            disabled={captureSaving || !captureText.trim()}
          >
            {captureSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {captureItems.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {captureItems.slice(0, 3).map((c) => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
                <div style={{ fontSize: 13, color: 'var(--ink)' }}>{c.content}</div>
                <button
                  onClick={() => promoteToTask(c)}
                  style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  To Task
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {indexing && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 10, background: 'var(--panel)', fontSize: 12, color: 'var(--muted)' }}>
          Indexing Health · OCR avg conf: {indexing.ocr.avg_confidence_7d ? indexing.ocr.avg_confidence_7d.toFixed(2) : 'n/a'} · Evidence anchors 24h: {indexing.evidence.with_citations_24h}/{indexing.evidence.responses_24h}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div className="ui-card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontWeight: 600 }}>Today</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Inbox: {feed.capture_inbox?.new_count ?? 0}</div>
        </div>
        {feed.today.tasks.length === 0 ? (
          <div className="page-subtitle">No tasks queued for today.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {feed.today.tasks.slice(0, 3).map((t) => (
              <div key={t.id} style={{ fontSize: 13, border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                <div>• {t.title}</div>
                <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                  <button className="ui-button" onClick={() => window.location.assign('/home')}>
                    Focus
                  </button>
                  <button className="ui-button" onClick={() => window.location.assign('/profile-customization')}>
                    Plan
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="ui-card" style={{ padding: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Bujji Picks</div>
        {feed.picks.length === 0 ? (
          <div className="page-subtitle">No picks yet. They will appear as your memory graph strengthens.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {feed.picks.slice(0, 3).map((p, i) => (
              <div key={`${p.id ?? p.title}-${i}`} style={{ fontSize: 13, border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                <div>• {p.title}</div>
                <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                  <button
                    className="ui-button"
                    onClick={async () => {
                      if (p.id) await markInterestSuggestionOpened(p.id);
                      const q = p.query || p.title;
                      window.open(`https://duckduckgo.com/?q=${encodeURIComponent(q)}`, '_blank', 'noopener,noreferrer');
                    }}
                  >
                    Open
                  </button>
                  {p.id && (
                    <button
                      className="ui-button"
                      onClick={async () => {
                        await dismissInterestSuggestion(p.id!);
                        setFeed((prev) => prev ? { ...prev, picks: prev.picks.filter(x => x.id !== p.id) } : prev);
                      }}
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
    </div>
  );
}
