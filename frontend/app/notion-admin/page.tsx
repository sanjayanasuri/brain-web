'use client';

import { useEffect, useState } from 'react';

interface NotionPage {
  page_id: string;
  title: string;
  last_edited_time: string;
  database_id: string | null;
  database_name: string | null;
  indexed: boolean;
}

interface UnlinkResult {
  status: string;
  page_id: string;
  lecture_ids: string[];
  nodes_deleted: number;
  nodes_updated: number;
  relationships_deleted: number;
}

export default function NotionAdminPage() {
  const [pages, setPages] = useState<NotionPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [updatingPages, setUpdatingPages] = useState<Set<string>>(new Set());
  const [unlinkingPage, setUnlinkingPage] = useState<string | null>(null);

  useEffect(() => {
    fetchPages();
  }, []);

  const fetchPages = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/notion/pages');
      if (!response.ok) {
        throw new Error(`Failed to fetch pages: ${response.statusText}`);
      }
      const data = await response.json();
      setPages(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pages');
    } finally {
      setLoading(false);
    }
  };

  const togglePageIndexing = async (pageId: string, currentIndexed: boolean) => {
    setUpdatingPages(prev => new Set(prev).add(pageId));
    setError(null);
    try {
      const response = await fetch('/api/notion/pages/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page_id: pageId,
          include: !currentIndexed,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update page indexing');
      }

      const data = await response.json();
      
      // Update local state
      setPages(prev => prev.map(p => 
        p.page_id === pageId 
          ? { ...p, indexed: data.indexed }
          : p
      ));

      setStatus(
        data.include 
          ? `✓ Page "${pages.find(p => p.page_id === pageId)?.title || pageId}" is now indexed`
          : `✓ Page "${pages.find(p => p.page_id === pageId)?.title || pageId}" is no longer indexed`
      );
      
      // Clear status after 3 seconds
      setTimeout(() => setStatus(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update page indexing');
    } finally {
      setUpdatingPages(prev => {
        const next = new Set(prev);
        next.delete(pageId);
        return next;
      });
    }
  };

  const unlinkPage = async (pageId: string, pageTitle: string) => {
    if (!confirm(
      `This will remove any nodes that ONLY came from "${pageTitle}". ` +
      `Shared concepts will stay. Continue?`
    )) {
      return;
    }

    setUnlinkingPage(pageId);
    setError(null);
    try {
      const response = await fetch('/api/notion/unlink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_id: pageId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to unlink page');
      }

      const data: UnlinkResult = await response.json();
      
      // Update local state - mark as not indexed
      setPages(prev => prev.map(p => 
        p.page_id === pageId 
          ? { ...p, indexed: false }
          : p
      ));

      setStatus(
        `✓ Unlinked "${pageTitle}": ` +
        `${data.nodes_deleted} nodes deleted, ` +
        `${data.nodes_updated} nodes updated, ` +
        `${data.relationships_deleted} relationships deleted`
      );
      
      // Clear status after 5 seconds
      setTimeout(() => setStatus(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlink page');
    } finally {
      setUnlinkingPage(null);
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return 'Unknown';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateString;
    }
  };

  if (loading) {
    return (
      <div className="app-shell" style={{ padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div>Loading Notion pages…</div>
      </div>
    );
  }

  return (
    <div className="app-shell" style={{ padding: 24, overflow: 'auto' }}>
      <div className="graph-header" style={{ marginBottom: 24 }}>
        <div>
          <p className="eyebrow">Notion admin</p>
          <h1 className="title">Manage Notion page indexing</h1>
          <p className="subtitle">
            Control which Notion pages are indexed into your Brain Web graph.
            Toggle indexing on/off, or unlink pages to remove their concepts from the graph.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        <button
          className="pill"
          onClick={fetchPages}
          style={{ cursor: 'pointer' }}
        >
          Refresh
        </button>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 14, color: 'var(--muted)', display: 'flex', alignItems: 'center' }}>
          {pages.filter(p => p.indexed).length} of {pages.length} pages indexed
        </div>
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

      <div className="control-card">
        <div className="control-header">
          <span>Notion pages</span>
          <span className="control-value">{pages.length} total</span>
        </div>
        
        {pages.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)' }}>
            No pages found
          </div>
        ) : (
          <div style={{ marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 4px', fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Title</th>
                  <th style={{ textAlign: 'left', padding: '8px 4px', fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Database</th>
                  <th style={{ textAlign: 'left', padding: '8px 4px', fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Last edited</th>
                  <th style={{ textAlign: 'center', padding: '8px 4px', fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Indexed</th>
                  <th style={{ textAlign: 'right', padding: '8px 4px', fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pages.map(page => (
                  <tr
                    key={page.page_id}
                    style={{
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <td style={{ padding: '8px 4px' }}>
                      <div style={{ fontWeight: 500 }}>{page.title}</div>
                    </td>
                    <td style={{ padding: '8px 4px', fontSize: 12, color: 'var(--muted)' }}>
                      {page.database_name || 'Standalone'}
                    </td>
                    <td style={{ padding: '8px 4px', fontSize: 12, color: 'var(--muted)' }}>
                      {formatDate(page.last_edited_time)}
                    </td>
                    <td style={{ padding: '8px 4px', textAlign: 'center' }}>
                      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={page.indexed}
                          onChange={() => togglePageIndexing(page.page_id, page.indexed)}
                          disabled={updatingPages.has(page.page_id)}
                          style={{ cursor: updatingPages.has(page.page_id) ? 'wait' : 'pointer' }}
                        />
                      </label>
                    </td>
                    <td style={{ padding: '8px 4px', textAlign: 'right' }}>
                      <button
                        className="pill"
                        onClick={() => unlinkPage(page.page_id, page.title)}
                        disabled={unlinkingPage === page.page_id || !page.indexed}
                        style={{
                          cursor: (unlinkingPage === page.page_id || !page.indexed) ? 'not-allowed' : 'pointer',
                          opacity: (unlinkingPage === page.page_id || !page.indexed) ? 0.5 : 1,
                          fontSize: 12,
                          padding: '4px 8px',
                        }}
                      >
                        {unlinkingPage === page.page_id ? 'Unlinking…' : 'Unlink'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
