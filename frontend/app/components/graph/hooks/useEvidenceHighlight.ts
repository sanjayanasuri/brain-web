'use client';

import { useCallback, useMemo } from 'react';
import { useGraph } from '../GraphContext';
import { useChat } from './useChatState';
import { useUI } from './useUIState';
import { EvidenceItem } from '../../../types/evidence';

export function useEvidenceHighlight(
    graphRef: React.MutableRefObject<any>,
    expandNeighbors: (conceptId: string) => Promise<void>,
    revealDomain: (domain?: string) => void,
    centerNodeInVisibleArea: (x: number, y: number, duration?: number) => void
) {
    const graph = useGraph();
    const { graphData, setExpandedNodes } = graph;
    const chat = useChat();
    const ui = useUI();

    const clearEvidenceHighlight = useCallback(() => {
        chat.actions.setShowingEvidence(false);
        chat.actions.setEvidenceNodeIds(new Set());
        chat.actions.setEvidenceLinkIds(new Set());
        chat.actions.setActiveEvidenceSectionId(null);
        if (graphRef.current?.refresh) {
            graphRef.current.refresh();
        }
    }, [chat.actions, graphRef]);

    const applyEvidenceHighlight = useCallback(async (
        evidenceItems: EvidenceItem[],
        retrievalMeta: any
    ) => {
        if (!evidenceItems || evidenceItems.length === 0) {
            return;
        }

        if (retrievalMeta?.claimIds && retrievalMeta.claimIds.length > 0) {
            try {
                const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
                const { listGraphs } = await import('../../../api-client');
                const graphs = await listGraphs();
                const graphId = graphs.active_graph_id || 'demo';

                const response = await fetch(`${apiBaseUrl}/ai/evidence-subgraph`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        graph_id: graphId,
                        claim_ids: retrievalMeta.claimIds,
                        limit_nodes: 10,
                        limit_edges: 15,
                    }),
                });

                if (response.ok) {
                    const data = await response.json();
                    const nodeIds = new Set<string>((data.concepts || []).map((c: any) => c.node_id as string));
                    const linkIds = new Set<string>((data.edges || []).map((e: any) =>
                        `${e.source_id}-${e.target_id}-${e.predicate}` as string
                    ));

                    chat.actions.setEvidenceNodeIds(nodeIds);
                    chat.actions.setEvidenceLinkIds(linkIds);
                    chat.actions.setShowingEvidence(true);

                    nodeIds.forEach(nodeId => {
                        const node = graphData.nodes.find(n => n.node_id === nodeId);
                        if (node) {
                            revealDomain(node.domain);
                            setExpandedNodes(prev => new Set<string>([...Array.from(prev), nodeId]));
                        }
                    });

                    if (graphRef.current?.refresh) {
                        graphRef.current.refresh();
                    }
                    return;
                }
            } catch (err) {
                console.error('Failed to fetch evidence subgraph:', err);
            }
        }

        const conceptIds = new Set<string>(
            evidenceItems
                .map(item => item.concept_id)
                .filter((id): id is string => !!id)
        );

        if (conceptIds.size === 0) {
            return;
        }

        const nodeIds = new Set<string>();
        const linkIds = new Set<string>();

        const missingConceptIds: string[] = [];
        conceptIds.forEach(conceptId => {
            const node = graphData.nodes.find((n: any) => n.node_id === conceptId);
            if (node) {
                nodeIds.add(node.node_id);
            } else {
                missingConceptIds.push(conceptId);
            }
        });

        for (const conceptId of missingConceptIds) {
            try {
                await expandNeighbors(conceptId);
                const node = graphData.nodes.find((n: any) => n.node_id === conceptId);
                if (node) {
                    nodeIds.add(node.node_id);
                }
            } catch (err) {
                console.warn('Failed to expand neighbors for evidence concept:', conceptId, err);
            }
        }

        if (nodeIds.size > 0) {
            graphData.links.forEach(link => {
                const srcId = typeof link.source === 'object' && link.source ? link.source.node_id : String(link.source ?? '');
                const tgtId = typeof link.target === 'object' && link.target ? link.target.node_id : String(link.target ?? '');

                if (nodeIds.has(srcId) || nodeIds.has(tgtId)) {
                    const linkKey = `${srcId}-${tgtId}-${link.predicate}`;
                    linkIds.add(linkKey);
                }
            });

            chat.actions.setEvidenceNodeIds(nodeIds);
            chat.actions.setEvidenceLinkIds(linkIds);
            chat.actions.setShowingEvidence(true);

            nodeIds.forEach(nodeId => {
                const node = graphData.nodes.find((n: any) => n.node_id === nodeId);
                if (node) {
                    revealDomain(node.domain);
                    setExpandedNodes(prev => new Set<string>([...Array.from(prev), nodeId]));
                }
            });

            if (graphRef.current?.refresh) {
                graphRef.current.refresh();
            }
        }
    }, [graphData.nodes, graphData.links, revealDomain, expandNeighbors, chat.actions, setExpandedNodes, graphRef]);

    const applyEvidenceHighlightWithRetry = useCallback(async (
        evidenceItems: EvidenceItem[],
        retrievalMeta: any,
        maxRetries: number = 10,
        delayMs: number = 100
    ) => {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            if (graphData.nodes.length > 0) {
                await applyEvidenceHighlight(evidenceItems, retrievalMeta);
                return;
            }
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        await applyEvidenceHighlight(evidenceItems, retrievalMeta);
    }, [graphData.nodes.length, applyEvidenceHighlight]);

    const applySectionEvidenceHighlight = useCallback(async (
        sectionId: string,
        sectionEvidenceIds: string[],
        allEvidence: EvidenceItem[],
        retrievalMeta: any
    ) => {
        const sectionEvidence = allEvidence.filter(e =>
            sectionEvidenceIds.includes(e.resource_id || '') ||
            sectionEvidenceIds.includes(e.id || '') ||
            sectionEvidenceIds.includes(`evidence-${e.id}`)
        );

        if (sectionEvidence.length === 0) {
            return;
        }

        chat.actions.setActiveEvidenceSectionId(sectionId);
        await applyEvidenceHighlight(sectionEvidence, retrievalMeta);

        if (graphRef.current && sectionEvidence.length > 0) {
            const conceptIds = new Set<string>(
                sectionEvidence
                    .map(item => item.concept_id)
                    .filter((id): id is string => !!id)
            );

            if (conceptIds.size > 0) {
                const nodes = graphData.nodes.filter((n: any) => conceptIds.has(n.node_id));
                if (nodes.length > 0) {
                    const centerX = nodes.reduce((sum, n) => sum + ((n as any).x || 0), 0) / nodes.length;
                    const centerY = nodes.reduce((sum, n) => sum + ((n as any).y || 0), 0) / nodes.length;

                    const currentZoom = ui.state.zoomTransform?.k || ui.state.zoomLevel || 1;
                    if (currentZoom < 1.5) {
                        graphRef.current.zoomToFit(400, 50);
                    } else {
                        centerNodeInVisibleArea(centerX, centerY, 400);
                    }
                }
            }
        }
    }, [applyEvidenceHighlight, graphData.nodes, ui.state.zoomTransform, ui.state.zoomLevel, centerNodeInVisibleArea, chat.actions, graphRef]);

    return useMemo(() => ({
        clearEvidenceHighlight,
        applyEvidenceHighlight,
        applyEvidenceHighlightWithRetry,
        applySectionEvidenceHighlight
    }), [
        clearEvidenceHighlight,
        applyEvidenceHighlight,
        applyEvidenceHighlightWithRetry,
        applySectionEvidenceHighlight
    ]);
}
