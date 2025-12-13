'use client';

import { useEffect, useState } from 'react';
import {
  getNotionSummary,
  ingestNotionPages,
  ingestAllNotionPages,
  type NotionSummaryResponse,
  type LectureIngestResult,
} from '../api-client';

export default function NotionImportPage() {
  const [summary, setSummary] = useState<NotionSummaryResponse | null>(null);
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'selective' | 'all'>('selective');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const data = await getNotionSummary();
        setSummary(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load Notion summary');
      }
    };
    fetchSummary();
  }, []);

  const togglePage = (id: string) => {
    setSelectedPageIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const ingestSelected = async () => {
    if (!summary || selectedPageIds.size === 0) return;
    setLoading(true);
    setStatus('Ingesting selected pages...');
    setError(null);
    try {
      const results = await ingestNotionPages(Array.from(selectedPageIds));
      const totalNodes = results.reduce((sum, r) => sum + r.nodes_created.length + r.nodes_updated.length, 0);
      const totalLinks = results.reduce((sum, r) => sum + r.links_created.length, 0);
      setStatus(`✓ Ingested ${selectedPageIds.size} pages: ${totalNodes} nodes, ${totalLinks} links created.`);
      // Clear selection after successful ingest
      setSelectedPageIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ingest failed');
    } finally {
      setLoading(false);
    }
  };

  const ingestAll = async () => {
    setLoading(true);
    setStatus('Ingesting all pages from Notion (this might take a while)...');
    setError(null);
    try {
      const results = await ingestAllNotionPages('pages');
      const totalNodes = results.reduce((sum, r) => sum + r.nodes_created.length + r.nodes_updated.length, 0);
      const totalLinks = results.reduce((sum, r) => sum + r.links_created.length, 0);
      setStatus(`✓ Ingested ${results.length} pages: ${totalNodes} nodes, ${totalLinks} links created.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ingest all failed');
    } finally {
      setLoading(false);
    }
  };

  if (!summary && !error) {
    return (
      <div className="app-shell" style={{ padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div>Connecting to Notion…</div>
      </div>
    );
  }

  return (
    <div className="app-shell" style={{ padding: 24, overflow: 'auto' }}>
      <div className="graph-header" style={{ marginBottom: 24 }}>
        <div>
          <p className="eyebrow">Notion sync</p>
          <h1 className="title">Import your lectures into Brain Web</h1>
          <p className="subtitle">
            Choose specific pages or sweep your entire workspace into the graph.
            Each page becomes a lecture, and concepts/links are extracted automatically.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        <button
          className={`pill ${mode === 'selective' ? 'pill--active' : ''}`}
          onClick={() => setMode('selective')}
          style={{ cursor: 'pointer' }}
        >
          1. Pick specific pages
        </button>
        <button
          className={`pill ${mode === 'all' ? 'pill--active' : ''}`}
          onClick={() => setMode('all')}
          style={{ cursor: 'pointer', backgroundColor: mode === 'all' ? 'var(--accent-2)' : undefined, color: mode === 'all' ? 'white' : undefined }}
        >
          2. Ingest everything
        </button>
      </div>

      {error && (
        <div className="chat-error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}
      {status && (
        <div className="chat-bubble" style={{ marginBottom: 16 }}>
          {status}
        </div>
      )}

      {summary && mode === 'selective' && (
        <div className="control-card">
          <div className="control-header">
            <span>Notion pages</span>
            <span className="control-value">
              {summary.pages.length} found · {selectedPageIds.size} selected
            </span>
          </div>
          <div style={{ maxHeight: 320, overflow: 'auto', marginTop: 8 }}>
            {summary.pages.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)' }}>
                No pages found in Notion workspace
              </div>
            ) : (
              summary.pages.map(p => (
                <label
                  key={p.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 4px',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedPageIds.has(p.id)}
                    onChange={() => togglePage(p.id)}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500 }}>{p.title}</div>
                    {p.url && (
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: 12, color: 'var(--accent)' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        Open in Notion →
                      </a>
                    )}
                  </div>
                </label>
              ))
            )}
          </div>
          <button
            className="send-btn"
            onClick={ingestSelected}
            disabled={loading || selectedPageIds.size === 0}
            style={{ marginTop: 12 }}
          >
            {loading ? 'Ingesting…' : `Ingest ${selectedPageIds.size} selected page(s)`}
          </button>
        </div>
      )}

      {summary && mode === 'all' && (
        <div className="control-card">
          <div className="control-header">
            <span>Ingest everything</span>
          </div>
          <p className="control-caption">
            This will ingest all {summary.pages.length} Notion pages we can see into your Brain Web graph.
            You can always prune or relink later.
          </p>
          <button
            className="send-btn"
            onClick={ingestAll}
            disabled={loading}
            style={{ marginTop: 8 }}
          >
            {loading ? 'Ingesting all pages…' : `Ingest all ${summary.pages.length} pages`}
          </button>
        </div>
      )}

      {summary && summary.databases.length > 0 && (
        <div className="control-card" style={{ marginTop: 24 }}>
          <div className="control-header">
            <span>Notion databases</span>
            <span className="control-value">{summary.databases.length} found</span>
          </div>
          <p className="control-caption" style={{ marginTop: 8 }}>
            Database ingestion is coming soon. For now, you can see your databases listed here.
          </p>
          <div style={{ maxHeight: 200, overflow: 'auto', marginTop: 8 }}>
            {summary.databases.map(db => (
              <div
                key={db.id}
                style={{
                  padding: '8px 4px',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <div style={{ fontWeight: 500 }}>{db.title}</div>
                {db.url && (
                  <a
                    href={db.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 12, color: 'var(--accent)' }}
                  >
                    Open in Notion →
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
