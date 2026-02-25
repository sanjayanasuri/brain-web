'use client';

import { useState } from 'react';
import { checkReaderUnderstanding, explainReaderSnippet, getReaderView, type ReaderResponse } from '../api/reader';
import { createReaderAnnotation, listReaderAnnotations } from '../api/reader-annotations';
import AppTopNav from '../components/layout/AppTopNav';

export default function ReaderPage() {
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState('what matters for me?');
  const [data, setData] = useState<ReaderResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [annotations, setAnnotations] = useState<any[]>([]);
  const [checkResults, setCheckResults] = useState<Record<string, { verdict: string; feedback: string; score: number }>>({});
  const [chatSnippet, setChatSnippet] = useState<string>('');
  const [explainChat, setExplainChat] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
  const [chatInput, setChatInput] = useState('');

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
    <div className="app-shell">
      <div className="app-container" style={{ maxWidth: 980 }}>
        <div className="page-header-row">
          <div>
            <div className="page-title">Reader</div>
            <div className="page-subtitle">Readable article view with relevance scoring, snippets, and AI context fit.</div>
          </div>
          <AppTopNav />
        </div>

        <div className="ui-card" style={{ display: 'grid', gap: 8 }}>
          <input className="ui-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Article URL" />
          <input className="ui-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="What should this be relevant to?" />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="ui-button" onClick={run} disabled={loading}>{loading ? 'Loading…' : 'Analyze Article'}</button>
          </div>
        </div>

        {data && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, background: 'var(--panel)', display: 'grid', gap: 10 }}>
            {!data.found ? (
              <div className="page-subtitle">{data.reason || 'No ingested document found for that target.'}</div>
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
                      <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
                        <button
                          onClick={async () => {
                            const answer = window.prompt('Quick check: explain this snippet in your own words') || '';
                            if (!answer.trim()) return;
                            const out = await checkReaderUnderstanding({
                              query,
                              snippet_text: s.text,
                              user_answer: answer,
                              doc_id: data.document?.doc_id,
                              url: data.document?.url,
                            });
                            setCheckResults(prev => ({ ...prev, [s.chunk_id || String(i)]: out }));
                          }}
                          style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', cursor: 'pointer', fontSize: 12 }}
                        >
                          Test understanding
                        </button>
                        <button
                          onClick={async () => {
                            const out = await explainReaderSnippet({
                              query,
                              snippet_text: s.text,
                              doc_id: data.document?.doc_id,
                              url: data.document?.url,
                            });
                            setChatSnippet(s.text);
                            setExplainChat([{ role: 'assistant', text: out.explanation || 'Here is the explanation.' }]);
                          }}
                          style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', cursor: 'pointer', fontSize: 12 }}
                        >
                          Explain
                        </button>
                      </div>
                      {checkResults[s.chunk_id || String(i)] && (
                        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
                          <strong>{checkResults[s.chunk_id || String(i)].verdict.toUpperCase()}</strong> · {checkResults[s.chunk_id || String(i)].feedback}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Annotations</div>
                  {annotations.length === 0 ? (
                    <div className="page-subtitle">No annotations yet. Highlight or save memory from snippets to start.</div>
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

                {explainChat.length > 0 && (
                  <div style={{ marginTop: 12, border: '1px solid var(--border)', borderRadius: 10, padding: 10, background: 'var(--surface)' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Explain in Context</div>
                    {chatSnippet ? <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Snippet: {chatSnippet.slice(0, 140)}{chatSnippet.length > 140 ? '…' : ''}</div> : null}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflow: 'auto' }}>
                      {explainChat.map((m, idx) => (
                        <div key={idx} style={{ fontSize: 12, padding: 8, borderRadius: 8, border: '1px solid var(--border)', background: m.role === 'assistant' ? 'var(--panel)' : 'var(--background)' }}>
                          <strong>{m.role === 'assistant' ? 'Bujji' : 'You'}:</strong> {m.text}
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                      <input
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        placeholder="Ask about this section..."
                        style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', background: 'var(--background)' }}
                        onKeyDown={async (e) => {
                          if (e.key !== 'Enter' || !chatInput.trim() || !chatSnippet) return;
                          const question = chatInput.trim();
                          setExplainChat(prev => [...prev, { role: 'user', text: question }]);
                          setChatInput('');
                          const out = await explainReaderSnippet({ query, snippet_text: chatSnippet, question, doc_id: data.document?.doc_id, url: data.document?.url });
                          setExplainChat(prev => [...prev, { role: 'assistant', text: out.explanation || '' }]);
                        }}
                      />
                      <button
                        onClick={async () => {
                          if (!chatInput.trim() || !chatSnippet) return;
                          const question = chatInput.trim();
                          setExplainChat(prev => [...prev, { role: 'user', text: question }]);
                          setChatInput('');
                          const out = await explainReaderSnippet({ query, snippet_text: chatSnippet, question, doc_id: data.document?.doc_id, url: data.document?.url });
                          setExplainChat(prev => [...prev, { role: 'assistant', text: out.explanation || '' }]);
                        }}
                        style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', cursor: 'pointer', fontSize: 12 }}
                      >
                        Ask
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
