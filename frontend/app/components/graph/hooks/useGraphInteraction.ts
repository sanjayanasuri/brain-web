'use client';

import { useCallback } from 'react';
import { useGraph } from '../GraphContext';
import { VisualNode, VisualGraph } from '../GraphTypes';
import { useUIState } from './useUIState';
import { Concept, getGraphNeighbors, selectGraph, createConcept } from '../../../api-client';

export function useGraphInteraction(
    graphRef: React.MutableRefObject<any>,
    graphCanvasRef: React.MutableRefObject<HTMLDivElement | null>,
    neighborCacheRef: React.MutableRefObject<Map<string, { nodes: Concept[]; edges: any[] }>>,
    loadingNeighborsRef: React.MutableRefObject<string | null>,
    domainColors: Map<string, string>
) {
    const graph = useGraph();
    const {
        graphData,
        setGraphData,
        selectedNode,
        setSelectedDomains,
        activeGraphId,
        setLoadingNeighbors,
        setDomainBubbles
    } = graph;

    const ui = useUIState();

    const normalize = useCallback((name: string) => name.trim().toLowerCase(), []);

    const findLocalConcept = useCallback(
        (name: string) => {
            const target = normalize(name);
            return graphData.nodes.find(n => normalize(n.name) === target) || null;
        },
        [graphData.nodes, normalize],
    );

    const resolveConceptByName = useCallback(
        async (name: string) => {
            const local = findLocalConcept(name);
            if (local) return local;
            try {
                const api = await import('../../../api-client');
                return await api.getConceptByName(name);
            } catch (err) {
                throw new Error(`Concept "${name}" not found`);
            }
        },
        [findLocalConcept],
    );

    const revealDomain = useCallback(
        (domain?: string) => {
            if (!domain) return;
            setSelectedDomains(prev => {
                if (prev.size === 0 || prev.has(domain)) return prev;
                return new Set([domain]);
            });
        },
        [setSelectedDomains],
    );

    const expandNeighbors = useCallback(async (conceptId: string) => {
        const cacheKey = `${activeGraphId}:${conceptId}:1`;
        const cached = neighborCacheRef.current.get(cacheKey);
        if (cached) {
            setGraphData((prev: VisualGraph): VisualGraph => {
                const existingNodeIds = new Set(prev.nodes.map(n => n.node_id));
                const existingEdgeKeys = new Set(
                    prev.links.map(l => {
                        const sourceId = typeof l.source === 'string' ? l.source : l.source.node_id;
                        const targetId = typeof l.target === 'string' ? l.target : l.target.node_id;
                        return `${sourceId}->${targetId}:${l.predicate}`;
                    })
                );

                const newNodes = cached.nodes.filter(n => !existingNodeIds.has(n.node_id));
                const newLinks = cached.edges
                    .map(e => {
                        const sourceNode = prev.nodes.find(n => n.node_id === e.source_id) || cached.nodes.find(n => n.node_id === e.source_id);
                        const targetNode = prev.nodes.find(n => n.node_id === e.target_id) || cached.nodes.find(n => n.node_id === e.target_id);
                        if (!sourceNode || !targetNode) return null;
                        const edgeKey = `${e.source_id}->${e.target_id}:${e.predicate}`;
                        if (existingEdgeKeys.has(edgeKey)) return null;
                        return {
                            source: sourceNode,
                            target: targetNode,
                            predicate: e.predicate,
                            relationship_status: e.status,
                            relationship_confidence: e.confidence,
                            relationship_method: e.method,
                            rationale: e.rationale,
                            relationship_source_id: e.relationship_source_id,
                            relationship_chunk_id: e.chunk_id,
                        } as any;
                    })
                    .filter((link): link is any => link !== null);

                if (newNodes.length === 0 && newLinks.length === 0) return prev;

                return {
                    nodes: [...prev.nodes, ...newNodes],
                    links: [...prev.links, ...newLinks],
                } as VisualGraph;
            });
            return;
        }

        loadingNeighborsRef.current = conceptId;
        setLoadingNeighbors(conceptId);
        const timeoutId = setTimeout(() => {
            if (loadingNeighborsRef.current === conceptId) {
                loadingNeighborsRef.current = null;
                setLoadingNeighbors(null);
            }
        }, 10000);

        try {
            const result = await getGraphNeighbors(activeGraphId, conceptId, 1, 80);

            if (loadingNeighborsRef.current === conceptId) {
                neighborCacheRef.current.set(cacheKey, {
                    nodes: result.nodes,
                    edges: result.edges,
                });

                setGraphData(prev => {
                    const existingNodeIds = new Set(prev.nodes.map(n => n.node_id));
                    const existingEdgeKeys = new Set(
                        prev.links.map(l => {
                            const sourceId = typeof l.source === 'string' ? l.source : l.source.node_id;
                            const targetId = typeof l.target === 'string' ? l.target : l.target.node_id;
                            return `${sourceId}->${targetId}:${l.predicate}`;
                        })
                    );

                    const newNodes = result.nodes.filter(n => !existingNodeIds.has(n.node_id));
                    const newLinks = result.edges
                        .map(e => {
                            const sourceNode = prev.nodes.find(n => n.node_id === e.source_id) || result.nodes.find(n => n.node_id === e.source_id);
                            const targetNode = prev.nodes.find(n => n.node_id === e.target_id) || result.nodes.find(n => n.node_id === e.target_id);
                            if (!sourceNode || !targetNode) return null;
                            const edgeKey = `${e.source_id}->${e.target_id}:${e.predicate}`;
                            if (existingEdgeKeys.has(edgeKey)) return null;
                            return {
                                source: sourceNode,
                                target: targetNode,
                                predicate: e.predicate,
                                relationship_status: e.status,
                                relationship_confidence: e.confidence,
                                relationship_method: e.method,
                                rationale: e.rationale,
                                relationship_source_id: e.relationship_source_id,
                                relationship_chunk_id: e.chunk_id,
                            } as any;
                        })
                        .filter((link): link is any => link !== null);

                    if (newNodes.length === 0 && newLinks.length === 0) return prev;

                    return {
                        nodes: [...prev.nodes, ...newNodes],
                        links: [...prev.links, ...newLinks],
                    };
                });
            }
        } catch (err) {
            console.error('Failed to expand neighbors:', err);
        } finally {
            clearTimeout(timeoutId);
            if (loadingNeighborsRef.current === conceptId) {
                loadingNeighborsRef.current = null;
                setLoadingNeighbors(null);
            }
        }
    }, [activeGraphId, setGraphData, setLoadingNeighbors, neighborCacheRef, loadingNeighborsRef]);

    const centerNodeInVisibleArea = useCallback((nodeX: number, nodeY: number, duration: number = 500, assumePanelOpen: boolean = false) => {
        if (!graphRef.current || !graphCanvasRef.current) return;

        const panelIsOpen = assumePanelOpen || !!selectedNode;
        const panelWidth = panelIsOpen ? (ui.state.focusMode ? 400 : 380) : 0;

        const canvasRect = graphCanvasRef.current.getBoundingClientRect();
        const currentZoom = typeof graphRef.current.zoom === 'function' ? graphRef.current.zoom() : 1;

        const pixelOffset = panelWidth / 2;
        const graphOffset = pixelOffset / currentZoom;

        const adjustedX = nodeX - graphOffset;

        graphRef.current.centerAt(adjustedX, nodeY, duration);
    }, [selectedNode, ui.state.focusMode, graphRef, graphCanvasRef]);

    const updateSelectedPosition = useCallback(
        (node?: any) => {
            const target = node || selectedNode;
            if (!target || !graphRef.current) {
                if (target && typeof window !== 'undefined') {
                    ui.actions.setSelectedPosition({
                        x: window.innerWidth - 420,
                        y: window.innerHeight / 2
                    });
                }
                return;
            }
            const data = graphRef.current.graphData();
            const actualNode = data.nodes.find((n: any) => n.node_id === target.node_id);
            if (!actualNode || typeof actualNode.x !== 'number' || typeof actualNode.y !== 'number') {
                if (typeof window !== 'undefined') {
                    ui.actions.setSelectedPosition({
                        x: window.innerWidth - 380,
                        y: window.innerHeight / 2
                    });
                }
                return;
            }
            try {
                const coords = graphRef.current.graph2ScreenCoords?.(actualNode.x, actualNode.y);
                if (coords && typeof coords.x === 'number' && typeof coords.y === 'number') {
                    ui.actions.setSelectedPosition({ x: coords.x, y: coords.y });
                } else {
                    if (typeof window !== 'undefined') {
                        ui.actions.setSelectedPosition({
                            x: window.innerWidth - 380,
                            y: window.innerHeight / 2
                        });
                    }
                }
            } catch (err) {
                if (typeof window !== 'undefined') {
                    ui.actions.setSelectedPosition({
                        x: window.innerWidth - 380,
                        y: window.innerHeight / 2
                    });
                }
            }
        },
        [selectedNode, ui.actions, graphRef],
    );

    const ensureConcept = useCallback(
        async (name: string, inherit?: { domain?: string; type?: string }) => {
            try {
                return await resolveConceptByName(name);
            } catch {
                await selectGraph(activeGraphId);

                const concept = await createConcept({
                    graph_id: activeGraphId,
                    name,
                    domain: inherit?.domain || 'general',
                    type: inherit?.type || 'concept',
                });
                return concept;
            }
        },
        [resolveConceptByName, activeGraphId],
    );

    const computeCollapseIds = useCallback(
        (rootId: string, depth: number, graph: VisualGraph) => {
            const adj = new Map<string, string[]>();
            graph.links.forEach((l) => {
                const a = typeof l.source === 'string' ? l.source : l.source.node_id;
                const b = typeof l.target === 'string' ? l.target : l.target.node_id;
                if (!adj.has(a)) adj.set(a, []);
                if (!adj.has(b)) adj.set(b, []);
                adj.get(a)!.push(b);
                adj.get(b)!.push(a);
            });

            const visited = new Set<string>();
            visited.add(rootId);
            const queue: Array<{ id: string; d: number }> = [{ id: rootId, d: 0 }];
            const hidden: string[] = [];

            while (queue.length > 0) {
                const cur = queue.shift()!;
                if (cur.d >= depth) continue;
                const nbrs = adj.get(cur.id) || [];
                for (let i = 0; i < nbrs.length; i += 1) {
                    const nb = nbrs[i];
                    if (visited.has(nb)) continue;
                    visited.add(nb);
                    hidden.push(nb);
                    queue.push({ id: nb, d: cur.d + 1 });
                }
            }

            return hidden;
        },
        [],
    );

    const recomputeDomainBubbles = useCallback(() => {
        const fg = graphRef.current;
        if (!fg) return;
        const data = fg.getGraphData ? fg.getGraphData() : fg.graphData();
        const nodes: any[] = data?.nodes || [];
        const groups = new Map<string, { sumX: number; sumY: number; count: number }>();

        nodes.forEach((n) => {
            if (!n || typeof n.x !== 'number' || typeof n.y !== 'number') return;
            const domain = String(n.domain || 'general');
            const g = groups.get(domain) || { sumX: 0, sumY: 0, count: 0 };
            g.sumX += n.x;
            g.sumY += n.y;
            g.count += 1;
            groups.set(domain, g);
        });

        const bubbles: any[] = [];
        groups.forEach((g, domain) => {
            if (g.count < 5) return;
            const x = g.sumX / g.count;
            const y = g.sumY / g.count;
            const color = domainColors.get(domain) || '#94a3b8';
            const r = Math.max(120, 70 + Math.sqrt(g.count) * 55);
            bubbles.push({ domain, x, y, r, radius: r, color, count: g.count });
        });

        setDomainBubbles(bubbles);
    }, [domainColors, setDomainBubbles, graphRef]);

    return {
        normalize,
        findLocalConcept,
        resolveConceptByName,
        revealDomain,
        expandNeighbors,
        centerNodeInVisibleArea,
        updateSelectedPosition,
        ensureConcept,
        computeCollapseIds,
        recomputeDomainBubbles
    };
}
