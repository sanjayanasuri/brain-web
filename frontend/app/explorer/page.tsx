'use client';

import dynamic from 'next/dynamic';
import { BranchProvider } from '../components/chat/BranchContext';

const GraphVisualization = dynamic(
  () => import('../components/graph/GraphVisualization'),
  { ssr: false, loading: () => <div data-testid="explorer-loading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--muted)' }}>Loading graph…</div> }
);

/**
 * Explorer Page
 * This is the main graph visualization view.
 */
export default function ExplorerPage() {
    return (
        <BranchProvider>
            <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--border)',
                    background: 'var(--panel)',
                }}>
                    <div>
                        <div style={{ fontSize: 16, fontWeight: 700 }}>Explorer Pro</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Map concepts, inspect links, and branch your thinking.</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => window.location.assign('/home')} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 12 }}>Home</button>
                        <button onClick={() => window.location.assign('/profile-customization')} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 12 }}>Personalize</button>
                    </div>
                </div>
                <div style={{ flex: 1, minHeight: 0 }}>
                    <GraphVisualization />
                </div>
            </div>
        </BranchProvider>
    );
}
