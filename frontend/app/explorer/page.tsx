'use client';

import GraphVisualization from '../components/graph/GraphVisualization';
import { BranchProvider } from '../components/chat/BranchContext';

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
