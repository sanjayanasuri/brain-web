"use client";

import GraphVisualization from "../components/graph/GraphVisualization";
import { BranchProvider } from "../contexts/BranchContext";

export default function ExplorerPage() {
    return (
        <BranchProvider>
            <GraphVisualization />
        </BranchProvider>
    );
}
