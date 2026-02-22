'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { listGraphs, selectGraph, type GraphSummary } from '../api-client';

type SortMode = 'recent' | 'name' | 'size';

export default function ControlPanel() {
  const router = useRouter();
  const [graphs, setGraphs] = useState<GraphSummary[]>([]);
  const [activeGraphId, setActiveGraphId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [templateFilter, setTemplateFilter] = useState('all');
  const [sortMode, setSortMode] = useState<SortMode>('recent');

  useEffect(() => {
    let mounted = true;
    async function loadGraphs() {
      try {
        setLoading(true);
        const data = await listGraphs();
        if (!mounted) return;
        setGraphs(data.graphs || []);
        setActiveGraphId(data.active_graph_id || '');
        setError(null);
      } catch (err) {
        console.error('Failed to load graphs:', err);
        if (!mounted) return;
        setError('Unable to load graphs right now.');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadGraphs();
    return () => {
      mounted = false;
    };
  }, []);

  const templateOptions = useMemo(() => {
    const templates = new Map<string, string>();
    graphs.forEach((graph) => {
      if (graph.template_id && graph.template_label) {
        templates.set(graph.template_id, graph.template_label);
      }
    });
    return Array.from(templates.entries());
  }, [graphs]);

  const filteredGraphs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    let filtered = graphs.filter((graph) => {
      const matchesQuery =
        !query ||
        (graph.name || '').toLowerCase().includes(query) ||
        (graph.intent || '').toLowerCase().includes(query) ||
        (graph.template_label || '').toLowerCase().includes(query) ||
        (graph.graph_id || '').toLowerCase().includes(query);

      const matchesTemplate =
        templateFilter === 'all' ||
        (graph.template_id || 'blank') === templateFilter ||
        (graph.template_label || '').toLowerCase() === templateFilter;

      return matchesQuery && matchesTemplate;
    });

    filtered = [...filtered].sort((a, b) => {
      if (sortMode === 'name') {
        return (a.name || '').localeCompare(b.name || '');
      }
      if (sortMode === 'size') {
        const aSize = (a.node_count || 0) + (a.edge_count || 0);
        const bSize = (b.node_count || 0) + (b.edge_count || 0);
        return bSize - aSize;
      }
      const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
      const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
      return bTime - aTime;
    });

    return filtered;
  }, [graphs, searchQuery, templateFilter, sortMode]);

  return (
    <div style={{ minHeight: 'calc(100vh - 56px)', background: 'var(--page-bg)' }}>
      <div style={{ padding: '32px 28px 48px', position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.5 }}>
          <div className="control-panel__glow" />
        </div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <div style={{ fontSize: '12px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--accent)', fontWeight: 600 }}>
                Workspace Library
              </div>
              <h1 style={{ margin: '6px 0 8px', fontSize: '32px', color: 'var(--ink)' }}>Manage graphs</h1>
              <div style={{ color: 'var(--muted)', fontSize: '14px', maxWidth: '520px' }}>
                Scan every knowledge graph, spot what needs attention, and jump right into the right workspace.
              </div>
            </div>
            <button
              type="button"
              onClick={() => router.push('/')}
              style={{
                background: 'var(--accent)',
                color: 'white',
                border: 'none',
                borderRadius: '999px',
                padding: '10px 18px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: 'var(--shadow)',
              }}
            >
              Create new graph
            </button>
          </div>

          <div style={{ marginTop: '24px', display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <div className="control-panel__stat">
              <div className="control-panel__stat-label">Total graphs</div>
              <div className="control-panel__stat-value">{graphs.length}</div>
            </div>
            <div className="control-panel__stat">
              <div className="control-panel__stat-label">Active workspace</div>
              <div className="control-panel__stat-value">{activeGraphId || '—'}</div>
            </div>
            <div className="control-panel__stat">
              <div className="control-panel__stat-label">Templates used</div>
              <div className="control-panel__stat-value">{Math.max(templateOptions.length, 1)}</div>
            </div>
          </div>

          <div style={{ marginTop: '24px', display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search graphs, intents, IDs..."
              style={{
                flex: '1 1 220px',
                minWidth: '220px',
                borderRadius: '999px',
                border: '1px solid var(--border)',
                padding: '10px 16px',
                backgroundColor: 'var(--surface)',
                fontSize: '13px',
                color: 'var(--ink)',
              }}
            />
            <select
              value={templateFilter}
              onChange={(event) => setTemplateFilter(event.target.value)}
              style={{
                borderRadius: '999px',
                border: '1px solid var(--border)',
                padding: '10px 14px',
                backgroundColor: 'var(--surface)',
                fontSize: '13px',
                color: 'var(--ink)',
              }}
            >
              <option value="all">All templates</option>
              {templateOptions.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
              style={{
                borderRadius: '999px',
                border: '1px solid var(--border)',
                padding: '10px 14px',
                backgroundColor: 'var(--surface)',
                fontSize: '13px',
                color: 'var(--ink)',
              }}
            >
              <option value="recent">Sort by recent</option>
              <option value="name">Sort by name</option>
              <option value="size">Sort by size</option>
            </select>
          </div>

          <div style={{ marginTop: '24px' }}>
            {loading && <div style={{ color: 'var(--muted)' }}>Loading graphs...</div>}
            {error && <div style={{ color: '#b91c1c' }}>{error}</div>}
            {!loading && !error && filteredGraphs.length === 0 && (
              <div style={{ color: 'var(--muted)' }}>No graphs match that filter yet.</div>
            )}

            <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
              {filteredGraphs.map((graph, index) => {
                const templateLabel = graph.template_label || null;
                const templateTags = graph.template_tags || [];
                const sizeLabel = `${graph.node_count || 0} nodes · ${graph.edge_count || 0} edges`;
                const isActive = graph.graph_id === activeGraphId;
                return (
                  <div key={graph.graph_id} className="control-panel__card" style={{ animationDelay: `${index * 40}ms` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                      <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--ink)' }}>
                        {graph.name || 'Untitled graph'}
                      </div>
                      {isActive && (
                        <div style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '999px', background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--accent)', fontWeight: 600 }}>
                          Active
                        </div>
                      )}
                    </div>
                    {(templateLabel || templateTags.length > 0) && (
                      <div style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {templateLabel && (
                          <span style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '999px', background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--accent)', fontWeight: 600 }}>
                            {templateLabel}
                          </span>
                        )}
                        {templateTags.slice(0, 2).map((tag) => (
                          <span
                            key={tag}
                            style={{
                              fontSize: '11px',
                              padding: '4px 8px',
                              borderRadius: '999px',
                              backgroundColor: '#f8fafc',
                              color: 'var(--muted)',
                              border: '1px solid var(--border)',
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    <div style={{ marginTop: '12px', fontSize: '13px', color: 'var(--muted)', minHeight: '40px' }}>
                      {graph.intent || graph.template_description || 'No intent captured yet.'}
                    </div>
                    <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--muted)' }}>{sizeLabel}</div>
                    <div style={{ marginTop: '14px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await selectGraph(graph.graph_id);
                            router.push(`/?graph_id=${encodeURIComponent(graph.graph_id)}`);
                          } catch (err) {
                            console.error('Failed to switch graph:', err);
                          }
                        }}
                        style={{
                          padding: '8px 12px',
                          borderRadius: '999px',
                          border: 'none',
                          background: 'var(--accent)',
                          color: 'white',
                          fontSize: '12px',
                          cursor: 'pointer',
                        }}
                      >
                        Open
                      </button>
                      <Link
                        href={`/graphs/${graph.graph_id}`}
                        style={{
                          padding: '8px 12px',
                          borderRadius: '999px',
                          border: '1px solid var(--border)',
                          color: 'var(--ink)',
                          fontSize: '12px',
                          textDecoration: 'none',
                        }}
                      >
                        Details
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <style jsx>{`
        .control-panel__glow {
          position: absolute;
          top: -120px;
          right: -80px;
          width: 320px;
          height: 320px;
          background: radial-gradient(circle at center, rgba(17, 138, 178, 0.15), transparent 70%);
          filter: blur(10px);
        }
        
        :root.dark .control-panel__glow {
          background: radial-gradient(circle at center, rgba(56, 189, 248, 0.15), transparent 70%);
        }

        .control-panel__stat {
          background: var(--panel);
          border-radius: 16px;
          padding: 14px 16px;
          border: 1px solid var(--border);
          box-shadow: var(--shadow);
        }

        .control-panel__stat-label {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--muted);
        }

        .control-panel__stat-value {
          font-size: 20px;
          font-weight: 600;
          color: var(--ink);
          margin-top: 4px;
        }

        .control-panel__card {
          background: var(--panel);
          border-radius: 18px;
          padding: 16px;
          border: 1px solid var(--border);
          box-shadow: var(--shadow);
          transform: translateY(8px);
          opacity: 0;
          animation: floatIn 0.5s ease forwards;
        }

        @keyframes floatIn {
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
