'use client';

import { useState } from 'react';
import { getReaderView, type ReaderResponse } from '../api/reader';
import { createReaderAnnotation, listReaderAnnotations } from '../api/reader-annotations';

export default function ReaderPage() {
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState('what matters for me?');
  const [data, setData] = useState<ReaderResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [annotations, setAnnotations] = useState<any[]>([]);

  const run = async () => {
    if (!url.trim() || !query.trim()) return;
    setLoading(true);
    try {
      const targetUrl = url.trim();
      const out = await getReaderView({ url: targetUrl, query: query.trim(), limit: 5 });
      setData(out);
      const anns = await listReaderAnnotations({ doc_id: out.document?.doc_id, url: targetUrl, limit: 20 }).catch(() => []);
      setAnnotations(Array.isArray(anns) ? anns : []);
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
                      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                        <button
                          onClick={async () => {
                            await createReaderAnnotation({
                              doc_id: data.document?.doc_id,
                              url: data.document?.url,
                              chunk_id: s.chunk_id,
                              annotation_type: 'highlight',
                              note: s.text.slice(0, 220),
                            });
                            const anns = await listReaderAnnotations({ doc_id: data.document?.doc_id, url: data.document?.url || url, limit: 20 }).catch(() => []);
                            setAnnotations(Array.isArray(anns) ? anns : []);
                          }}
                          style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', cursor: 'pointer', fontSize: 12 }}
                        >
                          Highlight
                        </button>
                        <button
                          onClick={async () => {
                            await createReaderAnnotation({
                              doc_id: data.document?.doc_id,
                              url: data.document?.url,
                              chunk_id: s.chunk_id,
                              annotation_type: 'save_memory',
                              note: s.text.slice(0, 220),
                            });
                            const anns = await listReaderAnnotations({ doc_id: data.document?.doc_id, url: data.document?.url || url, limit: 20 }).catch(() => []);
                            setAnnotations(Array.isArray(anns) ? anns : []);
                          }}
                          style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', cursor: 'pointer', fontSize: 12 }}
                        >
                          Save Memory
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Annotations</div>
                  {annotations.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>No annotations yet.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {annotations.slice(0, 8).map((a, idx) => (
                        <div key={`${a.id || idx}`} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, fontSize: 12, background: 'var(--surface)' }}>
                          <strong>{a.annotation_type}</strong>{a.note ? ` · ${String(a.note).slice(0, 140)}` : ''}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
