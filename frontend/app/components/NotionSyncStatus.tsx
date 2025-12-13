'use client';

import React, { useState, useEffect } from 'react';
import { getNotionSyncHistory, triggerNotionSync, type NotionSyncHistory } from '../api-client';

interface NotionSyncStatusProps {
  className?: string;
}

export default function NotionSyncStatus({ className = '' }: NotionSyncStatusProps) {
  const [history, setHistory] = useState<NotionSyncHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getNotionSyncHistory(10);
      setHistory(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sync history');
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async (forceFull: boolean = false) => {
    setSyncing(true);
    setError(null);
    try {
      await triggerNotionSync(forceFull);
      // Reload history after sync
      await loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger sync');
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    loadHistory();
    // Refresh every 30 seconds
    const interval = setInterval(loadHistory, 30000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (isoString: string | null) => {
    if (!isoString) return 'Never';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const containerStyle: React.CSSProperties = {
    padding: '16px',
    background: 'var(--bg-secondary, #f5f5f5)',
    borderRadius: '8px',
    border: '1px solid var(--border, #e0e0e0)',
  };

  return (
    <div 
      className={`notion-sync-status ${className}`} 
      style={containerStyle}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600' }}>Notion Sync</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => handleSync(false)}
            disabled={syncing}
            style={{
              padding: '4px 12px',
              fontSize: '12px',
              border: '1px solid var(--border, #ccc)',
              borderRadius: '4px',
              background: syncing ? '#ccc' : 'white',
              cursor: syncing ? 'not-allowed' : 'pointer',
            }}
          >
            {syncing ? 'Syncing...' : 'Sync'}
          </button>
          <button
            onClick={() => handleSync(true)}
            disabled={syncing}
            style={{
              padding: '4px 12px',
              fontSize: '12px',
              border: '1px solid var(--border, #ccc)',
              borderRadius: '4px',
              background: syncing ? '#ccc' : 'white',
              cursor: syncing ? 'not-allowed' : 'pointer',
            }}
          >
            Full Sync
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          padding: '8px',
          marginBottom: '12px',
          background: '#fee',
          border: '1px solid #fcc',
          borderRadius: '4px',
          fontSize: '12px',
          color: '#c00',
        }}>
          {error}
        </div>
      )}

      {loading && !history ? (
        <div style={{ padding: '16px', textAlign: 'center', color: '#666', fontSize: '12px' }}>
          Loading...
        </div>
      ) : history ? (
        <>
          <div style={{ marginBottom: '12px', fontSize: '12px', color: '#666' }}>
            Last sync: {history.last_sync ? formatTime(history.last_sync) : 'Never'}
            {history.last_sync && (
              <span style={{ marginLeft: '8px', color: '#0a0' }}>●</span>
            )}
          </div>

          {history.recent_pages.length === 0 ? (
            <div style={{ padding: '16px', textAlign: 'center', color: '#666', fontSize: '12px' }}>
              No pages synced yet
            </div>
          ) : (
            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
              {history.recent_pages.map((page: NotionSyncHistory['recent_pages'][0]) => (
                <div
                  key={page.page_id}
                  style={{
                    padding: '8px',
                    marginBottom: '6px',
                    background: 'white',
                    borderRadius: '4px',
                    border: '1px solid var(--border, #e0e0e0)',
                    fontSize: '12px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: '500', marginBottom: '4px' }}>
                        {page.page_title && page.page_title !== 'Untitled' 
                          ? page.page_title 
                          : `Page ${page.page_id.slice(0, 8)}...`}
                      </div>
                      <div style={{ fontSize: '11px', color: '#666' }}>
                        {page.last_ingested_at ? formatTime(page.last_ingested_at) : 'Not synced'}
                        {page.lecture_ids.length > 0 && (
                          <span style={{ marginLeft: '8px' }}>
                            ({page.lecture_ids.length} lecture{page.lecture_ids.length !== 1 ? 's' : ''})
                          </span>
                        )}
                        {(!page.page_title || page.page_title === 'Untitled') && (
                          <span style={{ marginLeft: '8px', fontFamily: 'monospace', fontSize: '10px', opacity: 0.7 }}>
                            {page.page_id}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ marginLeft: '8px' }}>
                      {page.status === 'synced' ? (
                        <span style={{ color: '#0a0', fontSize: '10px' }} title="Synced">●</span>
                      ) : (
                        <span style={{ color: '#999', fontSize: '10px' }} title="Not synced">○</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
