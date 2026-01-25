'use client';

import { forceCollide, forceCenter } from 'd3-force';
import { useGraph } from './GraphContext';
import { useUIState } from './hooks/useUIState';
import { ForceGraph2DWithRef } from './ForceGraphWrapper';
import { useChatState } from './hooks/useChatState';

interface GraphCanvasProps {
    graphRef: React.MutableRefObject<any>;
    graphCanvasRef: React.MutableRefObject<HTMLDivElement | null>;
    displayGraph: any;
    degreeById: Map<string, number>;
    highDegreeThreshold: number;
    selectedNeighborhoodIds: Set<string>;
    domainColors: Map<string, string>;
    onNodeClick: (node: any) => void;
    onNodeDoubleClick: (node: any) => void;
    onNodeDragEnd: (node: any) => void;
    onBackgroundClick: () => void;
    updateSelectedPosition: (node?: any) => void;
    recomputeDomainBubbles: () => void;
}

export default function GraphCanvas({
    graphRef,
    graphCanvasRef,
    displayGraph,
    degreeById,
    highDegreeThreshold,
    selectedNeighborhoodIds,
    domainColors,
    onNodeClick,
    onNodeDoubleClick,
    onNodeDragEnd,
    onBackgroundClick,
    updateSelectedPosition,
    recomputeDomainBubbles
}: GraphCanvasProps) {
    const { loading, error, graphData, selectedNode, loadingNeighbors, setLoadingNeighbors } = useGraph();
    const ui = useUIState();
    const chat = useChatState();

    return (
        <div
            ref={graphCanvasRef}
            className="graph-canvas"
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                width: '100vw',
                height: '100vh',
                zIndex: 1,
                contain: 'layout style paint',
                willChange: 'contents',
                transform: 'translateZ(0)',
                pointerEvents: 'auto',
            }}
        >
            {loading && graphData.nodes.length === 0 && (
                <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    zIndex: 10,
                    textAlign: 'center',
                    pointerEvents: 'none',
                }}>
                    <div className="loader__ring" style={{ margin: '0 auto 16px' }} />
                    <p style={{ color: 'var(--muted)', fontSize: '14px', margin: 0 }}>
                        Mapping your knowledge…
                    </p>
                </div>
            )}

            <ForceGraph2DWithRef
                ref={graphRef}
                graphData={displayGraph}
                nodeLabel={(node: any) => {
                    const zoom = ui.state.zoomTransform.k || ui.state.zoomLevel || 1;
                    const isHighDegree = (degreeById.get(node.node_id) || 0) >= highDegreeThreshold;
                    const isInNeighborhood = selectedNeighborhoodIds.has(node.node_id);
                    const isEvidence = chat.state.evidenceNodeIds.has(node.node_id);
                    const isHighlighted = (node as any).__highlighted;
                    const isSelected = selectedNode?.node_id === node.node_id;

                    if (isSelected || zoom > 1.2 || isHighDegree || isInNeighborhood || isEvidence || isHighlighted) {
                        return node.name;
                    }
                    return '';
                }}
                nodeColor={(node: any) => {
                    const domain = node.domain || 'general';
                    const color = domainColors.get(domain) || '#94a3b8';
                    const isEvidence = chat.state.evidenceNodeIds.has(node.node_id);
                    const isHighlighted = (node as any).__highlighted;
                    const isSelected = selectedNode?.node_id === node.node_id;

                    if (isSelected) return '#ff0000';
                    if (isHighlighted) return '#ffb703';
                    if (isEvidence) return '#06d6a0';
                    return color;
                }}
                nodeVal={(node: any) => {
                    const degree = degreeById.get(node.node_id) || 0;
                    const isSelected = selectedNode?.node_id === node.node_id;
                    if (isSelected) return 24;
                    return Math.max(4, Math.min(12, 4 + degree * 0.5));
                }}
                linkColor={(link: any) => {
                    const sourceId = typeof link.source === 'string' ? link.source : link.source.node_id;
                    const targetId = typeof link.target === 'string' ? link.target : link.target.node_id;
                    const isEvidence = chat.state.evidenceLinkIds.has(`${sourceId}-${targetId}-${link.predicate}`);
                    const isHighlighted = (link as any).__highlighted;

                    if (isHighlighted) return '#ffb703';
                    if (isEvidence) return '#06d6a0';
                    const status = link.relationship_status || 'ACCEPTED';
                    if (status === 'PROPOSED') return 'var(--panel)';
                    if (status === 'REJECTED') return 'var(--accent-2)';
                    return 'var(--border)';
                }}
                linkWidth={(link: any) => {
                    const sourceId = typeof link.source === 'string' ? link.source : link.source.node_id;
                    const targetId = typeof link.target === 'string' ? link.target : link.target.node_id;
                    const isEvidence = chat.state.evidenceLinkIds.has(`${sourceId}-${targetId}-${link.predicate}`);
                    const isHighlighted = (link as any).__highlighted;
                    return isEvidence || isHighlighted ? 3 : 1;
                }}
                onNodeClick={onNodeClick}
                onNodeDoubleClick={onNodeDoubleClick}
                onNodeDragEnd={onNodeDragEnd}
                onBackgroundClick={onBackgroundClick}
                onEngineStop={() => {
                    recomputeDomainBubbles();
                }}
                onZoom={(transform: any) => {
                    requestAnimationFrame(() => {
                        ui.actions.setZoomTransform(transform);
                        ui.actions.setZoomLevel(transform.k);
                        if (selectedNode) {
                            updateSelectedPosition(selectedNode);
                        }
                    });
                }}
                nodeCanvasObjectMode={() => 'after'}
                nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D) => {
                    const isSelected = selectedNode?.node_id === node.node_id;
                    if (isSelected && typeof node.x === 'number' && isFinite(node.x)) {
                        const nodeSize = 24;
                        const glowRadius = nodeSize + 12;
                        const gradient = ctx.createRadialGradient(node.x, node.y, nodeSize, node.x, node.y, glowRadius);
                        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
                        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

                        ctx.save();
                        ctx.globalAlpha = 0.8;
                        ctx.fillStyle = gradient;
                        ctx.beginPath();
                        ctx.arc(node.x, node.y, glowRadius, 0, 2 * Math.PI);
                        ctx.fill();
                        ctx.restore();

                        ctx.save();
                        ctx.strokeStyle = '#ff0000';
                        ctx.lineWidth = 4;
                        ctx.beginPath();
                        ctx.arc(node.x, node.y, nodeSize, 0, 2 * Math.PI);
                        ctx.stroke();
                        ctx.restore();
                    }
                }}
                d3Force={(name: string) => {
                    if (name === 'collide') {
                        return forceCollide().radius((node: any) => {
                            const isSelected = selectedNode?.node_id === node.node_id;
                            if (isSelected) return 32;
                            const degree = degreeById.get(node.node_id) || 0;
                            return Math.max(8, Math.min(20, 8 + degree * 0.3));
                        });
                    }
                    if (name === 'center' && displayGraph.links.length === 0) {
                        return forceCenter();
                    }
                    return null;
                }}
                cooldownTicks={displayGraph.links.length === 0 ? 50 : 100}
            />
        </div>
    );
}
