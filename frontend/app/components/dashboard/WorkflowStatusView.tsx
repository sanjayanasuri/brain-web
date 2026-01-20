'use client';

import { useState, useEffect } from 'react';
import { getWorkflowStatus, type WorkflowStatusResponse, type WorkflowStatus } from '../../api-client';

export default function WorkflowStatusView() {
  const [status, setStatus] = useState<WorkflowStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStatus();
  }, []);

  async function loadStatus() {
    try {
      setLoading(true);
      setError(null);
      const response = await getWorkflowStatus();
      setStatus(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workflow status');
    } finally {
      setLoading(false);
    }
  }

  function WorkflowCard({ title, workflow }: { title: string; workflow: WorkflowStatus }) {
    return (
      <div style={{
        padding: '16px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>{title}</h3>
          <div style={{
            padding: '4px 8px',
            borderRadius: '4px',
            background: workflow.available ? '#dcfce7' : '#fee2e2',
            color: workflow.available ? '#166534' : '#991b1b',
            fontSize: '11px',
            fontWeight: '600',
          }}>
            {workflow.available ? 'Available' : 'Unavailable'}
          </div>
        </div>
        <div style={{ marginBottom: '8px' }}>
          <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>
            Graph: <span style={{ color: 'var(--ink)' }}>{workflow.graph_id}</span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
            Branch: <span style={{ color: 'var(--ink)' }}>{workflow.branch_id}</span>
          </div>
        </div>
        <div style={{ marginTop: '12px' }}>
          <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '6px' }}>Types:</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {workflow.types.map((type) => (
              <span
                key={type}
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  background: 'var(--panel)',
                  border: '1px solid var(--border)',
                  fontSize: '11px',
                  color: 'var(--ink)',
                }}
              >
                {type}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--panel)',
      border: '1px solid var(--border)',
      borderRadius: '12px',
      padding: '20px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', margin: 0 }}>Workflow Status</h2>
        <button
          onClick={loadStatus}
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
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)' }}>Loading workflow status...</div>
      ) : status ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <WorkflowCard title="Capture" workflow={status.capture} />
          <WorkflowCard title="Explore" workflow={status.explore} />
          <WorkflowCard title="Synthesize" workflow={status.synthesize} />
        </div>
      ) : (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)' }}>No workflow status available</div>
      )}
    </div>
  );
}
