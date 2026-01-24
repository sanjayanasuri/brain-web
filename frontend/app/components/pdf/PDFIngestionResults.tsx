'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { PDFIngestResponse } from '../../api-client';
import { getIngestionRunChanges, type IngestionRunChanges } from '../../api-client';

interface PDFIngestionResultsProps {
  result: PDFIngestResponse;
  onViewInGraph?: () => void;
}

export default function PDFIngestionResults({
  result,
  onViewInGraph,
}: PDFIngestionResultsProps) {
  const [runChanges, setRunChanges] = useState<IngestionRunChanges | null>(null);
  const [loadingChanges, setLoadingChanges] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (result.run_id && showDetails) {
      loadRunChanges();
    }
  }, [result.run_id, showDetails]);

  async function loadRunChanges() {
    if (!result.run_id) return;
    
    try {
      setLoadingChanges(true);
      const changes = await getIngestionRunChanges(result.run_id);
      setRunChanges(changes);
    } catch (error) {
      console.error('Failed to load run changes:', error);
    } finally {
      setLoadingChanges(false);
    }
  }

  const statusColor = result.status === 'COMPLETED' ? '#22c55e' :
                      result.status === 'PARTIAL' ? '#fbbf24' :
                      '#ef4444';

  return (
    <div style={{
      background: 'var(--panel)',
      borderRadius: '12px',
      padding: '24px',
      boxShadow: 'var(--shadow)',
      border: '1px solid var(--border)',
      marginTop: '20px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '20px' }}>
        <div>
          <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}>
            Ingestion Results
          </h3>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{
              padding: '4px 12px',
              background: `${statusColor}20`,
              color: statusColor,
              borderRadius: '12px',
              fontSize: '12px',
              fontWeight: '600',
            }}>
              {result.status}
            </span>
            {result.extraction_method && (
              <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                Method: {result.extraction_method}
              </span>
            )}
            {result.page_count > 0 && (
              <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                {result.page_count} page{result.page_count !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
        {result.run_id && (
          <button
            onClick={() => setShowDetails(!showDetails)}
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
            {showDetails ? 'Hide' : 'Show'} Details
          </button>
        )}
      </div>

      {/* Statistics Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '12px',
        marginBottom: '20px',
      }}>
        <div style={{
          padding: '12px',
          background: '#f0f9ff',
          borderRadius: '8px',
          border: '1px solid #bae6fd',
        }}>
          <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--accent)' }}>
            {result.concepts_created}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
            Concepts Created
          </div>
        </div>
        <div style={{
          padding: '12px',
          background: '#f0fdf4',
          borderRadius: '8px',
          border: '1px solid #bbf7d0',
        }}>
          <div style={{ fontSize: '24px', fontWeight: '700', color: '#22c55e' }}>
            {result.links_created}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
            Relationships
          </div>
        </div>
        <div style={{
          padding: '12px',
          background: '#fef3c7',
          borderRadius: '8px',
          border: '1px solid #fde68a',
        }}>
          <div style={{ fontSize: '24px', fontWeight: '700', color: '#f59e0b' }}>
            {result.chunks_created}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
            Chunks Created
          </div>
        </div>
        <div style={{
          padding: '12px',
          background: '#fce7f3',
          borderRadius: '8px',
          border: '1px solid #fbcfe8',
        }}>
          <div style={{ fontSize: '24px', fontWeight: '700', color: '#ec4899' }}>
            {result.claims_created}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
            Claims Created
          </div>
        </div>
      </div>

      {/* Warnings and Errors */}
      {result.warnings.length > 0 && (
        <div style={{
          padding: '12px',
          background: '#fef3c7',
          border: '1px solid #fde68a',
          borderRadius: '8px',
          marginBottom: '12px',
        }}>
          <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '8px', color: '#92400e' }}>
            Warnings ({result.warnings.length})
          </div>
          <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: '#78350f' }}>
            {result.warnings.slice(0, 5).map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {result.errors.length > 0 && (
        <div style={{
          padding: '12px',
          background: '#fee',
          border: '1px solid #fcc',
          borderRadius: '8px',
          marginBottom: '12px',
        }}>
          <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '8px', color: '#991b1b' }}>
            Errors ({result.errors.length})
          </div>
          <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: '#7f1d1d' }}>
            {result.errors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Created Concepts Details */}
      {showDetails && result.run_id && (
        <div style={{
          marginTop: '20px',
          padding: '16px',
          background: '#f9fafb',
          borderRadius: '8px',
          border: '1px solid var(--border)',
        }}>
          {loadingChanges ? (
            <div style={{ textAlign: 'center', padding: '20px' }}>
              <div style={{ fontSize: '14px', color: 'var(--muted)' }}>Loading extraction details...</div>
            </div>
          ) : runChanges ? (
            <div>
              {runChanges.concepts_created.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '8px' }}>
                    Extracted Concepts ({runChanges.concepts_created.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '300px', overflowY: 'auto' }}>
                    {runChanges.concepts_created.map((concept) => (
                      <Link
                        key={concept.concept_id}
                        href={`/concepts/${concept.concept_id}`}
                        style={{
                          padding: '8px 12px',
                          background: 'white',
                          borderRadius: '6px',
                          border: '1px solid var(--border)',
                          textDecoration: 'none',
                          color: 'var(--accent)',
                          fontSize: '13px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ fontWeight: '500' }}>{concept.name}</span>
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '200px', overflowY: 'auto' }}>
                    {runChanges.concepts_updated.map((concept) => (
                      <Link
                        key={concept.concept_id}
                        href={`/concepts/${concept.concept_id}`}
                        style={{
                          padding: '8px 12px',
                          background: 'white',
                          borderRadius: '6px',
                          border: '1px solid var(--border)',
                          textDecoration: 'none',
                          color: 'var(--accent)',
                          fontSize: '13px',
                        }}
                      >
                        {concept.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: '13px', color: 'var(--muted)', textAlign: 'center' }}>
              No extraction details available
            </div>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: '12px', marginTop: '20px', flexWrap: 'wrap' }}>
        {result.run_id && (
          <Link
            href={`/?highlight_run_id=${encodeURIComponent(result.run_id)}`}
            style={{
              padding: '10px 20px',
              background: 'var(--accent)',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '500',
            }}
          >
            View in Graph
          </Link>
        )}
        {onViewInGraph && (
          <button
            onClick={onViewInGraph}
            style={{
              padding: '10px 20px',
              background: 'transparent',
              color: 'var(--accent)',
              border: '1px solid var(--accent)',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer',
            }}
          >
            Explore Graph
          </button>
        )}
        {result.run_id && (
          <Link
            href={`/ingest`}
            style={{
              padding: '10px 20px',
              background: 'transparent',
              color: 'var(--muted)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '500',
              textDecoration: 'none',
            }}
          >
            View All Ingestion Runs
          </Link>
        )}
      </div>
    </div>
  );
}
