'use client';

import React, { useState, useEffect, useCallback } from 'react';


interface NotionPage {
  page_id: string;
  title: string;
  last_edited_time: string;
  database_id: string | null;
  database_name: string | null;
  indexed: boolean;
}

interface SyncResult {
  status: string;
  pages_checked: number;
  pages_ingested: number;
  nodes_created: number;
  nodes_updated: number;
  links_created: number;
  errors: string[];
  pages_processed: Array<{
    page_id: string;
    page_title: string;
    lecture_id: string | null;
    status: 'success' | 'error';
    nodes_created?: number;
    links_created?: number;
    error?: string;
  }>;
}

export default function NotionSyncManager({ className = '' }: { className?: string }) {
  const [pages, setPages] = useState<NotionPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatingPages, setUpdatingPages] = useState<Set<string>>(new Set());
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());
  const [showAllPages, setShowAllPages] = useState(false);

  const loadPages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/notion/pages');
      if (!response.ok) {
        throw new Error(`Failed to fetch pages: ${response.statusText}`);
      }
      const data = (await response.json()) as NotionPage[];
      setPages(data);
      // Initialize selected pages to all indexed pages
      const indexedPageIds = new Set<string>(data.filter(p => p.indexed).map(p => p.page_id));
      setSelectedPages(indexedPageIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pages');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPages();
  }, [loadPages]);

  const handleSync = async (forceFull: boolean = false) => {
    setSyncing(true);
    setSyncProgress(null);
    setError(null);
    try {
      const response = await fetch(`/api/notion/sync?force_full=${forceFull}`, {
        method: 'POST',
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || errorData.detail || 'Failed to sync');
      }
      const result: SyncResult = await response.json();
      setSyncProgress(result);
      // Reload pages after sync to update status
      await loadPages();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger sync');
    } finally {
      setSyncing(false);
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

      // Update selected pages
      if (data.indexed) {
        setSelectedPages(prev => new Set(prev).add(pageId));
      } else {
        setSelectedPages(prev => {
          const next = new Set(prev);
          next.delete(pageId);
          return next;
        });
      }
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

  const toggleSelectAll = async () => {
    const allIndexed = pages.every(p => p.indexed);
    const pagesToUpdate = allIndexed 
      ? pages.filter(p => p.indexed) 
      : pages.filter(p => !p.indexed);
    
    // Batch update all pages
    setUpdatingPages(new Set(pagesToUpdate.map(p => p.page_id)));
    setError(null);
    
    try {
      await Promise.all(
        pagesToUpdate.map(page =>
          fetch('/api/notion/pages/index', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              page_id: page.page_id,
              include: !allIndexed,
            }),
          }).then(res => res.json())
        )
      );
      
      // Update local state
      setPages(prev => prev.map(p => ({ ...p, indexed: !allIndexed })));
      setSelectedPages(new Set(allIndexed ? [] : pages.map(p => p.page_id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update pages');
    } finally {
      setUpdatingPages(new Set());
    }
  };

  const indexedCount = pages.filter(p => p.indexed).length;
  const totalCount = pages.length;
  const displayPages = showAllPages ? pages : pages.slice(0, 10);

  return (
    <div className={`notion-sync-manager ${className}`} style={{
      padding: '20px',
      background: 'var(--panel)',
      borderRadius: '8px',
      border: '1px solid var(--border)',
    }}>
      <div style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>Notion Sync & Indexing</h3>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
              {indexedCount} / {totalCount} indexed
            </span>
            <button
              onClick={() => setShowAllPages(!showAllPages)}
              style={{
                padding: '4px 12px',
                fontSize: '12px',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                background: 'var(--surface)',
                cursor: 'pointer',
              }}
            >
              {showAllPages ? 'Show Less' : 'Show All'}
            </button>
          </div>
        </div>

        {/* Sync Controls */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <button
            onClick={() => handleSync(false)}
            disabled={syncing}
            style={{
              padding: '6px 16px',
              fontSize: '13px',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              background: syncing ? 'var(--muted)' : 'var(--surface)',
              cursor: syncing ? 'not-allowed' : 'pointer',
              fontWeight: '500',
            }}
          >
            {syncing ? 'Syncing...' : 'Sync Updated Pages'}
          </button>
          <button
            onClick={() => handleSync(true)}
            disabled={syncing}
            style={{
              padding: '6px 16px',
              fontSize: '13px',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              background: syncing ? 'var(--muted)' : 'var(--surface)',
              cursor: syncing ? 'not-allowed' : 'pointer',
            }}
          >
            Full Sync
          </button>
          <button
            onClick={toggleSelectAll}
            disabled={updatingPages.size > 0}
            style={{
              padding: '6px 16px',
              fontSize: '13px',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              background: 'white',
              cursor: updatingPages.size > 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {indexedCount === totalCount ? 'Deselect All' : 'Select All'}
          </button>
          <button
            onClick={loadPages}
            disabled={loading}
            style={{
              padding: '6px 16px',
              fontSize: '13px',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              background: 'white',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {/* Progress Bar */}
        {syncing && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '12px', color: 'var(--muted)' }}>
              <span>Syncing pages...</span>
              {syncProgress && (
                <span>
                  {syncProgress.pages_ingested} / {syncProgress.pages_checked} processed
                </span>
              )}
            </div>
            <div style={{
              width: '100%',
              height: '8px',
              background: 'var(--border)',
              borderRadius: '4px',
              overflow: 'hidden',
            }}>
              <div style={{
                width: syncProgress 
                  ? `${(syncProgress.pages_ingested / Math.max(syncProgress.pages_checked, 1)) * 100}%`
                  : '0%',
                height: '100%',
                background: 'var(--accent)',
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>
        )}

        {/* Sync Results */}
        {syncProgress && !syncing && (
          <div style={{
            padding: '12px',
            marginBottom: '16px',
            background: syncProgress.errors.length > 0 ? 'var(--panel)' : 'var(--panel)',
            border: `1px solid ${syncProgress.errors.length > 0 ? 'var(--accent-2)' : 'var(--accent)'}`,
            borderRadius: '4px',
            fontSize: '12px',
          }}>
            <div style={{ fontWeight: '600', marginBottom: '8px' }}>
              Sync Complete
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px' }}>
              <div>Pages checked: <strong>{syncProgress.pages_checked}</strong></div>
              <div>Pages ingested: <strong>{syncProgress.pages_ingested}</strong></div>
              <div>Nodes created: <strong>{syncProgress.nodes_created}</strong></div>
              <div>Links created: <strong>{syncProgress.links_created}</strong></div>
            </div>
            {syncProgress.errors.length > 0 && (
              <div style={{ marginTop: '8px', color: 'var(--accent-2)' }}>
                <strong>Errors ({syncProgress.errors.length}):</strong>
                <ul style={{ margin: '4px 0 0 20px', padding: 0 }}>
                  {syncProgress.errors.slice(0, 3).map((err, idx) => (
                    <li key={idx} style={{ fontSize: '11px' }}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div style={{
            padding: '12px',
            marginBottom: '16px',
            background: 'var(--panel)',
            border: '1px solid var(--accent-2)',
            borderRadius: '4px',
            fontSize: '12px',
            color: 'var(--accent-2)',
          }}>
            {error}
          </div>
        )}
      </div>

      {/* Pages List */}
      {loading ? (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)' }}>
          Loading pages...
        </div>
      ) : pages.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)' }}>
          No pages found. Make sure Notion is configured.
        </div>
      ) : (
        <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '8px', fontWeight: '600', width: '40px' }}>
                  <input
                    type="checkbox"
                    checked={indexedCount === totalCount && totalCount > 0}
                    onChange={toggleSelectAll}
                    disabled={updatingPages.size > 0}
                    style={{ cursor: updatingPages.size > 0 ? 'not-allowed' : 'pointer' }}
                  />
                </th>
                <th style={{ textAlign: 'left', padding: '8px', fontWeight: '600' }}>Page Title</th>
                <th style={{ textAlign: 'left', padding: '8px', fontWeight: '600', color: 'var(--muted)' }}>Database</th>
                <th style={{ textAlign: 'left', padding: '8px', fontWeight: '600', color: 'var(--muted)' }}>Last Edited</th>
                <th style={{ textAlign: 'center', padding: '8px', fontWeight: '600', width: '100px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {displayPages.map(page => {
                const isUpdating = updatingPages.has(page.page_id);
                return (
                  <tr
                    key={page.page_id}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      background: page.indexed ? 'var(--panel)' : 'var(--surface)',
                    }}
                  >
                    <td style={{ padding: '8px' }}>
                      <input
                        type="checkbox"
                        checked={page.indexed}
                        onChange={() => togglePageIndexing(page.page_id, page.indexed)}
                        disabled={isUpdating}
                        style={{ cursor: isUpdating ? 'wait' : 'pointer' }}
                      />
                    </td>
                    <td style={{ padding: '8px', fontWeight: page.indexed ? '500' : '400' }}>
                      {page.title || `Page ${page.page_id.slice(0, 8)}...`}
                    </td>
                    <td style={{ padding: '8px', color: 'var(--muted)' }}>
                      {page.database_name || 'Standalone'}
                    </td>
                    <td style={{ padding: '8px', color: 'var(--muted)', fontSize: '11px' }}>
                      {page.last_edited_time 
                        ? new Date(page.last_edited_time).toLocaleDateString() 
                        : 'Unknown'}
                    </td>
                    <td style={{ padding: '8px', textAlign: 'center' }}>
                      {isUpdating ? (
                        <span style={{ color: 'var(--muted)', fontSize: '11px' }}>Updating...</span>
                      ) : page.indexed ? (
                        <span style={{ 
                          color: 'var(--accent)', 
                          fontSize: '11px',
                          fontWeight: '500',
                          background: 'var(--panel)',
                          border: '1px solid var(--border)',
                          padding: '2px 8px',
                          borderRadius: '12px',
                        }}>
                          ✓ Indexed
                        </span>
                      ) : (
                        <span style={{ 
                          color: 'var(--muted)', 
                          fontSize: '11px',
                          background: 'var(--panel)',
                          border: '1px solid var(--border)',
                          padding: '2px 8px',
                          borderRadius: '12px',
                        }}>
                          Not Indexed
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!showAllPages && pages.length > 10 && (
            <div style={{ padding: '12px', textAlign: 'center', fontSize: '12px', color: 'var(--muted)' }}>
              Showing 10 of {pages.length} pages. Click &quot;Show All&quot; to see all pages.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
