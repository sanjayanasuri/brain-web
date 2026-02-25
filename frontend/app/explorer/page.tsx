"use client";

import GraphVisualization from "../components/graph/GraphVisualization";
import { BranchProvider } from "../components/chat/BranchContext";

export default function ExplorerPage() {
    return (
        <BranchProvider>
            <GraphVisualization />
        </BranchProvider>
    );
}
