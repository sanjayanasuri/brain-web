'use client';

import { useEffect, useMemo } from 'react';
import { useGraph } from '../GraphContext';
import { useUI } from './useUIState';
import { useChat } from './useChatState';

export function useGraphVisuals(
    recomputeDomainBubbles: () => void,
    updateSelectedPosition: (node?: any) => void,
    centerNodeInVisibleArea: (x: number, y: number, duration?: number) => void,
    graphRef: React.MutableRefObject<any>
) {
    const graph = useGraph();
    const {
        graphData,
        setGraphData,
        selectedNode,
        selectedDomains,
        highlightedConceptIds,
        highlightedRelationshipIds,
        focusedNodeId
    } = graph;
    const ui = useUI();
    const chat = useChat();

    // Degree and neighborhood
    const { degreeById, highDegreeThreshold, selectedNeighborhoodIds } = useMemo(() => {
        const degree = new Map<string, number>();
        graphData.links.forEach((l: any) => {
            const a = typeof l.source === 'string' ? l.source : l.source.node_id;
            const b = typeof l.target === 'string' ? l.target : l.target.node_id;
            degree.set(a, (degree.get(a) || 0) + 1);
            degree.set(b, (degree.get(b) || 0) + 1);
        });

        const values = Array.from(degree.values()).sort((a, b) => a - b);
        const p = values.length > 0 ? values[Math.floor(values.length * 0.9)] : 0;
        const threshold = Math.max(6, p || 0);

        const neighborhood = new Set<string>();
        if (selectedNode?.node_id) {
            neighborhood.add(selectedNode.node_id);
            graphData.links.forEach((l: any) => {
                const a = typeof l.source === 'string' ? l.source : l.source.node_id;
                const b = typeof l.target === 'string' ? l.target : l.target.node_id;
                if (a === selectedNode.node_id) neighborhood.add(b);
                if (b === selectedNode.node_id) neighborhood.add(a);
            });
        }

        return { degreeById: degree, highDegreeThreshold: threshold, selectedNeighborhoodIds: neighborhood };
    }, [graphData.links, selectedNode?.node_id]);

    // Recompute bubbles on changes
    useEffect(() => {
        const t = setTimeout(() => recomputeDomainBubbles(), 350);
        return () => clearTimeout(t);
    }, [graphData.nodes.length, selectedDomains.size, recomputeDomainBubbles]);

    // Handle focus mode zoom
    useEffect(() => {
        if (!ui.state.focusMode || !selectedNode?.node_id) return;
        const fg = graphRef.current;
        if (!fg) return;
        const data = typeof fg.graphData === 'function' ? fg.graphData() : (fg.graphData || graphData);
        const node = data?.nodes?.find((n: any) => n.node_id === selectedNode.node_id);
        if (node && typeof node.x === 'number') {
            const z = typeof fg.zoom === 'function' ? fg.zoom() : 1;
            const target = Math.max(2.2, Math.min(4.0, z * 1.15));
            centerNodeInVisibleArea(node.x, node.y, 550);
            fg.zoom(target, 550);
        }
    }, [ui.state.focusMode, selectedNode?.node_id, centerNodeInVisibleArea, graphRef]);

    // Handle explicit focusedNodeId (e.g. from Study Panel)
    useEffect(() => {
        if (!focusedNodeId) return;
        const fg = graphRef.current;
        if (!fg) return;

        const data = typeof fg.graphData === 'function' ? fg.graphData() : (fg.graphData || graphData);
        const node = data?.nodes?.find((n: any) => n.node_id === focusedNodeId);

        if (node && typeof node.x === 'number') {
            // centerNodeInVisibleArea(node.x, node.y, 1000);
            // Use direct centerAt for now to be safe, assuming centerNodeInVisibleArea might have offset logic
            fg.centerAt(node.x, node.y, 1000);

            const z = typeof fg.zoom === 'function' ? fg.zoom() : 1;
            if (z < 2) {
                fg.zoom(2, 1000);
            }
        }
    }, [focusedNodeId, graphRef]);

    // Apply highlights to graph data
    useEffect(() => {
        setGraphData(prev => {
            const hasHighlights = highlightedConceptIds.size > 0 || highlightedRelationshipIds.size > 0;
            return {
                ...prev,
                nodes: prev.nodes.map((n: any) => ({
                    ...n,
                    __highlighted: highlightedConceptIds.has(n.node_id),
                })),
                links: prev.links.map((l: any) => {
                    const srcId = typeof l.source === 'object' ? l.source.node_id : l.source;
                    const tgtId = typeof l.target === 'object' ? l.target.node_id : l.target;
                    const linkKey = `${srcId}-${tgtId}-${l.predicate}`;
                    return {
                        ...l,
                        __highlighted: highlightedRelationshipIds.has(linkKey),
                    };
                }),
            };
        });
    }, [highlightedConceptIds.size, highlightedRelationshipIds.size, setGraphData]);

    return useMemo(() => ({ degreeById, highDegreeThreshold, selectedNeighborhoodIds }), [degreeById, highDegreeThreshold, selectedNeighborhoodIds]);
}
