'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { forceCollide } from 'd3-force';
import ExplorerToolbar from './ExplorerToolbar';
import GraphMiniMap from './GraphMiniMap';
import type { Concept, GraphData, Resource, GraphSummary, BranchSummary } from '../api-client';
import {
  ingestLecture,
  type LectureIngestResult,
  getLectureSegments,
  type LectureSegment,
  getResourcesForConcept,
  uploadResourceForConcept,
  getTeachingStyle,
  type TeachingStyleProfile,
  getFocusAreas,
  type FocusArea,
  listGraphs,
  createGraph,
  selectGraph,
  listBranches,
  createBranch,
  selectBranch,
  forkBranchFromNode,
  compareBranches,
  llmCompareBranches,
  createSnapshot,
  listSnapshots,
  restoreSnapshot,
} from '../api-client';

// Type for the ForceGraph2D ref
type ForceGraphRef = {
  graphData: () => any;
  getGraphData: () => any;
  graph2ScreenCoords: (x: number, y: number) => { x: number; y: number } | null;
  centerAt: (x: number, y: number, duration?: number) => void;
  zoom: {
    (k: number, duration?: number): void;
    (): number;
  };
  zoomToFit: (duration?: number, padding?: number) => void;
  refresh: () => void;
  d3ReheatSimulation: () => void;
  toDataURL?: () => string;
  d3Force: (name: string) => any;
};

// Dynamically import ForceGraph2D
const ForceGraph2DBase = dynamic(
  () => import('react-force-graph-2d'),
  { ssr: false }
);

// Create a wrapper component that properly forwards refs
// 
// IMPORTANT: Next.js dynamic() creates a LoadableComponent wrapper that doesn't support refs.
// We work around this by using a ref callback that doesn't trigger React's ref validation.
// The warning you see is expected and harmless - the ref forwarding works correctly.
const ForceGraph2DWithRef = forwardRef<any, any>((props, ref) => {
  const internalRef = useRef<any>(null);
  const refCallback = useRef<((instance: any) => void) | null>(null);
  
  // Set up the ref callback once
  if (!refCallback.current) {
    refCallback.current = (instance: any) => {
      if (instance) {
        internalRef.current = instance;
        // Forward to parent ref
        if (ref) {
          if (typeof ref === 'function') {
            ref(instance);
          } else if (ref && 'current' in ref) {
            ref.current = instance;
          }
        }
      }
    };
  }
  
  // Forward the ref using useImperativeHandle as backup
  useImperativeHandle(ref, () => internalRef.current, []);
  
  // Use the stable callback ref
  // @ts-expect-error - LoadableComponent doesn't officially support refs but callback refs work
  return <ForceGraph2DBase {...props} ref={refCallback.current} />;
});

ForceGraph2DWithRef.displayName = 'ForceGraph2DWithRef';

// Export as ForceGraph2D for use in the component
const ForceGraph2D = ForceGraph2DWithRef;

type ChatMessage = { role: 'user' | 'system'; text: string };
type VisualNode = Concept & { domain: string; type: string };
type VisualLink = { source: VisualNode; target: VisualNode; predicate: string };
type VisualGraph = { nodes: VisualNode[]; links: VisualLink[] };
type TempNode = VisualNode & { temporary: true };
type SerializedGraph = { nodes: Concept[]; links: { source: string; target: string; predicate: string }[] };
type DomainBubble = { domain: string; x: number; y: number; r: number; color: string; count: number };

const DOMAIN_PALETTE = [
  '#118ab2',
  '#ef476f',
  '#06d6a0',
  '#f4a261',
  '#ffb703',
  '#073b4c',
  '#f28482',
  '#7c6ff9',
  '#52b788',
  '#3a86ff',
];

const IS_DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

function toRgba(hex: string, alpha: number) {
  let clean = hex.replace('#', '');
  if (clean.length === 3) {
    clean = clean
      .split('')
      .map(ch => ch + ch)
      .join('');
  }
  const num = parseInt(clean, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Compact lecture ingestion form component
function LectureIngestForm({
  onIngest,
  isLoading,
  result,
  onClose,
}: {
  onIngest: (title: string, text: string, domain?: string) => void;
  isLoading: boolean;
  result: LectureIngestResult | null;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [domain, setDomain] = useState('');

  // Reset form when result appears (success)
  useEffect(() => {
    if (result) {
      const timer = setTimeout(() => {
        setTitle('');
        setText('');
        setDomain('');
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [result]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (title && text) {
      onIngest(title, text, domain || undefined);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ marginBottom: '8px' }}>
        <input
          type="text"
          id="lecture-title"
          name="lecture-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Lecture title"
          required
          style={{
            width: '100%',
            padding: '6px 8px',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            fontSize: '13px',
          }}
        />
      </div>
      <div style={{ marginBottom: '8px' }}>
        <input
          type="text"
          id="lecture-domain"
          name="lecture-domain"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="Domain (optional)"
          style={{
            width: '100%',
            padding: '6px 8px',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            fontSize: '13px',
          }}
        />
      </div>
      <div style={{ marginBottom: '8px' }}>
        <textarea
          id="lecture-text"
          name="lecture-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste lecture text..."
          required
          rows={4}
          style={{
            width: '100%',
            padding: '6px 8px',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            fontSize: '13px',
            fontFamily: 'inherit',
            resize: 'vertical',
          }}
        />
      </div>
      {result && (
        <div style={{
          marginBottom: '8px',
          padding: '6px 8px',
          backgroundColor: '#efe',
          border: '1px solid #cfc',
          borderRadius: '4px',
          fontSize: '12px',
        }}>
          ✓ {result.nodes_created.length} nodes, {result.links_created.length} links
        </div>
      )}
      <div style={{ display: 'flex', gap: '6px' }}>
        <button
          type="submit"
          disabled={isLoading || !title || !text}
          className="pill pill--small"
          style={{
            flex: 1,
            backgroundColor: isLoading ? '#ccc' : 'var(--accent)',
            color: 'white',
            border: 'none',
            cursor: isLoading ? 'not-allowed' : 'pointer',
          }}
        >
          {isLoading ? 'Processing...' : 'Ingest'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="pill pill--ghost pill--small"
          style={{ cursor: 'pointer' }}
        >
          Close
        </button>
      </div>
    </form>
  );
}

export default function GraphVisualization() {
  // Suppress React ref warning for LoadableComponent (Next.js dynamic import limitation)
  useEffect(() => {
    if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
      const originalError = console.error;
      console.error = (...args: any[]) => {
        if (
          args[0]?.includes?.('Function components cannot be given refs') &&
          args[0]?.includes?.('ForceGraph2DWithRef')
        ) {
          // Suppress this specific warning - it's expected with Next.js dynamic imports
          return;
        }
        originalError.apply(console, args);
      };
      return () => {
        console.error = originalError;
      };
    }
  }, []);

  const [graphData, setGraphData] = useState<VisualGraph>({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState<Concept | null>(null);
  const [graphs, setGraphs] = useState<GraphSummary[]>([]);
  const [activeGraphId, setActiveGraphId] = useState<string>('default');
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [activeBranchId, setActiveBranchId] = useState<string>('main');
  const [focusAreas, setFocusAreas] = useState<FocusArea[]>([]);
  const [compareOtherBranchId, setCompareOtherBranchId] = useState<string>('');
  const [branchCompare, setBranchCompare] = useState<any>(null);
  const [branchCompareLLM, setBranchCompareLLM] = useState<any>(null);
  const [showGraphModal, setShowGraphModal] = useState(false);
  const [newGraphName, setNewGraphName] = useState('');
  const [graphSwitchError, setGraphSwitchError] = useState<string | null>(null);
  const [linkingMode, setLinkingMode] = useState<{ source: Concept | null; predicate: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [teachingStyle, setTeachingStyle] = useState<TeachingStyleProfile | null>(null);
  const [domainSpread, setDomainSpread] = useState(1.2);
  const [bubbleSpacing, setBubbleSpacing] = useState(1);
  const [showControls, setShowControls] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, string[]>>({});
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [currentZoom, setCurrentZoom] = useState(1);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [zoomTransform, setZoomTransform] = useState<{ k: number; x: number; y: number }>({ k: 1, x: 0, y: 0 });
  const [graphViewport, setGraphViewport] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [focusMode, setFocusMode] = useState(false);
  const lastAutoSnapshotAtRef = useRef<number>(0);
  const [focusDebug, setFocusDebug] = useState<{
    ts: number;
    node_id?: string;
    phase: string;
    attempts?: number;
    found?: boolean;
    x?: number;
    y?: number;
    zoom_before?: number;
    zoom_after?: number;
    error?: string;
  } | null>(null);
  const [selectedDomains, setSelectedDomains] = useState<Set<string>>(new Set());
  const [selectedPosition, setSelectedPosition] = useState<{ x: number; y: number } | null>(null);
  const [tempNodes, setTempNodes] = useState<TempNode[]>([]);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [chatAnswer, setChatAnswer] = useState<string | null>(null);
  const [answerId, setAnswerId] = useState<string | null>(null);
  const [lastQuestion, setLastQuestion] = useState<string>('');
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [usedNodes, setUsedNodes] = useState<Concept[]>([]);
  const [suggestedActions, setSuggestedActions] = useState<Array<{type: string; source?: string; target?: string; concept?: string; domain?: string; label: string}>>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState<string>('');
  const [isEditingAnswer, setIsEditingAnswer] = useState(false);
  const [editedAnswer, setEditedAnswer] = useState<string>('');
  const [isChatExpanded, setIsChatExpanded] = useState(false);
  const [isChatMaximized, setIsChatMaximized] = useState(false);
  const [chatMode, setChatMode] = useState<'Ask' | 'Explore Paths' | 'Summaries' | 'Gaps'>('Ask');
  const [chatContentHeight, setChatContentHeight] = useState(0);
  const [domainBubbles, setDomainBubbles] = useState<DomainBubble[]>([]);
  const [showLectureIngest, setShowLectureIngest] = useState(false);
  const [lectureIngestLoading, setLectureIngestLoading] = useState(false);
  const [lectureIngestResult, setLectureIngestResult] = useState<LectureIngestResult | null>(null);
  const [showSegments, setShowSegments] = useState(false);
  const [lectureSegments, setLectureSegments] = useState<LectureSegment[] | null>(null);
  const [segmentsLoading, setSegmentsLoading] = useState(false);
  const [selectedResources, setSelectedResources] = useState<Resource[]>([]);
  const [isResourceLoading, setIsResourceLoading] = useState(false);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const chatStreamRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<ForceGraphRef | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const graphCanvasRef = useRef<HTMLDivElement | null>(null);
  const normalize = useCallback((name: string) => name.trim().toLowerCase(), []);

  // Track graph viewport size (for "visible labels" heuristics)
  useEffect(() => {
    if (!graphCanvasRef.current) return;
    const el = graphCanvasRef.current;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setGraphViewport({ width: rect.width, height: rect.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
        const api = await import('../api-client');
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
    [],
  );

  const ensureConcept = useCallback(
    async (name: string, inherit?: { domain?: string; type?: string }) => {
      try {
        return await resolveConceptByName(name);
      } catch {
        const api = await import('../api-client');
        const concept = await api.createConcept({
          name,
          domain: inherit?.domain || 'general',
          type: inherit?.type || 'concept',
        });
        return concept;
      }
    },
    [resolveConceptByName],
  );

  const serializeGraph = useCallback(
    (graph: VisualGraph): SerializedGraph => {
      const nodes = graph.nodes.map(n => ({
        node_id: n.node_id,
        name: n.name,
        domain: n.domain,
        type: n.type,
        notes_key: (n as any).notes_key,
        lecture_key: (n as any).lecture_key,
        url_slug: (n as any).url_slug,
      }));
      const links = graph.links.map(l => ({
        source: typeof l.source === 'string' ? l.source : l.source.node_id,
        target: typeof l.target === 'string' ? l.target : l.target.node_id,
        predicate: l.predicate,
      }));
      return { nodes, links };
    },
    [],
  );

  const updateSelectedPosition = useCallback(
    (node?: any) => {
      const target = node || selectedNode;
      if (!target || !graphRef.current) return;
      const data = graphRef.current.graphData();
      const actualNode = data.nodes.find((n: any) => n.node_id === target.node_id);
      if (!actualNode || typeof actualNode.x !== 'number' || typeof actualNode.y !== 'number') return;
      const coords = graphRef.current.graph2ScreenCoords(actualNode.x, actualNode.y);
      if (coords && typeof coords.x === 'number' && typeof coords.y === 'number') {
        setSelectedPosition({ x: coords.x, y: coords.y });
      }
    },
    [selectedNode],
  );

  const convertGraphData = useCallback(
    (data: GraphData, temps: TempNode[] = tempNodes): VisualGraph => {
      const nodes: VisualNode[] = [
        ...data.nodes.map(node => ({
          ...node,
          domain: node.domain || 'general',
          type: node.type || 'concept',
        })),
        ...temps,
      ];

      const nodeMap = new Map<string, VisualNode>();
      nodes.forEach(node => nodeMap.set(node.node_id, node));

      const links: VisualLink[] = data.links
        .map(link => {
          const sourceId = typeof link.source === 'string' ? link.source : (link.source as any).node_id;
          const targetId = typeof link.target === 'string' ? link.target : (link.target as any).node_id;
          const sourceNode = nodeMap.get(sourceId);
          const targetNode = nodeMap.get(targetId);
          if (!sourceNode || !targetNode) {
            // Debug: log missing nodes
            if (process.env.NODE_ENV === 'development') {
              console.warn(`[Graph] Missing node for link: source=${sourceId}, target=${targetId}`);
            }
            return null;
          }
          return { source: sourceNode, target: targetNode, predicate: link.predicate };
        })
        .filter((link): link is VisualLink => Boolean(link));
      
      // Debug: log link conversion stats
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Graph] Converted ${links.length} links from ${data.links.length} raw links`);
      }

      return { nodes, links };
    },
    [tempNodes],
  );

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

  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { getAllGraphData } = await import('../api-client');
      const data = await getAllGraphData();
      const converted = convertGraphData(data, tempNodes);
      setGraphData(converted);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load graph');
    } finally {
      setLoading(false);
    }
  }, [convertGraphData, tempNodes]);

  const refreshGraphs = useCallback(async () => {
    try {
      const data = await listGraphs();
      setGraphs(data.graphs || []);
      setActiveGraphId(data.active_graph_id || 'default');
      setActiveBranchId(data.active_branch_id || 'main');
      setGraphSwitchError(null);
    } catch (err) {
      setGraphSwitchError(err instanceof Error ? err.message : 'Failed to load graphs');
    }
  }, []);

  const refreshBranches = useCallback(async () => {
    try {
      const data = await listBranches();
      setBranches(data.branches || []);
      setActiveBranchId(data.active_branch_id || 'main');
    } catch {
      // optional
    }
  }, []);

  const refreshFocusAreas = useCallback(async () => {
    try {
      const areas = await getFocusAreas();
      setFocusAreas(areas || []);
    } catch {
      // optional
    }
  }, []);

  const filteredGraph = useMemo<VisualGraph>(() => {
    if (selectedDomains.size === 0) return graphData;
    const filteredNodes = graphData.nodes.filter(n => selectedDomains.has(n.domain));
    const nodeIds = new Set(filteredNodes.map(n => n.node_id));
    const filteredLinks = graphData.links.filter(
      l => nodeIds.has(l.source.node_id) && nodeIds.has(l.target.node_id),
    );
    return { nodes: filteredNodes, links: filteredLinks };
  }, [graphData, selectedDomains]);

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
      (l) => keepIds.has(l.source.node_id) && keepIds.has(l.target.node_id),
    );

    return { displayGraph: { nodes: keptNodes, links: keptLinks }, hiddenCounts: counts };
  }, [filteredGraph, collapsedGroups]);

  const computeCollapseIds = useCallback(
    (rootId: string, depth: number, graph: VisualGraph = filteredGraph) => {
      // Build adjacency from current rendered graph (domain-filtered, before collapse)
      const adj = new Map<string, string[]>();
      graph.links.forEach((l) => {
        const a = l.source.node_id;
        const b = l.target.node_id;
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
    [filteredGraph],
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

    const bubbles: DomainBubble[] = [];
    groups.forEach((g, domain) => {
      if (g.count < 5) return;
      const x = g.sumX / g.count;
      const y = g.sumY / g.count;
      const color = domainColors.get(domain) || '#94a3b8';
      const r = Math.max(120, 70 + Math.sqrt(g.count) * 55);
      bubbles.push({ domain, x, y, r, color, count: g.count });
    });

    setDomainBubbles(bubbles);
  }, [domainColors]);

  // Refresh bubbles when the graph dataset changes (positions settle shortly after)
  useEffect(() => {
    if (!graphRef.current) return;
    const t = setTimeout(() => recomputeDomainBubbles(), 350);
    return () => clearTimeout(t);
  }, [displayGraph.nodes.length, displayGraph.links.length, selectedDomains.size, recomputeDomainBubbles]);

  // Degree + neighborhood helpers (for zoom-based labeling + selection emphasis)
  const { degreeById, highDegreeThreshold, selectedNeighborhoodIds } = useMemo(() => {
    const degree = new Map<string, number>();
    for (const l of displayGraph.links) {
      const a = l.source.node_id;
      const b = l.target.node_id;
      degree.set(a, (degree.get(a) || 0) + 1);
      degree.set(b, (degree.get(b) || 0) + 1);
    }

    const values = Array.from(degree.values()).sort((a, b) => a - b);
    const p = values.length > 0 ? values[Math.floor(values.length * 0.9)] : 0; // 90th percentile
    const threshold = Math.max(6, p || 0);

    const neighborhood = new Set<string>();
    const selectedId = selectedNode?.node_id || null;
    if (selectedId) {
      neighborhood.add(selectedId);
      for (const l of displayGraph.links) {
        const a = l.source.node_id;
        const b = l.target.node_id;
        if (a === selectedId) neighborhood.add(b);
        if (b === selectedId) neighborhood.add(a);
      }
    }

    return { degreeById: degree, highDegreeThreshold: threshold, selectedNeighborhoodIds: neighborhood };
  }, [displayGraph.links, selectedNode?.node_id]);

  // Focus Mode: when enabled and a node is selected, gently center + zoom in a bit more.
  useEffect(() => {
    if (!focusMode) return;
    if (!selectedNode?.node_id) return;
    const fg = graphRef.current;
    if (!fg) return;
    const data = fg.getGraphData ? fg.getGraphData() : fg.graphData();
    const node = data?.nodes?.find((n: any) => n.node_id === selectedNode.node_id);
    if (!node || typeof node.x !== 'number' || typeof node.y !== 'number') return;
    try {
      const z = typeof fg.zoom === 'function' ? fg.zoom() : 1;
      const target = Math.max(2.2, Math.min(4.0, z * 1.15));
      fg.centerAt(node.x, node.y, 550);
      fg.zoom(target, 550);
    } catch {
      // ignore (non-critical UX enhancement)
    }
  }, [focusMode, selectedNode?.node_id]);

  useEffect(() => {
    loadGraph();
    refreshGraphs();
    refreshBranches();
    refreshFocusAreas();
    // Load teaching style
    async function loadTeachingStyle() {
      try {
        const style = await getTeachingStyle();
        setTeachingStyle(style);
      } catch (err) {
        // Silently fail - teaching style is optional
        console.warn('Failed to load teaching style:', err);
      }
    }
    loadTeachingStyle();
  }, [loadGraph, refreshGraphs, refreshBranches, refreshFocusAreas]);

  // (Chat is now a docked panel; splitter resizing removed)

  // Fetch resources when selectedNode changes
  useEffect(() => {
    if (!selectedNode) {
      setSelectedResources([]);
      setResourceError(null);
      return;
    }

    let cancelled = false;
    const loadResources = async () => {
      try {
        setIsResourceLoading(true);
        setResourceError(null);
        const resources = await getResourcesForConcept(selectedNode.node_id);
        if (!cancelled) {
          setSelectedResources(resources);
        }
      } catch (err) {
        if (!cancelled) {
          setResourceError(err instanceof Error ? err.message : 'Failed to load resources');
        }
      } finally {
        if (!cancelled) {
          setIsResourceLoading(false);
        }
      }
    };
    loadResources();

    return () => {
      cancelled = true;
    };
  }, [selectedNode]);

  const reloadGraph = useCallback(async () => {
    try {
      const { getAllGraphData } = await import('../api-client');
      const data = await getAllGraphData();
      const convertedData = convertGraphData(data, tempNodes);
      setGraphData(convertedData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reload graph');
    }
  }, [convertGraphData, tempNodes]);

  const maybeAutoSnapshot = useCallback(
    async (reason: string) => {
      if (IS_DEMO_MODE) return;
      // Frontend-only autosnapshot (Phase 1 MVP):
      // - every 20 minutes while app is open
      // - after major graph mutations (we call this manually in key places)
      const now = Date.now();
      const minMs = 20 * 60 * 1000;
      if (now - lastAutoSnapshotAtRef.current < minMs) return;
      lastAutoSnapshotAtRef.current = now;

      try {
        const name = `Auto (${reason}) — ${new Date().toLocaleString()}`;
        await createSnapshot({ name, focused_node_id: selectedNode?.node_id || null });
        setChatMessages(prev => [...prev, { role: 'system', text: `Auto-snapshot saved → ${name}` }]);
      } catch {
        // silent; autosnapshot shouldn't interrupt flow
      }
    },
    [selectedNode],
  );

  useEffect(() => {
    if (IS_DEMO_MODE) return;
    const interval = window.setInterval(() => {
      void maybeAutoSnapshot('timer');
    }, 20 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [maybeAutoSnapshot]);

  useEffect(() => {
    // Hotkeys: cmd+1..9 to switch graphs (ordered by listGraphs result)
    function onKeyDown(e: KeyboardEvent) {
      if (!e.metaKey || e.shiftKey || e.ctrlKey || e.altKey) return;
      if (!/^[1-9]$/.test(e.key)) return;
      const idx = parseInt(e.key, 10) - 1;
      if (idx < 0 || idx >= graphs.length) return;
      const target = graphs[idx];
      if (!target?.graph_id) return;

      e.preventDefault();
      (async () => {
        try {
          await selectGraph(target.graph_id);
          setActiveGraphId(target.graph_id);
          setSelectedNode(null);
          setChatMessages(prev => [...prev, { role: 'system', text: `Switched graph → ${target.name || target.graph_id}` }]);
          await reloadGraph();
          await refreshGraphs();
          await refreshBranches();
        } catch (err) {
          setGraphSwitchError(err instanceof Error ? err.message : 'Failed to switch graph');
        }
      })();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [graphs, reloadGraph, refreshGraphs, refreshBranches]);

  const handleLectureIngest = useCallback(async (title: string, text: string, domain?: string) => {
    setLectureIngestLoading(true);
    setLectureIngestResult(null);
    setLectureSegments(null);
    try {
      const result = await ingestLecture({
        lecture_title: title,
        lecture_text: text,
        domain: domain || undefined,
      });
      setLectureIngestResult(result);
      
      // Automatically fetch and show segments after ingestion
      if (result.lecture_id) {
        if (result.segments && result.segments.length > 0) {
          setLectureSegments(result.segments);
          setShowSegments(true);
        } else {
          // Fetch segments if not in result
          setSegmentsLoading(true);
          try {
            const segments = await getLectureSegments(result.lecture_id);
            setLectureSegments(segments);
            if (segments.length > 0) {
              setShowSegments(true);
            }
          } catch (err) {
            console.error('Error fetching segments:', err);
          } finally {
            setSegmentsLoading(false);
          }
        }
      }
      
      // Reload graph to show new nodes
      await reloadGraph();
      await maybeAutoSnapshot('lecture ingest');
      // Clear result after a delay (form will reset itself via useEffect)
      setTimeout(() => {
        setLectureIngestResult(null);
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to ingest lecture');
      setLectureIngestResult(null);
    } finally {
      setLectureIngestLoading(false);
    }
  }, [reloadGraph, maybeAutoSnapshot]);

  // Extract force application logic into a separate function (defined before useEffect that uses it)
  const applyForcesToGraph = useCallback((fg: any) => {
    if (!fg) return;
    
    console.log('[Force Update] Applying forces with:', {
      domainSpread,
      bubbleSpacing,
      focusedNodeId,
      currentZoom,
      expandedNodesCount: expandedNodes.size,
      nodesCount: graphData.nodes.length,
    });
    
    // Increase spacing multiplier when zoomed in and a node is focused
    const zoomSpacingMultiplier = focusedNodeId && currentZoom > 1.2 ? 1.5 : 1;
    
    // Capture current values to use in force functions
    const currentDomainSpread = domainSpread;
    const currentBubbleSpacing = bubbleSpacing;
    const currentFocusedNodeId = focusedNodeId;
    const currentZoomLevel = currentZoom;
    
    const linkForce = fg.d3Force('link');
    if (linkForce) {
      let linkCount = 0;
      linkForce.distance((link: any) => {
        const sourceDomain = (link.source as any).domain || 'general';
        const targetDomain = (link.target as any).domain || 'general';
        const sameDomain = sourceDomain === targetDomain;
        const base = sameDomain ? 80 : 140;
        
        // Increase distance if link is connected to focused node
        const isFocusedLink = currentFocusedNodeId && 
          ((link.source as any).node_id === currentFocusedNodeId || (link.target as any).node_id === currentFocusedNodeId);
        const focusedMultiplier = isFocusedLink ? zoomSpacingMultiplier : 1;
        
        const distance = base * currentDomainSpread * currentBubbleSpacing * focusedMultiplier;
        
        // Log first few links to verify calculation
        if (linkCount < 3) {
          console.log(`[Link Force] Link ${linkCount}: base=${base}, domainSpread=${currentDomainSpread}, bubbleSpacing=${currentBubbleSpacing}, distance=${distance.toFixed(2)}`);
        }
        linkCount++;
        
        return distance;
      });
      console.log(`[Link Force] Applied to ${linkCount} links`);
    } else {
      console.warn('[Link Force] Link force not found!');
    }
    
    const chargeForce = fg.d3Force('charge');
    if (chargeForce) {
      let nodeCount = 0;
      // Increase repulsion around focused node when zoomed in
      chargeForce.strength((node: any) => {
        const isFocused = currentFocusedNodeId && node.node_id === currentFocusedNodeId;
        const baseStrength = -240 * currentBubbleSpacing * currentDomainSpread;
        const strength = isFocused && currentZoomLevel > 1.2 ? baseStrength * 1.8 : baseStrength;
        
        // Log first few nodes to verify calculation
        if (nodeCount < 3) {
          console.log(`[Charge Force] Node ${nodeCount} (${node.name || node.node_id}): baseStrength=${baseStrength.toFixed(2)}, finalStrength=${strength.toFixed(2)}, isFocused=${isFocused}`);
        }
        nodeCount++;
        
        return strength;
      });
      console.log(`[Charge Force] Applied to ${nodeCount} nodes, baseStrength=${(-240 * currentBubbleSpacing * currentDomainSpread).toFixed(2)}`);
    } else {
      console.warn('[Charge Force] Charge force not found!');
    }
    
    // Increase collision radius around focused node
    let collideCount = 0;
    fg.d3Force('collide', forceCollide((node: any) => {
      const baseRadius = expandedNodes.has(node.node_id) ? 38 : 26;
      const isFocused = currentFocusedNodeId && node.node_id === currentFocusedNodeId;
      const focusedMultiplier = isFocused && currentZoomLevel > 1.2 ? 1.6 : 1;
      const radius = baseRadius * currentBubbleSpacing * focusedMultiplier;
      
      // Log first few nodes to verify calculation
      if (collideCount < 3) {
        console.log(`[Collide Force] Node ${collideCount} (${node.name || node.node_id}): baseRadius=${baseRadius}, bubbleSpacing=${currentBubbleSpacing}, radius=${radius.toFixed(2)}, isFocused=${isFocused}`);
      }
      collideCount++;
      
      return radius;
    }));
    console.log(`[Collide Force] Applied to ${collideCount} nodes`);
    
    // Force a complete restart of the simulation to ensure changes take effect
    // Reset alpha to restart the simulation from the beginning
    const simulation = (fg as any).d3Force();
    if (simulation) {
      console.log('[Simulation] Restarting simulation with alpha=1');
      simulation.alpha(1).restart();
    } else {
      console.warn('[Simulation] Simulation object not found!');
    }
    fg.d3ReheatSimulation();
    console.log('[Simulation] Reheated simulation');
    
    // Refresh the graph to show changes
    setTimeout(() => {
      if (graphRef.current) {
        console.log('[Graph] Refreshing graph display');
        graphRef.current.refresh();
      }
    }, 100);
  }, [domainSpread, bubbleSpacing, expandedNodes, graphData.nodes.length, focusedNodeId, currentZoom]);

  useEffect(() => {
    if (!graphRef.current) return;

    console.log('[Force Update] Effect triggered with:', {
      domainSpread,
      bubbleSpacing,
      graphRefExists: !!graphRef.current,
    });
    applyForcesToGraph(graphRef.current);
  }, [
    domainSpread,
    bubbleSpacing,
    expandedNodes,
    graphData.nodes.length,
    selectedDomains.size,
    focusedNodeId,
    currentZoom,
    applyForcesToGraph,
  ]);

  // Apply initial forces when graph data changes (graph will be ready)
  useEffect(() => {
    if (graphData.nodes.length > 0 && graphRef.current) {
      // Small delay to ensure graph is fully initialized after data change
      const timer = setTimeout(() => {
        if (graphRef.current) {
          console.log('[Graph Ref] Graph is ready, applying initial forces');
          applyForcesToGraph(graphRef.current);
        }
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [graphData.nodes.length, applyForcesToGraph]);

  useEffect(() => {
    if (!selectedNode) {
      setSelectedPosition(null);
      return;
    }
    let frame: number;
    const tick = () => {
      updateSelectedPosition();
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [selectedNode, updateSelectedPosition]);

  const handleNodeHover = useCallback((node: any | null) => {
    if (!graphRef.current) return;
    const data = graphRef.current.getGraphData();
    data.nodes.forEach((n: any) => {
      n.__highlighted = node ? n.node_id === node.node_id : false;
    });
    data.links.forEach((l: any) => {
      const srcId = typeof l.source === 'object' ? l.source.node_id : l.source;
      const tgtId = typeof l.target === 'object' ? l.target.node_id : l.target;
      l.__highlighted = node ? srcId === node.node_id || tgtId === node.node_id : false;
    });
    graphRef.current.refresh();
  }, []);

  const focusOnNode = useCallback(
    (node: any) => {
      if (!graphRef.current || !node) return false;
      
      // Make sure its domain is visible
      revealDomain(node.domain);

      const fg = graphRef.current;
      
      // Set focused node to increase spacing around it
      setFocusedNodeId(node.node_id);
      
      // Get fresh graph data (might be filtered by domain)
      const data = fg.getGraphData ? fg.getGraphData() : fg.graphData();
      const updatedNode = data?.nodes?.find((n: any) => n.node_id === node.node_id);
      
      if (!updatedNode) {
        // Node not in visible graph - might be filtered, will retry
        console.log(`[Focus] Node ${node.node_id} not in visible graph, will retry`);
        return false;
      }
      
      if (typeof updatedNode.x === 'number' && typeof updatedNode.y === 'number') {
        // Current zoom, pick a "nice" zoom-in target
        const currentZoom = typeof fg.zoom === 'function' ? fg.zoom() : 1;
        // Make focus very obvious (commands should feel like a true "focus mode")
        const targetZoom = Math.max(2.6, Math.min(4, currentZoom * 2.2));

        setFocusDebug({
          ts: Date.now(),
          node_id: node.node_id,
          phase: 'focusOnNode: calling centerAt/zoom',
          found: true,
          x: updatedNode.x,
          y: updatedNode.y,
          zoom_before: currentZoom,
        });

        try {
          // Smooth pan + zoom towards the node
          fg.centerAt(updatedNode.x, updatedNode.y, 850);   // animation
          fg.zoom(targetZoom, 850);                        // same duration
        } catch (e: any) {
          setFocusDebug({
            ts: Date.now(),
            node_id: node.node_id,
            phase: 'focusOnNode: ERROR calling centerAt/zoom',
            found: true,
            x: updatedNode.x,
            y: updatedNode.y,
            zoom_before: currentZoom,
            error: e?.message || String(e),
          });
        }
        
        // Update zoom state after animation
        setTimeout(() => {
          if (graphRef.current) {
            // zoom() can be called with no args to get current zoom
            const currentZoomValue = typeof graphRef.current.zoom === 'function' 
              ? (graphRef.current.zoom as () => number)() 
              : 1;
            setCurrentZoom(currentZoomValue);
            setFocusDebug(prev => prev && prev.node_id === node.node_id ? ({
              ...prev,
              phase: 'focusOnNode: zoom after',
              zoom_after: currentZoomValue,
            }) : prev);
            // Reheat simulation to apply new spacing forces
            graphRef.current.d3ReheatSimulation();
          }
        }, 900); // Slightly after zoom animation completes
        
        updateSelectedPosition(updatedNode);
        return true;
      } else {
        // If the node hasn't been laid out yet, reheat simulation and retry
        console.log(`[Focus] Node ${node.node_id} doesn't have coordinates yet, reheating simulation...`);
        if (fg.d3ReheatSimulation) {
          fg.d3ReheatSimulation();
        }
        setFocusDebug({
          ts: Date.now(),
          node_id: node.node_id,
          phase: 'focusOnNode: missing coords, reheating',
          found: true,
          x: typeof updatedNode.x === 'number' ? updatedNode.x : undefined,
          y: typeof updatedNode.y === 'number' ? updatedNode.y : undefined,
        });
        return false; // Will retry via focusWithRetries
      }
    },
    [updateSelectedPosition, revealDomain],
  );

  const focusById = useCallback(
    (nodeId: string) => {
      if (!graphRef.current) return false;
      
      // First try to find in the full graphData (includes all nodes)
      const fullNode = graphData.nodes.find(n => n.node_id === nodeId);
      if (!fullNode) {
        console.warn(`[Focus] Node ${nodeId} not found in graph`);
        return false;
      }
      
      // Make sure domain is revealed (this updates selectedDomains, which updates filteredGraph)
      revealDomain(fullNode.domain);
      
      // Check filteredGraph (what's actually rendered) - this is memoized and updates when selectedDomains changes
      // The filteredGraph should update on the next render after revealDomain, but we need to wait for it
      const nodeInFiltered = filteredGraph.nodes.find(n => n.node_id === nodeId);
      
      // If node not in filtered graph, domain filter needs to update - retry will happen
      if (!nodeInFiltered) {
        // Check if we need to wait for domain filter - if selectedDomains is empty or doesn't include the domain,
        // we need to wait for the state update to propagate
        const needsDomainUpdate = selectedDomains.size === 0 || !selectedDomains.has(fullNode.domain);
        if (needsDomainUpdate) {
          console.log(`[Focus] Node ${nodeId} domain (${fullNode.domain}) not yet in selectedDomains, waiting for state update...`);
        } else {
          console.log(`[Focus] Node ${nodeId} not in filtered graph yet, waiting for filteredGraph recalculation...`);
        }
        // Force a reheat to help graph update faster
        if (graphRef.current?.d3ReheatSimulation) {
          graphRef.current.d3ReheatSimulation();
        }
        return false;
      }
      
      // Get the actual rendered node from the graph (has x/y coordinates)
      const data = graphRef.current.getGraphData ? graphRef.current.getGraphData() : graphRef.current.graphData();
      const node = data?.nodes?.find((n: any) => n.node_id === nodeId);
      
      if (!node) {
        console.log(`[Focus] Node ${nodeId} not yet rendered in graph visualization, attempting to unhide/pin...`);

        // If the node exists in the full graph but isn't in the rendered graph, it's often
        // because it's hidden by the collapse mechanic (isolated after hiding incident edges).
        // Pinning it as "expanded" prevents it from being hidden in displayGraph.
        setExpandedNodes(prev => {
          if (prev.has(nodeId)) return prev;
          const next = new Set(prev);
          next.add(nodeId);
          return next;
        });

        // Force graph to update
        if (graphRef.current.d3ReheatSimulation) graphRef.current.d3ReheatSimulation();
        return false;
      }
      
      setSelectedNode(nodeInFiltered); // Use node from filteredGraph for state
      
      // If node doesn't have coordinates yet, wait for graph to stabilize
      if (typeof node.x !== 'number' || typeof node.y !== 'number') {
        console.log(`[Focus] Node ${nodeId} doesn't have coordinates yet (x: ${node.x}, y: ${node.y}), reheating simulation...`);
        // Force graph to update and wait
        if (graphRef.current.d3ReheatSimulation) {
          graphRef.current.d3ReheatSimulation();
        }
        return false; // Will retry
      }
      
      const success = focusOnNode(node);
      if (success) setPendingFocusId(null);
      return success;
    },
    [focusOnNode, graphData.nodes, filteredGraph.nodes, revealDomain, selectedDomains],
  );

  const focusWithRetries = useCallback(
    (nodeId: string) => {
      const maxAttempts = 20; // Increased retries for domain filter updates
      let attempts = 0;
      const attempt = () => {
        attempts += 1;
        const ok = focusById(nodeId);
        if (ok) {
          setPendingFocusId(null);
          return;
        }
        if (attempts < maxAttempts) {
          // Increase delay for later attempts to give graph more time to stabilize
          // Early attempts: quick retries for coordinate updates
          // Later attempts: longer delays for domain filter updates and graph rendering
          const delay = attempts < 3 ? 200 : attempts < 6 ? 400 : attempts < 10 ? 600 : attempts < 15 ? 1000 : 1500;
          setTimeout(attempt, delay);
        } else {
          // Final attempt failed - clear pending and show error
          setPendingFocusId(null);
          console.warn(`[Focus] Failed to focus on node ${nodeId} after ${maxAttempts} attempts`);
          setError(`Could not focus on node. It may be filtered or not yet rendered.`);
        }
      };
      attempt();
    },
    [focusById],
  );

  const requestFocus = useCallback(
    (nodeLike: { node_id: string } | string) => {
      const id = typeof nodeLike === 'string' ? nodeLike : nodeLike.node_id;
      setPendingFocusId(id);
      focusWithRetries(id);
    },
    [focusWithRetries],
  );

  // Retry focus when graph data or filtered graph changes (e.g., after domain filter updates)
  useEffect(() => {
    if (pendingFocusId) {
      // Small delay to ensure React has finished updating filteredGraph after state changes
      const timeoutId = setTimeout(() => {
        focusWithRetries(pendingFocusId);
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [graphData.nodes, filteredGraph.nodes, pendingFocusId, focusWithRetries]);

  const activeFocusNames = useMemo(() => {
    return (focusAreas || []).filter(a => a.active).map(a => a.name).filter(Boolean);
  }, [focusAreas]);

  const guessKind = useCallback((node: Concept | null | undefined) => {
    if (!node) return 'concept';
    const name = (node.name || '').toLowerCase();
    const domain = (node.domain || '').toLowerCase();
    const type = (node.type || '').toLowerCase();
    const tags = Array.isArray((node as any).tags) ? ((node as any).tags as string[]).join(' ').toLowerCase() : '';
    const hay = `${name} ${domain} ${type} ${tags}`;

    if (/\b(character|plot|story|fiction|novel)\b/.test(hay)) return 'character';
    if (/\b(place|location|city|country|battle|scene)\b/.test(hay)) return 'place';
    if (/\b(company|stock|equity|finance|market|semiconductor|earnings)\b/.test(hay)) return 'company';
    if (/\b(api|apis|platform|developer|saas|economy)\b/.test(hay)) return 'api';
    if (/\b(person|founder|ceo|author)\b/.test(hay)) return 'person';
    if (type === 'lecture') return 'lecture';
    return 'concept';
  }, []);

  const generateCuriousQuestions = useCallback(
    (opts: { node?: Concept | null; focus?: string[]; lastQ?: string }) => {
      const node = opts.node || null;
      const focus = (opts.focus || []).slice(0, 2);
      const lastQ = (opts.lastQ || '').trim();
      const name = node?.name || (focus[0] ? focus[0] : 'this');
      const kind = guessKind(node);

      const dedupe = (arr: string[]) => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const q of arr) {
          const k = q.trim().toLowerCase();
          if (!k || seen.has(k)) continue;
          seen.add(k);
          out.push(q);
        }
        return out;
      };

      const connect = focus[0] ? `How does ${name} connect to ${focus[0]}?` : '';
      const connect2 = focus[1] ? `What would change if we view ${name} through the lens of ${focus[1]}?` : '';

      let base: string[] = [];
      if (kind === 'company') {
        base = [
          `What is ${name}'s business model in one sentence?`,
          `What have ${name}'s last few quarters looked like (revenue, margins, guidance)?`,
          `What are the top 2 risks that could break the thesis on ${name}?`,
        ];
      } else if (kind === 'api') {
        base = [
          `What problem does ${name} solve, and for whom?`,
          `What are 2 concrete examples of ${name} in the real world?`,
          `What are the incentives (who benefits, who pays) in ${name}?`,
        ];
      } else if (kind === 'character') {
        base = [
          `What does ${name} want right now, and why?`,
          `What does ${name} do next — and what forces that choice?`,
          `Who/what is ${name} in conflict with?`,
        ];
      } else if (kind === 'place') {
        base = [
          `What happened at ${name} that matters to the story/argument?`,
          `What constraints define ${name} (resources, rules, geography)?`,
          `Who is most affected by what happens at ${name}?`,
        ];
      } else if (kind === 'lecture') {
        base = [
          `What are the 3 core takeaways from ${name}?`,
          `What prerequisite concepts should I learn before ${name}?`,
          `What example would make ${name} click instantly?`,
        ];
      } else {
        base = [
          `What is a concrete example of ${name}?`,
          `What is ${name} most easily confused with — and what's the difference?`,
          `What are the prerequisites for understanding ${name}?`,
        ];
      }

      const contextNudge =
        lastQ && node ? `Given my question (“${lastQ}”), what should we connect ${name} to next?` : '';

      return dedupe([connect, connect2, contextNudge, ...base]).filter(Boolean).slice(0, 3);
    },
    [guessKind],
  );

  // Seed "curious" questions based on focus areas + current selection (no backend fetch).
  useEffect(() => {
    if (suggestedQuestions.length > 0) return;
    if (graphData.nodes.length === 0) return;
    const node = (selectedNode as any) || null;
    const qs = generateCuriousQuestions({ node, focus: activeFocusNames });
    if (qs.length > 0) setSuggestedQuestions(qs);
  }, [graphData.nodes.length, selectedNode, activeFocusNames, generateCuriousQuestions, suggestedQuestions.length]);

  // Measure chat content height and adjust expansion dynamically
  useEffect(() => {
    if (chatStreamRef.current && isChatExpanded) {
      const measureHeight = () => {
        const height = chatStreamRef.current?.scrollHeight || 0;
        setChatContentHeight(height);
        
        // Always scroll to top when content changes
        if (chatStreamRef.current) {
          chatStreamRef.current.scrollTop = 0;
        }
      };
      
      // Measure immediately
      measureHeight();
      
      // Use ResizeObserver to watch for content changes
      const resizeObserver = new ResizeObserver(measureHeight);
      if (chatStreamRef.current) {
        resizeObserver.observe(chatStreamRef.current);
      }
      
      // Also scroll to top after a brief delay to ensure content is rendered
      const scrollTimeout = setTimeout(() => {
        if (chatStreamRef.current) {
          chatStreamRef.current.scrollTop = 0;
        }
      }, 150);
      
      return () => {
        resizeObserver.disconnect();
        clearTimeout(scrollTimeout);
      };
    } else {
      setChatContentHeight(0);
    }
  }, [isChatExpanded, chatAnswer, chatMessages, suggestedQuestions, suggestedActions]);

  // Auto-scroll to newest content
  useEffect(() => {
    if (!chatStreamRef.current) return;
    const el = chatStreamRef.current;
    el.scrollTop = el.scrollHeight;
  }, [chatMessages, chatAnswer, isChatLoading]);

  const handleNodeClick = useCallback(
    async (node: any) => {
      if (linkingMode && linkingMode.source) {
        const source = linkingMode.source;
        const predicate = linkingMode.predicate || 'RELATES_TO';
        try {
          const { createRelationshipByIds } = await import('../api-client');
          await createRelationshipByIds(source.node_id, node.node_id, predicate);
          setLinkingMode(null);
          setError(null);
          setChatMessages(prev => [
            ...prev,
            { role: 'system', text: `Linked ${source.name} ➜ ${node.name} (${predicate})` },
          ]);
          await reloadGraph();
          await maybeAutoSnapshot('link');
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to create relationship');
        }
        return;
      }

      setSelectedNode(node);
      focusOnNode(node);
      
      // Minimize chat when clicking on a node to focus on graph
      setIsChatExpanded(false);
      
      // Clear chat answer when clicking on a node (new context)
      setChatAnswer(null);
      setAnswerId(null);
      setLastQuestion('');
      setSuggestedQuestions([]);
      setUsedNodes([]);
      
      setExpandedNodes(prev => {
        const next = new Set(prev);
        if (next.has(node.node_id)) {
          next.delete(node.node_id);
        } else {
          next.add(node.node_id);
        }
        return next;
      });
    },
    [linkingMode, reloadGraph, focusOnNode, maybeAutoSnapshot],
  );

  const ensureNodeInGraphData = useCallback((concept: Concept) => {
    setGraphData(prev => {
      const exists = prev.nodes.some(n => n.node_id === concept.node_id);
      if (exists) return prev;
      return {
        ...prev,
        nodes: [
          ...prev.nodes,
          {
            ...concept,
            domain: concept.domain || 'general',
            type: concept.type || 'concept',
          } as any,
        ],
      };
    });
  }, []);

  const hardCenterOnNodeId = useCallback((nodeId: string) => {
    const maxAttempts = 12;
    let attempts = 0;

    const attempt = () => {
      attempts += 1;
      const fg = graphRef.current;
      if (!fg) return;

      const data = fg.getGraphData ? fg.getGraphData() : fg.graphData();
      const node = data?.nodes?.find((n: any) => n?.node_id === nodeId);
      if (node && typeof node.x === 'number' && typeof node.y === 'number') {
        // mimic focusOnNode camera behavior
        setFocusedNodeId(nodeId);
        const currentZoomValue = typeof fg.zoom === 'function' ? fg.zoom() : 1;
        const targetZoom = Math.max(2.6, Math.min(4, currentZoomValue * 2.2));
        setFocusDebug({
          ts: Date.now(),
          node_id: nodeId,
          phase: 'hardCenter: calling centerAt/zoom',
          attempts,
          found: true,
          x: node.x,
          y: node.y,
          zoom_before: currentZoomValue,
        });
        try {
          fg.centerAt(node.x, node.y, 900);
          fg.zoom(targetZoom, 900);
        } catch (e: any) {
          setFocusDebug({
            ts: Date.now(),
            node_id: nodeId,
            phase: 'hardCenter: ERROR calling centerAt/zoom',
            attempts,
            found: true,
            x: node.x,
            y: node.y,
            zoom_before: currentZoomValue,
            error: e?.message || String(e),
          });
        }
        setTimeout(() => {
          const after = typeof fg.zoom === 'function' ? fg.zoom() : undefined;
          if (typeof after === 'number') {
            setFocusDebug(prev => prev && prev.node_id === nodeId ? ({
              ...prev,
              phase: 'hardCenter: zoom after',
              zoom_after: after,
            }) : prev);
          }
        }, 950);
        return;
      }

      // Node exists in our full graph but is currently not in rendered graph; pin it so it won't be hidden.
      setExpandedNodes(prev => {
        if (prev.has(nodeId)) return prev;
        const next = new Set(prev);
        next.add(nodeId);
        return next;
      });

      if (fg.d3ReheatSimulation) fg.d3ReheatSimulation();
      if (attempts === 1) {
        setFocusDebug({
          ts: Date.now(),
          node_id: nodeId,
          phase: 'hardCenter: node not ready (no coords yet)',
          attempts,
          found: Boolean(node),
        });
      }
      if (attempts < maxAttempts) {
        setTimeout(attempt, 120);
      }
    };

    attempt();
  }, []);

  const selectAndCenterConcept = useCallback(
    (concept: Concept, message: string) => {
      ensureNodeInGraphData(concept);
      revealDomain(concept.domain);
      // match click behavior: focus graph + open details
      setIsChatExpanded(false);
      setIsChatMaximized(false);
      setTimeout(() => {
        setSelectedNode(concept);
        requestFocus(concept.node_id);
        hardCenterOnNodeId(concept.node_id);
        setChatMessages(prev => [...prev, { role: 'system', text: message }]);
      }, 300);
    },
    [ensureNodeInGraphData, revealDomain, requestFocus, hardCenterOnNodeId],
  );

  const handleCommand = useCallback(
    async (command: string) => {
      const trimmed = command.trim();
      if (!trimmed) return;

      setChatMessages(prev => [...prev, { role: 'user', text: trimmed }]);
      setError(null);
      
      // Clear previous chat answer when starting a new command
      setChatAnswer(null);
      setAnswerId(null);
      setLastQuestion('');
      setSuggestedQuestions([]);
      setUsedNodes([]);
      setSuggestedActions([]);

      const parts = trimmed.split(/\s+/);
      const cmd = parts[0].toLowerCase();

      // Known commands that should not be treated as questions
      const knownCommands = ['cleanup', 'preserve', 'help', '?', 'relink', 'link', 'add', 'temp', 'delete', 'path', 'search', 'select', 'focus', 'center'];

      // Natural-language navigation commands
      if (['go', 'open', 'show', 'focus', 'center'].includes(cmd) && parts.length > 1) {
        // Allow phrases like: "focus AWS", "focus on AWS", "focus in on AWS", "center on AWS"
        let searchName = parts.slice(1).join(' ');
        searchName = searchName.replace(/^(in\s+on\s+|on\s+|in\s+)?/i, '').trim();
        try {
          const concept = await resolveConceptByName(searchName);
          selectAndCenterConcept(concept, `Centering on ${concept.name}...`);
        } catch {
          setError(`Concept "${searchName}" not found`);
        }
        return;
      }

      // Check if this is a question (not a known command)
      const isQuestion =
        !knownCommands.includes(cmd) &&
        !trimmed.startsWith('search ') &&
        !trimmed.startsWith('select ') &&
        !trimmed.startsWith('go ') &&
        !trimmed.startsWith('open ') &&
        !trimmed.startsWith('show ') &&
        !trimmed.startsWith('focus ') &&
        !trimmed.startsWith('center ');

      // Expand chat immediately when asking a question
      if (isQuestion) {
        setIsChatExpanded(true);
      }

      // If it's a question, call the chat API
      if (isQuestion) {
        setIsChatLoading(true);
        setLoadingStage('Searching your knowledge graph...');
        
        // Simulate progress stages with timeouts
        const stageTimeouts: ReturnType<typeof setTimeout>[] = [];
        stageTimeouts.push(setTimeout(() => setLoadingStage('Finding relevant concepts...'), 500));
        stageTimeouts.push(setTimeout(() => setLoadingStage('Gathering relationships...'), 1500));
        stageTimeouts.push(setTimeout(() => setLoadingStage('Building context...'), 2500));
        stageTimeouts.push(setTimeout(() => setLoadingStage('Asking Brain Web...'), 3500));
        
        const clearAllTimeouts = () => {
          stageTimeouts.forEach(clearTimeout);
        };
        
        try {
          const response = await fetch('/api/brain-web/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: trimmed }),
          });
          
          // Clear all timeouts once we get a response
          clearAllTimeouts();

          if (!response.ok) {
            throw new Error(`Chat API failed: ${response.statusText}`);
          }

          const data = await response.json();
          setChatAnswer(data.answer);
          setAnswerId(data.answerId || null);
          setLastQuestion(trimmed);
          setSuggestedActions(data.suggestedActions || []);
          
          // Log debug metadata in devtools
          if (data.meta) {
            console.debug('Brain Web meta:', data.meta);
          }
          
          // Always expand chat when answer is received
          setIsChatExpanded(true);
          
          // Only maximize if answer is VERY long (more than 400 characters or has many paragraphs)
          const hasManyParagraphs = data.answer && (data.answer.split('\n\n').length > 4 || data.answer.split('\n').length > 10);
          if (data.answer && (data.answer.length > 400 || hasManyParagraphs)) {
            setIsChatMaximized(true);
          } else {
            // Ensure it's not maximized for normal responses
            setIsChatMaximized(false);
          }
          
          // Scroll to top after content is set
          setTimeout(() => {
            if (chatStreamRef.current) {
              chatStreamRef.current.scrollTop = 0;
            }
          }, 200);
          
          // Suggested follow-ups:
          // Prefer API suggestions if they are good, but always add context-aware questions
          // based on the node types (company vs concept vs character/place) and today's focus areas.
          const apiQuestionsRaw: string[] = data.suggestedQuestions || [];
          const isGenericDefine = (q: string) => {
            const s = (q || '').toLowerCase().trim();
            return s.startsWith('how would you define ') && s.includes('in your own words');
          };
          const apiQuestions = apiQuestionsRaw.filter(q => q && !isGenericDefine(q));

          const contextNode: Concept | null =
            (data.usedNodes && data.usedNodes.length > 0 ? data.usedNodes[0] : null) ||
            ((selectedNode as any) || null);

          const generated = generateCuriousQuestions({
            node: contextNode,
            focus: activeFocusNames,
            lastQ: trimmed,
          });

          const merged = [...apiQuestions, ...generated].filter(Boolean).slice(0, 3);
          setSuggestedQuestions(merged);
          
          setUsedNodes(data.usedNodes || []);
          
          // Don't add to chatMessages - we display it via chatAnswer instead
          // This prevents duplicate display (once as "System", once as "Brain Web")
          
          // Highlight used nodes on graph and center/zoom on them
          if (data.usedNodes && data.usedNodes.length > 0) {
            const nodeIds = new Set(data.usedNodes.map((n: Concept) => n.node_id));
            setGraphData(prev => {
              const updated = { ...prev };
              updated.nodes = prev.nodes.map((n: any) => ({
                ...n,
                __highlighted: nodeIds.has(n.node_id),
              }));
              updated.links = prev.links.map((l: any) => {
                const srcId = typeof l.source === 'object' ? l.source.node_id : l.source;
                const tgtId = typeof l.target === 'object' ? l.target.node_id : l.target;
                return {
                  ...l,
                  __highlighted: nodeIds.has(srcId) || nodeIds.has(tgtId),
                };
              });
              return updated;
            });
            
            // Center and zoom on the used nodes after a short delay to let graph update
            setTimeout(() => {
              if (graphRef.current && data.usedNodes.length > 0) {
                const graphData = graphRef.current.getGraphData ? graphRef.current.getGraphData() : graphRef.current.graphData();
                const highlightedNodes = graphData?.nodes?.filter((n: any) => nodeIds.has(n.node_id)) || [];
                
                if (highlightedNodes.length > 0) {
                  // Calculate center of highlighted nodes
                  let sumX = 0, sumY = 0;
                  highlightedNodes.forEach((n: any) => {
                    if (typeof n.x === 'number' && typeof n.y === 'number') {
                      sumX += n.x;
                      sumY += n.y;
                    }
                  });
                  
                  const centerX = sumX / highlightedNodes.length;
                  const centerY = sumY / highlightedNodes.length;
                  
                  // Center on the group of nodes
                  graphRef.current.centerAt(centerX, centerY, 800);
                  
                  // Zoom to fit the highlighted nodes (less aggressive zoom)
                  if (highlightedNodes.length === 1) {
                    // Single node: moderate zoom
                    graphRef.current.zoom(1.8, 800);
                  } else {
                    // Multiple nodes: zoom to fit them
                    graphRef.current.zoomToFit(800, 50); // 50px padding
                  }
                  
                  graphRef.current.refresh();
                }
              }
            }, 300);
          }
        } catch (err) {
          clearAllTimeouts();
          const message = err instanceof Error ? err.message : 'Failed to get answer';
          setError(message);
          setChatMessages(prev => [...prev, { role: 'system', text: `⚠️ ${message}` }]);
        } finally {
          clearAllTimeouts();
          setIsChatLoading(false);
          setLoadingStage('');
        }
        return;
      }

      try {
        const api = await import('../api-client');

        if (cmd === 'cleanup') {
          const result = await api.cleanupTestData();
          await reloadGraph();
          setChatMessages(prev => [...prev, { role: 'system', text: result.message }]);
        } else if (cmd === 'preserve') {
          const name = parts.slice(1).join(' ') || `state-${Date.now()}`;
          try {
            let image: string | undefined;
            if (graphRef.current?.toDataURL) {
              image = graphRef.current.toDataURL();
            }
            const snapshot = {
              name,
              savedAt: new Date().toISOString(),
              graph: serializeGraph(graphData),
              tempNodes,
              image,
            };
            const stored = JSON.parse(localStorage.getItem('brainweb-preserves') || '[]');
            stored.push(snapshot);
            localStorage.setItem('brainweb-preserves', JSON.stringify(stored));
            setChatMessages(prev => [...prev, { role: 'system', text: `Saved state "${name}"` }]);
          } catch (err) {
            setError('Could not preserve state in this browser');
          }
        } else if (cmd === 'help' || cmd === '?') {
          setChatMessages(prev => [
            ...prev,
            {
              role: 'system',
              text:
                'Examples:\n• search parallel computing\n• select Sentiment Analysis\n• link Tokenization to Sentiment Analysis as USES\n• relink Tokenization to Sentiment Analysis as SUPPORTS\n• link from Linear Algebra as PREREQUISITE (then click a target)\n• add node B2B/B2C domain Business type concept\n• temp Draft Idea\n• delete node Draft Idea\n• preserve lecture-setup\n• cleanup',
            },
          ]);
        } else if (cmd === 'relink' && parts.length >= 4) {
          const toIndex = parts.indexOf('to');
          const asIndex = parts.indexOf('as');
          if (toIndex > 0) {
            const sourceName = parts.slice(1, toIndex).join(' ');
            const targetName = asIndex > toIndex ? parts.slice(toIndex + 1, asIndex).join(' ') : parts.slice(toIndex + 1).join(' ');
            const predicateParts = asIndex > toIndex && asIndex > -1 ? parts.slice(asIndex + 1) : [];
            const predicate = (predicateParts.join(' ').toUpperCase() || 'RELATES_TO').trim();

            const target = await ensureConcept(targetName);
            const source = await ensureConcept(sourceName, { domain: target.domain, type: target.type });

            const getId = (n: any) => (typeof n === 'string' ? n : n.node_id);
            const existing = graphData.links.filter(
              l => getId(l.source) === source.node_id && getId(l.target) === target.node_id,
            );
            const api = await import('../api-client');
            for (const link of existing) {
              try {
                await api.deleteRelationship(source.node_id, target.node_id, link.predicate);
              } catch (err) {
                console.warn('Delete relationship failed, continuing to relink', err);
              }
            }
            await api.createRelationshipByIds(source.node_id, target.node_id, predicate);
            await reloadGraph();
            await maybeAutoSnapshot('relink');
            requestFocus(target.node_id);
            setChatMessages(prev => [
              ...prev,
              {
                role: 'system',
                text: `Re-linked ${source.name} ➜ ${target.name} as ${predicate}${existing.length ? ` (replaced ${existing.map(l => l.predicate).join(', ')})` : ''}`,
              },
            ]);
          } else {
            setError('Usage: relink <source> to <target> as <predicate>');
          }
        } else if (cmd === 'link' && parts[1] === 'from' && parts.length >= 4) {
          const asIndex = parts.indexOf('as');
          if (asIndex > 2) {
            const sourceName = parts.slice(2, asIndex).join(' ');
            const predicate = parts.slice(asIndex + 1).join(' ').toUpperCase() || 'RELATES_TO';
            const source = await ensureConcept(sourceName);
            setLinkingMode({ source, predicate });
            setChatMessages(prev => [
              ...prev,
              { role: 'system', text: `Linking mode: click a node to link from ${source.name} as ${predicate}` },
            ]);
          } else {
            setError('Usage: link from <source> as <predicate>');
          }
        } else if (cmd === 'link' && parts.length >= 4) {
          const toIndex = parts.indexOf('to');
          const asIndex = parts.indexOf('as');
          if (toIndex > 0) {
            const sourceName = parts.slice(1, toIndex).join(' ');
            const targetName = asIndex > toIndex ? parts.slice(toIndex + 1, asIndex).join(' ') : parts.slice(toIndex + 1).join(' ');
            const predicate =
              asIndex > toIndex && asIndex > -1
                ? parts
                    .slice(asIndex + 1)
                    .filter(word => word.toLowerCase() !== 'replace')
                    .join(' ')
                    .toUpperCase() || 'RELATES_TO'
                : 'RELATES_TO';

            const target = await ensureConcept(targetName);
            const source = await ensureConcept(sourceName, { domain: target.domain, type: target.type });
            await api.createRelationshipByIds(source.node_id, target.node_id, predicate);
            await reloadGraph();
            await maybeAutoSnapshot('link');
            requestFocus(target.node_id);
            setChatMessages(prev => [
              ...prev,
              { role: 'system', text: `Linked ${source.name} ➜ ${target.name} (${predicate})` },
            ]);
          } else {
            setError('Usage: link <source> to <target> as <predicate>');
          }
        } else if (cmd === 'add') {
          // Simple default:
          // - "add NVIDIA"  => adds a concept node named NVIDIA
          // Optional:
          // - "add NVIDIA domain Semiconductors"
          // - "add NVIDIA type lecture"
          // - "add node NVIDIA ..." (alias; kept for compatibility)
          const start = parts[1] === 'node' ? 2 : 1;
          if (parts.length <= start) {
            setError('Usage: add <name> [domain <domain>] [type <type>]');
            return;
          }

          const domainIndex = parts.indexOf('domain');
          const typeIndex = parts.indexOf('type');
          const nameEndCandidates = [domainIndex, typeIndex].filter(i => i >= 0);
          const nameEnd = nameEndCandidates.length ? Math.min(...nameEndCandidates) : parts.length;

          const name = parts.slice(start, nameEnd).join(' ');
          const rawDomain =
            domainIndex > -1
              ? parts.slice(domainIndex + 1, typeIndex > -1 && typeIndex > domainIndex ? typeIndex : undefined).join(' ')
              : 'general';
          const rawType = typeIndex > -1 ? parts.slice(typeIndex + 1).join(' ') : 'concept';

          // Treat "node" as a synonym for "concept" so the command can stay simple.
          const type = rawType.trim().toLowerCase() === 'node' ? 'concept' : rawType.trim() || 'concept';
          const domain = rawDomain.trim() || 'general';

          if (!name) {
            setError('Usage: add <name> [domain <domain>] [type <type>]');
            return;
          }

          try {
            // If it exists in this graph/branch already, just focus it.
            const already = await resolveConceptByName(name);
            if (already) {
              requestFocus(already.node_id);
              setChatMessages(prev => [...prev, { role: 'system', text: `“${name}” already exists here, centering instead.` }]);
              return;
            }
          } catch {
            /* ignore and create */
          }

          const newConcept = await api.createConcept({ name, domain, type });
          await reloadGraph();
          await maybeAutoSnapshot('add');
          setSelectedNode(newConcept);
          requestFocus(newConcept.node_id);
          hardCenterOnNodeId(newConcept.node_id);
          setChatMessages(prev => [...prev, { role: 'system', text: `Added ${newConcept.name}` }]);
        } else if (cmd === 'temp') {
          const name = parts.slice(1).join(' ');
          if (!name) {
            setError('Usage: temp <name>');
          } else {
            const tempId = `temp-${Date.now()}`;
            const tempNode: TempNode = {
              node_id: tempId,
              name,
              domain: 'temporary',
              type: 'temp',
              temporary: true,
            };
            setTempNodes(prev => [...prev, tempNode]);
            setGraphData(prev => ({ ...prev, nodes: [...prev.nodes, tempNode] }));
            requestFocus(tempNode.node_id);
            setChatMessages(prev => [...prev, { role: 'system', text: `Created temporary node ${name}` }]);
          }
        } else if (cmd === 'delete' && parts[1] === 'node' && parts.length > 2) {
          const nodeName = parts.slice(2).join(' ');
          const concept = await resolveConceptByName(nodeName);
          await api.deleteConcept(concept.node_id);
          await reloadGraph();
          await maybeAutoSnapshot('delete node');
          setSelectedNode(null);
          setChatMessages(prev => [...prev, { role: 'system', text: `Deleted node ${concept.name}` }]);
        } else if (cmd === 'path' && parts.length > 1) {
          const targetName = parts.slice(1).join(' ');
          try {
            const concept = await resolveConceptByName(targetName);
            selectAndCenterConcept(concept, `Finding path to ${concept.name}...`);
          } catch {
            setError(`Concept "${targetName}" not found`);
          }
        } else if (cmd === 'search') {
          const searchName = parts.slice(1).join(' ');
          if (searchName) {
            try {
              const concept = await resolveConceptByName(searchName);
              selectAndCenterConcept(concept, `Centered on ${concept.name}`);
            } catch {
              setError(`Concept "${searchName}" not found`);
            }
          }
        } else if (cmd === 'select') {
          const searchName = parts.slice(1).join(' ');
          if (searchName) {
            try {
              const concept = await resolveConceptByName(searchName);
              selectAndCenterConcept(concept, `Selected ${concept.name}`);
            } catch {
              setError(`Concept "${searchName}" not found`);
            }
          }
        } else {
          try {
            const concept = await resolveConceptByName(trimmed);
            selectAndCenterConcept(concept, `Centered on ${concept.name}`);
          } catch (err) {
            setError(
              `Concept "${trimmed}" not found. Try: "add node ${trimmed} domain <domain>" or "help" for commands.`,
            );
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Command failed';
        setError(message);
        setChatMessages(prev => [...prev, { role: 'system', text: `⚠️ ${message}` }]);
      }
    },
    [reloadGraph, resolveConceptByName, ensureConcept, graphData.links, graphData, tempNodes, serializeGraph, requestFocus, maybeAutoSnapshot],
  );

  const quickCommands = useMemo(() => {
    const cmds: string[] = [];
    const focus = activeFocusNames.slice(0, 3);

    // Focus-area driven quick actions
    for (const f of focus) {
      cmds.push(`search ${f}`);
    }

    // If you have a selected node, encourage connecting it to a focus area.
    if (selectedNode && focus.length > 0) {
      cmds.push(`link ${selectedNode.name} to ${focus[0]} as relates_to`);
    }

    // If nothing else, provide a simple add example (now that add is simplified).
    if (cmds.length === 0) {
      cmds.push('add New idea');
      cmds.push('search something');
    }

    // Keep it short
    return cmds.slice(0, 4);
  }, [activeFocusNames, selectedNode]);

  if (loading) {
    return (
      <div className="loader">
        <div className="loader__ring" />
        <p className="loader__text">Mapping your knowledge…</p>
      </div>
    );
  }

  return (
    <div className="app-shell" ref={layoutRef}>
      {showGraphModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => setShowGraphModal(false)}
        >
          <div
            style={{
              width: 'min(520px, 96vw)',
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: 16,
              padding: 16,
              boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Graph Collections</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>Create a new graph</div>
              </div>
              <button
                className="pill pill--ghost pill--small"
                style={{ cursor: 'pointer' }}
                onClick={() => setShowGraphModal(false)}
              >
                Close
              </button>
            </div>

            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <input
                value={newGraphName}
                onChange={(e) => setNewGraphName(e.target.value)}
                placeholder="e.g. CS251, Startup Research, Personal Finance"
                style={{
                  flex: 1,
                  height: 36,
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  padding: '0 12px',
                  fontSize: 13,
                }}
              />
              <button
                className="pill pill--primary"
                style={{ cursor: 'pointer' }}
                onClick={async () => {
                  const name = newGraphName.trim();
                  if (!name) return;
                  try {
                    const res = await createGraph(name);
                    setNewGraphName('');
                    setShowGraphModal(false);
                    setActiveGraphId(res.active_graph_id);
                    setActiveBranchId(res.active_branch_id || 'main');
                    setSelectedNode(null);
                    setChatMessages(prev => [...prev, { role: 'system', text: `Created graph → ${name}` }]);
                    await reloadGraph();
                    await refreshGraphs();
                    await refreshBranches();
                  } catch (err) {
                    setGraphSwitchError(err instanceof Error ? err.message : 'Failed to create graph');
                  }
                }}
              >
                Create
              </button>
            </div>

            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>
              Tip: use cmd+1..9 to switch quickly once you have multiple graphs.
            </div>
          </div>
        </div>
      )}
      <div className="graph-pane">
        {focusDebug && (
          <div
            style={{
              position: 'absolute',
              top: 70,
              left: 16,
              zIndex: 20,
              fontSize: 11,
              padding: '8px 10px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'rgba(15, 23, 42, 0.72)',
              color: 'white',
              maxWidth: 360,
              whiteSpace: 'pre-wrap',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong>Focus debug</strong>
              <button
                className="pill pill--ghost pill--small"
                style={{ cursor: 'pointer', padding: '2px 8px' }}
                onClick={() => setFocusDebug(null)}
              >
                hide
              </button>
            </div>
            <div style={{ marginTop: 6, opacity: 0.9 }}>
              {`phase: ${focusDebug.phase}\nnode: ${focusDebug.node_id || ''}\nattempts: ${focusDebug.attempts ?? ''}\nfound: ${String(focusDebug.found ?? '')}\nxy: ${typeof focusDebug.x === 'number' ? focusDebug.x.toFixed(1) : ''}, ${typeof focusDebug.y === 'number' ? focusDebug.y.toFixed(1) : ''}\nzoom: ${typeof focusDebug.zoom_before === 'number' ? focusDebug.zoom_before.toFixed(2) : ''} → ${typeof focusDebug.zoom_after === 'number' ? focusDebug.zoom_after.toFixed(2) : ''}\nerror: ${focusDebug.error || ''}`}
            </div>
          </div>
        )}
        <div className="graph-header">
          <div>
            <p className="eyebrow">Brain Web / Prezi View</p>
            <h1 className="title">Lecture-friendly knowledge bubbles</h1>
          </div>
          <ExplorerToolbar
            demoMode={IS_DEMO_MODE}
            graphs={graphs}
            activeGraphId={activeGraphId}
            onSelectGraph={(next) => {
              (async () => {
                try {
                  if (IS_DEMO_MODE) return;
                  await selectGraph(next);
                  setActiveGraphId(next);
                  setActiveBranchId('main');
                  setSelectedNode(null);
                  setChatMessages(prev => [...prev, { role: 'system', text: `Switched graph → ${graphs.find(g => g.graph_id === next)?.name || next}` }]);
                  await reloadGraph();
                  await refreshGraphs();
                  await refreshBranches();
                } catch (err) {
                  setGraphSwitchError(err instanceof Error ? err.message : 'Failed to switch graph');
                }
              })();
            }}
            onRequestCreateGraph={() => {
              if (IS_DEMO_MODE) return;
              setShowGraphModal(true);
            }}
            branches={branches}
            activeBranchId={activeBranchId}
            onSelectBranch={(next) => {
              (async () => {
                try {
                  if (IS_DEMO_MODE) return;
                  await selectBranch(next);
                  setActiveBranchId(next);
                  setSelectedNode(null);
                  setBranchCompare(null);
                  setBranchCompareLLM(null);
                  setChatMessages(prev => [...prev, { role: 'system', text: `Switched branch → ${branches.find(b => b.branch_id === next)?.name || next}` }]);
                  await reloadGraph();
                  await refreshGraphs();
                  await refreshBranches();
                } catch (err) {
                  setGraphSwitchError(err instanceof Error ? err.message : 'Failed to switch branch');
                }
              })();
            }}
            graphSwitchError={graphSwitchError}
            canFocus={Boolean(selectedNode)}
            onFocus={() => {
              if (!selectedNode) return;
              hardCenterOnNodeId(selectedNode.node_id);
            }}
            canFork={IS_DEMO_MODE ? false : Boolean(selectedNode)}
            onFork={() => {
              (async () => {
                if (IS_DEMO_MODE) return;
                if (!selectedNode) {
                  setChatMessages(prev => [...prev, { role: 'system', text: 'Select a node first to fork from.' }]);
                  return;
                }
                const name = window.prompt('New branch name:', `Fork from ${selectedNode.name}`) || '';
                const trimmed = name.trim();
                if (!trimmed) return;
                const depthRaw = window.prompt('Fork depth (hops):', '2') || '2';
                const depth = Math.max(0, Math.min(6, parseInt(depthRaw, 10) || 2));
                try {
                  const b = await createBranch(trimmed);
                  await forkBranchFromNode(b.branch_id, selectedNode.node_id, depth);
                  await selectBranch(b.branch_id);
                  setActiveBranchId(b.branch_id);
                  setChatMessages(prev => [...prev, { role: 'system', text: `Forked branch → ${trimmed} (depth ${depth})` }]);
                  await reloadGraph();
                  await refreshBranches();
                } catch (err) {
                  setGraphSwitchError(err instanceof Error ? err.message : 'Failed to fork branch');
                }
              })();
            }}
            canCompare={IS_DEMO_MODE ? false : branches.length > 1}
            onCompare={() => {
              (async () => {
                if (IS_DEMO_MODE) return;
                if (branches.length <= 1) return;
                const options = branches
                  .filter(b => b.branch_id !== activeBranchId)
                  .map(b => `${b.branch_id} — ${b.name || ''}`)
                  .join('\n');
                const pick =
                  window.prompt(
                    `Compare current branch (${activeBranchId}) with:\n${options}\n\nPaste branch_id:`,
                    branches.find(b => b.branch_id !== activeBranchId)?.branch_id || '',
                  ) || '';
                const other = pick.trim();
                if (!other) return;
                setCompareOtherBranchId(other);
                try {
                  const diff = await compareBranches(activeBranchId, other);
                  setBranchCompare(diff);
                  setBranchCompareLLM(null);
                  setChatMessages(prev => [...prev, { role: 'system', text: `Compared branches → ${activeBranchId} vs ${other}` }]);
                } catch (err) {
                  setGraphSwitchError(err instanceof Error ? err.message : 'Failed to compare branches');
                }
              })();
            }}
            onSaveState={() => {
              (async () => {
                if (IS_DEMO_MODE) return;
                const name = window.prompt('Snapshot name:', `Snapshot ${new Date().toLocaleString()}`) || '';
                const trimmed = name.trim();
                if (!trimmed) return;
                try {
                  await createSnapshot({ name: trimmed, focused_node_id: selectedNode?.node_id || null });
                  setChatMessages(prev => [...prev, { role: 'system', text: `Saved snapshot → ${trimmed}` }]);
                } catch (err) {
                  setGraphSwitchError(err instanceof Error ? err.message : 'Failed to create snapshot');
                }
              })();
            }}
            onRestore={() => {
              (async () => {
                if (IS_DEMO_MODE) return;
                try {
                  const data = await listSnapshots(20);
                  const items = data.snapshots || [];
                  if (items.length === 0) {
                    setChatMessages(prev => [...prev, { role: 'system', text: 'No snapshots found for this branch.' }]);
                    return;
                  }
                  const pick = window.prompt(
                    'Paste snapshot_id to restore (this creates a new restored branch):\n' +
                      items.map(s => `${s.snapshot_id} — ${s.name}`).join('\n'),
                    items[0].snapshot_id,
                  ) || '';
                  const snapshotId = pick.trim();
                  if (!snapshotId) return;
                  const res = await restoreSnapshot(snapshotId);
                  if (res?.restored_branch_id) {
                    await selectBranch(res.restored_branch_id);
                    setActiveBranchId(res.restored_branch_id);
                    await refreshBranches();
                    await reloadGraph();
                    setChatMessages(prev => [...prev, { role: 'system', text: `Restored snapshot → new branch ${res.restored_branch_id}` }]);
                  }
                } catch (err) {
                  setGraphSwitchError(err instanceof Error ? err.message : 'Failed to restore snapshot');
                }
              })();
            }}
            nodesCount={graphData.nodes.length}
            linksCount={graphData.links.length}
            domainsCount={uniqueDomains.length}
            showLectureIngest={IS_DEMO_MODE ? false : showLectureIngest}
            onToggleLectureIngest={() => {
              if (IS_DEMO_MODE) return;
              setShowLectureIngest(v => !v);
            }}
            lecturePopover={
              <div style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: '8px',
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                padding: '12px',
                boxShadow: 'var(--shadow)',
                zIndex: 1000,
                minWidth: '320px',
                maxWidth: '420px',
                maxHeight: '70vh',
                overflowY: 'auto',
              }}>
                <LectureIngestForm
                  onIngest={handleLectureIngest}
                  isLoading={lectureIngestLoading}
                  result={lectureIngestResult}
                  onClose={() => setShowLectureIngest(false)}
                />
              </div>
            }
            showControls={showControls}
            onToggleControls={() => setShowControls(v => !v)}
            focusMode={focusMode}
            onToggleFocusMode={() => {
              setFocusMode(v => !v);
              if (!selectedNode) {
                setChatMessages(prev => [...prev, { role: 'system', text: 'Focus Mode: select a node to emphasize its neighborhood.' }]);
              }
            }}
          />

            {/* Segments Viewer Panel */}
            {showSegments && lectureSegments && (
              <div style={{
                position: 'fixed',
                bottom: '20px',
                right: '20px',
                width: '500px',
                maxHeight: '70vh',
                backgroundColor: 'white',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '16px',
                boxShadow: 'var(--shadow)',
                zIndex: 1001,
                overflow: 'auto',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>
                    Lecture Segments ({lectureSegments.length})
                  </h3>
                  <button
                    onClick={() => setShowSegments(false)}
                    style={{
                      background: 'none',
                      border: 'none',
                      fontSize: '20px',
                      cursor: 'pointer',
                      color: '#666',
                      padding: '0 8px',
                    }}
                  >
                    ×
                  </button>
                </div>
                
                {lectureSegments.map((segment, idx) => (
                  <div
                    key={segment.segment_id}
                    style={{
                      marginBottom: '16px',
                      padding: '12px',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      backgroundColor: '#f9f9f9',
                    }}
                  >
                    {segment.lecture_title && (
                      <div style={{ fontSize: '12px', fontWeight: '600', color: '#666', marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid #f0f0f0' }}>
                        📄 {segment.lecture_title}
                      </div>
                    )}
                    <div style={{ fontWeight: '600', marginBottom: '8px', fontSize: '14px' }}>
                      Segment {segment.segment_index + 1}
                    </div>
                    
                    {segment.summary && (
                      <div style={{ marginBottom: '8px', fontSize: '13px', color: '#666', fontStyle: 'italic' }}>
                        {segment.summary}
                      </div>
                    )}
                    
                    <div style={{ marginBottom: '8px', fontSize: '13px', color: '#333' }}>
                      {segment.text.substring(0, 200)}
                      {segment.text.length > 200 && '...'}
                    </div>
                    
                    {segment.style_tags && segment.style_tags.length > 0 && (
                      <div style={{ marginBottom: '8px', fontSize: '12px' }}>
                        <strong>Style:</strong>{' '}
                        {segment.style_tags.map((tag, i) => (
                          <span key={i} style={{
                            display: 'inline-block',
                            marginRight: '4px',
                            padding: '2px 6px',
                            backgroundColor: '#e0e0e0',
                            borderRadius: '3px',
                            fontSize: '11px',
                          }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    
                    {segment.covered_concepts.length > 0 && (
                      <div style={{ marginBottom: '8px', fontSize: '12px' }}>
                        <strong>Concepts:</strong>{' '}
                        {segment.covered_concepts.map((c, i) => (
                          <span key={c.node_id} style={{ marginRight: '8px', color: '#0070f3' }}>
                            {c.name}
                            {i < segment.covered_concepts.length - 1 && ','}
                          </span>
                        ))}
                      </div>
                    )}
                    
                    {segment.analogies.length > 0 && (
                      <div style={{ fontSize: '12px' }}>
                        <strong>Analogies:</strong>{' '}
                        {segment.analogies.map((a, i) => (
                          <span key={a.analogy_id} style={{ marginRight: '8px', color: '#28a745' }}>
                            &quot;{a.label}&quot;
                            {i < segment.analogies.length - 1 && ', '}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
        </div>

        {showControls && (
          <div className="graph-controls graph-controls--compact">
            <div className="control-card control-card--compact">
              <div className="control-header">
                <span>Domain spread</span>
                <span className="control-value">{domainSpread.toFixed(1)}x</span>
              </div>
            <input
              type="range"
              id="domain-spread"
              name="domain-spread"
              min={0.7}
              max={1.8}
              step={0.1}
              value={domainSpread}
              onChange={e => {
                const newValue = parseFloat(e.target.value);
                console.log('[Domain Spread] Slider changed:', { oldValue: domainSpread, newValue });
                setDomainSpread(newValue);
              }}
            />
          </div>
          <div className="control-card control-card--compact">
            <div className="control-header">
              <span>Bubble padding</span>
              <span className="control-value">{bubbleSpacing.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              id="bubble-spacing"
              name="bubble-spacing"
              min={0.85}
              max={1.4}
              step={0.05}
              value={bubbleSpacing}
              onChange={e => {
                const newValue = parseFloat(e.target.value);
                console.log('[Bubble Spacing] Slider changed:', { oldValue: bubbleSpacing, newValue });
                setBubbleSpacing(newValue);
              }}
            />
          </div>
          <div className="control-card control-card--legend control-card--compact">
            <div className="control-header">
              <span>Domains</span>
              <button
                className={`pill ${selectedDomains.size === 0 ? 'pill--active' : ''}`}
                onClick={() => setSelectedDomains(new Set())}
              >
                Show all
              </button>
            </div>
            <div className="legend">
              {uniqueDomains.map(domain => (
                <button
                  key={domain}
                  className={`pill ${selectedDomains.has(domain) ? 'pill--active' : ''}`}
                  style={{ borderColor: domainColors.get(domain), color: domainColors.get(domain) }}
                  onClick={() =>
                    setSelectedDomains(prev => {
                      const next = new Set(prev);
                      if (next.has(domain)) {
                        next.delete(domain);
                      } else {
                        next.add(domain);
                      }
                      return next;
                    })
                  }
                >
                  <span className="legend-dot" style={{ background: domainColors.get(domain) }} />
                  {domain}
                </button>
              ))}
            </div>
          </div>
        </div>
        )}

        <div className="graph-canvas" ref={graphCanvasRef}>
          {graphData.nodes.length > 0 && (
            <ForceGraph2D
              ref={graphRef}
              graphData={displayGraph}
              nodeRelSize={8}
              backgroundCanvasObject={(ctx: CanvasRenderingContext2D, globalScale: number) => {
                if (!domainBubbles || domainBubbles.length === 0) return;
                ctx.save();
                domainBubbles.forEach((b) => {
                  ctx.beginPath();
                  ctx.arc(b.x, b.y, b.r, 0, 2 * Math.PI, false);
                  ctx.fillStyle = toRgba(b.color, 0.05);
                  ctx.fill();
                  ctx.lineWidth = Math.max(1, 2 / Math.max(1, globalScale));
                  ctx.strokeStyle = toRgba(b.color, 0.10);
                  ctx.stroke();
                });
                ctx.restore();
              }}
              linkColor={(link: any) => {
                if (link.__highlighted) return toRgba('#118ab2', 0.65);

                const srcId =
                  typeof link.source === 'object' && link.source
                    ? link.source.node_id
                    : String(link.source ?? '');
                const tgtId =
                  typeof link.target === 'object' && link.target
                    ? link.target.node_id
                    : String(link.target ?? '');

                if (selectedNode?.node_id) {
                  const inNeighborhood = selectedNeighborhoodIds.has(srcId) || selectedNeighborhoodIds.has(tgtId);
                  return inNeighborhood ? toRgba('#64748b', 0.45) : toRgba('#94a3b8', focusMode ? 0.06 : 0.12);
                }

                return toRgba('#94a3b8', 0.32);
              }}
              linkWidth={(link: any) => {
                if (link.__highlighted) return 3;
                if (!selectedNode?.node_id) return 1.25;
                const srcId =
                  typeof link.source === 'object' && link.source
                    ? link.source.node_id
                    : String(link.source ?? '');
                const tgtId =
                  typeof link.target === 'object' && link.target
                    ? link.target.node_id
                    : String(link.target ?? '');
                const inNeighborhood = selectedNeighborhoodIds.has(srcId) || selectedNeighborhoodIds.has(tgtId);
                return inNeighborhood ? 1.6 : 0.8;
              }}
              linkDirectionalParticles={(link: any) => {
                if (link.__highlighted) return 2;
                if (!selectedNode?.node_id) return 0;
                const srcId =
                  typeof link.source === 'object' && link.source
                    ? link.source.node_id
                    : String(link.source ?? '');
                const tgtId =
                  typeof link.target === 'object' && link.target
                    ? link.target.node_id
                    : String(link.target ?? '');
                const inNeighborhood = selectedNeighborhoodIds.has(srcId) || selectedNeighborhoodIds.has(tgtId);
                return inNeighborhood ? 1 : 0;
              }}
              linkDirectionalParticleWidth={2.5}
              linkLabel={(link: any) => link.predicate || ''}
              nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
                const color = domainColors.get(node.domain) || '#94a3b8';
                const label = node.name;
                const isSelected = selectedNode?.node_id === node.node_id;
                const isFocused = selectedDomains.size === 0 || selectedDomains.has(node.domain);
                const isNeighbor = selectedNode?.node_id ? selectedNeighborhoodIds.has(node.node_id) : false;
                const radius = expandedNodes.has(node.node_id) ? 18 : 12;
                const baseFont = isSelected ? 14 : isNeighbor ? 12 : 11;
                const textSize = Math.max(9, baseFont / Math.sqrt(globalScale));
                const isTemp = node.temporary;

                // Opacity rules:
                // - If a node is selected: emphasize neighborhood; dim the rest.
                // - Otherwise: mild global opacity, plus slight dim for "far" nodes.
                let alpha = 0.85;
                if (selectedNode?.node_id) {
                  alpha = isSelected || isNeighbor ? 1 : (focusMode ? 0.12 : 0.26);
                } else if (graphViewport.width > 0 && graphViewport.height > 0) {
                  const k = zoomTransform.k || zoomLevel || 1;
                  const cx = (graphViewport.width / 2 - zoomTransform.x) / k;
                  const cy = (graphViewport.height / 2 - zoomTransform.y) / k;
                  const dist = Math.hypot((node.x ?? 0) - cx, (node.y ?? 0) - cy);
                  const visibleRadius = (Math.min(graphViewport.width, graphViewport.height) * 0.55) / k;
                  if (dist > visibleRadius) alpha = 0.58;
                }
                if (!isFocused) alpha *= 0.55;

                ctx.beginPath();
                ctx.arc(node.x, node.y, radius + 7, 0, 2 * Math.PI, false);
                ctx.fillStyle = isTemp ? toRgba('#ffffff', 0.18) : toRgba(color, node.__highlighted || isSelected ? 0.28 : 0.18);
                ctx.fill();

                ctx.beginPath();
                ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
                ctx.fillStyle = isTemp ? '#ffffff' : color;
                ctx.globalAlpha = alpha;
                ctx.fill();
                ctx.globalAlpha = 1;

                ctx.lineWidth = isSelected ? 3 : 1.5;
                ctx.strokeStyle = isSelected ? '#0f172a' : toRgba('#ffffff', 0.75);
                ctx.globalAlpha = alpha;
                ctx.stroke();
                ctx.globalAlpha = 1;

                // Zoom-based label visibility:
                // - far: no labels
                // - mid: only selected/hovered/high-degree
                // - close: labels for "visible" nodes near viewport center
                let shouldLabel = true;
                if (zoomLevel < 0.5) {
                  shouldLabel = false;
                } else if (zoomLevel < 1.5) {
                  const deg = degreeById.get(node.node_id) || 0;
                  shouldLabel = Boolean(isSelected || node.__highlighted || deg >= highDegreeThreshold);
                } else {
                  if (graphViewport.width > 0 && graphViewport.height > 0) {
                    const k = zoomTransform.k || zoomLevel || 1;
                    const cx = (graphViewport.width / 2 - zoomTransform.x) / k;
                    const cy = (graphViewport.height / 2 - zoomTransform.y) / k;
                    const dist = Math.hypot((node.x ?? 0) - cx, (node.y ?? 0) - cy);
                    const labelRadius = (Math.min(graphViewport.width, graphViewport.height) * 0.7) / k;
                    shouldLabel = dist <= labelRadius || isSelected || node.__highlighted;
                  }
                }

                if (shouldLabel) {
                  const x = node.x ?? 0;
                  const y = (node.y ?? 0) + radius + textSize;
                  ctx.save();
                  ctx.globalAlpha = alpha;
                  ctx.font = `600 ${textSize}px 'Space Grotesk', 'Inter', sans-serif`;
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.lineJoin = 'round';
                  ctx.miterLimit = 2;

                  // Subtle dark halo for readability, then neutral light text on top.
                  ctx.strokeStyle = 'rgba(15, 23, 42, 0.65)';
                  ctx.lineWidth = Math.max(3, 4 / Math.sqrt(globalScale));
                  ctx.strokeText(label, x, y);
                  ctx.fillStyle = isTemp ? 'rgba(15, 23, 42, 0.95)' : 'rgba(248, 250, 252, 0.95)';
                  ctx.fillText(label, x, y);
                  ctx.restore();
                }

                const hidden = hiddenCounts.get(node.node_id) || 0;
                if (hidden > 0) {
                  const badgeR = Math.max(8, 10 / Math.sqrt(globalScale));
                  const bx = node.x + radius + badgeR + 2;
                  const by = node.y - radius - badgeR - 2;
                  ctx.beginPath();
                  ctx.arc(bx, by, badgeR, 0, 2 * Math.PI, false);
                  ctx.fillStyle = '#0f172a';
                  ctx.fill();
                  ctx.lineWidth = 2;
                  ctx.strokeStyle = toRgba('#ffffff', 0.9);
                  ctx.stroke();
                  ctx.font = `700 ${Math.max(10, 12 / Math.sqrt(globalScale))}px 'Inter', sans-serif`;
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.fillStyle = '#ffffff';
                  ctx.fillText(String(hidden), bx, by);
                }
              }}
              onNodeClick={(node: any) => {
                handleNodeClick(node);
                setIsChatExpanded(false); // Minimize chat when clicking node
              }}
              onNodeRightClick={(node: any) => {
                // Right click: collapse/expand a small local branch (depth=1)
                const rootId = String(node.node_id);
                if (collapsedGroups[rootId]) {
                  setCollapsedGroups((prev) => {
                    const next = { ...prev };
                    delete next[rootId];
                    return next;
                  });
                  setChatMessages((p) => [...p, { role: 'system', text: `Expanded branch for ${node.name}` }]);
                  return;
                }
                const ids = computeCollapseIds(rootId, 1);
                if (ids.length === 0) {
                  setChatMessages((p) => [...p, { role: 'system', text: `Nothing to collapse under ${node.name}` }]);
                  return;
                }
                setCollapsedGroups((prev) => ({ ...prev, [rootId]: ids }));
                setChatMessages((p) => [...p, { role: 'system', text: `Collapsed branch for ${node.name} (${ids.length})` }]);
              }}
              onBackgroundClick={() => {
                setSelectedNode(null);
                setFocusedNodeId(null); // Clear focus when clicking background
                setIsChatExpanded(false); // Minimize chat when clicking background
                setIsChatMaximized(false); // Also minimize if maximized
                
                // Auto zoom out when clicking background
                if (graphRef.current) {
                  // zoom() can be called with no args to get current zoom
                  const currentZoomValue = typeof graphRef.current.zoom === 'function' 
                    ? (graphRef.current.zoom as () => number)() 
                    : 1;
                  if (currentZoomValue > 1.2) {
                    graphRef.current.zoomToFit(600, 100);
                  }
                }
              }}
              onNodeHover={handleNodeHover}
              cooldownTicks={120}
              onEngineStop={() => {
                if (!graphRef.current) return;
                
                // Update current zoom state
                // zoom() can be called with no args to get current zoom
                const currentZoomValue = typeof graphRef.current.zoom === 'function' 
                  ? (graphRef.current.zoom as () => number)() 
                  : 1;
                setCurrentZoom(currentZoomValue);
                
                const hasFocusTarget = Boolean(pendingFocusId || selectedNode || usedNodes.length > 0 || focusedNodeId);
                // Only auto-zoom if there's no focus target and no highlighted nodes
                if (!hasFocusTarget) {
                  // Only zoom out if we're zoomed in
                  if (currentZoomValue > 1.1) {
                    graphRef.current.zoomToFit(600, 100); // Slower animation, with padding
                  }
                }
                if (pendingFocusId) {
                  focusWithRetries(pendingFocusId);
                }
                updateSelectedPosition(selectedNode || undefined);
                recomputeDomainBubbles();
              }}
              onZoom={() => {
                // Update zoom state when user manually zooms
                // (react-force-graph) passes a d3-zoom transform here: { k, x, y }
                // We'll still fall back to fg.zoom() in case the callback signature differs.
                const fg = graphRef.current;
                const currentZoomValue =
                  fg && typeof fg.zoom === 'function' ? (fg.zoom as () => number)() : 1;
                setCurrentZoom(currentZoomValue);
                setZoomLevel(currentZoomValue);
                  
                  // Clear focus if zooming out significantly
                if (currentZoomValue < 1.1 && focusedNodeId) {
                  setFocusedNodeId(null);
                }
              }}
              onZoomEnd={(t: any) => {
                // Prefer transform (k,x,y) when available for viewport-based heuristics.
                if (t && typeof t.k === 'number') {
                  setZoomTransform({ k: t.k, x: typeof t.x === 'number' ? t.x : 0, y: typeof t.y === 'number' ? t.y : 0 });
                  setZoomLevel(t.k);
                  setCurrentZoom(t.k);
                  return;
                }
                // Fallback: query current zoom from the graph instance
                const fg = graphRef.current;
                const z = fg && typeof fg.zoom === 'function' ? (fg.zoom as () => number)() : 1;
                setZoomLevel(z);
                setCurrentZoom(z);
              }}
              backgroundColor="rgba(0,0,0,0)"
            />
          )}
          {graphData.nodes.length > 0 && (
            <GraphMiniMap graphRef={graphRef as any} />
          )}
          {focusMode && !selectedNode && (
            <div className="focus-hint">
              Select a node to focus.
            </div>
          )}
          {selectedNode && selectedPosition && (
            <div
              className="node-tag"
              style={{
                left: selectedPosition.x + 16,
                top: selectedPosition.y - 10,
              }}
            >
              <p className="eyebrow">Context</p>
              <div className="node-tag__title">{selectedNode.name}</div>
              <div className="node-tag__meta">
                <span
                  className="badge"
                  style={{
                    background: toRgba(domainColors.get(selectedNode.domain) || '#0f172a', 0.16),
                    color: domainColors.get(selectedNode.domain),
                  }}
                >
                  {selectedNode.domain}
                </span>
                <span className="badge badge--soft">{selectedNode.type}</span>
              </div>
              <div className="node-tag__context">
                Part of {selectedNode.domain} · is a {selectedNode.type}
              </div>
            </div>
          )}
          {selectedNode && (
            <div className="node-card">
              <div className="node-card__header">
                <div>
                  <p className="eyebrow">Selected bubble</p>
                  <h3>{selectedNode.name}</h3>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <Link
                    href={`/concepts/${selectedNode.node_id}`}
                    className="pill"
                    style={{ textDecoration: 'none', cursor: 'pointer' }}
                  >
                    Open Concept Board →
                  </Link>
                  {(() => {
                    const count = hiddenCounts.get(selectedNode.node_id) || 0;
                    const isCollapsed = Boolean(collapsedGroups[selectedNode.node_id]);
                    return (
                      <button
                        type="button"
                        className="pill pill--ghost"
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          const rootId = selectedNode.node_id;
                          if (isCollapsed) {
                            setCollapsedGroups((prev) => {
                              const next = { ...prev };
                              delete next[rootId];
                              return next;
                            });
                            setChatMessages((p) => [...p, { role: 'system', text: `Expanded branch for ${selectedNode.name}` }]);
                            return;
                          }
                          const ids = computeCollapseIds(rootId, 2, filteredGraph);
                          if (ids.length === 0) {
                            setChatMessages((p) => [...p, { role: 'system', text: `Nothing to collapse under ${selectedNode.name}` }]);
                            return;
                          }
                          setCollapsedGroups((prev) => ({ ...prev, [rootId]: ids }));
                          setChatMessages((p) => [...p, { role: 'system', text: `Collapsed branch for ${selectedNode.name} (${ids.length})` }]);
                        }}
                        title={isCollapsed ? 'Expand previously collapsed branch' : 'Collapse a small subtree (depth 2)'}
                      >
                        {isCollapsed ? `Expand (${count})` : 'Collapse branch'}
                      </button>
                    );
                  })()}
                  <button className="pill" onClick={() => setSelectedNode(null)}>
                    Close
                  </button>
                </div>
              </div>
              <div className="node-card__meta">
                <span className="badge" style={{ background: toRgba(domainColors.get(selectedNode.domain) || '#0f172a', 0.16), color: domainColors.get(selectedNode.domain) }}>
                  {selectedNode.domain}
                </span>
                <span className="badge badge--soft">{selectedNode.type}</span>
                {selectedNode.notes_key && <span className="badge badge--soft">Notes: {selectedNode.notes_key}</span>}
                {selectedNode.lecture_key && (
                  <span className="badge badge--soft">Lecture: {selectedNode.lecture_key}</span>
                )}
              </div>
              <p className="node-card__id">{selectedNode.node_id}</p>

              {/* Resources Section */}
              <div className="node-card__section">
                <p className="eyebrow">Resources</p>
                {isResourceLoading && <p className="node-card__hint">Loading resources…</p>}
                {resourceError && <p className="node-card__error">{resourceError}</p>}
                {!isResourceLoading && !resourceError && selectedResources.length === 0 && (
                  <p className="node-card__hint">No resources attached yet.</p>
                )}
                <div className="resource-list">
                  {selectedResources.map(res => (
                    <div key={res.resource_id} className="resource-item">
                      <div className="resource-item__header">
                        <span className="badge badge--soft">{res.kind}</span>
                        {res.title && <span className="resource-item__title">{res.title}</span>}
                      </div>
                      {(() => {
                        // Construct full URL - if it's a relative path starting with /static, prepend API base URL
                        const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
                        const resourceUrl = res.url.startsWith('/static/') || res.url.startsWith('http') 
                          ? (res.url.startsWith('http') ? res.url : `${apiBaseUrl}${res.url}`)
                          : res.url;
                        
                        return (
                          <>
                            {res.kind === 'image' && (
                              <div className="resource-item__preview">
                                <img src={resourceUrl} alt={res.title || res.caption || 'resource image'} />
                              </div>
                            )}
                            {res.kind === 'pdf' && (
                              <a href={resourceUrl} target="_blank" rel="noreferrer" className="resource-item__link">
                                Open PDF
                              </a>
                            )}
                            {res.kind === 'audio' && (
                              <audio controls src={resourceUrl} className="resource-item__audio" />
                            )}
                            {res.kind === 'web_link' && (
                              <a href={resourceUrl} target="_blank" rel="noreferrer" className="resource-item__link">
                                Open link
                              </a>
                            )}
                            {/* Fallback for other resource types */}
                            {!['image', 'pdf', 'audio', 'web_link'].includes(res.kind) && (
                              <a href={resourceUrl} target="_blank" rel="noreferrer" className="resource-item__link">
                                Open resource
                              </a>
                            )}
                          </>
                        );
                      })()}
                      {res.caption && <p className="resource-item__caption">{res.caption}</p>}
                    </div>
                  ))}
                </div>
                {/* Future: Brain Web chat can suggest or auto-generate diagrams and attach them here as resources.
                    This would integrate with the chat system to create visual resources on demand. */}
              </div>

              {/* Upload Control */}
              {selectedNode && !IS_DEMO_MODE && (
                <div className="resource-upload">
                  <label className="resource-upload__label">
                    <span className="pill pill--ghost">Attach file</span>
                    <input
                      type="file"
                      style={{ display: 'none' }}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          setIsResourceLoading(true);
                          setResourceError(null);
                          const res = await uploadResourceForConcept(file, selectedNode.node_id, file.name);
                          setSelectedResources(prev => [...prev, res]);
                        } catch (err) {
                          setResourceError(err instanceof Error ? err.message : 'Failed to upload resource');
                        } finally {
                          setIsResourceLoading(false);
                          e.target.value = '';
                        }
                      }}
                    />
                  </label>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div 
        className={`chat-pane ${isChatMaximized ? 'chat-pane--maximized' : isChatExpanded ? 'chat-pane--expanded' : 'chat-pane--collapsed'}`}
        style={{ 
          height: isChatMaximized ? '70vh' : isChatExpanded ? '360px' : '300px',
          minHeight: 260,
        }}
      >
        <div className="chat-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <p className="eyebrow" style={{ marginBottom: '2px' }}>Graph Concierge</p>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Docked panel</span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
              {(['Ask', 'Explore Paths', 'Summaries', 'Gaps'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`pill pill--small ${chatMode === mode ? 'pill--active' : 'pill--ghost'}`}
                  onClick={() => setChatMode(mode)}
                  style={{ cursor: 'pointer' }}
                  title="Mode placeholder (UI scaffold)"
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {isChatMaximized && (
              <button
                className="pill pill--ghost"
                onClick={() => {
                  setIsChatMaximized(false);
                  setIsChatExpanded(false); // Also collapse to default size
                }}
                style={{ fontSize: '12px', padding: '6px 12px', cursor: 'pointer', border: '1px solid var(--border)' }}
              >
                Minimize
              </button>
            )}
            <div className="pill pill--ghost">Live graph control</div>
          </div>
        </div>

        {linkingMode && (
          <div className="chips" style={{ marginBottom: '0' }}>
            <button className="chip chip--warning" onClick={() => setLinkingMode(null)}>
              Cancel linking mode
            </button>
          </div>
        )}

        <div 
          ref={chatStreamRef}
          className="chat-stream" 
          style={{ marginTop: '0', marginBottom: '0' }}
        >
          {error && <div className="chat-error">{error}</div>}
          {chatMessages.map((msg, idx) => (
            <div key={idx} className={`chat-bubble ${msg.role === 'user' ? 'chat-bubble--user' : ''}`}>
              <div className="chat-role">{msg.role === 'user' ? 'You' : 'System'}</div>
              <div className="chat-text">{msg.text}</div>
            </div>
          ))}
          {isChatLoading && (
            <div className="chat-empty">
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                <div className="loader__ring" style={{ width: '32px', height: '32px', borderWidth: '3px' }} />
                <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
                  {loadingStage || 'Thinking...'}
                </p>
              </div>
            </div>
          )}
          {chatAnswer && (
            <div className="chat-bubble" id="chat-answer-top">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div className="chat-role">Brain Web</div>
                {teachingStyle && (
                  <Link
                    href="/profile-customization"
                    style={{
                      fontSize: '11px',
                      color: 'var(--accent)',
                      textDecoration: 'none',
                      padding: '2px 8px',
                      background: 'rgba(17, 138, 178, 0.1)',
                      borderRadius: '12px',
                    }}
                    title="View/Edit Teaching Style"
                  >
                    Answering as: {teachingStyle.tone.substring(0, 30)}...
                  </Link>
                )}
              </div>
              {!isEditingAnswer ? (
                <div 
                  className="chat-text" 
                  style={{ 
                    whiteSpace: 'pre-wrap',
                    lineHeight: '1.6',
                    marginBottom: suggestedActions.length > 0 ? '12px' : '0'
                  }}
                >
                  {chatAnswer}
                </div>
              ) : (
                <textarea
                  value={editedAnswer}
                  onChange={(e) => setEditedAnswer(e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: '150px',
                    padding: '8px',
                    fontSize: '14px',
                    fontFamily: 'inherit',
                    border: '1px solid var(--border, #ccc)',
                    borderRadius: '4px',
                    resize: 'vertical',
                    whiteSpace: 'pre-wrap',
                    lineHeight: '1.6',
                  }}
                />
              )}
              {answerId && (
                <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, flexWrap: 'wrap' }}>
                  {!isEditingAnswer ? (
                    <>
                      <span style={{ color: 'var(--muted)' }}>Was this helpful?</span>
                      <button
                        className="chip"
                        style={{ fontSize: '12px', padding: '4px 8px', cursor: 'pointer' }}
                        onClick={async () => {
                          if (!answerId) return;
                          try {
                            const { submitFeedback } = await import('../api-client');
                            await submitFeedback(answerId, 1, null, lastQuestion);
                            setChatMessages(prev => [...prev, { 
                              role: 'system', 
                              text: '✓ Feedback submitted: helpful' 
                            }]);
                          } catch (err) {
                            console.error('Failed to submit feedback:', err);
                          }
                        }}
                      >
                        👍
                      </button>
                      <button
                        className="chip"
                        style={{ fontSize: '12px', padding: '4px 8px', cursor: 'pointer' }}
                        onClick={async () => {
                          if (!answerId) return;
                          try {
                            const { submitFeedback } = await import('../api-client');
                            await submitFeedback(answerId, -1, null, lastQuestion);
                            setChatMessages(prev => [...prev, { 
                              role: 'system', 
                              text: '✓ Feedback submitted: not helpful' 
                            }]);
                          } catch (err) {
                            console.error('Failed to submit feedback:', err);
                          }
                        }}
                      >
                        👎
                      </button>
                      <button
                        className="chip"
                        style={{ fontSize: '12px', padding: '4px 8px', cursor: 'pointer' }}
                        onClick={() => {
                          setEditedAnswer(chatAnswer);
                          setIsEditingAnswer(true);
                        }}
                      >
                        Edit in my words
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="chip"
                        style={{ fontSize: '12px', padding: '4px 8px', cursor: 'pointer', background: '#0a0', color: 'white' }}
                        onClick={async () => {
                          try {
                            const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
                            const response = await fetch(`${apiBaseUrl}/feedback/answer/revision`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                answer_id: answerId,
                                user_rewritten_answer: editedAnswer,
                              }),
                            });
                            if (!response.ok) {
                              throw new Error('Failed to save revision');
                            }
                            setChatAnswer(editedAnswer);
                            setIsEditingAnswer(false);
                            setChatMessages(prev => [...prev, { 
                              role: 'system', 
                              text: '✓ Revision saved. This will be used as an example for future answers.' 
                            }]);
                          } catch (err) {
                            console.error('Failed to save revision:', err);
                            setChatMessages(prev => [...prev, { 
                              role: 'system', 
                              text: '✗ Failed to save revision' 
                            }]);
                          }
                        }}
                      >
                        Save
                      </button>
                      <button
                        className="chip"
                        style={{ fontSize: '12px', padding: '4px 8px', cursor: 'pointer' }}
                        onClick={() => {
                          setIsEditingAnswer(false);
                          setEditedAnswer('');
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              )}
              {suggestedActions.length > 0 && (
                <div style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {suggestedActions.map((action, idx) => (
                    <button
                      key={idx}
                      className="chip"
                      style={{ fontSize: '12px', padding: '6px 12px' }}
                      onClick={async () => {
                        if (action.type === 'link' && action.source && action.target) {
                          // Find nodes by name
                          const sourceNode = findLocalConcept(action.source);
                          const targetNode = findLocalConcept(action.target);
                          
                          if (sourceNode && targetNode) {
                            try {
                              const { createRelationshipByIds } = await import('../api-client');
                              await createRelationshipByIds(sourceNode.node_id, targetNode.node_id, 'RELATES_TO');
                              setChatMessages(prev => [...prev, { 
                                role: 'system', 
                                text: `✓ Linked ${action.source} to ${action.target}` 
                              }]);
                              await reloadGraph();
                            } catch (err) {
                              setError(err instanceof Error ? err.message : 'Failed to create link');
                            }
                          } else {
                            setError(`Could not find nodes: ${!sourceNode ? action.source : ''} ${!targetNode ? action.target : ''}`);
                          }
                        } else if (action.type === 'add' && action.concept && action.domain) {
                          // Add new concept
                          try {
                            const { createConcept } = await import('../api-client');
                            await createConcept({
                              name: action.concept,
                              domain: action.domain,
                              type: 'concept'
                            });
                            setChatMessages(prev => [...prev, { 
                              role: 'system', 
                              text: `✓ Added ${action.concept} to ${action.domain}` 
                            }]);
                            await reloadGraph();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Failed to add concept');
                          }
                        }
                      }}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        
        {suggestedQuestions.length > 0 && (
          <div className="chips" style={{ marginTop: '6px', flexShrink: 0 }}>
            <span style={{ fontSize: '11px', color: 'var(--muted)', marginRight: '6px' }}>Brain Web is curious...</span>
            {suggestedQuestions.map((q, idx) => (
              <button
                key={idx}
                className="chip"
                onClick={() => {
                  setSearchTerm(q);
                  handleCommand(q);
                }}
              >
                {q}
              </button>
            ))}
          </div>
        )}

        <div className="chat-input-row">
          <textarea
            id="chat-input"
            name="chat-input"
            value={searchTerm}
            onChange={e => {
              setSearchTerm(e.target.value);
              setError(null);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (searchTerm.trim()) {
                  handleCommand(searchTerm);
                  setSearchTerm('');
                }
              }
            }}
            placeholder={
              linkingMode
                ? `Linking mode is on. Click a bubble to connect from ${linkingMode.source?.name} (${linkingMode.predicate}).`
                : 'Start a conversation with Brain Web...'
            }
            rows={2}
            className="chat-input"
            onInput={e => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
            }}
          />
          <button
            className="send-btn"
            onClick={() => {
              if (searchTerm.trim()) {
                handleCommand(searchTerm);
                setSearchTerm('');
              }
            }}
          >
            Send
          </button>
        </div>
        {quickCommands.length > 0 && (
          <div style={{ marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center', flexShrink: 0 }}>
            <span style={{ fontSize: '10px', color: 'var(--muted)', marginRight: '3px' }}>Quick:</span>
            {quickCommands.map(cmd => (
              <button
                key={cmd}
                onClick={() => {
                  setSearchTerm(cmd);
                  handleCommand(cmd);
                }}
                style={{
                  fontSize: '11px',
                  padding: '4px 8px',
                  borderRadius: '12px',
                  border: '1px solid var(--border)',
                  background: '#f7f8ff',
                  color: '#111827',
                  cursor: 'pointer',
                  fontWeight: '500',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 4px 8px rgba(15, 23, 42, 0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                {cmd}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
