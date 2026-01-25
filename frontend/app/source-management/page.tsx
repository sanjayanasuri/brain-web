'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getNotionConfig, updateNotionConfig, NotionConfig } from '../api-client';
import NotionSyncManager from '../components/notion/NotionSyncManager';
import GraphFilesViewer from '../components/graph-files/GraphFilesViewer';

export default function SourceManagementPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notionConfig, setNotionConfig] = useState<NotionConfig | null>(null);
  const [savingNotion, setSavingNotion] = useState(false);

  useEffect(() => {
    async function loadConfig() {
      try {
        setLoading(true);
        setError(null);
        const config = await getNotionConfig();
        setNotionConfig(config);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load Notion configuration');
      } finally {
        setLoading(false);
      }
    }
    loadConfig();
  }, []);

  async function handleSaveNotion() {
    if (!notionConfig) return;
    try {
      setSavingNotion(true);
      setError(null);
      const updated = await updateNotionConfig(notionConfig);
      setNotionConfig(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Notion configuration');
    } finally {
      setSavingNotion(false);
    }
  }

  if (loading) {
    return (
      <div className="app-shell" style={{ padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div>Loading source management...</div>
      </div>
    );
  }

  return (
    <div className="app-shell" style={{ padding: 24, overflow: 'auto', maxWidth: '1200px', margin: '0 auto' }}>
      <div className="graph-header" style={{ marginBottom: 24 }}>
        <div>
          <p className="eyebrow">Source Management</p>
          <h1 className="title">Manage Your Knowledge Sources</h1>
          <p className="subtitle">
            Configure Notion databases and manage which pages are indexed into your Brain Web graph.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link
            href="/"
            className="pill pill--ghost pill--small"
            style={{ cursor: 'pointer', textDecoration: 'none' }}
          >
            ← Back to Graph
          </Link>
          <Link
            href="/profile-customization"
            className="pill pill--ghost pill--small"
            style={{ cursor: 'pointer', textDecoration: 'none' }}
          >
            Profile Customization
          </Link>
        </div>
      </div>

      {error && (
        <div className="chat-error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {process.env.NEXT_PUBLIC_DEMO_MODE === 'true' ? (
          <section className="control-card" style={{ textAlign: 'center', padding: '40px' }}>
            <h3 style={{ marginBottom: 12 }}>Demo Mode Enabled</h3>
            <p className="subtitle">
              Source management and database configurations are disabled in this public demo to protect privacy.
            </p>
          </section>
        ) : (
          <>
            {/* Notion Database Configuration */}
            <section className="control-card">
              <div className="control-header" style={{ marginBottom: 16 }}>
                <div>
                  <span>Notion Database Configuration</span>
                  <p className="subtitle" style={{ marginTop: 4 }}>
                    Specify which Notion databases should be synced. Leave empty to sync all databases.
                  </p>
                </div>
              </div>

              {notionConfig ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <label className="field-label">
                    Database IDs (one per line)
                    <textarea
                      className="chat-input"
                      rows={6}
                      value={notionConfig.database_ids.join('\n')}
                      onChange={e =>
                        setNotionConfig(prev =>
                          prev
                            ? {
                              ...prev,
                              database_ids: e.target.value
                                .split('\n')
                                .map(s => s.trim())
                                .filter(Boolean),
                            }
                            : prev,
                        )
                      }
                      placeholder="Enter Notion database IDs, one per line&#10;Example:&#10;abc123def456&#10;ghi789jkl012"
                    />
                  </label>
                  <div style={{ fontSize: '12px', color: 'var(--muted, #666)', marginTop: '-8px' }}>
                    Tip: Leave empty to automatically discover and sync all databases you have access to.
                  </div>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 13,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={notionConfig.enable_auto_sync}
                      onChange={e =>
                        setNotionConfig(prev =>
                          prev
                            ? {
                              ...prev,
                              enable_auto_sync: e.target.checked,
                            }
                            : prev,
                        )
                      }
                    />
                    Enable auto-sync in the background (runs every 5 minutes)
                  </label>
                  <button
                    className="send-btn"
                    style={{ alignSelf: 'flex-start', marginTop: 4 }}
                    onClick={handleSaveNotion}
                    disabled={savingNotion}
                  >
                    {savingNotion ? 'Saving…' : 'Save Database Configuration'}
                  </button>
                </div>
              ) : (
                <p className="subtitle">
                  Notion configuration is not available. Please check backend connection.
                </p>
              )}
            </section>

            {/* Notion Sync & Indexing */}
            <section className="control-card">
              <NotionSyncManager />
            </section>

            {/* Graph Data Files */}
            <section className="control-card">
              <GraphFilesViewer />
            </section>
          </>
        )}
      </div>
    </div>
  );
}
