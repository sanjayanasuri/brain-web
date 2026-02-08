'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import {
    listGraphs,
    listBranches,
    getFocusAreas,
    getGraphOverview,
    Concept,
    GraphData
} from '../../../api-client';
import { useGraph } from '../GraphContext';
import { VisualNode, VisualLink, VisualGraph, TempNode } from '../GraphTypes';
import { useGraphFilters } from './useGraphFilters';
import { useUI } from './useUIState';
import { DOMAIN_PALETTE } from '../GraphUtils';
import { getLastSession } from '../../../lib/sessionState';

export function useGraphData() {
    const searchParams = useSearchParams();
    const graph = useGraph();
    const {
        graphData,
        setGraphData,
        activeGraphId,
        setActiveGraphId,
        setGraphs,
        setBranches,
        setActiveBranchId,
        setFocusAreas,
        setLoading,
        setError,
        setOverviewMeta,
        selectedDomains,
        collapsedGroups,
        tempNodes
    } = graph;

    const filters = useGraphFilters();
    const ui = useUI();

    const neighborCacheRef = useRef<Map<string, { nodes: Concept[]; edges: any[] }>>(new Map());

    const convertGraphData = useCallback(
        (data: GraphData, temps: TempNode[]): VisualGraph => {
            const nodes: VisualNode[] = new Array(data.nodes.length + temps.length);
            let idx = 0;

            const hasLinks = data.links.length > 0;
            const centerX = typeof window !== 'undefined' ? window.innerWidth / 2 : 400;
            const centerY = typeof window !== 'undefined' ? window.innerHeight / 2 : 300;

            for (let i = 0; i < data.nodes.length; i++) {
                const node = data.nodes[i];
                const nodeData: VisualNode = {
                    ...node,
                    domain: node.domain || 'general',
                    type: node.type || 'concept',
                } as VisualNode;

                if (!hasLinks && ((nodeData as any).x === undefined || (nodeData as any).y === undefined)) {
                    const angle = (i / data.nodes.length) * Math.PI * 2;
                    const radius = 100;
                    (nodeData as any).x = centerX + Math.cos(angle) * radius;
                    (nodeData as any).y = centerY + Math.sin(angle) * radius;
                }

                nodes[idx++] = nodeData;
            }

            for (let i = 0; i < temps.length; i++) {
                nodes[idx++] = temps[i];
            }

            const nodeMap = new Map<string, VisualNode>();
            for (let i = 0; i < nodes.length; i++) {
                nodeMap.set(nodes[i].node_id, nodes[i]);
            }

            const links: VisualLink[] = [];
            const linkSet = new Set<string>();

            for (let i = 0; i < data.links.length; i++) {
                const link = data.links[i];
                const sourceId = typeof link.source === 'string' ? link.source : (link.source as any).node_id;
                const targetId = typeof link.target === 'string' ? link.target : (link.target as any).node_id;

                const linkKey = `${sourceId}-${targetId}-${link.predicate}`;
                if (linkSet.has(linkKey)) continue;
                linkSet.add(linkKey);

                const sourceNode = nodeMap.get(sourceId);
                const targetNode = nodeMap.get(targetId);
                if (!sourceNode || !targetNode) continue;

                let sourceType = (link as any).source_type;
                if (!sourceType && (link as any).relationship_source_id) {
                    const sourceId = (link as any).relationship_source_id;
                    if (sourceId.includes('SEC') || sourceId.includes('edgar')) {
                        sourceType = 'SEC';
                    } else if (sourceId.includes('IR') || sourceId.includes('investor')) {
                        sourceType = 'IR';
                    } else if (sourceId.includes('NEWS') || sourceId.includes('news')) {
                        sourceType = 'NEWS';
                    }
                }

                links.push({
                    source: sourceNode,
                    target: targetNode,
                    predicate: link.predicate,
                    relationship_status: (link as any).relationship_status,
                    relationship_confidence: (link as any).relationship_confidence,
                    relationship_method: (link as any).relationship_method,
                    source_type: sourceType,
                    rationale: (link as any).rationale,
                } as VisualLink);
            }

            return { nodes, links };
        },
        [],
    );

    const loadGraph = useCallback(async (graphId?: string) => {
        const targetGraphId = graphId || activeGraphId;
        setLoading(true);
        setError(null);
        try {
            const data = await getGraphOverview(targetGraphId, 200, 400);

            const convertedTempNodes: TempNode[] = tempNodes.map(temp => ({
                ...temp,
                node_id: temp.node_id,
                type: 'concept',
                temporary: true as const,
            }));
            const converted = convertGraphData(data, convertedTempNodes);

            requestAnimationFrame(() => {
                setGraphData(converted);
                setOverviewMeta(data.meta || null);
                setLoading(false);
            });

            neighborCacheRef.current.clear();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load graph');
            setLoading(false);
        }
    }, [convertGraphData, tempNodes, activeGraphId, setLoading, setError, setGraphData, setOverviewMeta]);

    const refreshGraphs = useCallback(async (preserveActiveGraph = true) => {
        try {
            const data = await listGraphs();
            setGraphs(data.graphs || []);
            if (!preserveActiveGraph) {
                const backendGraphId = data.active_graph_id;
                if (backendGraphId) {
                    const currentGraphId = activeGraphId || 'default';
                    if (backendGraphId !== 'demo' || currentGraphId === 'default') {
                        setActiveGraphId(backendGraphId);
                    }
                }
            }
            setActiveBranchId(data.active_branch_id || 'main');
            ui.actions.setGraphSwitchError(null);
        } catch (err) {
            ui.actions.setGraphSwitchError(err instanceof Error ? err.message : 'Failed to load graphs');
        }
    }, [activeGraphId, setGraphs, setActiveGraphId, setActiveBranchId, ui.actions]);

    const refreshBranches = useCallback(async () => {
        try {
            const data = await listBranches();
            setBranches(data.branches || []);
            setActiveBranchId(data.active_branch_id || 'main');
        } catch {
            // ignore
        }
    }, [setBranches, setActiveBranchId]);

    const refreshFocusAreas = useCallback(async () => {
        try {
            const areas = await getFocusAreas();
            setFocusAreas(areas || []);
        } catch {
            // ignore
        }
    }, [setFocusAreas]);

    const uniqueDomains = useMemo(() => {
        const set = new Set<string>();
        graphData.nodes.forEach(node => set.add(node.domain || 'general'));
        tempNodes.forEach(node => set.add(node.domain || 'general'));
        return Array.from(set);
    }, [graphData.nodes, tempNodes]);

    const domainColors = useMemo(() => {
        const map = new Map<string, string>();
        uniqueDomains.forEach((domain, idx) => {
            map.set(domain, DOMAIN_PALETTE[idx % DOMAIN_PALETTE.length]);
        });
        if (!map.has('general')) {
            map.set('general', '#6b7280');
        }
        return map;
    }, [uniqueDomains]);

    const filteredGraph = useMemo<VisualGraph>(() => {
        let filteredNodes = graphData.nodes;
        let filteredLinks = graphData.links;

        if (selectedDomains.size > 0) {
            filteredNodes = graphData.nodes.filter(n => selectedDomains.has(n.domain));
            const nodeIds = new Set(filteredNodes.map(n => n.node_id));
            filteredLinks = graphData.links.filter(
                l => {
                    const sourceId = typeof l.source === 'string' ? l.source : l.source.node_id;
                    const targetId = typeof l.target === 'string' ? l.target : l.target.node_id;
                    return nodeIds.has(sourceId) && nodeIds.has(targetId);
                },
            );
        }

        filteredLinks = filteredLinks.filter(link => {
            const status = link.relationship_status || 'ACCEPTED';
            if (status === 'ACCEPTED' && !filters.state.filterStatusAccepted) return false;
            if (status === 'PROPOSED' && !filters.state.filterStatusProposed) return false;
            if (status === 'REJECTED' && !filters.state.filterStatusRejected) return false;

            const confidence = link.relationship_confidence ?? 1.0;
            if (confidence < filters.state.filterConfidenceThreshold) return false;

            if (link.source_type && filters.state.filterSources.size > 0 && !filters.state.filterSources.has(link.source_type)) {
                return false;
            }

            return true;
        });

        const connectedNodeIds = new Set<string>();
        filteredLinks.forEach(link => {
            const sourceId = typeof link.source === 'string' ? link.source : link.source.node_id;
            const targetId = typeof link.target === 'string' ? link.target : link.target.node_id;
            connectedNodeIds.add(sourceId);
            connectedNodeIds.add(targetId);
        });

        if (filteredLinks.length === 0) {
            // return filteredNodes
        } else {
            const originalNodeIdsWithLinks = new Set<string>();
            graphData.links.forEach(link => {
                const sourceId = typeof link.source === 'string' ? link.source : link.source.node_id;
                const targetId = typeof link.target === 'string' ? link.target : link.target.node_id;
                originalNodeIdsWithLinks.add(sourceId);
                originalNodeIdsWithLinks.add(targetId);
            });

            filteredNodes = filteredNodes.filter(n =>
                connectedNodeIds.has(n.node_id) || !originalNodeIdsWithLinks.has(n.node_id)
            );
        }

        return { nodes: filteredNodes, links: filteredLinks };
    }, [graphData, selectedDomains, filters.state]);

    const { displayGraph, hiddenCounts } = useMemo(() => {
        const counts = new Map<string, number>();
        const hiddenIds = new Set<string>();

        Object.keys(collapsedGroups).forEach((rootId) => {
            const ids = collapsedGroups[rootId] || [];
            counts.set(rootId, ids.length);
            ids.forEach((id) => hiddenIds.add(id));
        });

        if (hiddenIds.size === 0) {
            return { displayGraph: filteredGraph, hiddenCounts: counts };
        }

        const keptNodes = filteredGraph.nodes.filter((n) => !hiddenIds.has(n.node_id));
        const keepIds = new Set<string>(keptNodes.map((n) => n.node_id));
        const keptLinks = filteredGraph.links.filter(
            (l) => {
                const sourceId = typeof l.source === 'string' ? l.source : l.source.node_id;
                const targetId = typeof l.target === 'string' ? l.target : l.target.node_id;
                return keepIds.has(sourceId) && keepIds.has(targetId);
            },
        );

        return { displayGraph: { nodes: keptNodes, links: keptLinks }, hiddenCounts: counts };
    }, [filteredGraph, collapsedGroups]);

    return useMemo(() => ({
        loadGraph,
        refreshGraphs,
        refreshBranches,
        refreshFocusAreas,
        displayGraph,
        filteredGraph,
        hiddenCounts,
        uniqueDomains,
        domainColors,
        neighborCacheRef
    }), [
        loadGraph,
        refreshGraphs,
        refreshBranches,
        refreshFocusAreas,
        displayGraph,
        filteredGraph,
        hiddenCounts,
        uniqueDomains,
        domainColors,
        neighborCacheRef
    ]);
}
