'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
// import OfflineControls from '@/app/components/OfflineControls';
import { getLastSession } from '../lib/sessionState';
import { getActiveTrailId } from '../lib/trailState';

export default function OfflineSettingsPage() {
  const router = useRouter();
  const [graphId, setGraphId] = useState<string>('');
  const [branchId, setBranchId] = useState<string>('main');
  const [trailId, setTrailId] = useState<string | undefined>(undefined);

  useEffect(() => {
    const lastSession = getLastSession();
    if (lastSession) {
      setGraphId(lastSession.graph_id || '');
      setBranchId(typeof window !== 'undefined'
        ? sessionStorage.getItem('brainweb:activeBranchId') || 'main'
        : 'main');
    }
    const activeTrail = getActiveTrailId();
    if (activeTrail) {
      setTrailId(activeTrail);
    }
  }, []);

  if (!graphId) {
    return (
      <div style={{ padding: '24px', textAlign: 'center' }}>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <button
          onClick={() => router.back()}
          style={{
            padding: '8px 16px',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            background: 'var(--bg)',
            cursor: 'pointer',
            marginBottom: '16px',
          }}
        >
          ← Back
        </button>
        <h1 style={{ fontSize: '24px', fontWeight: '600', marginBottom: '8px' }}>
          Offline Settings
        </h1>
        <p style={{ color: 'var(--muted)', marginBottom: '24px' }}>
          Manage offline caching and search preferences for your knowledge graph.
        </p>
      </div>

      <div style={{
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '24px',
        background: 'var(--panel)',
      }}>
        {/* <OfflineControls
          graph_id={graphId}
          branch_id={branchId}
          trail_id={trailId}
        /> */}
        <p style={{ textAlign: 'center', color: 'var(--muted)' }}>
          Offline Controls are currently unavailable.
        </p>
      </div>

      <div style={{ marginTop: '24px', padding: '16px', background: 'var(--panel)', borderRadius: '8px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '12px' }}>
          About Offline Mode
        </h2>
        <ul style={{ listStyle: 'disc', paddingLeft: '20px', color: 'var(--muted)', lineHeight: '1.6' }}>
          <li>Download artifacts, concepts, and trails for offline access</li>
          <li>Search cached content when offline or on slow connections</li>
          <li>Automatic sync of queued events when you come back online</li>
          <li>Cache validation ensures you have the latest data</li>
        </ul>
      </div>
    </div>
  );
}

