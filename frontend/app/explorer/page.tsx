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
            <GraphVisualization />
        </BranchProvider>
    );
}
