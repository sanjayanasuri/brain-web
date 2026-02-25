'use client';

import { useState } from 'react';
import { getReaderView, type ReaderResponse } from '../api/reader';

export default function ReaderPage() {
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState('what matters for me?');
  const [data, setData] = useState<ReaderResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!url.trim() || !query.trim()) return;
    setLoading(true);
    try {
      const out = await getReaderView({ url: url.trim(), query: query.trim(), limit: 5 });
      setData(out);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', padding: '18px 16px', background: 'var(--background)' }}>
      <div style={{ maxWidth: 980, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>Reader</div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Readable article view with relevance scoring, snippets, and AI context fit.</div>
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, background: 'var(--panel)', display: 'grid', gap: 8 }}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Article URL" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', background: 'var(--surface)' }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="What should this be relevant to?" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', background: 'var(--surface)' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={run} disabled={loading} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}>{loading ? 'Loading…' : 'Analyze Article'}</button>
            <button onClick={() => window.location.assign('/home')} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}>Home</button>
          </div>
        </div>

        {data && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, background: 'var(--panel)', display: 'grid', gap: 10 }}>
            {!data.found ? (
              <div style={{ color: 'var(--muted)' }}>{data.reason || 'Not found'}</div>
            ) : (
              <>
                <div style={{ fontSize: 14 }}>
                  <strong>{data.document?.title || data.document?.url}</strong>
                  <div style={{ color: 'var(--muted)', marginTop: 4 }}>Relevance: {((data.relevance || 0) * 100).toFixed(0)}% · {data.scoring_policy}</div>
                </div>
                {(data.interest_terms || []).length > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Interest terms: {(data.interest_terms || []).join(', ')}
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(data.snippets || []).map((s, i) => (
                    <div key={`${s.chunk_id || i}`} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: 'var(--surface)' }}>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Snippet {i + 1} · Score {Math.round((s.score || 0) * 100)}%</div>
                      <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5 }}>{s.text}</div>
                      {(s.why || []).length > 0 && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>Why: {s.why.join(' · ')}</div>}
                      {(s.claims || []).length > 0 && <div style={{ marginTop: 6, fontSize: 12 }}>Claims: {(s.claims || []).slice(0, 2).join(' | ')}</div>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
