'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useGraph } from '../GraphContext';
import { useUIState } from './useUIState';
import { useChatState } from './useChatState';
import {
    selectGraph,
    getConcept,
    getResourcesForConcept,
    getIngestionRunChanges,
    getTeachingStyle
} from '../../../api-client';
import { getLastSession } from '../../../lib/sessionState';
import { addConceptToHistory } from '../../../lib/conceptNavigationHistory';

export function useGraphInitialization(
    loadGraph: (graphId?: string) => Promise<void>,
    refreshGraphs: (preserve?: boolean) => Promise<void>,
    refreshBranches: () => Promise<void>,
    refreshFocusAreas: () => Promise<void>,
    updateSelectedPosition: (node: any) => void,
    centerNodeInVisibleArea: (x: number, y: number, duration?: number, assumePanelOpen?: boolean) => void,
    expandNeighbors: (id: string) => Promise<void>,
    revealDomain: (domain?: string) => void,
    graphRef: React.MutableRefObject<any>,
    resourceCacheRef: React.MutableRefObject<Map<string, any>>
) {
    const searchParams = useSearchParams();
    const graph = useGraph();
    const {
        activeGraphId,
        setActiveGraphId,
        setSelectedNode,
        setGraphData,
        setHighlightedConceptIds,
        setHighlightedRelationshipIds,
        setExpandedNodes,
        setTeachingStyle
    } = graph;

    const ui = useUIState();
    const chat = useChatState();

    const hasInitializedRef = useRef(false);
    const lastGraphIdRef = useRef<string | null>(null);

    const getActiveGraphId = () => {
        const graphIdParam = searchParams?.get('graph_id');
        if (graphIdParam) return graphIdParam;
        const lastSession = getLastSession();
        if (lastSession?.graph_id) return lastSession.graph_id;
        return 'default';
    };

    // Initial load
    useEffect(() => {
        if (hasInitializedRef.current) return;
        hasInitializedRef.current = true;

        const targetGraphId = getActiveGraphId();
        lastGraphIdRef.current = targetGraphId;

        async function loadInitialData() {
            try {
                const shouldSyncWithBackend = targetGraphId === 'default';
                await refreshGraphs(!shouldSyncWithBackend);

                loadGraph(targetGraphId);

                refreshBranches();
                refreshFocusAreas();
                getTeachingStyle().then(setTeachingStyle).catch(() => { });
            } catch (err) {
                console.error('Error loading initial data:', err);
            }
        }
        loadInitialData();
    }, []);

    // Handle URL graph_id changes
    const urlGraphId = searchParams?.get('graph_id');
    useEffect(() => {
        if (!hasInitializedRef.current) return;
        const targetGraphId = getActiveGraphId();
        if (targetGraphId !== lastGraphIdRef.current) {
            lastGraphIdRef.current = targetGraphId;
            selectGraph(targetGraphId).then(() => {
                setActiveGraphId(targetGraphId);
                setSelectedNode(null);
                refreshGraphs(true);
                refreshBranches();
                loadGraph(targetGraphId);
            });
        }
    }, [urlGraphId]);

    // Handle selection from URL
    const conceptIdParam = searchParams?.get('select');
    useEffect(() => {
        if (!conceptIdParam || !graph.graphData.nodes.length) return;

        const conceptInGraph = graph.graphData.nodes.find((n: any) => n.node_id === conceptIdParam);
        if (conceptInGraph) {
            setSelectedNode(conceptInGraph);
            updateSelectedPosition(conceptInGraph);

            if (!resourceCacheRef.current.has(conceptIdParam)) {
                getResourcesForConcept(conceptIdParam).then(resources => {
                    resourceCacheRef.current.set(conceptIdParam, resources);
                });
            }

            setTimeout(() => {
                if (graphRef.current && conceptInGraph) {
                    const node = conceptInGraph as any;
                    if (node.x && node.y) {
                        centerNodeInVisibleArea(node.x, node.y, 800, true);
                        graphRef.current.zoom(2.0, 800);
                    }
                }
            }, 100);
        } else {
            getConcept(conceptIdParam).then(concept => {
                setGraphData(prev => ({
                    ...prev,
                    nodes: [...prev.nodes, { ...concept, domain: concept.domain || 'general', type: 'concept' } as any]
                }));
                setSelectedNode(concept);
                updateSelectedPosition(concept);
            }).catch(() => {
                ui.actions.setConceptNotFoundBanner(conceptIdParam);
            });
        }
    }, [conceptIdParam, graph.graphData.nodes.length]);

    // Handle ingestion highlights from URL
    const runIdParam = searchParams?.get('highlight_run_id');
    useEffect(() => {
        if (runIdParam) {
            getIngestionRunChanges(runIdParam).then(changes => {
                const conceptIds = new Set<string>();
                changes.concepts_created.forEach((c: any) => conceptIds.add(c.concept_id));
                changes.concepts_updated.forEach((c: any) => conceptIds.add(c.concept_id));
                setHighlightedConceptIds(conceptIds);

                const relIds = new Set<string>();
                changes.relationships_proposed.forEach((r: any) => {
                    relIds.add(`${r.from_concept_id}-${r.to_concept_id}-${r.predicate}`);
                });
                setHighlightedRelationshipIds(relIds);
            });
        }
    }, [runIdParam]);

    return { getActiveGraphId };
}
