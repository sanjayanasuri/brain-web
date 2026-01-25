'use client';

import { useRef, useState, useCallback, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import ExplorerToolbar from './ExplorerToolbar';
import GraphMiniMap from './GraphMiniMap';
import ContextPanel from '../context/ContextPanel';
import SessionDrawer from '../navigation/SessionDrawer';
import { ContextTrackerButton } from '../explorer/ContextTracker';
import NavigationTestHelper from '../navigation/NavigationTestHelper';
import { GraphProvider, useGraph } from './GraphContext';
import { useChatState } from './hooks/useChatState';
import { useGraphFilters } from './hooks/useGraphFilters';
import { useUIState } from './hooks/useUIState';
import { getPlugin } from './plugins/pluginRegistry';
import './plugins/lecturePlugin';
import type { Concept, Resource } from '../../api-client';
import { ActivityEvent } from './GraphTypes';

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

  const chat = useChatState();
  const filters = useGraphFilters();
  const ui = useUIState();

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

  const handleFocus = useCallback(() => {
    if (!selectedNode || !graphRef.current) return;
    const data = graphRef.current.graphData();
    const node = data?.nodes?.find((n: any) => n.node_id === selectedNode.node_id);
    if (node && typeof node.x === 'number' && typeof node.y === 'number') {
      interactionHook.centerNodeInVisibleArea(node.x, node.y, 500);
      graphRef.current.zoom(2.5, 500);
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
  }, [selectedResources, selectedNode, ui]);

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
    <div className="app-shell" style={{ position: 'relative', width: '100%', height: '100vh', overflow: 'hidden', background: 'var(--background)' }}>
      <NavigationTestHelper />

      {/* Background layer: Graph */}
      <GraphCanvas
        graphRef={graphRef}
        graphCanvasRef={graphCanvasRef}
        displayGraph={displayGraph}
        degreeById={visualsHook.degreeById}
        highDegreeThreshold={visualsHook.highDegreeThreshold}
        selectedNeighborhoodIds={visualsHook.selectedNeighborhoodIds}
        domainColors={domainColors}
        onNodeClick={interactionHook.updateSelectedPosition} // Just update position on click, GraphContext handles selection
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
      />

      {/* UI Overlay layer */}
      <div style={{ position: 'relative', zIndex: 10, width: '100%', height: '100vh', display: 'flex', flexDirection: 'column', pointerEvents: 'none' }}>
        <div style={{ padding: '12px 16px', background: 'var(--background)', zIndex: 100, pointerEvents: 'auto' }}>
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
          />
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', gap: '16px', padding: '0 16px 16px', pointerEvents: 'none' }}>
          {/* Sidebar */}
          <div style={{ pointerEvents: 'auto' }}>
            <SessionDrawer
              isCollapsed={ui.state.sidebarCollapsed}
              onToggleCollapse={() => ui.actions.setSidebarCollapsed(!ui.state.sidebarCollapsed)}
            />
          </div>

          <div style={{ flex: 1, pointerEvents: 'none' }} />

          {/* Chat and Info Panels */}
          <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', pointerEvents: 'auto' }}>
            {/* Context Panel when node selected */}
            {selectedNode && (
              <div style={{ width: '400px', height: '80vh' }}>
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
                  setActiveTab={ui.actions.setNodePanelTab}
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
            {!chat.state.isChatCollapsed && (
              <div style={{
                width: chat.state.isChatExpanded ? '500px' : '350px',
                height: '80vh',
                background: 'var(--panel)',
                borderRadius: '16px',
                border: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column'
              }}>
                <div style={{ padding: '12px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: '14px' }}>Brain Web Chat</h3>
                  <ContextTrackerButton />
                  <button onClick={() => chat.actions.setChatCollapsed(true)}>→</button>
                </div>

                <div ref={chatStreamRef} style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
                  {/* Chat messages would be rendered here, calling sub-components is better */}
                  {chat.state.chatHistory.map(msg => (
                    <div key={msg.id} style={{ marginBottom: '16px' }}>
                      <strong>{msg.question}</strong>
                      <div style={{ marginTop: '8px', fontSize: '14px' }}>{msg.answer || 'Thinking...'}</div>
                    </div>
                  ))}
                </div>

                <div style={{ padding: '12px', borderTop: '1px solid var(--border)' }}>
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    const val = (e.currentTarget.elements[0] as HTMLInputElement).value;
                    chatHook.handleChatSubmit(val, true);
                    (e.currentTarget.elements[0] as HTMLInputElement).value = '';
                  }}>
                    <input type="text" placeholder="Ask anything..." style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border)' }} />
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Overlays */}
      <GraphMiniMap graphRef={graphRef} />
    </div>
  );
}

export default function GraphVisualization() {
  return (
    <GraphProvider>
      <Suspense fallback={
        <div className="loader" style={{ height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div className="loader__ring" />
          <p className="loader__text" style={{ marginLeft: '12px' }}>Initializing Graph…</p>
        </div>
      }>
        <GraphVisualizationInner />
      </Suspense>
    </GraphProvider>
  );
}
