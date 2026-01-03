'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  listProposedRelationships,
  acceptRelationships,
  rejectRelationships,
  editRelationship,
  listGraphs,
  type RelationshipReviewItem,
  type RelationshipReviewListResponse,
} from '../api-client';

type SortField = 'confidence' | 'created_at';
type SortOrder = 'asc' | 'desc';

export default function ReviewPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [relationships, setRelationships] = useState<RelationshipReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [graphId, setGraphId] = useState<string>('');
  const [status, setStatus] = useState<'PROPOSED' | 'ACCEPTED' | 'REJECTED'>('PROPOSED');
  const [ingestionRunId, setIngestionRunId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>('confidence');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingRelType, setEditingRelType] = useState<string>('');

  useEffect(() => {
    // Read query params first (faster than API call)
    const statusParam = searchParams.get('status');
    const runIdParam = searchParams.get('ingestion_run_id');
    const graphIdParam = searchParams.get('graph_id');
    
    if (statusParam && ['PROPOSED', 'ACCEPTED', 'REJECTED'].includes(statusParam)) {
      setStatus(statusParam as 'PROPOSED' | 'ACCEPTED' | 'REJECTED');
    }
    if (runIdParam) {
      setIngestionRunId(runIdParam);
    }
    if (graphIdParam) {
      // If graphId is in URL, use it immediately (no need to wait for API)
      setGraphId(graphIdParam);
    } else {
      // Only load graphs if graphId not in URL params
      async function loadGraphs() {
        try {
          const data = await listGraphs();
          setGraphId(data.active_graph_id || 'demo');
        } catch (err) {
          setGraphId('demo');
        }
      }
      loadGraphs();
    }
  }, [searchParams]);

  useEffect(() => {
    if (!graphId) return;
    loadRelationships();
  }, [graphId, status, ingestionRunId]);

  async function loadRelationships() {
    try {
      setLoading(true);
      setError(null);
      const data = await listProposedRelationships(graphId, status, 200, 0, ingestionRunId || undefined);
      
      // Sort relationships
      const sorted = [...data.relationships].sort((a, b) => {
        let aVal: any, bVal: any;
        if (sortField === 'confidence') {
          aVal = a.confidence;
          bVal = b.confidence;
        } else {
          aVal = a.created_at || 0;
          bVal = b.created_at || 0;
        }
        
        if (sortOrder === 'asc') {
          return aVal > bVal ? 1 : -1;
        } else {
          return aVal < bVal ? 1 : -1;
        }
      });
      
      setRelationships(sorted);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load relationships');
    } finally {
      setLoading(false);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(relationships.map(r => `${r.src_node_id}-${r.dst_node_id}-${r.rel_type}`)));
  }

  function deselectAll() {
    setSelectedIds(new Set());
  }

  async function handleBatchAccept() {
    if (selectedIds.size === 0) return;
    
    const edges = relationships
      .filter(r => selectedIds.has(`${r.src_node_id}-${r.dst_node_id}-${r.rel_type}`))
      .map(r => ({
        src_node_id: r.src_node_id,
        dst_node_id: r.dst_node_id,
        rel_type: r.rel_type,
      }));
    
    try {
      await acceptRelationships(graphId, edges);
      setSelectedIds(new Set());
      await loadRelationships();
      // Preserve ingestion_run_id in URL after accept
      if (ingestionRunId) {
        const params = new URLSearchParams(searchParams.toString());
        params.set('ingestion_run_id', ingestionRunId);
        router.push(`/review?${params.toString()}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept relationships');
    }
  }

  async function handleBatchReject() {
    if (selectedIds.size === 0) return;
    
    const edges = relationships
      .filter(r => selectedIds.has(`${r.src_node_id}-${r.dst_node_id}-${r.rel_type}`))
      .map(r => ({
        src_node_id: r.src_node_id,
        dst_node_id: r.dst_node_id,
        rel_type: r.rel_type,
      }));
    
    try {
      await rejectRelationships(graphId, edges);
      setSelectedIds(new Set());
      await loadRelationships();
      // Preserve ingestion_run_id in URL after reject
      if (ingestionRunId) {
        const params = new URLSearchParams(searchParams.toString());
        params.set('ingestion_run_id', ingestionRunId);
        router.push(`/review?${params.toString()}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject relationships');
    }
  }

  async function handleAccept(id: string) {
    const rel = relationships.find(r => `${r.src_node_id}-${r.dst_node_id}-${r.rel_type}` === id);
    if (!rel) return;
    
    try {
      await acceptRelationships(graphId, [{
        src_node_id: rel.src_node_id,
        dst_node_id: rel.dst_node_id,
        rel_type: rel.rel_type,
      }]);
      await loadRelationships();
      // Preserve ingestion_run_id in URL after accept
      if (ingestionRunId) {
        const params = new URLSearchParams(searchParams.toString());
        params.set('ingestion_run_id', ingestionRunId);
        router.push(`/review?${params.toString()}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept relationship');
    }
  }

  async function handleReject(id: string) {
    const rel = relationships.find(r => `${r.src_node_id}-${r.dst_node_id}-${r.rel_type}` === id);
    if (!rel) return;
    
    try {
      await rejectRelationships(graphId, [{
        src_node_id: rel.src_node_id,
        dst_node_id: rel.dst_node_id,
        rel_type: rel.rel_type,
      }]);
      await loadRelationships();
      // Preserve ingestion_run_id in URL after reject
      if (ingestionRunId) {
        const params = new URLSearchParams(searchParams.toString());
        params.set('ingestion_run_id', ingestionRunId);
        router.push(`/review?${params.toString()}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject relationship');
    }
  }

  async function handleEdit(id: string, newRelType: string) {
    const rel = relationships.find(r => `${r.src_node_id}-${r.dst_node_id}-${r.rel_type}` === id);
    if (!rel) return;
    
    try {
      await editRelationship(graphId, rel.src_node_id, rel.dst_node_id, rel.rel_type, newRelType);
      setEditingId(null);
      await loadRelationships();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to edit relationship');
    }
  }

  function startEdit(id: string) {
    const rel = relationships.find(r => `${r.src_node_id}-${r.dst_node_id}-${r.rel_type}` === id);
    if (rel) {
      setEditingId(id);
      setEditingRelType(rel.rel_type);
    }
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingRelType('');
  }

  const relationshipId = (r: RelationshipReviewItem) => `${r.src_node_id}-${r.dst_node_id}-${r.rel_type}`;

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--page-bg)',
      padding: '20px',
    }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '24px' }}>
          <Link href="/" style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: '14px' }}>
            ← Back to Graph
          </Link>
          <h1 style={{ fontSize: '32px', fontWeight: '700', margin: '12px 0' }}>
            Relationship Review
          </h1>
        </div>

        {/* Ingestion Run Filter Banner */}
        {ingestionRunId && (
          <div style={{
            background: 'var(--panel)',
            border: '1px solid var(--accent)',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div style={{ fontSize: '14px', color: 'var(--accent)' }}>
              Filtered to ingestion run <code style={{ fontFamily: 'monospace', fontSize: '12px' }}>{ingestionRunId.slice(0, 8)}...</code>
            </div>
            <button
              onClick={() => {
                setIngestionRunId(null);
                const params = new URLSearchParams(searchParams.toString());
                params.delete('ingestion_run_id');
                router.push(`/review?${params.toString()}`);
              }}
              style={{
                padding: '4px 12px',
                background: 'transparent',
                color: 'var(--accent)',
                border: '1px solid var(--accent)',
                borderRadius: '4px',
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              Clear filter
            </button>
          </div>
        )}

        {/* Filters and Controls */}
        <div style={{
          background: 'var(--panel)',
          borderRadius: '12px',
          padding: '20px',
          boxShadow: 'var(--shadow)',
          marginBottom: '24px',
        }}>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--muted)', marginBottom: '4px', display: 'block' }}>
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                style={{
                  padding: '8px 12px',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  fontSize: '14px',
                }}
              >
                <option value="PROPOSED">Proposed</option>
                <option value="ACCEPTED">Accepted</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--muted)', marginBottom: '4px', display: 'block' }}>
                Sort by
              </label>
              <select
                value={sortField}
                onChange={(e) => {
                  setSortField(e.target.value as SortField);
                  loadRelationships();
                }}
                style={{
                  padding: '8px 12px',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  fontSize: '14px',
                }}
              >
                <option value="confidence">Confidence</option>
                <option value="created_at">Recency</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--muted)', marginBottom: '4px', display: 'block' }}>
                Order
              </label>
              <select
                value={sortOrder}
                onChange={(e) => {
                  setSortOrder(e.target.value as SortOrder);
                  loadRelationships();
                }}
                style={{
                  padding: '8px 12px',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  fontSize: '14px',
                }}
              >
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            </div>

            <div style={{ flex: 1 }} />

            {selectedIds.size > 0 && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={handleBatchAccept}
                  style={{
                    padding: '8px 16px',
                    background: 'var(--accent)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: '500',
                    cursor: 'pointer',
                  }}
                >
                  Accept {selectedIds.size}
                </button>
                <button
                  onClick={handleBatchReject}
                  style={{
                    padding: '8px 16px',
                    background: 'var(--accent-2)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: '500',
                    cursor: 'pointer',
                  }}
                >
                  Reject {selectedIds.size}
                </button>
                <button
                  onClick={deselectAll}
                  style={{
                    padding: '8px 16px',
                    background: 'transparent',
                    color: 'var(--muted)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    fontSize: '14px',
                    cursor: 'pointer',
                  }}
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div style={{
            padding: '12px',
            background: 'var(--panel)',
            border: '1px solid var(--accent-2)',
            borderRadius: '8px',
            color: 'var(--accent-2)',
            marginBottom: '24px',
          }}>
            {error}
          </div>
        )}

        {/* Relationships List */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <div style={{ fontSize: '18px', color: 'var(--muted)' }}>Loading relationships...</div>
          </div>
        ) : relationships.length === 0 ? (
          <div style={{
            background: 'var(--panel)',
            borderRadius: '12px',
            padding: '40px',
            textAlign: 'center',
            boxShadow: 'var(--shadow)',
          }}>
            <div style={{ fontSize: '16px', color: 'var(--muted)' }}>
              No {status.toLowerCase()} relationships found
            </div>
          </div>
        ) : (
          <div style={{
            background: 'var(--panel)',
            borderRadius: '12px',
            padding: '20px',
            boxShadow: 'var(--shadow)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ fontSize: '14px', color: 'var(--muted)' }}>
                {relationships.length} relationship{relationships.length !== 1 ? 's' : ''}
              </div>
              <button
                onClick={selectedIds.size === relationships.length ? deselectAll : selectAll}
                style={{
                  padding: '6px 12px',
                  background: 'transparent',
                  color: 'var(--accent)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  fontSize: '12px',
                  cursor: 'pointer',
                }}
              >
                {selectedIds.size === relationships.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {relationships.map((rel) => {
                const id = relationshipId(rel);
                const isSelected = selectedIds.has(id);
                const isEditing = editingId === id;

                return (
                  <div
                    key={id}
                    style={{
                      padding: '16px',
                      borderRadius: '8px',
                      border: isSelected ? '2px solid var(--accent)' : '1px solid var(--border)',
                      background: isSelected ? 'var(--panel)' : 'var(--surface)',
                    }}
                  >
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'start' }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(id)}
                        style={{ marginTop: '4px' }}
                      />
                      
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
                          <Link
                            href={`/concepts/${rel.src_node_id}`}
                            style={{
                              fontSize: '16px',
                              fontWeight: '600',
                              color: 'var(--accent)',
                              textDecoration: 'none',
                            }}
                          >
                            {rel.src_name}
                          </Link>
                          <span style={{ color: 'var(--muted)' }}>→</span>
                          {isEditing ? (
                            <>
                              <input
                                type="text"
                                value={editingRelType}
                                onChange={(e) => setEditingRelType(e.target.value)}
                                style={{
                                  padding: '4px 8px',
                                  border: '1px solid var(--border)',
                                  borderRadius: '4px',
                                  fontSize: '14px',
                                  width: '150px',
                                }}
                                placeholder="Relationship type"
                              />
                              <button
                                onClick={() => handleEdit(id, editingRelType)}
                                style={{
                                  padding: '4px 12px',
                                  background: 'var(--accent)',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '4px',
                                  fontSize: '12px',
                                  cursor: 'pointer',
                                }}
                              >
                                Save
                              </button>
                              <button
                                onClick={cancelEdit}
                                style={{
                                  padding: '4px 12px',
                                  background: 'transparent',
                                  color: 'var(--muted)',
                                  border: '1px solid var(--border)',
                                  borderRadius: '4px',
                                  fontSize: '12px',
                                  cursor: 'pointer',
                                }}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <span style={{
                                padding: '4px 10px',
                                background: 'var(--panel)',
                                border: '1px solid var(--border)',
                                color: 'var(--accent)',
                                borderRadius: '12px',
                                fontSize: '12px',
                                fontWeight: '600',
                              }}>
                                {rel.rel_type}
                              </span>
                              <button
                                onClick={() => startEdit(id)}
                                style={{
                                  padding: '2px 8px',
                                  background: 'transparent',
                                  color: 'var(--muted)',
                                  border: 'none',
                                  fontSize: '11px',
                                  cursor: 'pointer',
                                  textDecoration: 'underline',
                                }}
                              >
                                Edit
                              </button>
                            </>
                          )}
                          <Link
                            href={`/concepts/${rel.dst_node_id}`}
                            style={{
                              fontSize: '16px',
                              fontWeight: '600',
                              color: 'var(--accent)',
                              textDecoration: 'none',
                            }}
                          >
                            {rel.dst_name}
                          </Link>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                          <span style={{
                            padding: '2px 8px',
                            background: 'var(--panel)',
                            border: '1px solid var(--border)',
                            color: 'var(--accent)',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: '600',
                          }}>
                            {(rel.confidence * 100).toFixed(0)}% confidence
                          </span>
                          <span style={{
                            padding: '2px 8px',
                            background: 'var(--panel)',
                            border: '1px solid var(--border)',
                            color: 'var(--muted)',
                            borderRadius: '12px',
                            fontSize: '11px',
                          }}>
                            {rel.method}
                          </span>
                          {rel.source_id && (
                            <span style={{
                              padding: '2px 8px',
                              background: 'var(--panel)',
                              color: 'var(--muted)',
                              borderRadius: '12px',
                              fontSize: '11px',
                            }}>
                              Source: {rel.source_id}
                            </span>
                          )}
                        </div>

                        {rel.rationale && (
                          <div style={{
                            fontSize: '13px',
                            color: 'var(--muted)',
                            marginTop: '8px',
                            padding: '8px',
                            background: 'rgba(107, 114, 128, 0.05)',
                            borderRadius: '6px',
                            lineHeight: '1.5',
                          }}>
                            {rel.rationale}
                          </div>
                        )}
                      </div>

                      {!isEditing && (
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            onClick={() => handleAccept(id)}
                            style={{
                              padding: '6px 12px',
                              background: 'var(--accent)',
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: '500',
                              cursor: 'pointer',
                            }}
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => handleReject(id)}
                            style={{
                              padding: '6px 12px',
                              background: 'var(--accent-2)',
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: '500',
                              cursor: 'pointer',
                            }}
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
