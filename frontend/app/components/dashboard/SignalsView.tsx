'use client';

import { useState, useEffect } from 'react';
import { listSignals, type Signal, type SignalType } from '../../api-client';

export default function SignalsView() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<{
    signal_type?: SignalType;
    limit: number;
    offset: number;
  }>({
    limit: 50,
    offset: 0,
  });

  useEffect(() => {
    loadSignals();
  }, [filter]);

  async function loadSignals() {
    try {
      setLoading(true);
      setError(null);
      const response = await listSignals({
        signal_type: filter.signal_type,
        limit: filter.limit,
        offset: filter.offset,
      });
      setSignals(response.signals);
      setTotal(response.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load signals');
    } finally {
      setLoading(false);
    }
  }

  function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleString();
  }

  function formatSignalType(type: SignalType): string {
    return type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
  }

  return (
    <div style={{
      background: 'var(--panel)',
      border: '1px solid var(--border)',
      borderRadius: '12px',
      padding: '20px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', margin: 0 }}>Signals</h2>
        <div style={{ fontSize: '13px', color: 'var(--muted)' }}>
          {total} total
        </div>
      </div>

      <div style={{ marginBottom: '16px', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <select
          value={filter.signal_type || ''}
          onChange={(e) => setFilter({ ...filter, signal_type: e.target.value as SignalType || undefined, offset: 0 })}
          style={{
            padding: '6px 12px',
            borderRadius: '6px',
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            fontSize: '13px',
            color: 'var(--ink)',
          }}
        >
          <option value="">All types</option>
          <option value="TEXT_AUTHORING">Text Authoring</option>
          <option value="SPAN_LINK">Span Link</option>
          <option value="EMPHASIS">Emphasis</option>
          <option value="FILE_INGESTION">File Ingestion</option>
          <option value="VOICE_CAPTURE">Voice Capture</option>
          <option value="VOICE_COMMAND">Voice Command</option>
          <option value="QUESTION">Question</option>
          <option value="TIME">Time</option>
          <option value="ASSESSMENT">Assessment</option>
        </select>
        <button
          onClick={loadSignals}
          style={{
            padding: '6px 12px',
            borderRadius: '6px',
            border: '1px solid var(--border)',
            background: 'var(--accent)',
            color: 'white',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div style={{ padding: '12px', background: '#fee2e2', color: '#991b1b', borderRadius: '6px', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)' }}>Loading signals...</div>
      ) : signals.length === 0 ? (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)' }}>No signals found</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '500px', overflowY: 'auto' }}>
          {signals.map((signal) => (
            <div
              key={signal.signal_id}
              style={{
                padding: '12px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                fontSize: '13px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '8px' }}>
                <div style={{ fontWeight: '600', color: 'var(--ink)' }}>
                  {formatSignalType(signal.signal_type)}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                  {formatTimestamp(signal.timestamp)}
                </div>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>
                ID: {signal.signal_id.substring(0, 8)}...
              </div>
              {signal.concept_id && (
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                  Concept: {signal.concept_id.substring(0, 8)}...
                </div>
              )}
              {signal.document_id && (
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                  Document: {signal.document_id.substring(0, 8)}...
                </div>
              )}
              {Object.keys(signal.payload).length > 0 && (
                <details style={{ marginTop: '8px' }}>
                  <summary style={{ fontSize: '12px', color: 'var(--accent)', cursor: 'pointer' }}>
                    Payload
                  </summary>
                  <pre style={{
                    marginTop: '8px',
                    padding: '8px',
                    background: 'var(--panel)',
                    borderRadius: '4px',
                    fontSize: '11px',
                    overflow: 'auto',
                    maxHeight: '150px',
                  }}>
                    {JSON.stringify(signal.payload, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && signals.length > 0 && (
        <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            onClick={() => setFilter({ ...filter, offset: Math.max(0, filter.offset - filter.limit) })}
            disabled={filter.offset === 0}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              background: filter.offset === 0 ? 'var(--panel)' : 'var(--surface)',
              color: filter.offset === 0 ? 'var(--muted)' : 'var(--ink)',
              fontSize: '13px',
              cursor: filter.offset === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            Previous
          </button>
          <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
            Showing {filter.offset + 1}-{Math.min(filter.offset + filter.limit, total)} of {total}
          </div>
          <button
            onClick={() => setFilter({ ...filter, offset: filter.offset + filter.limit })}
            disabled={filter.offset + filter.limit >= total}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              background: filter.offset + filter.limit >= total ? 'var(--panel)' : 'var(--surface)',
              color: filter.offset + filter.limit >= total ? 'var(--muted)' : 'var(--ink)',
              fontSize: '13px',
              cursor: filter.offset + filter.limit >= total ? 'not-allowed' : 'pointer',
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
