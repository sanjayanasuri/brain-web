'use client';

import { useRef, useState, useCallback, useMemo, Suspense, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import ExplorerToolbar from './ExplorerToolbar';
import GraphChatPanel from './GraphChatPanel';
import GraphMiniMap from './GraphMiniMap';
import GraphFiltersPanel from './GraphFiltersPanel';
import SimulationControlsPanel from './SimulationControlsPanel';
import ContextPanel from '../context/ContextPanel';
import SessionDrawer from '../navigation/SessionDrawer';
import { useSidebar } from '../context-providers/SidebarContext';
import VoiceAgentPanel from '../voice/VoiceAgentPanel';
import SupermemorySettings from '../voice/SupermemorySettings';
import { ContextTrackerButton } from '../explorer/ContextTracker';
import { GraphProvider, useGraph } from './GraphContext';
import GraphSideToolbar, { InteractionMode } from './GraphSideToolbar';
import PencilCanvas from '../ui/PencilCanvas';
import SelectionActionMenu from '../study/SelectionActionMenu';
import { useChatState, ChatProvider, useChat } from './hooks/useChatState';
import { useGraphFilters } from './hooks/useGraphFilters';
import { UIProvider, useUI } from './hooks/useUIState';
import { getPlugin } from './plugins/pluginRegistry';
import './plugins/lecturePlugin';
import type { Concept, Resource } from '../../api-client';
import { ActivityEvent } from './GraphTypes';
import ReaderView from '../reader/ReaderView';

import {
  getCurrentSessionId,
  setCurrentSessionId,
  getChatSession
} from '../../lib/chatSessions';
import {
  selectGraph,
  selectBranch,
  forkBranchFromNode,
  createSnapshot,
  listSnapshots,
  restoreSnapshot,
  listGraphs
} from '../../api-client';

import { useGraphData } from './hooks/useGraphData';
import { useGraphInteraction } from './hooks/useGraphInteraction';
import { useEvidenceHighlight } from './hooks/useEvidenceHighlight';
import { useChatInteraction } from './hooks/useChatInteraction';
import { useGraphInitialization } from './hooks/useGraphInitialization';
import { useGraphVisuals } from './hooks/useGraphVisuals';
import { deriveActivityEvents } from './GraphUtils';
import GraphCanvas from './GraphCanvas';
import ContentImportForm from './ContentImportForm';

function GraphVisualizationInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const graph = useGraph();
  const {
    graphData,
    selectedNode,
    setSelectedNode,
    graphs,
    activeGraphId,
    setActiveGraphId,
    branches,
    activeBranchId,
    setActiveBranchId,
    loading,
    overviewMeta,
    focusedNodeId,
    tempNodes
  } = graph;

  const chat = useChat();
  const filters = useGraphFilters();
  const ui = useUI();

  const graphRef = useRef<any>(null);
  const graphCanvasRef = useRef<HTMLDivElement | null>(null);
  const chatStreamRef = useRef<HTMLDivElement | null>(null);
  const resourceCacheRef = useRef<Map<string, any>>(new Map());
  const loadingNeighborsRef = useRef<string | null>(null);

  // Modular Hooks
  const graphDataHook = useGraphData();
  const { displayGraph, domainColors, uniqueDomains } = graphDataHook;

  const interactionHook = useGraphInteraction(
    graphRef,
    graphCanvasRef,
    graphDataHook.neighborCacheRef,
    loadingNeighborsRef,
    domainColors
  );

  const evidenceHook = useEvidenceHighlight(
    graphRef,
    interactionHook.expandNeighbors,
    interactionHook.revealDomain,
    interactionHook.centerNodeInVisibleArea
  );

  const chatHook = useChatInteraction(
    chatStreamRef,
    graphRef,
    graphDataHook.loadGraph,
    interactionHook.centerNodeInVisibleArea,
    interactionHook.updateSelectedPosition,
    interactionHook.resolveConceptByName,
    evidenceHook.clearEvidenceHighlight,
    evidenceHook.applyEvidenceHighlightWithRetry
  );

  useGraphInitialization(
    graphDataHook.loadGraph,
    graphDataHook.refreshGraphs,
    graphDataHook.refreshBranches,
    graphDataHook.refreshFocusAreas,
    interactionHook.updateSelectedPosition,
    interactionHook.centerNodeInVisibleArea,
    interactionHook.expandNeighbors,
    interactionHook.revealDomain,
    graphRef,
    resourceCacheRef
  );

  const visualsHook = useGraphVisuals(
    interactionHook.recomputeDomainBubbles,
    interactionHook.updateSelectedPosition,
    interactionHook.centerNodeInVisibleArea,
    graphRef
  );

  // State local to this component
  const [contentIngestResult, setContentIngestResult] = useState<any>(null);
  const [selectedResources, setSelectedResources] = useState<Resource[]>([]);
  const [expandedResources, setExpandedResources] = useState<Set<string>>(new Set());
  const [isResourceLoading, setIsResourceLoading] = useState(false);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [evidenceFilter, setEvidenceFilter] = useState<'all' | 'browser_use' | 'upload' | 'notion'>('all');
  const [evidenceSearch, setEvidenceSearch] = useState('');
  const [compareOtherBranchId, setCompareOtherBranchId] = useState<string | null>(null);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('select');
  const [showLegend, setShowLegend] = useState(false);
  const [pencilColor, setPencilColor] = useState('#2980b9');
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectionMenuState, setSelectionMenuState] = useState<{
    visible: boolean;
    position: { x: number; y: number };
    selectionId: string;
  } | null>(null);
  const [activeReader, setActiveReader] = useState<{ content: string, title: string, url: string } | null>(null);

  const { showVoiceAgent, setShowVoiceAgent } = useSidebar();
  const [showMemorySettings, setShowMemorySettings] = useState(false);

  // Global selection detection for Study System
  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      // Small delay for selection to be stable
      setTimeout(() => {
        const selection = window.getSelection();
        const selectedText = selection?.toString().trim();

        if (selectedText && selectedText.length > 2) {
          const range = selection?.getRangeAt(0);
          if (range) {
            const rect = range.getBoundingClientRect();

            // Trigger if selection is within context panel or chat or a content area
            const target = e.target as HTMLElement;
            const isContextPanel = !!target.closest('.context-panel');
            const isChatPanel = !!target.closest('.chat-panel');
            const isResponsivePanel = !!target.closest('.responsive-panel');
            const isLectureEditor = !!target.closest('.lecture-editor');

            if (isContextPanel || isChatPanel || isResponsivePanel || isLectureEditor) {
              setSelectionMenuState({
                visible: true,
                position: { x: rect.left + rect.width / 2, y: rect.bottom + 10 },
                selectionId: selectedText,
              });
            }
          }
        } else {
          // Close menu if clicking elsewhere (not on the menu itself)
          if (!(e.target as HTMLElement).closest('.selection-action-menu')) {
            if (!selectedText) {
              setSelectionMenuState(null);
            }
          }
        }
      }, 50);
    };

    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, []);

  // Escape key to reset mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle when not in input/textarea
      const activeElement = document.activeElement;
      if (
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.getAttribute('contenteditable') === 'true'
      ) {
        return;
      }

      if (e.key === 'Escape') {
        setInteractionMode('select');
        setSelectionMenuState(null);
      }

      // Toggle chat with 'C' key
      if (e.key.toLowerCase() === 'c' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        chat.actions.setChatCollapsed(!chat.state.isChatCollapsed);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [chat.actions, chat.state.isChatCollapsed]);

  const handlePencilClick = useCallback((x: number, y: number) => {
    // Convert screen coords to graph coords and find node
    const node = interactionHook.findNodeAtScreenPos(x, y);
    if (node) {
      setSelectedNode(node);
      interactionHook.updateSelectedPosition(node);
    } else {
      setSelectedNode(null);
    }
  }, [interactionHook, setSelectedNode]);

  const handlePencilHover = useCallback((x: number, y: number) => {
    const node = interactionHook.findNodeAtScreenPos(x, y);
    if (node) {
      setHoveredNodeId((node as any).node_id);
    } else {
      setHoveredNodeId(null);
    }
  }, [interactionHook]);

  const handleLassoIntent = useCallback((intent: any) => {
    if (intent.type === 'lasso' || intent.type === 'search') {
      const bounds = intent.bounds; // {x, y, w, h} in screen space
      if (!graphRef.current) return;

      const fg = graphRef.current;
      const data = typeof fg.graphData === 'function' ? fg.graphData() : (fg.graphData || graph.graphData);
      const selectedIds = new Set<string>();

      data.nodes.forEach((node: any) => {
        const coords = fg.graph2ScreenCoords?.(node.x, node.y);
        if (coords) {
          if (
            coords.x >= bounds.x &&
            coords.x <= bounds.x + bounds.w &&
            coords.y >= bounds.y &&
            coords.y <= bounds.y + bounds.h
          ) {
            selectedIds.add(node.node_id);
          }
        }
      });

      if (selectedIds.size > 0) {
        // Show selection action menu for study system
        const centerX = bounds.x + bounds.w / 2;
        const centerY = bounds.y + bounds.h + 10; // Below the selection

        // Create a selection ID from the lasso (for now, use first node ID)
        const firstNodeId = Array.from(selectedIds)[0];

        setSelectionMenuState({
          visible: true,
          position: { x: centerX, y: centerY },
          selectionId: firstNodeId, // In Phase 2, we'll create a proper multi-node selection
        });

        // Find the first node for now to highlight or multi-select if supported
        // For now, let's just select the first one found or handle multi-selection if GraphContext supports it
        const firstId = Array.from(selectedIds)[0];
        const node = data.nodes.find((n: any) => n.node_id === firstId);
        if (node) {
          setSelectedNode(node);
          interactionHook.updateSelectedPosition(node);
        }
      }

      setInteractionMode('select');
    }
  }, [graphRef, setSelectedNode, interactionHook]);

  const handleAddNode = useCallback(async () => {
    // Instead of a text prompt, activate handwriting mode for quick sketch
    // This is more natural for pencil users
    setInteractionMode('handwriting');
    // You could also show a toast or hint here
  }, [setInteractionMode]);

  const handleResetView = useCallback(() => {
    if (graphRef.current) {
      graphRef.current.zoomToFit?.(800, 100);
    }
  }, [graphRef]);

  const handleFocus = useCallback(() => {
    if (!selectedNode || !graphRef.current) return;
    const fg = graphRef.current;
    const data = typeof fg.graphData === 'function' ? fg.graphData() : (fg.graphData || graph.graphData);
    const node = data?.nodes?.find((n: any) => n.node_id === selectedNode.node_id);
    if (node && typeof node.x === 'number' && typeof node.y === 'number') {
      interactionHook.centerNodeInVisibleArea(node.x, node.y, 500);
      fg.zoom?.(2.5, 500);
    }
  }, [selectedNode, interactionHook]);

  // Derived Activity Events
  const activityEvents = useMemo(() => {
    return deriveActivityEvents(
      selectedResources,
      selectedNode,
      (resourceId: string) => {
        const resource = selectedResources.find(r => r.resource_id === resourceId);
        if (resource) {
          setExpandedResources(prev => new Set(prev).add(resourceId));
          ui.actions.setNodePanelTab('evidence');
        }
      }
    );
  }, [selectedResources, selectedNode, ui.actions]);

  const handleGraphSwitch = useCallback(async (graphId: string) => {
    try {
      await selectGraph(graphId);
      setActiveGraphId(graphId);
      setSelectedNode(null);
      await graphDataHook.loadGraph(graphId);
      await graphDataHook.refreshGraphs();
      await graphDataHook.refreshBranches();
    } catch (err) {
      console.error('Failed to switch graph:', err);
    }
  }, [graphDataHook, setActiveGraphId, setSelectedNode]);

  const handleNodeDoubleClick = useCallback((node: any) => {
    const concept = graphData.nodes.find(n => n.node_id === node.node_id);
    if (!concept) return;
    const slug = concept.url_slug || concept.node_id;
    const graphId = searchParams?.get('graph_id');
    const queryString = graphId ? `?graph_id=${graphId}` : '';
    router.push(`/concepts/${slug}${queryString}`);
  }, [graphData.nodes, router, searchParams]);

  return (
    <div className="app-shell" style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', padding: 0, margin: 0 }}>
      {/* Background layer: Graph */}
      <GraphCanvas
        graphRef={graphRef}
        graphCanvasRef={graphCanvasRef}
        displayGraph={displayGraph}
        degreeById={visualsHook.degreeById}
        highDegreeThreshold={visualsHook.highDegreeThreshold}
        selectedNeighborhoodIds={visualsHook.selectedNeighborhoodIds}
        domainColors={domainColors}
        onNodeClick={(node) => {
          setSelectedNode(node);
          interactionHook.updateSelectedPosition(node);
        }}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeDragEnd={(node) => {
          node.fx = node.x;
          node.fy = node.y;
          if (selectedNode && node.node_id === selectedNode.node_id) {
            interactionHook.updateSelectedPosition(selectedNode);
          }
        }}
        onBackgroundClick={() => setSelectedNode(null)}
        updateSelectedPosition={interactionHook.updateSelectedPosition}
        recomputeDomainBubbles={interactionHook.recomputeDomainBubbles}
        hoveredNodeId={hoveredNodeId}
      />

      {/* UI Overlay layer */}
      <div className="explorer-overlay-container" style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: 0, margin: 0, pointerEvents: 'none', zIndex: 10 }}>
        <div className="explorer-toolbar-container" style={{ pointerEvents: 'auto', width: '100%' }}>
          <ExplorerToolbar
            demoMode={false}
            graphs={graphs}
            activeGraphId={activeGraphId}
            onSelectGraph={handleGraphSwitch}
            onRequestCreateGraph={() => ui.actions.setShowGraphModal(true)}
            branches={branches}
            activeBranchId={activeBranchId}
            onSelectBranch={async (id) => {
              await selectBranch(id);
              setActiveBranchId(id);
              await graphDataHook.loadGraph();
              await graphDataHook.refreshBranches();
            }}
            graphSwitchError={ui.state.graphSwitchError}
            canFocus={!!selectedNode}
            onFocus={handleFocus}
            canFork={!!selectedNode}
            onFork={async () => {
              if (!selectedNode) return;
              try {
                const branch = await forkBranchFromNode(activeGraphId, selectedNode.node_id);
                await graphDataHook.refreshBranches();
                setActiveBranchId(branch.branch_id);
              } catch (err) {
                console.error('Failed to fork branch:', err);
              }
            }}
            canCompare={branches.length > 1}
            onCompare={() => {
              if (branches.length > 1) {
                const other = branches.find(b => b.branch_id !== activeBranchId);
                if (other) {
                  setCompareOtherBranchId(other.branch_id);
                }
              }
            }}
            onSaveState={async () => {
              try {
                await createSnapshot({
                  name: `Snapshot ${new Date().toLocaleString()}`,
                  focused_node_id: selectedNode?.node_id || focusedNodeId || null,
                });
              } catch (err) {
                console.error('Failed to create snapshot:', err);
              }
            }}
            onRestore={async () => {
              try {
                const result = await listSnapshots(50);
                if (result.snapshots.length > 0) {
                  await restoreSnapshot(result.snapshots[0].snapshot_id);
                  await graphDataHook.loadGraph();
                }
              } catch (err) {
                console.error('Failed to restore snapshot:', err);
              }
            }}
            nodesCount={displayGraph.nodes.length}
            linksCount={displayGraph.links.length}
            domainsCount={uniqueDomains.length}
            overviewMeta={overviewMeta}
            loadingNeighbors={graph.loadingNeighbors}
            showContentIngest={ui.state.showContentIngest}
            onToggleContentIngest={() => ui.actions.setShowContentIngest(!ui.state.showContentIngest)}
            contentIngestPopover={ui.state.showContentIngest ? (
              <div style={{ padding: '12px', background: 'var(--panel)', borderRadius: '8px', boxShadow: 'var(--shadow)', minWidth: '300px' }}>
                <ContentImportForm
                  onIngest={async (t, tx, d) => {
                    ui.actions.setContentIngestLoading(true);
                    const res = await getPlugin('lecture')?.handleIngestion?.(activeGraphId, t, tx, d);
                    setContentIngestResult(res);
                    await graphDataHook.loadGraph();
                    ui.actions.setContentIngestLoading(false);
                  }}
                  isLoading={ui.state.contentIngestLoading}
                  result={contentIngestResult}
                  onClose={() => ui.actions.setShowContentIngest(false)}
                />
              </div>
            ) : undefined}
            showControls={ui.state.showControls}
            onToggleControls={() => ui.actions.setShowControls(!ui.state.showControls)}
            focusMode={ui.state.focusMode}
            onToggleFocusMode={() => ui.actions.setFocusMode(!ui.state.focusMode)}
            showFilters={filters.state.showFilters}
            onToggleFilters={() => filters.actions.setShowFilters(!filters.state.showFilters)}
            sourceLayer={filters.state.sourceLayer}
            onSourceLayerChange={filters.actions.setSourceLayer}
            showMemorySettings={showMemorySettings}
            onToggleMemorySettings={() => setShowMemorySettings(!showMemorySettings)}
            // New Props
            mode={interactionMode}
            onModeChange={setInteractionMode}
            color={pencilColor}
            onColorChange={setPencilColor}
            onAddNode={handleAddNode}
            onResetView={handleResetView}
            showLegend={showLegend}
            onToggleLegend={() => setShowLegend(!showLegend)}
          />
        </div>

        <div className="explorer-panels-layout">
          {/* Legend - Moved to Top Left underneath toolbar or absolute */}
          {showLegend && (
            <div style={{
              position: 'absolute',
              top: '120px',
              left: '20px',
              background: 'var(--panel)',
              backdropFilter: 'blur(16px)',
              padding: '16px',
              borderRadius: '20px',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow)',
              pointerEvents: 'auto',
              minWidth: '220px',
              maxHeight: '400px',
              overflowY: 'auto',
              animation: 'slideInLeft 0.3s ease',
              zIndex: 100
            }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600', color: 'var(--ink-strong)' }}>Knowledge Domains</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {Array.from(domainColors.entries()).map(([domain, color]) => (
                  <div key={domain} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: color }} />
                    <span style={{ fontSize: '12px', color: 'var(--ink)' }}>{domain}</span>
                  </div>
                ))}
              </div>
              <div style={{ height: '1px', background: 'var(--border)', margin: '16px 0' }} />
              <div style={{ fontSize: '11px', color: 'var(--ink-subtle)', fontStyle: 'italic' }}>
                {displayGraph.nodes.length} Nodes • {displayGraph.links.length} Relations
              </div>
            </div>
          )}

          <div style={{ flex: 1, pointerEvents: 'none' }} />

          {/* Chat and Info Panels */}
          <div className="explorer-panels-group">
            {/* Context Panel when node selected */}
            {selectedNode && (
              <div className="responsive-panel" style={{ maxWidth: '400px' }}>
                <ContextPanel
                  selectedNode={selectedNode}
                  selectedResources={selectedResources}
                  isResourceLoading={isResourceLoading}
                  resourceError={resourceError}
                  expandedResources={expandedResources}
                  setExpandedResources={setExpandedResources}
                  evidenceFilter={evidenceFilter}
                  setEvidenceFilter={setEvidenceFilter}
                  evidenceSearch={evidenceSearch}
                  setEvidenceSearch={setEvidenceSearch}
                  activeTab={ui.state.nodePanelTab}
                  setActiveTab={ui.actions.setNodePanelTab as any}
                  onClose={() => setSelectedNode(null)}
                  onFetchEvidence={(result) => {
                    if (result.resources) setSelectedResources(result.resources);
                  }}
                  onResourceUpload={(res) => {
                    setSelectedResources(prev => [...prev, res]);
                  }}
                  domainColors={domainColors}
                  neighborCount={0} // Placeholder
                  IS_DEMO_MODE={false}
                  activityEvents={activityEvents}
                  activeGraphId={activeGraphId}
                />
              </div>
            )}

            {/* Chat Panel */}
            <GraphChatPanel
              chatStreamRef={chatStreamRef}
              onAsk={(question) => chatHook.handleChatSubmit(question, true)}
              onRead={setActiveReader}
            />

            {/* Reader Mode Overlay */}
            {activeReader && (
              <ReaderView
                content={activeReader.content}
                title={activeReader.title}
                url={activeReader.url}
                onClose={() => setActiveReader(null)}
                onSaveConcept={(text, context) => {
                  chatHook.handleChatSubmit(`Create a concept from this text: "${text}" (Context: ${context})`, true);
                }}
                onDiscuss={(text) => {
                  chatHook.handleChatSubmit(`I'd like to discuss this part: "${text}"`, true);
                }}
              />
            )}

          </div>
        </div>
      </div>

      {/* Drawing Overlay */}
      {interactionMode !== 'select' && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 5, // Above graph, below UI
          pointerEvents: 'auto'
        }}>
          <PencilCanvas
            key={interactionMode}
            transparent
            overlay
            tool={interactionMode === 'handwriting' ? 'pen' : 'lasso'}
            color={pencilColor}
            onIntent={handleLassoIntent}
            onClickPassthrough={handlePencilClick}
            onHoverPassthrough={handlePencilHover}
            onClose={() => setInteractionMode('select')}
            title="Graph Annotation"
          />
        </div>
      )}

      {/* Overlays */}
      <GraphMiniMap graphRef={graphRef} />

      {filters.state.showFilters && (
        <GraphFiltersPanel onClose={() => filters.actions.setShowFilters(false)} />
      )}

      {ui.state.showControls && (
        <SimulationControlsPanel
          onClose={() => ui.actions.setShowControls(false)}
          graphRef={graphRef}
        />
      )}

      {/* Study System Components */}

      {selectionMenuState?.visible && (
        <SelectionActionMenu
          selectionId={selectionMenuState.selectionId}
          position={selectionMenuState.position}
          onClose={() => setSelectionMenuState(null)}
        />
      )}


      {/* Voice Agent Panel Overlay */}
      {showVoiceAgent && (
        <div className="voice-panel-overlay">
          <VoiceAgentPanel graphId={activeGraphId} branchId={activeBranchId} />
        </div>
      )}

      {/* Memory Settings Modal Overlay */}
      {showMemorySettings && (
        <div className="modal-overlay" onClick={() => setShowMemorySettings(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Brain Memory Settings</h2>
              <button className="close-btn" onClick={() => setShowMemorySettings(false)}>✕</button>
            </div>
            <SupermemorySettings />
          </div>
        </div>
      )}

      <style jsx>{`
        .voice-panel-overlay {
          position: fixed;
          top: 100px;
          left: 32px;
          z-index: 1000;
          animation: slideInLeft 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-40px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.4);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2000;
          animation: fadeIn 0.2s ease-out;
        }
        .modal-content {
          background: var(--panel);
          border-radius: 24px;
          width: 90%;
          max-width: 650px;
          max-height: 85vh;
          overflow-y: auto;
          box-shadow: var(--shadow-lg);
          border: 1px solid var(--border);
          padding: 32px;
        }
        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }
        .close-btn {
          background: none;
          border: none;
          font-size: 20px;
          cursor: pointer;
          color: var(--ink-faint);
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

export default function GraphVisualization() {
  return (
    <GraphProvider>
      <UIProvider>
        <Suspense fallback={
          <div className="loader" style={{ height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <div className="loader__ring" />
            <p className="loader__text" style={{ marginLeft: '12px' }}>Initializing Graph…</p>
          </div>
        }>
          <GraphVisualizationInner />
        </Suspense>
      </UIProvider>
    </GraphProvider>
  );
}
