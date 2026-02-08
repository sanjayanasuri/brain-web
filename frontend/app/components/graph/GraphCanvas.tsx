'use client';

import { forceCollide, forceCenter } from 'd3-force';
import { useGraph } from './GraphContext';
import { useUI } from './hooks/useUIState';
import { ForceGraph2DWithRef } from './ForceGraphWrapper';
import { useChat } from './hooks/useChatState';

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
    hoveredNodeId?: string | null;
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
    recomputeDomainBubbles,
    hoveredNodeId
}: GraphCanvasProps) {
    const { loading, error, graphData, selectedNode, loadingNeighbors, setLoadingNeighbors } = useGraph();
    const ui = useUI();
    const chat = useChat();

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
                backgroundColor="rgba(0,0,0,0)" // Transparent to use CSS background
                nodeLabel={(node: any) => {
                    const zoom = ui.state.zoomTransform.k || ui.state.zoomLevel || 1;
                    const isHighDegree = (degreeById.get(node.node_id) || 0) >= highDegreeThreshold;
                    const isInNeighborhood = selectedNeighborhoodIds.has(node.node_id);
                    const isEvidence = chat.state.evidenceNodeIds.has(node.node_id);
                    const isHighlighted = (node as any).__highlighted;
                    const isSelected = selectedNode?.node_id === node.node_id;
                    const isHovered = hoveredNodeId === node.node_id;

                    if (isSelected || isHovered || zoom > 1.2 || isHighDegree || isInNeighborhood || isEvidence || isHighlighted) {
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

                    if (isSelected) return '#3b82f6'; // Electric blue for selection
                    if (isHighlighted) return '#60a5fa';
                    if (isEvidence) return '#10b981';
                    return color;
                }}
                nodeVal={(node: any) => {
                    const degree = degreeById.get(node.node_id) || 0;
                    const isSelected = selectedNode?.node_id === node.node_id;
                    if (isSelected) return 24;
                    return Math.max(5, Math.min(15, 5 + degree * 0.4));
                }}
                // Information flow aesthetics
                linkDirectionalParticles={2}
                linkDirectionalParticleSpeed={0.004}
                linkDirectionalParticleWidth={1.5}
                linkDirectionalParticleColor={() => 'rgba(255, 255, 255, 0.4)'}

                linkColor={(link: any) => {
                    const sourceId = typeof link.source === 'string' ? link.source : link.source.node_id;
                    const targetId = typeof link.target === 'string' ? link.target : link.target.node_id;
                    const isEvidence = chat.state.evidenceLinkIds.has(`${sourceId}-${targetId}-${link.predicate}`);
                    const isHighlighted = (link as any).__highlighted;

                    if (isHighlighted) return '#3b82f6';
                    if (isEvidence) return '#10b981';
                    const status = link.relationship_status || 'ACCEPTED';
                    if (status === 'PROPOSED') return 'rgba(148, 163, 184, 0.2)';
                    if (status === 'REJECTED') return 'rgba(239, 68, 68, 0.2)';
                    return 'rgba(148, 163, 184, 0.4)';
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
                onZoom={(transform: any) => {
                    // Update UI state with current zoom level for labels
                    // Use requestAnimationFrame to avoid blocking the transform
                    requestAnimationFrame(() => {
                        // Only update if k changes significantly to reduce re-renders
                        if (Math.abs(ui.state.zoomLevel - transform.k) > 0.01) {
                            ui.actions.setZoomLevel(transform.k);
                        }
                        ui.actions.setZoomTransform(transform);
                        if (selectedNode) {
                            updateSelectedPosition(selectedNode);
                        }
                    });
                }}
                nodeCanvasObjectMode={() => 'after'}
                nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
                    const radius = Math.max(5, Math.min(15, 5 + (degreeById.get(node.node_id) || 0) * 0.4));
                    const isSelected = selectedNode?.node_id === node.node_id;
                    const isNew = node.__isNew;

                    // "New" badge effect
                    if (isNew && typeof node.x === 'number' && isFinite(node.x)) {
                        // Pulsing glow
                        const pulseScale = 1 + Math.sin(Date.now() / 300) * 0.1;
                        const glowRadius = radius * 2.5 * pulseScale;

                        const gradient = ctx.createRadialGradient(node.x, node.y, radius, node.x, node.y, glowRadius);
                        gradient.addColorStop(0, 'rgba(16, 185, 129, 0.4)'); // Emerald green glow
                        gradient.addColorStop(1, 'rgba(16, 185, 129, 0)');

                        ctx.save();
                        ctx.fillStyle = gradient;
                        ctx.beginPath();
                        ctx.arc(node.x, node.y, glowRadius, 0, 2 * Math.PI);
                        ctx.fill();
                        ctx.restore();
                    }

                    // Glassmorphism glow for nodes
                    if (isSelected && typeof node.x === 'number' && isFinite(node.x)) {
                        const nodeSize = 24;
                        const glowRadius = nodeSize + 15;
                        const gradient = ctx.createRadialGradient(node.x, node.y, nodeSize, node.x, node.y, glowRadius);
                        gradient.addColorStop(0, 'rgba(59, 130, 246, 0.6)');
                        gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');

                        ctx.save();
                        ctx.fillStyle = gradient;
                        ctx.beginPath();
                        ctx.arc(node.x, node.y, glowRadius, 0, 2 * Math.PI);
                        ctx.fill();

                        // White core ring
                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 2 / globalScale;
                        ctx.beginPath();
                        ctx.arc(node.x, node.y, nodeSize, 0, 2 * Math.PI);
                        ctx.stroke();
                        ctx.restore();
                    } else if (globalScale > 0.8) {
                        // Subtle glow for regular nodes when zoomed in
                        ctx.save();
                        ctx.shadowBlur = 10;
                        ctx.shadowColor = 'rgba(255, 255, 255, 0.2)';
                        ctx.restore();
                    }
                }}
                d3Force={(name: string, force: any) => {
                    if (name === 'collide') {
                        force.radius((node: any) => {
                            const isSelected = selectedNode?.node_id === node.node_id;
                            if (isSelected) return 40;
                            const degree = degreeById.get(node.node_id) || 0;
                            return Math.max(12, Math.min(30, 12 + degree * 0.6));
                        });
                        force.strength(0.7);
                    }
                    if (name === 'charge') {
                        force.strength(-150);
                        force.distanceMax(500);
                    }
                    if (name === 'link') {
                        force.distance(80);
                        force.strength(0.5);
                    }
                    if (name === 'center' && displayGraph.links.length === 0) {
                        return forceCenter();
                    }
                }}
                cooldownTicks={100}
                warmupTicks={20}
            />
        </div>
    );
}
