'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  listIngestionRuns,
  getIngestionRunChanges,
  undoIngestionRun,
  restoreIngestionRun,
  type IngestionRun,
  type IngestionRunChanges,
} from '../api-client';

export default function IngestionHubPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<IngestionRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runChanges, setRunChanges] = useState<IngestionRunChanges | null>(null);
  const [loadingChanges, setLoadingChanges] = useState(false);
  const [undoMode, setUndoMode] = useState<'SAFE' | 'RELATIONSHIPS_ONLY'>('SAFE');
  const [showUndoDialog, setShowUndoDialog] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    loadRuns();
  }, []);

  async function loadRuns() {
    try {
      setLoading(true);
      setError(null);
      const data = await listIngestionRuns(50, 0);
      setRuns(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ingestion runs');
    } finally {
      setLoading(false);
    }
  }

  async function handleReviewChanges(runId: string, graphId: string) {
    router.push(`/review?status=PROPOSED&ingestion_run_id=${encodeURIComponent(runId)}&graph_id=${encodeURIComponent(graphId)}`);
  }

  async function handleShowInExplorer(runId: string, graphId: string) {
    router.push(`/?graph_id=${encodeURIComponent(graphId)}&highlight_run_id=${encodeURIComponent(runId)}`);
  }

  async function handleOpenCreatedConcepts(runId: string) {
    if (selectedRunId === runId && runChanges) {
      setSelectedRunId(null);
      setRunChanges(null);
      return;
    }
    
    try {
      setLoadingChanges(true);
      setSelectedRunId(runId);
      const changes = await getIngestionRunChanges(runId);
      setRunChanges(changes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load run changes');
    } finally {
      setLoadingChanges(false);
    }
  }

  async function handleUndoRun(runId: string) {
    try {
      setUndoing(true);
      setError(null);
      const result = await undoIngestionRun(runId, undoMode);
      setShowUndoDialog(null);
      
      // Reload runs to get updated state
      await loadRuns();
      
      // Show success message with summary
      const summary = `Archived: ${result.archived.relationships} relationships, ${result.archived.concepts} concepts, ${result.archived.resources} resources`;
      const skippedCount = result.skipped.concepts.length + result.skipped.resources.length + result.skipped.relationships.length;
      if (skippedCount > 0) {
        alert(`${summary}\n\nSkipped ${skippedCount} items (see details in run summary)`);
      } else {
        alert(`Successfully undone run.\n\n${summary}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to undo run');
    } finally {
      setUndoing(false);
    }
  }

  async function handleRestoreRun(runId: string) {
    try {
      setRestoring(true);
      setError(null);
      const result = await restoreIngestionRun(runId);
      
      // Reload runs to get updated state
      await loadRuns();
      
      // Show success message
      const summary = `Restored: ${result.restored.relationships} relationships, ${result.restored.concepts} concepts, ${result.restored.resources} resources`;
      alert(`Successfully restored run.\n\n${summary}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore run');
    } finally {
      setRestoring(false);
    }
  }

  function formatTime(isoString: string | null | undefined) {
    if (!isoString) return 'N/A';
    const date = new Date(isoString);
    return date.toLocaleString();
  }

  function formatShortId(runId: string) {
    return runId.slice(0, 8);
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #fdf7ec 0%, #eef6ff 60%, #f7f9fb 100%)',
      padding: '20px',
    }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '24px' }}>
          <Link href="/" style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: '14px' }}>
            ← Back to Graph
          </Link>
          <h1 style={{ fontSize: '32px', fontWeight: '700', margin: '12px 0' }}>
            Ingestion Hub
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '14px' }}>
            Review and manage ingestion runs
          </p>
        </div>

        {error && (
          <div style={{
            padding: '12px',
            background: '#fee',
            border: '1px solid #fcc',
            borderRadius: '8px',
            color: '#c33',
            marginBottom: '24px',
          }}>
            {error}
          </div>
        )}

        {/* Runs List */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <div style={{ fontSize: '18px', color: 'var(--muted)' }}>Loading ingestion runs...</div>
          </div>
        ) : runs.length === 0 ? (
          <div style={{
            background: 'var(--panel)',
            borderRadius: '12px',
            padding: '40px',
            textAlign: 'center',
            boxShadow: 'var(--shadow)',
          }}>
            <div style={{ fontSize: '16px', color: 'var(--muted)' }}>
              No ingestion runs found
            </div>
          </div>
        ) : (
          <div style={{
            background: 'var(--panel)',
            borderRadius: '12px',
            padding: '20px',
            boxShadow: 'var(--shadow)',
          }}>
            <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '16px' }}>
              {runs.length} run{runs.length !== 1 ? 's' : ''}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {runs.map((run) => {
                const summary = run.summary_counts || {};
                const isSelected = selectedRunId === run.run_id;

                return (
                  <div key={run.run_id}>
                    <div
                      style={{
                        padding: '16px',
                        borderRadius: '8px',
                        border: '1px solid var(--border)',
                        background: 'white',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', flexWrap: 'wrap', gap: '12px' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
                            <span style={{
                              padding: '4px 10px',
                              background: run.status === 'COMPLETED' ? 'rgba(34, 197, 94, 0.1)' :
                                        run.status === 'FAILED' ? 'rgba(239, 68, 68, 0.1)' :
                                        run.status === 'PARTIAL' ? 'rgba(251, 191, 36, 0.1)' :
                                        'rgba(107, 114, 128, 0.1)',
                              color: run.status === 'COMPLETED' ? '#22c55e' :
                                     run.status === 'FAILED' ? '#ef4444' :
                                     run.status === 'PARTIAL' ? '#fbbf24' :
                                     '#6b7280',
                              borderRadius: '12px',
                              fontSize: '12px',
                              fontWeight: '600',
                            }}>
                              {run.status}
                            </span>
                            <span style={{ fontSize: '14px', fontWeight: '600' }}>
                              {run.source_type}
                            </span>
                            {run.source_label && (
                              <span style={{ fontSize: '14px', color: 'var(--muted)' }}>
                                {run.source_label}
                              </span>
                            )}
                            <span style={{ fontSize: '12px', color: 'var(--muted)', fontFamily: 'monospace' }}>
                              {formatShortId(run.run_id)}
                            </span>
                          </div>

                          <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '8px' }}>
                            Started: {formatTime(run.started_at)}
                            {run.completed_at && ` • Completed: ${formatTime(run.completed_at)}`}
                          </div>

                          {summary && (
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '12px' }}>
                              {summary.concepts_created !== undefined && summary.concepts_created > 0 && (
                                <span style={{
                                  padding: '2px 8px',
                                  background: 'rgba(17, 138, 178, 0.1)',
                                  color: 'var(--accent)',
                                  borderRadius: '12px',
                                }}>
                                  {summary.concepts_created} concept{summary.concepts_created !== 1 ? 's' : ''} created
                                </span>
                              )}
                              {summary.concepts_updated !== undefined && summary.concepts_updated > 0 && (
                                <span style={{
                                  padding: '2px 8px',
                                  background: 'rgba(17, 138, 178, 0.1)',
                                  color: 'var(--accent)',
                                  borderRadius: '12px',
                                }}>
                                  {summary.concepts_updated} concept{summary.concepts_updated !== 1 ? 's' : ''} updated
                                </span>
                              )}
                              {summary.resources_created !== undefined && summary.resources_created > 0 && (
                                <span style={{
                                  padding: '2px 8px',
                                  background: 'rgba(17, 138, 178, 0.1)',
                                  color: 'var(--accent)',
                                  borderRadius: '12px',
                                }}>
                                  {summary.resources_created} resource{summary.resources_created !== 1 ? 's' : ''} created
                                </span>
                              )}
                              {summary.relationships_proposed !== undefined && summary.relationships_proposed > 0 && (
                                <span style={{
                                  padding: '2px 8px',
                                  background: 'rgba(251, 191, 36, 0.1)',
                                  color: '#fbbf24',
                                  borderRadius: '12px',
                                }}>
                                  {summary.relationships_proposed} relationship{summary.relationships_proposed !== 1 ? 's' : ''} proposed
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {summary.relationships_proposed !== undefined && summary.relationships_proposed > 0 && (
                            <button
                              onClick={() => handleReviewChanges(run.run_id, run.graph_id)}
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
                              Review changes
                            </button>
                          )}
                          <button
                            onClick={() => handleShowInExplorer(run.run_id, run.graph_id)}
                            style={{
                              padding: '6px 12px',
                              background: 'transparent',
                              color: 'var(--accent)',
                              border: '1px solid var(--accent)',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: '500',
                              cursor: 'pointer',
                            }}
                          >
                            Show in Explorer
                          </button>
                          {(summary.concepts_created !== undefined && summary.concepts_created > 0) && (
                            <button
                              onClick={() => handleOpenCreatedConcepts(run.run_id)}
                              style={{
                                padding: '6px 12px',
                                background: 'transparent',
                                color: 'var(--muted)',
                                border: '1px solid var(--border)',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: '500',
                                cursor: 'pointer',
                              }}
                            >
                              {isSelected ? 'Hide' : 'Open'} created concepts
                            </button>
                          )}
                          {!run.undone_at && (
                            <button
                              onClick={() => setShowUndoDialog(run.run_id)}
                              style={{
                                padding: '6px 12px',
                                background: 'transparent',
                                color: '#ef4444',
                                border: '1px solid #ef4444',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: '500',
                                cursor: 'pointer',
                              }}
                            >
                              Undo run
                            </button>
                          )}
                          {run.undone_at && !run.restored_at && (
                            <button
                              onClick={() => handleRestoreRun(run.run_id)}
                              disabled={restoring}
                              style={{
                                padding: '6px 12px',
                                background: 'transparent',
                                color: '#22c55e',
                                border: '1px solid #22c55e',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: '500',
                                cursor: restoring ? 'not-allowed' : 'pointer',
                                opacity: restoring ? 0.6 : 1,
                              }}
                            >
                              {restoring ? 'Restoring...' : 'Restore'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Created Concepts Panel */}
                    {isSelected && runChanges && (
                      <div style={{
                        marginTop: '8px',
                        padding: '16px',
                        borderRadius: '8px',
                        border: '1px solid var(--border)',
                        background: '#f9fafb',
                      }}>
                        {loadingChanges ? (
                          <div style={{ textAlign: 'center', padding: '20px' }}>
                            <div style={{ fontSize: '14px', color: 'var(--muted)' }}>Loading changes...</div>
                          </div>
                        ) : (
                          <div>
                            {runChanges.concepts_created.length > 0 && (
                              <div style={{ marginBottom: '16px' }}>
                                <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '8px' }}>
                                  Created Concepts ({runChanges.concepts_created.length})
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                  {runChanges.concepts_created.map((concept) => (
                                    <Link
                                      key={concept.concept_id}
                                      href={`/concepts/${concept.concept_id}`}
                                      style={{
                                        padding: '6px 12px',
                                        background: 'white',
                                        borderRadius: '4px',
                                        border: '1px solid var(--border)',
                                        textDecoration: 'none',
                                        color: 'var(--accent)',
                                        fontSize: '13px',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                      }}
                                    >
                                      <span>{concept.name}</span>
                                      <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                                        {concept.domain} • {concept.type}
                                      </span>
                                    </Link>
                                  ))}
                                </div>
                              </div>
                            )}
                            {runChanges.concepts_updated.length > 0 && (
                              <div style={{ marginBottom: '16px' }}>
                                <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '8px' }}>
                                  Updated Concepts ({runChanges.concepts_updated.length})
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                  {runChanges.concepts_updated.map((concept) => (
                                    <Link
                                      key={concept.concept_id}
                                      href={`/concepts/${concept.concept_id}`}
                                      style={{
                                        padding: '6px 12px',
                                        background: 'white',
                                        borderRadius: '4px',
                                        border: '1px solid var(--border)',
                                        textDecoration: 'none',
                                        color: 'var(--accent)',
                                        fontSize: '13px',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                      }}
                                    >
                                      <span>{concept.name}</span>
                                      <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                                        {concept.domain} • {concept.type}
                                      </span>
                                    </Link>
                                  ))}
                                </div>
                              </div>
                            )}
                            {runChanges.resources_created.length > 0 && (
                              <div>
                                <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '8px' }}>
                                  Created Resources ({runChanges.resources_created.length})
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                  {runChanges.resources_created.map((resource) => (
                                    <div
                                      key={resource.resource_id}
                                      style={{
                                        padding: '6px 12px',
                                        background: 'white',
                                        borderRadius: '4px',
                                        border: '1px solid var(--border)',
                                        fontSize: '13px',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                      }}
                                    >
                                      <span>{resource.title}</span>
                                      <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                                        {resource.source_type}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Undo Dialog */}
                    {showUndoDialog === run.run_id && (
                      <div style={{
                        marginTop: '8px',
                        padding: '16px',
                        borderRadius: '8px',
                        border: '1px solid var(--border)',
                        background: '#fff',
                        boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                      }}>
                        <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>
                          Undo Ingestion Run
                        </div>
                        <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '16px' }}>
                          This will hide proposed relationships and archive concepts/resources created by this run when safe.
                        </div>
                        <div style={{ marginBottom: '16px' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', marginBottom: '8px' }}>
                            <input
                              type="radio"
                              checked={undoMode === 'SAFE'}
                              onChange={() => setUndoMode('SAFE')}
                            />
                            <span>Safe undo (default) - Archive concepts/resources when safe</span>
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                            <input
                              type="radio"
                              checked={undoMode === 'RELATIONSHIPS_ONLY'}
                              onChange={() => setUndoMode('RELATIONSHIPS_ONLY')}
                            />
                            <span>Relationships only - Only archive proposed relationships</span>
                          </label>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => setShowUndoDialog(null)}
                            style={{
                              padding: '6px 12px',
                              background: 'transparent',
                              color: 'var(--muted)',
                              border: '1px solid var(--border)',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: '500',
                              cursor: 'pointer',
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleUndoRun(run.run_id)}
                            disabled={undoing}
                            style={{
                              padding: '6px 12px',
                              background: '#ef4444',
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: '500',
                              cursor: undoing ? 'not-allowed' : 'pointer',
                              opacity: undoing ? 0.6 : 1,
                            }}
                          >
                            {undoing ? 'Undoing...' : 'Confirm Undo'}
                          </button>
                        </div>
                      </div>
                    )}
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

