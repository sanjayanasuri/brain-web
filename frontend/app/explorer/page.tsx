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
                    boxShadow: 'var(--shadow)',
                }}>
                    <div>
                        <div style={{ fontSize: 16, fontWeight: 700 }}>Explorer</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Map concepts, inspect links, and branch your thinking.</div>
                    </div>
                    <AppTopNav />
                </div>
                <div style={{ flex: 1, minHeight: 0 }}>
                    <GraphVisualization />
                </div>
            </div>
        </BranchProvider>
    );
}
