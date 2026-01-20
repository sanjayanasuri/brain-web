'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { forceCollide, forceCenter } from 'd3-force';
import ExplorerToolbar from './ExplorerToolbar';
import GraphMiniMap from './GraphMiniMap';
import ContextPanel, { type ContextPanelTab } from '../context/ContextPanel';
import SessionDrawer from '../navigation/SessionDrawer';
import { GraphProvider, useGraph, type VisualGraph } from './GraphContext';
import { useChatState, type ChatMessage } from './hooks/useChatState';
import { useGraphFilters } from './hooks/useGraphFilters';
import { getPlugin, getPluginForDomain } from './plugins/pluginRegistry';
import './plugins/lecturePlugin'; // Register lecture plugin
import { useUIState } from './hooks/useUIState';
import type { Concept, GraphData, Resource, GraphSummary, BranchSummary } from '../../api-client';
import type { EvidenceItem } from '../../types/evidence';
import { normalizeEvidence } from '../../types/evidence';
import { useEvidenceNavigation } from '../../hooks/useEvidenceNavigation';
import { computeFreshness } from '../../utils/freshness';
import { formatConfidence } from '../../utils/confidence';
import {
  getResourcesForConcept,
  uploadResourceForConcept,
  fetchConfusionsForConcept,
  getTeachingStyle,
  type TeachingStyleProfile,
  getFocusAreas,
  getIngestionRunChanges,
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
  getGraphOverview,
  getGraphNeighbors,
} from '../../api-client';
import { fetchEvidenceForConcept } from '../../lib/evidenceFetch';
import { setLastSession, getLastSession, pushRecentConceptView, trackConceptViewed, trackEvent } from '../../lib/sessionState';
import { logEvent } from '../../lib/eventsClient';
import { 
  createChatSession, 
  addMessageToSession, 
  getCurrentSession, 
  getCurrentSessionId,
  setCurrentSessionId,
  getChatSession,
  type ChatSession 
} from '../../lib/chatSessions';
import StyleFeedbackForm from '../ui/StyleFeedbackForm';

// Activity Event Types
type ActivityEventType = 
  | 'RESOURCE_ATTACHED'
  | 'NODE_CREATED'
  | 'NODE_UPDATED'
  | 'RELATIONSHIP_ADDED'
  | 'RELATIONSHIP_REMOVED';

interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  title: string;
  timestamp: Date | null;
  detail?: string;
  resource_id?: string;
  url?: string;
  source_badge?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

/**
 * Format time ago string (e.g., "2 hours ago", "3 days ago")
 */
function formatTimeAgo(date: Date | null): string {
  if (!date) return '';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffDays > 0) {
    return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
  } else if (diffHours > 0) {
    return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  } else if (diffMinutes > 0) {
    return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
  } else {
    return 'Just now';
  }
}

/**
 * Get source icon for evidence source type
 */
function getSourceIcon(sourceType: string | undefined): string {
  switch (sourceType) {
    case 'browser_use':
      return '🌐';
    case 'upload':
      return '📄';
    case 'notion':
      return '📝';
    case 'sec':
      return '📊';
    case 'ir':
      return '💼';
    case 'news':
      return '📰';
    case 'finance':
      return '💰';
    default:
      return '📌';
  }
}

/**
 * Get human-readable source type name
 */
function getSourceTypeName(sourceType: string | undefined): string {
  switch (sourceType) {
    case 'browser_use':
      return 'Web';
    case 'upload':
      return 'Upload';
    case 'notion':
      return 'Notion';
    case 'sec':
      return 'SEC';
    case 'ir':
      return 'IR';
    case 'news':
      return 'News';
    case 'finance':
      return 'Finance';
    default:
      return 'Unknown';
  }
}

/**
 * Derive activity events from selectedResources and selectedNode
 */
function deriveActivityEvents(
  resources: Resource[],
  node: Concept | null,
  onViewEvidence: (resourceId: string) => void
): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  
  // Derive events from resources
  for (const res of resources) {
    // Regular resource attached
    // Try to get created_at from resource.created_at or metadata
    let timestamp: Date | null = null;
    if (res.created_at) {
      const date = new Date(res.created_at);
      if (!isNaN(date.getTime())) {
        timestamp = date;
      }
    } else if (res.metadata?.created_at) {
      const ts = res.metadata.created_at;
      if (typeof ts === 'string') {
        const date = new Date(ts);
        // If invalid date, set to null
        if (!isNaN(date.getTime())) {
          timestamp = date;
        }
      } else if (typeof ts === 'number') {
        const date = new Date(ts);
        // If invalid date, set to null
        if (!isNaN(date.getTime())) {
          timestamp = date;
        }
      }
    }
    
    const title = res.title || res.kind || 'Resource';
    const caption = res.caption ? (res.caption.length > 100 ? res.caption.substring(0, 100) + '...' : res.caption) : undefined;
    
    events.push({
      id: `resource-${res.resource_id}`,
      type: 'RESOURCE_ATTACHED',
      title: `Resource attached: ${title}`,
      timestamp,
      detail: caption,
      resource_id: res.resource_id,
      url: res.url,
      source_badge: res.source || undefined,
      action: {
        label: 'View evidence',
        onClick: () => onViewEvidence(res.resource_id),
      },
    });
  }
  
  // Derive events from node fields
  if (node) {
    // Node created event
    // Note: We don't have created_at in the Concept interface yet, so skip for now
    // This can be added later when backend provides it
    
    // Node updated event
    // Note: We don't have updated_at in the Concept interface yet, so skip for now
    // This can be added later when backend provides it
  }
  
  // Sort events: newest first, null timestamps go last
  events.sort((a, b) => {
    if (!a.timestamp && !b.timestamp) return 0;
    if (!a.timestamp) return 1;
    if (!b.timestamp) return -1;
    return b.timestamp.getTime() - a.timestamp.getTime();
  });
  
  return events;
}

/**
 * Normalize sources from metadata to a consistent format.
 * Handles both string[] and Array<{url: string, snippet?: string}> formats.
 */
function normalizeSources(metadata: Record<string, any> | null | undefined): Array<{url: string, snippet?: string}> {
  if (!metadata || !metadata.sources) {
    return [];
  }
  
  const sources = metadata.sources;
  if (!Array.isArray(sources)) {
    return [];
  }
  
  return sources.map((source: any) => {
    if (typeof source === 'string') {
      return { url: source };
    }
    if (typeof source === 'object' && source !== null && typeof source.url === 'string') {
      return {
        url: source.url,
        snippet: typeof source.snippet === 'string' ? source.snippet : undefined,
      };
    }
    return null;
  }).filter((s: any): s is {url: string, snippet?: string} => s !== null);
}

/**
 * Get confidence badge info, handling both numeric (0-1) and string ("high|medium|low") formats.
 */
function getConfidenceBadge(metadata: Record<string, any> | null | undefined): { text: string; bgColor: string; color: string } | null {
  const confidence = metadata?.size?.confidence ?? metadata?.price?.confidence;
  
  if (confidence === null || confidence === undefined) {
    return null;
  }
  
  if (typeof confidence === 'number') {
    // Numeric confidence (0-1 scale)
    const percentage = (confidence * 100).toFixed(0);
    let bgColor: string;
    let color: string;
    
    if (confidence >= 0.7) {
      bgColor = 'rgba(34, 197, 94, 0.15)';
      color = '#22c55e';
    } else if (confidence >= 0.4) {
      bgColor = 'rgba(251, 191, 36, 0.15)';
      color = '#fbbf24';
    } else {
      bgColor = 'rgba(239, 68, 68, 0.15)';
      color = '#ef4444';
    }
    
    return {
      text: `Confidence: ${percentage}%`,
      bgColor,
      color,
    };
  }
  
  if (typeof confidence === 'string') {
    // String confidence ("high", "medium", "low")
    const lower = confidence.toLowerCase();
    let bgColor: string;
    let color: string;
    
    if (lower === 'high') {
      bgColor = 'rgba(34, 197, 94, 0.15)';
      color = '#22c55e';
    } else if (lower === 'medium') {
      bgColor = 'rgba(251, 191, 36, 0.15)';
      color = '#fbbf24';
    } else if (lower === 'low') {
      bgColor = 'rgba(239, 68, 68, 0.15)';
      color = '#ef4444';
    } else {
      // Unknown string value, default to medium
      bgColor = 'rgba(251, 191, 36, 0.15)';
      color = '#fbbf24';
    }
    
    return {
      text: `Confidence: ${confidence.charAt(0).toUpperCase() + confidence.slice(1)}`,
      bgColor,
      color,
    };
  }
  
  return null;
}

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

// ChatMessage is now imported from useChatState hook
type VisualNode = Concept & { domain: string; type: string; x?: number; y?: number };
type VisualLink = { 
  source: VisualNode; 
  target: VisualNode; 
  predicate: string;
  relationship_status?: string;
  relationship_confidence?: number;
  relationship_method?: string;
  source_type?: string;
  rationale?: string;
};
// VisualGraph is imported from GraphContext
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

const IS_DEMO_MODE = false; // Demo mode removed - production ready

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

// Content import form component (generic, works with any domain plugin)
function ContentImportForm({
  onIngest,
  isLoading,
  result,
  onClose,
}: {
  onIngest: (title: string, text: string, domain?: string) => void;
  isLoading: boolean;
  result: any | null;
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
          id="content-title"
          name="content-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Content title"
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
          id="content-domain"
          name="content-domain"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="Topic or domain (optional)"
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
          id="content-text"
          name="content-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste or type your content here..."
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
          {isLoading ? 'Processing...' : 'Import Content'}
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

function GraphVisualizationInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  // Use GraphContext for shared graph state
  const graph = useGraph();
  const { graphData, setGraphData, selectedNode, setSelectedNode, graphs, setGraphs, activeGraphId, setActiveGraphId, branches, setBranches, activeBranchId, setActiveBranchId, focusAreas, setFocusAreas, loading, setLoading, error, setError, loadingNeighbors, setLoadingNeighbors, overviewMeta, setOverviewMeta, neighborCache, clearNeighborCache, selectedDomains, setSelectedDomains, expandedNodes, setExpandedNodes, collapsedGroups, setCollapsedGroups, focusedNodeId, setFocusedNodeId, domainBubbles, setDomainBubbles, highlightedConceptIds, setHighlightedConceptIds, highlightedRelationshipIds, setHighlightedRelationshipIds, tempNodes, setTempNodes } = graph;
  
  // Use custom hooks for state management
  const chat = useChatState();
  const filters = useGraphFilters();
  const ui = useUIState();
  
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

  // Track when we're loading a session to prevent auto-scroll from interfering
  const isLoadingSessionRef = useRef(false);
  const chatStreamRef = useRef<HTMLDivElement | null>(null);
  
  // Track if component is mounted to prevent hydration errors
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);
  
  // Auto-scroll chat to bottom when history changes or new message arrives
  // Use requestAnimationFrame for better performance and debounce to avoid excessive scrolling
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    // Skip auto-scroll if we're loading a session (user should be able to scroll freely)
    if (isLoadingSessionRef.current) {
      return;
    }
    
    if (chatStreamRef.current) {
      // Clear any pending scroll
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      
      // Use requestAnimationFrame for smooth scrolling without blocking
      scrollTimeoutRef.current = setTimeout(() => {
        requestAnimationFrame(() => {
          if (chatStreamRef.current) {
            // Only auto-scroll if user is near bottom (within 100px)
            const { scrollTop, scrollHeight, clientHeight } = chatStreamRef.current;
            const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
            
            if (isNearBottom || chat.state.chatHistory.length === 0) {
              chatStreamRef.current.scrollTop = chatStreamRef.current.scrollHeight;
            }
          }
        });
      }, 50); // Reduced delay for better responsiveness
    }
    
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [chat.state.chatHistory.length, chat.state.chatAnswer]);
  
  // Clear transient chatAnswer if it's already in history (prevents duplicate display)
  useEffect(() => {
    if (chat.state.chatAnswer && chat.state.answerId) {
      const answerInHistory = chat.state.chatHistory.some(msg => 
        msg.answerId === chat.state.answerId && msg.answer && msg.answer.trim()
      );
      if (answerInHistory) {
        // Answer is in history, clear transient state
        chat.actions.setChatAnswer(null);
        chat.actions.setAnswerId(null);
      }
    }
  }, [chat.state.chatHistory, chat.state.chatAnswer, chat.state.answerId, chat.actions]);

  // Remaining state that hasn't been moved to hooks yet
  const [compareOtherBranchId, setCompareOtherBranchId] = useState<string>('');
  const [branchCompare, setBranchCompare] = useState<any>(null);
  const [branchCompareLLM, setBranchCompareLLM] = useState<any>(null);
  const [teachingStyle, setTeachingStyle] = useState<TeachingStyleProfile | null>(null);
  const [domainSpread, setDomainSpread] = useState(1.2);
  const [bubbleSpacing, setBubbleSpacing] = useState(1);
  const lastAutoSnapshotAtRef = useRef<number>(0);
  // Debounce concept view logging (10s)
  const lastConceptViewLogRef = useRef<{ conceptId: string; timestamp: number } | null>(null);
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
  const [runChanges, setRunChanges] = useState<any>(null);
  const [chatContentHeight, setChatContentHeight] = useState(0);
  const [contentIngestResult, setContentIngestResult] = useState<any | null>(null);
  const [selectedResources, setSelectedResources] = useState<Resource[]>([]);
  const [isResourceLoading, setIsResourceLoading] = useState(false);
  const [expandedEvidenceItems, setExpandedEvidenceItems] = useState<Set<string>>(new Set());
  const [showAllEvidence, setShowAllEvidence] = useState(false);
  const [navigatingEvidenceId, setNavigatingEvidenceId] = useState<string | null>(null);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [isFetchingConfusions, setIsFetchingConfusions] = useState(false);
  // Fetch Evidence state (per concept to avoid state leaks when switching nodes)
  const [fetchEvidenceState, setFetchEvidenceState] = useState<{
    conceptId: string;
    status: 'idle' | 'loading' | 'success' | 'empty' | 'error';
    addedCount?: number;
    error?: string;
  }>({ conceptId: '', status: 'idle' });
  // Resource cache: node_id -> Resource[] (using useRef to avoid dependency loops)
  const resourceCacheRef = useRef<Map<string, Resource[]>>(new Map());
  // Evidence tab filters
  const [evidenceFilter, setEvidenceFilter] = useState<'all' | 'browser_use' | 'upload' | 'notion'>('all');
  const [evidenceSearch, setEvidenceSearch] = useState('');
  // Expanded resource details
  const [expandedResources, setExpandedResources] = useState<Set<string>>(new Set());
  const graphRef = useRef<ForceGraphRef | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const graphCanvasRef = useRef<HTMLDivElement | null>(null);
  const isClosingPanelRef = useRef<boolean>(false);
  const neighborCacheRef = useRef<Map<string, { nodes: Concept[]; edges: any[] }>>(new Map());
  const loadingNeighborsRef = useRef<string | null>(null);
  const isSubmittingChatRef = useRef<boolean>(false);
  const normalize = useCallback((name: string) => name.trim().toLowerCase(), []);

  // Auto-highlight evidence setting (localStorage)
  const getAutoHighlightSetting = useCallback((): boolean => {
    if (typeof window === 'undefined') return true; // Default ON
    try {
      const stored = localStorage.getItem('brainweb:autoHighlightEvidence');
      return stored === null ? true : stored === 'true'; // Default ON if missing
    } catch {
      return true;
    }
  }, []);

  const setAutoHighlightSetting = useCallback((value: boolean): void => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('brainweb:autoHighlightEvidence', String(value));
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  const [autoHighlightEvidence, setAutoHighlightEvidenceState] = useState<boolean>(() => getAutoHighlightSetting());

  const setAutoHighlightEvidence = useCallback((value: boolean) => {
    setAutoHighlightEvidenceState(value);
    setAutoHighlightSetting(value);
  }, [setAutoHighlightSetting]);

  // Initialize from localStorage on mount
  useEffect(() => {
    setAutoHighlightEvidenceState(getAutoHighlightSetting());
  }, [getAutoHighlightSetting]);

  // Track graph viewport size (for "visible labels" heuristics)
  useEffect(() => {
    if (!graphCanvasRef.current) return;
    const el = graphCanvasRef.current;
    const update = () => {
      const rect = el.getBoundingClientRect();
      ui.actions.setGraphViewport({ width: rect.width, height: rect.height });
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
        const api = await import('../../api-client');
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

  // Neighbor expansion with caching
  const expandNeighbors = useCallback(async (conceptId: string) => {
    // Check cache first
    const cacheKey = `${activeGraphId}:${conceptId}:1`;
    const cached = neighborCacheRef.current.get(cacheKey);
    if (cached) {
      // Merge cached data into graph
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
    
    // Fetch neighbors with timeout protection
    loadingNeighborsRef.current = conceptId;
    setLoadingNeighbors(conceptId);
    const timeoutId = setTimeout(() => {
      // If still loading after 10 seconds, clear the loading state to prevent UI lock
      if (loadingNeighborsRef.current === conceptId) {
        console.warn('Neighbor loading timeout for concept:', conceptId);
        loadingNeighborsRef.current = null;
        setLoadingNeighbors(null);
      }
    }, 10000); // 10 second timeout
    
    try {
      const result = await getGraphNeighbors(activeGraphId, conceptId, 1, 80);
      
      // Only process result if we're still loading for this concept (user didn't switch nodes)
      if (loadingNeighborsRef.current === conceptId) {
        // Cache the result
        neighborCacheRef.current.set(cacheKey, {
          nodes: result.nodes,
          edges: result.edges,
        });
        
        // Merge into graph data
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
      // Only clear if we're still loading for this specific concept
      if (loadingNeighborsRef.current === conceptId) {
        loadingNeighborsRef.current = null;
        setLoadingNeighbors(null);
      }
    }
  }, [activeGraphId]);

  // Extract evidence highlight logic into reusable functions
  const clearEvidenceHighlight = useCallback(() => {
    chat.actions.setShowingEvidence(false);
    chat.actions.setEvidenceNodeIds(new Set());
    chat.actions.setEvidenceLinkIds(new Set());
    chat.actions.setActiveEvidenceSectionId(null);
    if (graphRef.current?.refresh) {
      graphRef.current.refresh();
    }
  }, [chat.actions]);

  type RetrievalMetaType = {
    communities: number;
    claims: number;
    concepts: number;
    edges: number;
    sourceBreakdown?: Record<string, number>;
    claimIds?: string[];
    communityIds?: string[];
    topClaims?: Array<{
      claim_id: string;
      text: string;
      confidence?: number;
      source_id?: string;
      published_at?: string;
    }>;
  } | null;

  const applyEvidenceHighlight = useCallback(async (
    evidenceItems: EvidenceItem[],
    retrievalMeta: RetrievalMetaType
  ) => {
    // If no evidence items, do nothing
    if (!evidenceItems || evidenceItems.length === 0) {
      return;
    }

    // Try API approach first (if claimIds available)
    if (retrievalMeta?.claimIds && retrievalMeta.claimIds.length > 0) {
      try {
        const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
        const { listGraphs } = await import('../../api-client');
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
          
          // Ensure evidence nodes are visible
          nodeIds.forEach(nodeId => {
            const node = graphData.nodes.find(n => n.node_id === nodeId);
            if (node) {
              revealDomain(node.domain);
              setExpandedNodes(prev => new Set<string>([...Array.from(prev), nodeId]));
            }
          });
          
          // Refresh graph to show highlighting
          if (graphRef.current?.refresh) {
            graphRef.current.refresh();
          }
          return;
        }
      } catch (err) {
        console.error('Failed to fetch evidence subgraph:', err);
      }
    }

    // Fallback: map concept_ids from EvidenceItem directly to node_ids
    const conceptIds = new Set<string>(
      evidenceItems
        .map(item => item.concept_id)
        .filter((id): id is string => !!id)
    );

    if (conceptIds.size === 0) {
      // No concept_ids available, can't highlight
      return;
    }

    // Map concept_ids to node_ids (assuming concept_id === node_id, or find by matching)
    const nodeIds = new Set<string>();
    const linkIds = new Set<string>();

    // Try direct match first (concept_id === node_id)
    // Also expand neighbors for concepts not yet in graph
    const missingConceptIds: string[] = [];
    conceptIds.forEach(conceptId => {
      const node = graphData.nodes.find(n => n.node_id === conceptId);
      if (node) {
        nodeIds.add(node.node_id);
      } else {
        missingConceptIds.push(conceptId);
      }
    });
    
    // Expand neighbors for missing concepts
    for (const conceptId of missingConceptIds) {
      try {
        await expandNeighbors(conceptId);
        // After expansion, check again
        const node = graphData.nodes.find(n => n.node_id === conceptId);
        if (node) {
          nodeIds.add(node.node_id);
        }
      } catch (err) {
        console.warn('Failed to expand neighbors for evidence concept:', conceptId, err);
      }
    }

    // If we found nodes, highlight them and their connected edges
    if (nodeIds.size > 0) {
      // Find links connected to evidence nodes
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

      // Ensure evidence nodes are visible
      nodeIds.forEach(nodeId => {
        const node = graphData.nodes.find(n => n.node_id === nodeId);
        if (node) {
          revealDomain(node.domain);
          setExpandedNodes(prev => new Set<string>([...Array.from(prev), nodeId]));
        }
      });

      // Refresh graph to show highlighting
      if (graphRef.current?.refresh) {
        graphRef.current.refresh();
      }
    }
  }, [graphData.nodes, graphData.links, revealDomain, expandNeighbors]);

  // Helper to retry highlight application if graph is still loading
  const applyEvidenceHighlightWithRetry = useCallback(async (
    evidenceItems: EvidenceItem[],
    retrievalMeta: RetrievalMetaType,
    maxRetries: number = 10,
    delayMs: number = 100
  ) => {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Check if graph has nodes loaded
      if (graphData.nodes.length > 0) {
        await applyEvidenceHighlight(evidenceItems, retrievalMeta);
        return;
      }
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    // Final attempt even if graph seems empty (might still work)
    await applyEvidenceHighlight(evidenceItems, retrievalMeta);
  }, [graphData.nodes.length, applyEvidenceHighlight]);

  // Helper function to center a node accounting for the context panel
  const centerNodeInVisibleArea = useCallback((nodeX: number, nodeY: number, duration: number = 500, assumePanelOpen: boolean = false) => {
    if (!graphRef.current || !graphCanvasRef.current) return;
    
    // Get panel width (if context panel is open or will be open)
    const panelIsOpen = assumePanelOpen || !!selectedNode;
    const panelWidth = panelIsOpen ? (ui.state.focusMode ? 400 : 380) : 0;
    
    // Get canvas dimensions
    const canvasRect = graphCanvasRef.current.getBoundingClientRect();
    const canvasWidth = canvasRect.width;
    const visibleWidth = canvasWidth - panelWidth;
    
    // Get current zoom level
    const currentZoom = typeof graphRef.current.zoom === 'function' ? graphRef.current.zoom() : 1;
    
    // Calculate the center of the visible area in graph coordinates
    // The center of the visible area is at (visibleWidth / 2) pixels from the left
    // We need to shift the node's x coordinate so it appears at that center
    // Convert pixel offset to graph coordinate offset
    const pixelOffset = panelWidth / 2; // Half the panel width
    const graphOffset = pixelOffset / currentZoom; // Convert to graph coordinates
    
    // Adjust x coordinate to account for panel
    const adjustedX = nodeX - graphOffset;
    
    graphRef.current.centerAt(adjustedX, nodeY, duration);
  }, [selectedNode, ui.state.focusMode]);

  // Apply section-level evidence highlighting
  const applySectionEvidenceHighlight = useCallback(async (
    sectionId: string,
    sectionEvidenceIds: string[],
    allEvidence: EvidenceItem[],
    retrievalMeta: RetrievalMetaType
  ) => {
    // Filter evidence items to only those in this section
    const sectionEvidence = allEvidence.filter(e => 
      sectionEvidenceIds.includes(e.resource_id || '') ||
      sectionEvidenceIds.includes(e.id || '') ||
      sectionEvidenceIds.includes(`evidence-${e.id}`)
    );

    if (sectionEvidence.length === 0) {
      return;
    }

    // Set active section
    chat.actions.setActiveEvidenceSectionId(sectionId);

    // Apply highlighting using existing logic
    await applyEvidenceHighlight(sectionEvidence, retrievalMeta);

    // Gently center/zoom to highlighted subgraph
    if (graphRef.current && sectionEvidence.length > 0) {
      // Get concept IDs from evidence
      const conceptIds = new Set<string>(
        sectionEvidence
          .map(item => item.concept_id)
          .filter((id): id is string => !!id)
      );

      if (conceptIds.size > 0) {
        // Find nodes for these concepts
        const nodes = graphData.nodes.filter(n => conceptIds.has(n.node_id));
        if (nodes.length > 0) {
          // Calculate center of evidence nodes
          const centerX = nodes.reduce((sum, n) => sum + ((n as any).x || 0), 0) / nodes.length;
          const centerY = nodes.reduce((sum, n) => sum + ((n as any).y || 0), 0) / nodes.length;
          
          // Gently center (don't hard reset zoom)
          const currentZoom = ui.state.zoomTransform?.k || ui.state.zoomLevel || 1;
          if (currentZoom < 1.5) {
            // Only adjust if zoomed out - gently zoom in
            graphRef.current.zoomToFit(400, 50);
          } else {
            // Just center on the nodes (evidence highlighting doesn't select a node, so panel might not be open)
            centerNodeInVisibleArea(centerX, centerY, 400);
          }
        }
      }
    }
  }, [applyEvidenceHighlight, graphData.nodes, ui.state.zoomTransform, ui.state.zoomLevel, centerNodeInVisibleArea]);

  const ensureConcept = useCallback(
    async (name: string, inherit?: { domain?: string; type?: string }) => {
      try {
        return await resolveConceptByName(name);
      } catch {
        const api = await import('../../api-client');
        
        // CRITICAL: Set the active graph context in backend before creating concept
        // This ensures the node is created in the correct graph/workspace
        await api.selectGraph(activeGraphId);
        
        const concept = await api.createConcept({
          graph_id: activeGraphId, // Explicitly specify which graph to add to
          name,
          domain: inherit?.domain || 'general',
          type: inherit?.type || 'concept',
        });
        return concept;
      }
    },
    [resolveConceptByName, activeGraphId],
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
        relationship_status: (l as any).relationship_status,
        relationship_confidence: (l as any).relationship_confidence,
      }));
      return { nodes, links };
    },
    [],
  );

  const updateSelectedPosition = useCallback(
    (node?: any) => {
      const target = node || selectedNode;
      if (!target || !graphRef.current) {
        // Fallback: use center-right of screen if we can't get graph position
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
        // Fallback: use center-right of screen if node doesn't have coordinates
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
          // Fallback: use center-right of screen if graph2ScreenCoords fails
          if (typeof window !== 'undefined') {
            ui.actions.setSelectedPosition({ 
              x: window.innerWidth - 380, 
              y: window.innerHeight / 2 
            });
          }
        }
      } catch (err) {
        // Fallback: use center-right of screen if graph2ScreenCoords throws
        console.warn('Failed to get screen coordinates:', err);
        if (typeof window !== 'undefined') {
          ui.actions.setSelectedPosition({ 
            x: window.innerWidth - 380, 
            y: window.innerHeight / 2 
          });
        }
      }
    },
    [selectedNode, ui.actions],
  );

  const convertGraphData = useCallback(
    (data: GraphData, temps: TempNode[]): VisualGraph => {
      // Optimize: pre-allocate arrays and use efficient map operations
      const nodes: VisualNode[] = new Array(data.nodes.length + temps.length);
      let idx = 0;
      
      // Process nodes efficiently
      // For isolated nodes (no links), add initial positioning to ensure they're visible
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
        
        // If no links exist, position nodes in a circle around center to make them visible
        if (!hasLinks && ((nodeData as any).x === undefined || (nodeData as any).y === undefined)) {
          const angle = (i / data.nodes.length) * Math.PI * 2;
          const radius = 100; // Distance from center
          (nodeData as any).x = centerX + Math.cos(angle) * radius;
          (nodeData as any).y = centerY + Math.sin(angle) * radius;
        }
        
        nodes[idx++] = nodeData;
      }
      
      // Add temp nodes
      for (let i = 0; i < temps.length; i++) {
        nodes[idx++] = temps[i];
      }

      // Build node map efficiently
      const nodeMap = new Map<string, VisualNode>();
      for (let i = 0; i < nodes.length; i++) {
        nodeMap.set(nodes[i].node_id, nodes[i]);
      }

      // Process links efficiently - pre-allocate array
      const links: VisualLink[] = [];
      const linkSet = new Set<string>(); // Track processed links to avoid duplicates
      
      for (let i = 0; i < data.links.length; i++) {
        const link = data.links[i];
        const sourceId = typeof link.source === 'string' ? link.source : (link.source as any).node_id;
        const targetId = typeof link.target === 'string' ? link.target : (link.target as any).node_id;
        
        // Skip if already processed
        const linkKey = `${sourceId}-${targetId}-${link.predicate}`;
        if (linkSet.has(linkKey)) continue;
        linkSet.add(linkKey);
        
        const sourceNode = nodeMap.get(sourceId);
        const targetNode = nodeMap.get(targetId);
        if (!sourceNode || !targetNode) {
          // Skip missing nodes silently in production
          if (process.env.NODE_ENV === 'development') {
            console.warn(`[Graph] Missing node for link: source=${sourceId}, target=${targetId}`);
          }
          continue;
        }
        
        // Derive source_type efficiently
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
      
      // Debug: log link conversion stats (only in dev)
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Graph] Converted ${links.length} links from ${data.links.length} raw links`);
      }

      return { nodes, links };
    },
    [],
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

  const loadGraph = useCallback(async (graphId?: string) => {
    const targetGraphId = graphId || activeGraphId;
    // Don't block UI - set loading but continue rendering
    setLoading(true);
    setError(null);
    try {
      // Use overview endpoint with smaller initial load for faster rendering
      const data = await getGraphOverview(targetGraphId, 200, 400);
      
      // Debug logging
      console.log('[Graph] Loaded data:', {
        nodes: data.nodes?.length || 0,
        links: data.links?.length || 0,
        meta: data.meta,
        sampleNodes: data.nodes?.slice(0, 3).map(n => ({ id: n.node_id, name: n.name, domain: n.domain }))
      });
      
      // Process data immediately but set state asynchronously to avoid blocking
      // Convert tempNodes from context format to TempNode format
      const convertedTempNodes: TempNode[] = tempNodes.map(temp => ({
        ...temp,
        node_id: temp.id,
        type: 'concept',
        temporary: true as const,
      }));
      const converted = convertGraphData(data, convertedTempNodes);
      
      console.log('[Graph] Converted data:', {
        nodes: converted.nodes.length,
        links: converted.links.length,
        sampleNodes: converted.nodes.slice(0, 3).map(n => ({ id: n.node_id, name: n.name, domain: n.domain, x: (n as any).x, y: (n as any).y }))
      });
      
      // Use requestAnimationFrame to batch state updates and avoid blocking
      requestAnimationFrame(() => {
        setGraphData(converted);
        setOverviewMeta(data.meta || null);
        setLoading(false);
      });
      
      // Clear cache when switching graphs
      neighborCacheRef.current.clear();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load graph');
      setLoading(false);
    }
  }, [convertGraphData, tempNodes, activeGraphId]);

  const refreshGraphs = useCallback(async (preserveActiveGraph = true) => {
    try {
      const data = await listGraphs();
      setGraphs(data.graphs || []);
      // Only update activeGraphId if we're explicitly syncing with backend (e.g., initial load)
      // By default, preserve the user's current selection to prevent reverting to demo
      if (!preserveActiveGraph) {
        const backendGraphId = data.active_graph_id;
        // Only sync with backend if:
        // 1. Backend returned a valid graph_id AND
        // 2. Either: backend returned non-demo, OR current selection is 'default' (initial state)
        // This prevents reverting to demo when user has explicitly selected a different graph
        if (backendGraphId) {
          const currentGraphId = activeGraphId || 'default';
          if (backendGraphId !== 'demo' || currentGraphId === 'default') {
            setActiveGraphId(backendGraphId);
          }
          // Otherwise, preserve user's current selection (don't revert to demo)
        }
      }
      setActiveBranchId(data.active_branch_id || 'main');
      ui.actions.setGraphSwitchError(null);
    } catch (err) {
      ui.actions.setGraphSwitchError(err instanceof Error ? err.message : 'Failed to load graphs');
    }
  }, [activeGraphId]);

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
    // First filter by domain
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
    
    // Then filter by relationship status, confidence, and source
    filteredLinks = filteredLinks.filter(link => {
      const status = link.relationship_status || 'ACCEPTED';
      
      // Status filter
      if (status === 'ACCEPTED' && !filters.state.filterStatusAccepted) return false;
      if (status === 'PROPOSED' && !filters.state.filterStatusProposed) return false;
      if (status === 'REJECTED' && !filters.state.filterStatusRejected) return false;
      
      // Confidence filter
      const confidence = link.relationship_confidence ?? 1.0;
      if (confidence < filters.state.filterConfidenceThreshold) return false;
      
      // Source filter (if source_type is available)
      if (link.source_type && filters.state.filterSources.size > 0 && !filters.state.filterSources.has(link.source_type)) {
        return false;
      }
      
      return true;
    });
    
    // Keep nodes that are connected by filtered links OR are isolated (no links)
    // This ensures isolated nodes (like finance nodes) are always visible
    const connectedNodeIds = new Set<string>();
    filteredLinks.forEach(link => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.node_id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.node_id;
      connectedNodeIds.add(sourceId);
      connectedNodeIds.add(targetId);
    });
    
    // If there are no filtered links, keep all nodes that pass domain filtering
    // This ensures nodes remain visible even when their links are filtered out
    if (filteredLinks.length === 0) {
      // Keep all nodes that passed domain filtering - they're all effectively isolated
      // filteredNodes already contains the right nodes from domain filtering
    } else {
      // Keep connected nodes OR isolated nodes (nodes with no links in original graph)
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
  }, [graphData, selectedDomains, filters.state.filterStatusAccepted, filters.state.filterStatusProposed, filters.state.filterStatusRejected, filters.state.filterConfidenceThreshold, filters.state.filterSources]);

  const { displayGraph, hiddenCounts } = useMemo(() => {
    const counts = new Map<string, number>();
    const hiddenIds = new Set<string>();

    Object.keys(collapsedGroups).forEach((rootId) => {
      const ids = collapsedGroups[rootId] || [];
      counts.set(rootId, ids.length);
      ids.forEach((id) => hiddenIds.add(id));
    });

    if (hiddenIds.size === 0) {
      // Debug logging
      if (process.env.NODE_ENV === 'development' && filteredGraph.nodes.length === 0 && graphData.nodes.length > 0) {
        console.warn('[Graph] All nodes filtered out:', {
          totalNodes: graphData.nodes.length,
          filteredNodes: filteredGraph.nodes.length,
          selectedDomains: Array.from(selectedDomains),
          filterStatus: {
            accepted: filters.state.filterStatusAccepted,
            proposed: filters.state.filterStatusProposed,
            rejected: filters.state.filterStatusRejected,
          },
          confidenceThreshold: filters.state.filterConfidenceThreshold,
        });
      }
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
  }, [filteredGraph, collapsedGroups, graphData.nodes.length, selectedDomains, filters.state]);

  // Debug: Log graph data changes (after displayGraph is defined)
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log('[Graph] Graph data state:', {
        graphDataNodes: graphData.nodes.length,
        graphDataLinks: graphData.links.length,
        displayNodes: displayGraph.nodes.length,
        displayLinks: displayGraph.links.length,
        selectedDomains: Array.from(selectedDomains),
        loading,
        error,
        activeGraphId,
      });
    }
  }, [graphData.nodes.length, graphData.links.length, displayGraph.nodes.length, displayGraph.links.length, selectedDomains, loading, error, activeGraphId]);

  const computeCollapseIds = useCallback(
    (rootId: string, depth: number, graph: VisualGraph = filteredGraph) => {
      // Build adjacency from current rendered graph (domain-filtered, before collapse)
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

    setDomainBubbles(bubbles.map(b => ({ ...b, radius: b.r })));
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
      const a = typeof l.source === 'string' ? l.source : l.source.node_id;
      const b = typeof l.target === 'string' ? l.target : l.target.node_id;
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
        const a = typeof l.source === 'string' ? l.source : l.source.node_id;
        const b = typeof l.target === 'string' ? l.target : l.target.node_id;
        if (a === selectedId) neighborhood.add(b);
        if (b === selectedId) neighborhood.add(a);
      }
    }

    return { degreeById: degree, highDegreeThreshold: threshold, selectedNeighborhoodIds: neighborhood };
  }, [displayGraph.links, selectedNode?.node_id]);

  const connectionsForSelected = useMemo(() => {
    if (!selectedNode?.node_id) return [];
    const selectedId = selectedNode.node_id;
    const items: Array<{
      node_id: string;
      name: string;
      predicate: string;
      isOutgoing: boolean;
    }> = [];
    const seen = new Set<string>();

    for (const link of displayGraph.links) {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.node_id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.node_id;
      let neighbor: VisualNode | null = null;
      let isOutgoing = false;

      if (sourceId === selectedId) {
        neighbor = typeof link.target === 'string' ? null : (link.target as VisualNode);
        isOutgoing = true;
      } else if (targetId === selectedId) {
        neighbor = typeof link.source === 'string' ? null : (link.source as VisualNode);
        isOutgoing = false;
      }

      if (!neighbor) continue;
      const key = `${neighbor.node_id}:${link.predicate}:${isOutgoing ? 'out' : 'in'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        node_id: neighbor.node_id,
        name: neighbor.name,
        predicate: link.predicate,
        isOutgoing,
      });
    }

    return items;
  }, [displayGraph.links, selectedNode?.node_id]);

  // Auto-enable focus mode when a node is selected (via dropdown or click)
  useEffect(() => {
    if (selectedNode && !ui.state.focusMode) {
      // Auto-enable focus mode when node is selected
      ui.actions.setFocusMode(true);
      // Collapse sidebar to give more space
      if (!ui.state.sidebarCollapsed) {
        ui.actions.setSidebarCollapsed(true);
      }
    } else if (!selectedNode && ui.state.focusMode) {
      // Auto-disable focus mode when no node is selected
      ui.actions.setFocusMode(false);
      // Optionally restore sidebar (user can manually expand if needed)
      // Don't auto-expand to avoid disrupting user's preference
    }
  }, [selectedNode?.node_id]);

  // Update selected node position continuously (for panel positioning)
  useEffect(() => {
    if (!selectedNode) return;
    
    const updatePosition = () => {
      updateSelectedPosition(selectedNode);
    };
    
    // Update immediately
    updatePosition();
    
    // Update on interval for smooth following
    const interval = setInterval(updatePosition, 100);
    
    return () => clearInterval(interval);
  }, [selectedNode, updateSelectedPosition]);

  // Focus Mode: when enabled and a node is selected, gently center + zoom in a bit more.
  useEffect(() => {
    if (!ui.state.focusMode) return;
    if (!selectedNode?.node_id) return;
    const fg = graphRef.current;
    if (!fg) return;
    const data = fg.getGraphData ? fg.getGraphData() : fg.graphData();
    const node = data?.nodes?.find((n: any) => n.node_id === selectedNode.node_id);
    if (!node || typeof node.x !== 'number' || typeof node.y !== 'number') return;
    try {
      const z = typeof fg.zoom === 'function' ? fg.zoom() : 1;
      const target = Math.max(2.2, Math.min(4.0, z * 1.15));
      centerNodeInVisibleArea(node.x, node.y, 550);
      fg.zoom(target, 550);
    } catch {
      // ignore (non-critical UX enhancement)
    }
  }, [ui.state.focusMode, selectedNode?.node_id, centerNodeInVisibleArea]);

  // Handle select parameter when graph is already loaded (not switching graphs)
  // Extract select param to prevent infinite loops (searchParams object changes on every render)
  const selectParamRef = useRef<string | null>(null);
  const currentSelectParam = searchParams?.get('select') || null;
  if (selectParamRef.current !== currentSelectParam) {
    selectParamRef.current = currentSelectParam;
  }
  const conceptIdParam = selectParamRef.current;

  useEffect(() => {
    if (!conceptIdParam) return;
    if (!graphData.nodes.length) return; // Wait for graph to load
    if (selectedNode?.node_id === conceptIdParam) return; // Already selected
    if (isClosingPanelRef.current) return; // Don't re-select if we're intentionally closing
    
    // Check if we already loaded resources for this concept
    if (resourceCacheRef.current.has(conceptIdParam) && selectedResources.length > 0 && selectedNode?.node_id === conceptIdParam) {
      return; // Already loaded
    }
    
    // Check if concept is in the loaded graph
    const conceptInGraph = graphData.nodes.find((n: any) => n.node_id === conceptIdParam);
    if (conceptInGraph) {
      // Concept is in graph, select it
      setSelectedNode(conceptInGraph);
      updateSelectedPosition(conceptInGraph);
      
      // Load resources for the concept (only if not cached)
      if (!resourceCacheRef.current.has(conceptIdParam)) {
        import('../../api-client').then((api) => {
          api.getResourcesForConcept(conceptIdParam).then((resources) => {
            setSelectedResources(resources);
            resourceCacheRef.current.set(conceptIdParam, resources);
          }).catch((err) => {
            console.warn('Failed to load resources for concept:', err);
          });
        });
      } else {
        // Use cached resources
        setSelectedResources(resourceCacheRef.current.get(conceptIdParam)!);
      }
      
      // Center on the node
      setTimeout(() => {
        if (graphRef.current && conceptInGraph) {
          const node = conceptInGraph as any;
          if (typeof node.x === 'number' && typeof node.y === 'number') {
            centerNodeInVisibleArea(node.x, node.y, 800, true);
            graphRef.current.zoom(2.0, 800);
          }
        }
      }, 100);
    } else {
      // Concept not in graph, try to fetch it from API
      import('../../api-client').then((api) => {
        api.getConcept(conceptIdParam).then((concept) => {
          // Add concept to graph if it exists but wasn't loaded
          setGraphData(prev => {
            const exists = prev.nodes.some(n => n.node_id === concept.node_id);
            if (!exists) {
              // Add the concept to the graph
              const visualNode: Concept & { domain: string; type: string; x?: number; y?: number } = {
                ...concept,
                domain: concept.domain || 'general',
                type: 'concept',
              };
              return { ...prev, nodes: [...prev.nodes, visualNode] };
            }
            return prev;
          });
          
          // Select the concept
          setSelectedNode(concept);
          updateSelectedPosition(concept);
          
          // Load resources (only if not cached)
          if (!resourceCacheRef.current.has(conceptIdParam)) {
            api.getResourcesForConcept(conceptIdParam).then((resources) => {
              setSelectedResources(resources);
              resourceCacheRef.current.set(conceptIdParam, resources);
            }).catch((err) => {
              console.warn('Failed to load resources for concept:', err);
            });
          } else {
            setSelectedResources(resourceCacheRef.current.get(conceptIdParam)!);
          }
          
          // Center on the node
          setTimeout(() => {
            if (graphRef.current && concept) {
              const graphData = graphRef.current.graphData();
              const nodeInGraph = graphData?.nodes?.find((n: any) => n.node_id === concept.node_id);
              if (nodeInGraph && typeof nodeInGraph.x === 'number' && typeof nodeInGraph.y === 'number') {
                centerNodeInVisibleArea(nodeInGraph.x, nodeInGraph.y, 800, true);
                graphRef.current.zoom(2.0, 800);
              } else {
                graphRef.current.zoomToFit(800, 50);
              }
            }
          }, 300);
        }).catch(() => {
          ui.actions.setConceptNotFoundBanner(conceptIdParam);
        });
      });
    }
  }, [conceptIdParam, graphData.nodes.length, selectedNode?.node_id, updateSelectedPosition]);

  // Get activeGraphId from URL > sessionState > default
  const getActiveGraphId = useCallback((): string => {
    const graphIdParam = searchParams?.get('graph_id');
    if (graphIdParam) return graphIdParam;
    
    const lastSession = getLastSession();
    if (lastSession?.graph_id) return lastSession.graph_id;
    
    return 'default';
  }, [searchParams]);

  // Auto-dismiss switch banner after 3 seconds
  useEffect(() => {
    if (ui.state.graphSwitchBanner) {
      const timer = setTimeout(() => {
        ui.actions.setGraphSwitchBanner(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [ui.state.graphSwitchBanner]);

  // Auto-dismiss concept not found banner after 5 seconds
  useEffect(() => {
    if (ui.state.conceptNotFoundBanner) {
      const timer = setTimeout(() => {
        ui.actions.setConceptNotFoundBanner(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [ui.state.conceptNotFoundBanner]);

  // Track if initial load has happened to prevent infinite loops
  const hasInitializedRef = useRef(false);
  const lastGraphIdRef = useRef<string | null>(null);

  // Initial load effect - runs once on mount
  useEffect(() => {
    if (hasInitializedRef.current) return;
    
    hasInitializedRef.current = true;
    const targetGraphId = getActiveGraphId();
    lastGraphIdRef.current = targetGraphId;
    
    // Load all data in parallel for faster initial load
    // Don't block UI - start loading immediately but don't wait
    async function loadInitialData() {
      try {
        // First, refresh graphs to get the list of graphs
        // On initial load, sync with backend only if user hasn't specified a graph_id
        const shouldSyncWithBackend = targetGraphId === 'default';
        await refreshGraphs(!shouldSyncWithBackend);
        
        // Use the targetGraphId from URL/session (already determined above)
        // Load graph in background (non-blocking)
        // Other data can load in parallel
        loadGraph(targetGraphId).catch(err => {
          console.error('Error loading graph:', err);
        });
        
        // Load other data in parallel (non-blocking)
        Promise.all([
          refreshBranches(),
          refreshFocusAreas(),
          (async () => {
            try {
              const style = await getTeachingStyle();
              setTeachingStyle(style);
            } catch (err) {
              // Silently fail - teaching style is optional
              console.warn('Failed to load teaching style:', err);
            }
          })(),
        ]).catch(err => {
          console.error('Error loading initial data:', err);
        });
      } catch (err) {
        console.error('Error loading initial data:', err);
      }
    }
    loadInitialData();
  }, []); // Empty deps - only run on mount

  // Extract graph_id from URL for stable dependency
  const urlGraphId = useMemo(() => searchParams?.get('graph_id') || null, [searchParams]);

  // Handle graph_id changes from URL
  useEffect(() => {
    if (!hasInitializedRef.current) return; // Wait for initial load
    
    const targetGraphId = getActiveGraphId();
    
    // Only switch if graph_id actually changed (allow reloading same graph if needed)
    if (targetGraphId !== lastGraphIdRef.current) {
      lastGraphIdRef.current = targetGraphId;
      
      selectGraph(targetGraphId).then(() => {
        setActiveGraphId(targetGraphId);
        setSelectedNode(null);
        refreshGraphs(true); // Preserve the graph we just switched to
        refreshBranches();
        loadGraph(targetGraphId).then(() => {
          // After graph loads, try to select concept_id if present
          const conceptIdParam = searchParams?.get('select');
          if (conceptIdParam) {
            // Use getConcept API to fetch full concept data
            import('../../api-client').then((api) => {
              api.getConcept(conceptIdParam).then((concept) => {
                // Set the selected node - this will automatically open the context panel
                setSelectedNode(concept);
                updateSelectedPosition(concept);
                
                // Load resources for the concept
                api.getResourcesForConcept(conceptIdParam).then((resources) => {
                  setSelectedResources(resources);
                  resourceCacheRef.current.set(conceptIdParam, resources);
                }).catch((err) => {
                  console.warn('Failed to load resources for concept:', err);
                });
                
                // Center on the node after a short delay to ensure graph is rendered
                setTimeout(() => {
                  if (graphRef.current && concept) {
                    const graphData = graphRef.current.graphData();
                    const nodeInGraph = graphData?.nodes?.find((n: any) => n.node_id === concept.node_id);
                    if (nodeInGraph && typeof nodeInGraph.x === 'number' && typeof nodeInGraph.y === 'number') {
                      centerNodeInVisibleArea(nodeInGraph.x, nodeInGraph.y, 800, true);
                      graphRef.current.zoom(2.0, 800);
                    } else {
                      // If node not in graph yet, try to zoom to fit
                      graphRef.current.zoomToFit(800, 50);
                    }
                  }
                }, 300);
              }).catch(() => {
                // Concept not found - try to find it in the loaded graph data
                const graphData = graphRef.current?.graphData();
                const conceptInGraph = graphData?.nodes?.find((n: any) => n.node_id === conceptIdParam);
                if (conceptInGraph) {
                  setSelectedNode(conceptInGraph);
                  updateSelectedPosition(conceptInGraph);
                  
                  // Load resources (only if not cached)
                  if (!resourceCacheRef.current.has(conceptIdParam)) {
                    import('../../api-client').then((api) => {
                      api.getResourcesForConcept(conceptIdParam).then((resources) => {
                        setSelectedResources(resources);
                        resourceCacheRef.current.set(conceptIdParam, resources);
                      }).catch(() => {});
                    });
                  } else {
                    setSelectedResources(resourceCacheRef.current.get(conceptIdParam)!);
                  }
                  
                  setTimeout(() => {
                    if (graphRef.current && conceptInGraph) {
                      const node = conceptInGraph as any;
                      if (typeof node.x === 'number' && typeof node.y === 'number') {
                        centerNodeInVisibleArea(node.x, node.y, 800, true);
                        graphRef.current.zoom(2.0, 800);
                      }
                    }
                  }, 300);
                } else {
                  ui.actions.setConceptNotFoundBanner(conceptIdParam);
                }
              });
            });
          }
        });
        
        // Show switch banner
        refreshGraphs();
        // Get graph name after refresh completes
        setTimeout(() => {
          listGraphs().then((data) => {
            const graph = data.graphs?.find((g: any) => g.graph_id === targetGraphId);
            ui.actions.setGraphSwitchBanner({
              message: `Switched to ${graph?.name || targetGraphId}`,
              graphName: graph?.name || targetGraphId,
            });
          }).catch(() => {
            ui.actions.setGraphSwitchBanner({
              message: `Switched to ${targetGraphId}`,
              graphName: targetGraphId,
            });
          });
        }, 100);
      }).catch((err) => {
        console.error('Failed to switch to graph from URL:', err);
        loadGraph(targetGraphId);
        refreshGraphs();
        refreshBranches();
      });
    }
  }, [urlGraphId, activeGraphId, getActiveGraphId]); // Stable dependencies

  // Watch activeGraphId changes and reload graph if needed
  // This ensures the graph loads when activeGraphId changes (e.g., from workspace selector)
  // Only triggers if URL-based loading didn't already handle it
  useEffect(() => {
    if (!hasInitializedRef.current) return; // Wait for initial load
    
    // Only reload if activeGraphId changed and doesn't match what we last loaded
    // Also check if URL doesn't have graph_id param (to avoid conflicts with URL-based loading)
    const urlGraphId = searchParams?.get('graph_id');
    if (activeGraphId && activeGraphId !== lastGraphIdRef.current) {
      // If URL has graph_id, let the URL-based useEffect handle it
      if (urlGraphId && urlGraphId === activeGraphId) {
        return; // URL-based loading will handle it
      }
      
      const targetGraphId = activeGraphId;
      console.log('[Graph] activeGraphId changed, loading graph:', targetGraphId);
      lastGraphIdRef.current = targetGraphId;
      
      // Load the graph for the new activeGraphId
      loadGraph(targetGraphId).catch((err) => {
        console.error('Failed to load graph for activeGraphId:', err);
        setError(err instanceof Error ? err.message : 'Failed to load graph');
      });
    }
  }, [activeGraphId, loadGraph, searchParams]);

  // Handle highlight_run_id query param
  const highlightRunIdParamRef = useRef<string | null>(null);
  const currentHighlightRunId = searchParams?.get('highlight_run_id') || null;
  if (highlightRunIdParamRef.current !== currentHighlightRunId) {
    highlightRunIdParamRef.current = currentHighlightRunId;
  }
  const runIdParam = highlightRunIdParamRef.current;

  useEffect(() => {
    if (runIdParam && runIdParam !== ui.state.highlightRunId) {
      ui.actions.setHighlightRunId(runIdParam);
      // Load run changes
      getIngestionRunChanges(runIdParam)
        .then((changes) => {
          setRunChanges(changes);
          // Set highlighted concept IDs
          const conceptIds = new Set<string>();
          changes.concepts_created.forEach((c: any) => conceptIds.add(c.concept_id));
          changes.concepts_updated.forEach((c: any) => conceptIds.add(c.concept_id));
          setHighlightedConceptIds(conceptIds);
          
          // Set highlighted relationship IDs
          const relIds = new Set<string>();
          changes.relationships_proposed.forEach((r: any) => {
            relIds.add(`${r.from_concept_id}-${r.to_concept_id}-${r.predicate}`);
          });
          setHighlightedRelationshipIds(relIds);
        })
        .catch((err) => {
          console.error('Failed to load run changes:', err);
        });
    } else if (!runIdParam && ui.state.highlightRunId) {
      ui.actions.setHighlightRunId(null);
      setRunChanges(null);
      setHighlightedConceptIds(new Set());
      setHighlightedRelationshipIds(new Set());
    }
  }, [runIdParam, ui.state.highlightRunId]);

  // Apply highlighting to graph data when highlightedConceptIds or highlightedRelationshipIds change
  useEffect(() => {
    setGraphData(prev => {
      const hasHighlights = highlightedConceptIds.size > 0 || highlightedRelationshipIds.size > 0;
      if (!hasHighlights) {
        // Clear highlighting
        return {
          ...prev,
          nodes: prev.nodes.map((n: any) => ({
            ...n,
            __highlighted: false,
          })),
          links: prev.links.map((l: any) => ({
            ...l,
            __highlighted: false,
          })),
        };
      }
      
      // Apply highlighting
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
  }, [highlightedConceptIds.size, highlightedRelationshipIds.size]); // Only depend on sizes

  // Separate effect for expanding neighborhoods when run changes are loaded
  useEffect(() => {
    if (runChanges && highlightedConceptIds.size > 0) {
      const createdIds = runChanges.concepts_created.slice(0, 10).map((c: any) => c.concept_id);
      createdIds.forEach((conceptId: string) => {
        if (highlightedConceptIds.has(conceptId)) {
          const node = graphData.nodes.find(n => n.node_id === conceptId);
          if (node) {
            revealDomain(node.domain);
            if (!expandedNodes.has(conceptId)) {
              expandNeighbors(conceptId);
            }
          }
        }
      });
    }
  }, [runChanges, highlightedConceptIds.size]); // Only run when runChanges changes or highlight count changes

  // (Chat is now a docked panel; splitter resizing removed)

  // Get active domain plugin for selected node
  const getActivePlugin = useCallback((node: Concept | null): ReturnType<typeof getPlugin> | null => {
    if (!node) return null;
    // Check domain first
    const domainPlugin = getPluginForDomain(node.domain || '');
    if (domainPlugin) return domainPlugin;
    // Check all plugins for relevance
    const plugins = [getPlugin('lecture')].filter(Boolean);
    for (const plugin of plugins) {
      if (plugin?.isRelevant?.(node)) {
        return plugin;
      }
    }
    return null;
  }, []);


  // Chat input handler
  // Ref to track the current message ID being processed
  const currentMessageIdRef = useRef<string | null>(null);
  
  const handleChatSubmit = useCallback(async (message: string) => {
    // Prevent duplicate submissions
    if (!message.trim() || chat.state.isChatLoading || isSubmittingChatRef.current) {
      return;
    }
    
    // Mark as submitting immediately to prevent double submissions
    isSubmittingChatRef.current = true;
    
    // Add user message to history immediately so it appears right away
    const userMessageId = `user-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    currentMessageIdRef.current = userMessageId; // Store in ref for later lookup
    
    // Check if this exact message was just added (prevent duplicates) - check ALL recent messages, not just last
    const recentMessages = chat.state.chatHistory.slice(-3); // Check last 3 messages
    const isDuplicate = recentMessages.some(msg => 
      msg.question === message && (!msg.answer || msg.answer.trim() === '')
    );
    if (isDuplicate) {
      // This message was already added, don't add it again
      console.warn('[Chat] Duplicate message detected, skipping');
      isSubmittingChatRef.current = false;
      currentMessageIdRef.current = null;
      return;
    }
    
    // Add pending message to history (will be updated when response arrives)
    const pendingMessage = {
      id: userMessageId,
      question: message,
      answer: '', // Empty initially, will be filled when response arrives
      answerId: null,
      answerSections: null,
      timestamp: Date.now(),
      suggestedQuestions: [],
      usedNodes: [],
      suggestedActions: [],
      retrievalMeta: null,
      evidenceUsed: [],
    };
    chat.actions.addChatMessage(pendingMessage);
    
    // Scroll to bottom after adding pending message to show it immediately
    setTimeout(() => {
      if (chatStreamRef.current) {
        chatStreamRef.current.scrollTop = chatStreamRef.current.scrollHeight;
      }
    }, 0);
    
    chat.actions.setChatLoading(true);
    chat.actions.setLoadingStage('Processing your question...');
    chat.actions.setLastQuestion(message);
    chat.actions.setChatAnswer(null);
    chat.actions.setAnswerId(null);
    chat.actions.setAnswerSections(null);
    chat.actions.setEvidenceUsed([]);
    chat.actions.setUsedNodes([]);
    chat.actions.setSuggestedQuestions([]);
    chat.actions.setSuggestedActions([]);
    chat.actions.setRetrievalMeta(null);
    clearEvidenceHighlight();
    
    try {
      // Convert chat history to the format expected by the API
      const chatHistoryForAPI = chat.state.chatHistory.map(msg => ({
        id: msg.id,
        question: msg.question,
        answer: msg.answer,
        timestamp: msg.timestamp,
      }));
      
      console.log('[Chat] Sending request to /api/brain-web/chat', {
        message: message.substring(0, 50),
        graph_id: activeGraphId,
        branch_id: activeBranchId,
        historyLength: chatHistoryForAPI.length,
      });
      
      const response = await fetch('/api/brain-web/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          mode: 'graphrag',
          graph_id: activeGraphId,
          branch_id: activeBranchId,
          lens: undefined,
          chatHistory: chatHistoryForAPI,
        }),
      });
      
      console.log('[Chat] Response status:', response.status, response.statusText);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Chat] API error response:', errorText);
        let errorMessage = 'Chat request failed';
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch {
          errorMessage = errorText || errorMessage;
        }
        throw new Error(errorMessage);
      }
      
      const data = await response.json();
      console.log('[Chat] Response received:', {
        hasAnswer: !!data.answer,
        answerLength: data.answer?.length || 0,
        answerType: typeof data.answer,
        answerValue: data.answer ? data.answer.substring(0, 200) : 'MISSING',
        hasError: !!data.error,
        error: data.error,
        fullDataKeys: Object.keys(data),
      });
      
      // Check for error in response body
      if (data.error) {
        throw new Error(data.error);
      }
      
      // Check if answer is missing
      if (!data.answer || data.answer.trim() === '') {
        console.error('[Chat] ⚠️ WARNING: Response received but answer is empty or missing!', {
          dataKeys: Object.keys(data),
          answer: data.answer,
          answerId: data.answerId,
        });
      }
      
      console.log('[Chat] Received response:', {
        answer: data.answer?.substring(0, 100),
        suggestedActions: data.suggestedActions,
        suggestedActionsCount: data.suggestedActions?.length || 0,
        fullSuggestedActions: data.suggestedActions,
      });
      
      // Auto-execute actions if this is an action request (user wants to add/create/link something)
      const isActionRequest = message.toLowerCase().match(/\b(add|create|link|connect)\b.*\b(node|graph|concept)\b/i) ||
                              message.toLowerCase().match(/\badd\s+\w+\s+to\s+(graph|the\s+graph)\b/i);
      
      if (data.suggestedActions && data.suggestedActions.length > 0) {
        console.log('[Chat] ✅ Actions received:', data.suggestedActions);
        
        // Auto-execute if this looks like an action request
        if (isActionRequest && data.suggestedActions.length > 0) {
          console.log('[Chat] 🚀 Auto-executing action request');
          // Execute the first action automatically
          const action = data.suggestedActions[0];
          
          try {
            chat.actions.setChatLoading(true);
            chat.actions.setLoadingStage(`Executing: ${action.label}...`);
            
            if (action.type === 'add' && action.concept) {
              const api = await import('../../api-client');
              
              // CRITICAL: Set the active graph context in backend before creating concept
              // This ensures the node is created in the correct graph/workspace
              console.log('[Auto-Action] Setting active graph context to:', activeGraphId);
              await api.selectGraph(activeGraphId);
              
              const newConcept = await api.createConcept({
                name: action.concept,
                domain: action.domain || 'general',
                type: 'concept',
                graph_id: activeGraphId, // Explicitly specify which graph to add to
              });
              
              console.log('[Auto-Action] Created concept:', newConcept);
              
              // Fetch the full concept from backend to ensure we have all data
              let fullConcept: Concept;
              try {
                fullConcept = await api.getConcept(newConcept.node_id);
                console.log('[Auto-Action] Fetched full concept:', fullConcept);
              } catch (err) {
                console.warn('[Auto-Action] Could not fetch concept, using created one:', err);
                fullConcept = newConcept;
              }
              
              const visualNode: Concept & { domain: string; type: string } = {
                ...fullConcept,
                domain: action.domain || 'general',
                type: 'concept',
              };
              
              // Add to graph immediately
              setGraphData(prev => {
                const exists = prev.nodes.some(n => n.node_id === fullConcept.node_id);
                if (exists) {
                  console.log('[Auto-Action] Node already in graph, updating it');
                  return {
                    ...prev,
                    nodes: prev.nodes.map(n => n.node_id === fullConcept.node_id ? visualNode : n),
                  };
                }
                console.log('[Auto-Action] Adding new node to graph:', visualNode);
                return { ...prev, nodes: [...prev.nodes, visualNode] };
              });
              
              // Refresh graph, but ensure our node persists
              await loadGraph(activeGraphId);
              
              // After loadGraph, ensure our node is still there (it might be filtered out by limits)
              setTimeout(() => {
                setGraphData(prev => {
                  const nodeExists = prev.nodes.some(n => n.node_id === fullConcept.node_id);
                  if (!nodeExists) {
                    console.log('[Auto-Action] Node missing after loadGraph (likely filtered by limits), re-adding');
                    return { ...prev, nodes: [...prev.nodes, visualNode] };
                  }
                  return prev;
                });
              }, 100);
              
              setTimeout(() => {
                setGraphData(prev => {
                  const nodeExists = prev.nodes.some(n => n.node_id === newConcept.node_id);
                  if (!nodeExists) {
                    return { ...prev, nodes: [...prev.nodes, visualNode] };
                  }
                  return prev;
                });
                
                const updatedGraphData = graphRef.current?.graphData();
                const conceptInGraph = updatedGraphData?.nodes?.find((n: any) => n.node_id === newConcept.node_id) || visualNode;
                setSelectedNode(conceptInGraph);
                updateSelectedPosition(conceptInGraph);
                
                setTimeout(() => {
                  if (graphRef.current && conceptInGraph) {
                    const node = conceptInGraph as any;
                    if (node.x !== undefined && node.y !== undefined) {
                      centerNodeInVisibleArea(node.x, node.y, 1000, true);
                      graphRef.current.zoom(1.5, 1000);
                    } else {
                      graphRef.current.zoomToFit(1000, 50);
                    }
                  }
                }, 300);
              }, 600);
              
              chat.actions.setChatAnswer(`✅ Added "${action.concept}" to the graph!`);
            } else if (action.type === 'link' && action.source && action.target) {
              const api = await import('../../api-client');
              const sourceConcept = await resolveConceptByName(action.source);
              const targetConcept = await resolveConceptByName(action.target);
              
              if (!sourceConcept || !targetConcept) {
                throw new Error(`Could not find concepts: ${action.source} or ${action.target}`);
              }
              
              await api.createRelationshipByIds(
                sourceConcept.node_id,
                targetConcept.node_id,
                action.label || 'related_to'
              );
              
              await loadGraph(activeGraphId);
              chat.actions.setChatAnswer(`✅ Linked "${action.source}" to "${action.target}"!`);
            }
            
            chat.actions.setLoadingStage('');
          } catch (err: any) {
            console.error('[Auto-Action] Error:', err);
            chat.actions.setChatAnswer(`❌ Failed to execute: ${err.message || 'Unknown error'}`);
          } finally {
            chat.actions.setChatLoading(false);
            chat.actions.setLoadingStage('');
          }
        }
      } else {
        console.log('[Chat] ⚠️ No actions in response');
      }
      // Normalize and set evidence first
      let normalizedEvidence: EvidenceItem[] = [];
      if (data.evidence) {
        normalizedEvidence = normalizeEvidence(data.evidence);
      } else if (data.evidenceUsed) {
        normalizedEvidence = data.evidenceUsed;
      }
      
      // Update the pending message in history with the complete answer FIRST
      // This ensures history is persisted before setting transient state
      let messageIndex = -1;
      
      // CRITICAL: Always process the answer if it exists, regardless of message state
      if (data.answer && data.answer.trim()) {
        console.log('[Chat] Processing answer, length:', data.answer.length);
        
        // Use the ref to get the message ID (in case of closure issues)
        const messageIdToFind = currentMessageIdRef.current || userMessageId;
        console.log('[Chat] Looking for message with ID:', messageIdToFind, 'or question:', message?.substring(0, 50));
        
        // Get the latest history state
        const currentHistory = chat.state.chatHistory;
        console.log('[Chat] Current history length:', currentHistory.length);
        
        // Try to find by ID first
        messageIndex = currentHistory.findIndex(msg => msg.id === messageIdToFind);
        console.log('[Chat] Found message by ID at index:', messageIndex);
        
        // Also try to find by question if ID doesn't match (fallback for state sync issues)
        if (messageIndex < 0 && message) {
          messageIndex = currentHistory.findIndex(msg => 
            msg.question === message && (!msg.answer || msg.answer.trim() === '')
          );
          console.log('[Chat] Found message by question at index:', messageIndex);
        }
        
        if (messageIndex >= 0) {
          // Update existing message
          console.log('[Chat] ✅ Updating existing message at index', messageIndex);
          const updatedHistory = currentHistory.map((msg, idx) => 
            idx === messageIndex ? {
              ...msg,
              answer: data.answer,
              answerId: data.answerId || null,
              answerSections: data.answer_sections || data.sections || null,
              suggestedQuestions: data.suggestedQuestions || [],
              usedNodes: data.usedNodes || [],
              suggestedActions: data.suggestedActions || [],
              retrievalMeta: data.retrievalMeta || null,
              evidenceUsed: normalizedEvidence,
            } : msg
          );
          console.log('[Chat] About to update history, new answer length:', data.answer.length);
          console.log('[Chat] Updated history preview:', updatedHistory.map(m => ({
            id: m.id,
            question: m.question.substring(0, 30),
            hasAnswer: !!m.answer,
            answerLength: m.answer?.length || 0,
          })));
          chat.actions.setChatHistory(updatedHistory);
          // Also set transient state as backup in case React state update is delayed
          chat.actions.setChatAnswer(data.answer);
          chat.actions.setAnswerId(data.answerId || null);
          // Force a small delay to ensure state is updated, then verify and clear transient
          setTimeout(() => {
            const verifyHistory = chat.state.chatHistory;
            const verifyMsg = verifyHistory.find(m => m.id === messageIdToFind);
            console.log('[Chat] ✅ History updated. Verification:', {
              found: !!verifyMsg,
              hasAnswer: verifyMsg?.answer ? true : false,
              answerLength: verifyMsg?.answer?.length || 0,
            });
            // Clear transient state only if answer is confirmed in history
            if (verifyMsg?.answer && verifyMsg.answer.trim()) {
              chat.actions.setChatAnswer(null);
              chat.actions.setAnswerId(null);
            }
          }, 100);
          currentMessageIdRef.current = null; // Clear ref
          console.log('[Chat] ✅ Message updated in history');
        } else {
          // Message not found - check if a message with same question/answer already exists
          const existingMessage = message ? currentHistory.find(msg => 
            msg.question === message && msg.answer && msg.answer.trim() !== '' && msg.answer === data.answer
          ) : null;
          
          if (existingMessage) {
            // Message already exists with answer, just clear transient state
            console.log('[Chat] Message already exists with answer, clearing transient state');
            chat.actions.setChatAnswer(null);
            chat.actions.setAnswerId(null);
            currentMessageIdRef.current = null;
          } else {
            // Message not found, add it (fallback - shouldn't normally happen)
            console.log('[Chat] ⚠️ Message not found in history, adding as new message');
            const newMessage: ChatMessage = {
              id: messageIdToFind,
              question: message || 'User question',
              answer: data.answer,
              answerId: data.answerId || null,
              answerSections: data.answer_sections || data.sections || null,
              timestamp: Date.now(),
              suggestedQuestions: data.suggestedQuestions || [],
              usedNodes: data.usedNodes || [],
              suggestedActions: data.suggestedActions || [],
              retrievalMeta: data.retrievalMeta || null,
              evidenceUsed: normalizedEvidence,
            };
            chat.actions.addChatMessage(newMessage);
            // Clear transient state since answer is now in history
            chat.actions.setChatAnswer(null);
            chat.actions.setAnswerId(null);
            currentMessageIdRef.current = null;
            console.log('[Chat] ✅ Added new message to history');
          }
        }
      } else {
        console.warn('[Chat] ⚠️ No answer in response or answer is empty');
      }
      
      // Ensure all other state is updated regardless of whether message was found
      chat.actions.setAnswerSections(data.answer_sections || data.sections || null);
      chat.actions.setUsedNodes(data.usedNodes || []);
      chat.actions.setSuggestedQuestions(data.suggestedQuestions || []);
      chat.actions.setSuggestedActions(data.suggestedActions || []);
      chat.actions.setRetrievalMeta(data.retrievalMeta || null);
      chat.actions.setEvidenceUsed(normalizedEvidence);
      
      // FINAL FALLBACK: If answer exists but messageIndex is still -1, 
      // set transient state so it at least displays (shouldn't happen in normal flow)
      if (messageIndex < 0 && data.answer && data.answer.trim()) {
        // Wait a bit for state to update, then check again
        setTimeout(() => {
          const latestHistory = chat.state.chatHistory;
          const answerInHistory = latestHistory.some(msg => 
            msg.answer && msg.answer.trim() === data.answer.trim()
          );
          
          if (!answerInHistory) {
            console.log('[Chat] ⚠️ FINAL FALLBACK: Setting transient state because answer not in history after delay');
            chat.actions.setChatAnswer(data.answer);
            chat.actions.setAnswerId(data.answerId || null);
            // Also try to add it to history one more time
            const messageIdToFind = currentMessageIdRef.current || userMessageId;
            const finalHistory = chat.state.chatHistory;
            const finalIndex = finalHistory.findIndex(msg => 
              msg.id === messageIdToFind || (msg.question === message && !msg.answer)
            );
            
            if (finalIndex >= 0) {
              const finalUpdated = finalHistory.map((msg, idx) => 
                idx === finalIndex ? { ...msg, answer: data.answer, answerId: data.answerId } : msg
              );
              chat.actions.setChatHistory(finalUpdated);
              console.log('[Chat] ✅ FINAL FALLBACK: Successfully added answer to history');
            } else {
              // Last resort: add as completely new message
              const newMsg: ChatMessage = {
                id: messageIdToFind,
                question: message || 'User question',
                answer: data.answer,
                answerId: data.answerId || null,
                answerSections: data.answer_sections || null,
                timestamp: Date.now(),
                suggestedQuestions: data.suggestedQuestions || [],
                usedNodes: data.usedNodes || [],
                suggestedActions: data.suggestedActions || [],
                retrievalMeta: data.retrievalMeta || null,
                evidenceUsed: normalizedEvidence,
              };
              chat.actions.addChatMessage(newMsg);
              console.log('[Chat] ✅ FINAL FALLBACK: Added as completely new message');
            }
          } else {
            console.log('[Chat] Answer found in history after delay, clearing transient state');
            chat.actions.setChatAnswer(null);
            chat.actions.setAnswerId(null);
          }
        }, 200);
      } else if (messageIndex >= 0) {
        // Clear transient state since answer should be in history
        chat.actions.setChatAnswer(null);
        chat.actions.setAnswerId(null);
      }
      
      // Auto-highlight evidence if enabled
      if (autoHighlightEvidence && normalizedEvidence.length > 0) {
        await applyEvidenceHighlightWithRetry(normalizedEvidence, data.retrievalMeta);
      }
      
      // Session management: Create or update session
      let currentSessionId = getCurrentSessionId();
      
      // If no session exists, create one (first question)
      if (!currentSessionId && message.trim()) {
        try {
          const newSession = await createChatSession(
            message,
            data.answer || '',
            data.answerId || null,
            activeGraphId,
            activeBranchId
          );
          currentSessionId = newSession.id;
          setCurrentSessionId(currentSessionId);
        } catch (err) {
          console.warn('Failed to create session:', err);
        }
      }
      
      // Add message to session
      if (currentSessionId && data.answer && message.trim()) {
        addMessageToSession(
          currentSessionId,
          message,
          data.answer,
          data.answerId || null,
          data.suggestedQuestions || [],
          normalizedEvidence
        );
      }
      
      // Scroll chat to bottom after a brief delay to ensure DOM is updated
      setTimeout(() => {
        if (chatStreamRef.current) {
          chatStreamRef.current.scrollTop = chatStreamRef.current.scrollHeight;
        }
      }, 100);
    } catch (err) {
      console.error('[Chat] Error in handleChatSubmit:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      console.error('[Chat] Error details:', {
        message: errorMessage,
        stack: err instanceof Error ? err.stack : undefined,
      });
      
      // Update the pending message with error - use ref to get message ID
      const messageIdToFind = currentMessageIdRef.current;
      if (messageIdToFind) {
        const currentHistory = chat.state.chatHistory;
        const messageIndex = currentHistory.findIndex(msg => msg.id === messageIdToFind);
        if (messageIndex >= 0) {
          const updatedHistory = currentHistory.map(msg => 
            msg.id === messageIdToFind ? {
              ...msg,
              answer: `❌ Error: ${errorMessage}. Please try again.`,
              answerId: null,
            } : msg
          );
          chat.actions.setChatHistory(updatedHistory);
        }
      }
      
      // Also set transient error state
      chat.actions.setChatAnswer(`❌ Error: ${errorMessage}. Please try again.`);
    } finally {
      chat.actions.setChatLoading(false);
      chat.actions.setLoadingStage('');
      isSubmittingChatRef.current = false;
      currentMessageIdRef.current = null; // Clear ref on completion/error
    }
  }, [chat.actions, chat.state.isChatLoading, chat.state.chatHistory, activeGraphId, activeBranchId, autoHighlightEvidence, applyEvidenceHighlightWithRetry, clearEvidenceHighlight]);

  // Node selection handler
  const handleNodeClick = useCallback((node: any) => {
    console.log('Node clicked:', node);
    const concept = graphData.nodes.find(n => n.node_id === node.node_id);
    if (!concept) {
      console.log('Concept not found for node:', node);
      return;
    }
    
    console.log('Setting selected node:', concept);
    // Always allow node selection - clear any loading states if switching nodes
    const isDifferentNode = selectedNode?.node_id !== concept.node_id;
    if (isDifferentNode && loadingNeighbors) {
      // Clear loading state when switching to a different node
      loadingNeighborsRef.current = null;
      setLoadingNeighbors(null);
    }
    
    setSelectedNode(concept);
    trackConceptViewed(concept.node_id, concept.name);
    pushRecentConceptView({ id: concept.node_id, name: concept.name });
    // Set a default position immediately so panel shows up right away
    if (typeof window !== 'undefined') {
      ui.actions.setSelectedPosition({ 
        x: window.innerWidth - 380, 
        y: window.innerHeight / 2 
      });
    }
    // Update position with actual graph coordinates (will override default if successful)
    setTimeout(() => updateSelectedPosition(concept), 0);
  }, [graphData.nodes, updateSelectedPosition, loadingNeighbors, selectedNode, ui.actions]);

  // Node double-click handler - navigate to concept page
  const handleNodeDoubleClick = useCallback((node: any) => {
    const concept = graphData.nodes.find(n => n.node_id === node.node_id);
    if (!concept) return;
    
    // Navigate to concept page (Wikipedia-style)
    const slug = concept.url_slug || concept.node_id;
    const graphId = searchParams?.get('graph_id');
    const queryString = graphId ? `?graph_id=${graphId}` : '';
    router.push(`/concepts/${slug}${queryString}`);
  }, [graphData.nodes, router, searchParams]);

  // Graph switch handler
  const handleGraphSwitch = useCallback(async (graphId: string) => {
    try {
      await selectGraph(graphId);
      setActiveGraphId(graphId);
      setSelectedNode(null);
      await loadGraph(graphId);
      await refreshGraphs();
      await refreshBranches();
    } catch (err) {
      console.error('Failed to switch graph:', err);
      ui.actions.setGraphSwitchError(err instanceof Error ? err.message : 'Failed to switch graph');
    }
  }, [loadGraph, refreshGraphs, refreshBranches]);

  // Track if this is the initial mount to prevent auto-loading chat sessions on startup
  const isInitialMountRef = useRef(true);
  const initialChatParamRef = useRef<string | null>(null);
  
  // Load chat session from URL param (only if not initial mount)
  useEffect(() => {
    const chatSessionId = searchParams?.get('chat') || null;
    const isInitialMount = isInitialMountRef.current;
    
    // On initial mount, just remember the chat param but don't load it
    // This allows the app to start fresh while preserving the URL
    if (isInitialMount) {
      isInitialMountRef.current = false;
      initialChatParamRef.current = chatSessionId;
      // Clear chat history on startup to start fresh
      chat.actions.setChatHistory([]);
      setCurrentSessionId(null);
      // Don't load the session on initial mount - user gets a fresh start
      return;
    }
    
    // After initial mount, only load session if:
    // 1. There's a chat parameter in the URL
    // 2. It's different from the initial one (user explicitly navigated to it)
    // This allows users to navigate to chat sessions after startup
    if (chatSessionId && chatSessionId !== initialChatParamRef.current) {
      const session = getChatSession(chatSessionId);
      if (session) {
        // Mark that we're loading a session to prevent auto-scroll interference
        isLoadingSessionRef.current = true;
        
        setCurrentSessionId(session.id);
        // Load session messages into chat history
        const sessionMessages = session.messages.map(msg => ({
          id: msg.id,
          question: msg.question,
          answer: msg.answer,
          answerId: msg.answerId,
          answerSections: null,
          timestamp: msg.timestamp,
          suggestedQuestions: msg.suggestedQuestions || [],
          usedNodes: [],
          suggestedActions: [],
          retrievalMeta: null,
          evidenceUsed: msg.evidenceUsed || [],
        }));
        chat.actions.setChatHistory(sessionMessages);
        
        // Scroll to bottom initially, but allow user to scroll up freely
        // Use requestAnimationFrame to ensure DOM is updated
        requestAnimationFrame(() => {
          setTimeout(() => {
            if (chatStreamRef.current) {
              chatStreamRef.current.scrollTop = chatStreamRef.current.scrollHeight;
            }
            // Re-enable auto-scroll after a short delay to allow user interaction
            setTimeout(() => {
              isLoadingSessionRef.current = false;
            }, 500);
          }, 100);
        });
      }
    }
  }, [searchParams, chat.actions]);

  // Focus handler
  const handleFocus = useCallback(() => {
    if (!selectedNode || !graphRef.current) return;
    const data = graphRef.current.graphData();
    const node = data?.nodes?.find((n: any) => n.node_id === selectedNode.node_id);
    if (node && typeof node.x === 'number' && typeof node.y === 'number') {
      centerNodeInVisibleArea(node.x, node.y, 500);
      graphRef.current.zoom(2.5, 500);
    }
  }, [selectedNode, centerNodeInVisibleArea]);

  // Activity events
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
  }, [selectedResources, selectedNode, setExpandedResources, ui]);

  // Don't block UI - show everything immediately, just show loading state in graph area
  return (
    <div className="app-shell" style={{ position: 'relative', width: '100%', height: '100vh', overflow: 'hidden' }}>

      {/* Graph canvas - full screen behind everything */}
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
        {!loading && graphData.nodes.length > 0 && displayGraph.nodes.length === 0 && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 10,
            textAlign: 'center',
            pointerEvents: 'none',
            padding: '20px',
            background: 'var(--panel)',
            borderRadius: '12px',
            border: '1px solid var(--border)',
            maxWidth: '400px',
          }}>
            <p style={{ color: 'var(--ink)', fontSize: '14px', margin: '0 0 8px 0', fontWeight: '600' }}>
              No nodes visible
            </p>
            <p style={{ color: 'var(--muted)', fontSize: '12px', margin: 0 }}>
              {graphData.nodes.length} nodes loaded but filtered out. Check your domain filters or relationship filters.
            </p>
          </div>
        )}
        {!loading && graphData.nodes.length === 0 && error && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 10,
            textAlign: 'center',
            pointerEvents: 'none',
            padding: '20px',
            background: 'var(--panel)',
            borderRadius: '12px',
            border: '1px solid var(--border)',
            maxWidth: '400px',
          }}>
            <p style={{ color: 'var(--ink)', fontSize: '14px', margin: '0 0 8px 0', fontWeight: '600' }}>
              Failed to load graph
            </p>
            <p style={{ color: 'var(--muted)', fontSize: '12px', margin: 0 }}>
              {error}
            </p>
          </div>
          )}
        <ForceGraph2D
          ref={graphRef}
          graphData={displayGraph}
          nodeLabel={(node: any) => {
            const zoom = ui.state.zoomTransform.k || ui.state.zoomLevel || 1;
            const isHighDegree = (degreeById.get(node.node_id) || 0) >= highDegreeThreshold;
            const isInNeighborhood = selectedNeighborhoodIds.has(node.node_id);
            const isEvidence = chat.state.evidenceNodeIds.has(node.node_id);
            const isHighlighted = (node as any).__highlighted;
            const isSelected = selectedNode?.node_id === node.node_id;
            
            // Always show label for selected node, or if: zoomed in enough, high degree, in neighborhood, evidence, or highlighted
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
            
            if (isSelected) {
              return '#ff0000'; // Bright red for selected node
            }
            if (isHighlighted) {
              return '#ffb703';
            }
            if (isEvidence) {
              return '#06d6a0';
            }
            return color;
          }}
          nodeVal={(node: any) => {
            const degree = degreeById.get(node.node_id) || 0;
            const isSelected = selectedNode?.node_id === node.node_id;
            
            // Make selected node significantly larger (3x normal size)
            if (isSelected) {
              return 24; // Large, prominent size
            }
            
            // Normal size based on degree
            return Math.max(4, Math.min(12, 4 + degree * 0.5));
          }}
          linkColor={(link: any) => {
            const sourceId = typeof link.source === 'string' ? link.source : link.source.node_id;
            const targetId = typeof link.target === 'string' ? link.target : link.target.node_id;
            const isEvidence = chat.state.evidenceLinkIds.has(`${sourceId}-${targetId}-${link.predicate}`);
            const isHighlighted = (link as any).__highlighted;
            
            if (isHighlighted) {
              return '#ffb703';
            }
            if (isEvidence) {
              return '#06d6a0';
            }
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
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
          onNodeDragEnd={(node: any) => {
            node.fx = node.x;
            node.fy = node.y;
            // Update position if this is the selected node
            if (selectedNode && node.node_id === selectedNode.node_id) {
              updateSelectedPosition(selectedNode);
            }
          }}
          onBackgroundClick={() => {
            // Clear loading states when clicking background to prevent UI lock
            if (loadingNeighbors) {
              loadingNeighborsRef.current = null;
              setLoadingNeighbors(null);
            }
            setSelectedNode(null);
          }}
          onNodeHover={(node: any) => {
            if (node) {
              const domain = node.domain || 'general';
              const color = domainColors.get(domain) || '#94a3b8';
              document.body.style.cursor = 'pointer';
              // Store original color if not already stored
              if (!(node as any).__originalColor) {
                (node as any).__originalColor = node.color || color;
              }
              // Highlight node
              (node as any).color = '#ffb703';
            } else {
              document.body.style.cursor = 'default';
            }
          }}
          onLinkHover={(link: any) => {
            if (link) {
              // Store original color if not already stored
              if (!(link as any).__originalColor) {
                (link as any).__originalColor = link.color || 'var(--border)';
              }
              // Highlight link
              (link as any).color = '#ffb703';
              (link as any).__highlighted = true;
            } else {
              // Reset all links to original colors
              displayGraph.links.forEach((l: any) => {
                if ((l as any).__originalColor) {
                  l.color = (l as any).__originalColor;
                  delete (l as any).__highlighted;
                }
              });
            }
          }}
          nodeCanvasObjectMode={() => 'after'} // Render custom nodes after default
          nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const isSelected = selectedNode?.node_id === node.node_id;
            
            if (isSelected) {
              const nodeSize = 24;
              // Draw bright white glow effect for selected node
              const glowRadius = nodeSize + 12;
              const gradient = ctx.createRadialGradient(node.x, node.y, nodeSize, node.x, node.y, glowRadius);
              gradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
              gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.6)');
              gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.3)');
              gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
              
              ctx.save();
              ctx.globalAlpha = 0.8;
              ctx.fillStyle = gradient;
              ctx.beginPath();
              ctx.arc(node.x, node.y, glowRadius, 0, 2 * Math.PI);
              ctx.fill();
              ctx.restore();
              
              // Draw bright thick border
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
                const degree = degreeById.get(node.node_id) || 0;
                // Make collision radius larger for selected node
                if (isSelected) {
                  return 32; // Larger collision radius for selected node
                }
                return Math.max(8, Math.min(20, 8 + degree * 0.3));
              });
            }
            // For isolated nodes (no links), add center force to keep them visible
            if (name === 'center' && displayGraph.links.length === 0) {
              return forceCenter();
            }
            return null;
          }}
          cooldownTicks={displayGraph.links.length === 0 ? 50 : 100}
          d3AlphaDecay={0.0228} // Faster decay for better performance
          d3VelocityDecay={0.4} // Higher velocity decay for smoother animation
          onEngineStop={() => {
            recomputeDomainBubbles();
          }}
          onZoom={(transform: any) => {
            // Debounce zoom updates to prevent lag
            requestAnimationFrame(() => {
              ui.actions.setZoomTransform(transform);
              ui.actions.setZoomLevel(transform.k);
              // Update selected node position on zoom/pan
              if (selectedNode) {
                updateSelectedPosition(selectedNode);
              }
            });
          }}
        />
      </div>

      {/* UI Components - positioned above graph */}
      <div style={{ position: 'relative', zIndex: 2, width: '100%', height: '100vh', display: 'flex', flexDirection: 'column', pointerEvents: 'none' }}>
      {/* Toolbar */}
      <div style={{ padding: '12px 16px', background: 'var(--background)', zIndex: 100, pointerEvents: 'auto' }}>
        <ExplorerToolbar
          demoMode={IS_DEMO_MODE}
          graphs={graphs}
          activeGraphId={activeGraphId}
          onSelectGraph={handleGraphSwitch}
          onRequestCreateGraph={() => ui.actions.setShowGraphModal(true)}
          branches={branches}
          activeBranchId={activeBranchId}
          onSelectBranch={async (branchId: string) => {
            try {
              await selectBranch(branchId);
              setActiveBranchId(branchId);
              await loadGraph();
              await refreshBranches();
            } catch (err) {
              console.error('Failed to switch branch:', err);
            }
          }}
          graphSwitchError={ui.state.graphSwitchError}
          canFocus={!!selectedNode}
          onFocus={handleFocus}
          canFork={!!selectedNode}
          onFork={async () => {
            if (!selectedNode) return;
            try {
              const branch = await forkBranchFromNode(activeGraphId, selectedNode.node_id);
              await refreshBranches();
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
              const snapshot = await createSnapshot({
                name: `Snapshot ${new Date().toLocaleString()}`,
                focused_node_id: selectedNode?.node_id || focusedNodeId || null,
              });
              console.log('Snapshot created:', snapshot);
            } catch (err) {
              console.error('Failed to create snapshot:', err);
            }
          }}
          onRestore={async () => {
            try {
              const result = await listSnapshots(50);
              if (result.snapshots.length > 0) {
                await restoreSnapshot(result.snapshots[0].snapshot_id);
                await loadGraph();
              }
            } catch (err) {
              console.error('Failed to restore snapshot:', err);
            }
          }}
          nodesCount={displayGraph.nodes.length}
          linksCount={displayGraph.links.length}
          domainsCount={uniqueDomains.length}
          overviewMeta={overviewMeta}
          loadingNeighbors={loadingNeighbors}
          showContentIngest={ui.state.showContentIngest}
          onToggleContentIngest={() => ui.actions.setShowContentIngest(!ui.state.showContentIngest)}
          contentIngestPopover={ui.state.showContentIngest ? (() => {
            // Find active plugin that supports ingestion
            const lecturePlugin = getPlugin('lecture');
            if (!lecturePlugin?.handleIngestion) return undefined;
            
            return (
              <div style={{ padding: '12px', background: 'var(--panel)', borderRadius: '8px', boxShadow: 'var(--shadow)', minWidth: '300px' }}>
                <ContentImportForm
                  onIngest={async (title, text, domain) => {
                    ui.actions.setContentIngestLoading(true);
                    try {
                      const result = await lecturePlugin.handleIngestion!(activeGraphId, title, text, domain);
                      setContentIngestResult(result);
                      await loadGraph();
                    } catch (err) {
                      console.error('Failed to ingest content:', err);
                    } finally {
                      ui.actions.setContentIngestLoading(false);
                    }
                  }}
                  isLoading={ui.state.contentIngestLoading}
                  result={contentIngestResult}
                  onClose={() => ui.actions.setShowContentIngest(false)}
                />
              </div>
            );
          })() : undefined}
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

      {/* Main layout */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', gap: '16px', padding: '0 16px 16px', pointerEvents: 'none' }}>
        {/* Session Drawer (left sidebar) - always show collapsed button, full drawer when not collapsed */}
        {!ui.state.sidebarCollapsed && (
          <div style={{ pointerEvents: 'auto' }}>
            <SessionDrawer
              isCollapsed={ui.state.sidebarCollapsed}
              onToggleCollapse={() => ui.actions.setSidebarCollapsed(true)}
            />
          </div>
        )}
        {ui.state.sidebarCollapsed && (
          <div style={{
            width: '40px',
            background: 'var(--panel)',
            borderRight: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'flex-start',
            padding: '12px 8px',
            pointerEvents: 'auto',
            zIndex: 100,
          }}>
            <button
              onClick={() => ui.actions.setSidebarCollapsed(false)}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                cursor: 'pointer',
                padding: '8px',
                color: 'var(--muted)',
                fontSize: '14px',
                width: '100%',
              }}
              aria-label="Expand sidebar"
              title="Expand sidebar"
            >
              →
            </button>
          </div>
        )}

        {/* Spacer for graph - graph is now behind everything */}
        <div style={{ flex: 1, pointerEvents: 'none' }} />

        {/* Chat panel - always show collapsed button, full panel when not collapsed */}
        {chat.state.isChatCollapsed ? (
          <div style={{
            width: '40px',
            background: 'var(--panel)',
            borderLeft: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'flex-start',
            padding: '12px 8px',
            borderRadius: '16px',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow)',
            pointerEvents: 'auto',
            zIndex: 100,
          }}>
            <button
              onClick={() => chat.actions.setChatCollapsed(false)}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: '4px',
                color: 'var(--muted)',
                fontSize: '14px',
                width: '100%',
              }}
              aria-label="Expand chat"
              title="Expand chat"
            >
              →
            </button>
          </div>
        ) : (
        <div style={{
          width: selectedNode 
            ? '280px' // Slightly wider in focus mode but still compact
            : chat.state.isChatMaximized 
              ? '100%' 
              : chat.state.isChatExpanded 
                ? '500px' 
                : '350px',
          height: chat.state.isChatMaximized ? '100%' : '80vh',
          maxHeight: chat.state.isChatMaximized ? '100%' : '80vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--panel)',
          borderRadius: '16px',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow)',
          transition: 'width 0.3s ease',
          overflow: 'visible',
          pointerEvents: 'auto',
        }}>
          {/* Chat header */}
          <div style={{
            padding: selectedNode ? '8px 12px' : '12px 16px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}>
            {/* Header row */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ 
                fontSize: selectedNode ? '12px' : '14px', 
                fontWeight: '600', 
                margin: 0, 
                color: 'var(--ink)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                Chat
              </h3>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <button
                  onClick={() => chat.actions.setChatCollapsed(true)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    color: 'var(--muted)',
                    fontSize: '14px',
                  }}
                  aria-label="Collapse chat"
                  title="Collapse chat"
                >
                  →
                </button>
                {chat.state.chatHistory.length > 0 && (
                <button
                  onClick={() => {
                    if (confirm('Clear chat history?')) {
                      chat.actions.setChatHistory([]);
                      chat.actions.setChatAnswer(null);
                      chat.actions.setLastQuestion('');
                      setCurrentSessionId(null);
                    }
                  }}
                  style={{
                    padding: '4px 8px',
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '11px',
                    color: 'var(--muted)',
                  }}
                  title="Clear chat history"
                >
                  Clear
                </button>
                )}
              </div>
            </div>
            
            {/* Control buttons row */}
            <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  // Maximize/Expand chat
                  if (!chat.state.isChatExpanded) {
                    chat.actions.setChatExpanded(true);
                  }
                  if (!chat.state.isChatMaximized) {
                    chat.actions.setChatMaximized(true);
                  }
                }}
                disabled={chat.state.isChatMaximized}
                style={{
                  padding: '4px 8px',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  cursor: chat.state.isChatMaximized ? 'default' : 'pointer',
                  fontSize: '14px',
                  fontWeight: '600',
                  color: chat.state.isChatMaximized ? 'var(--muted)' : 'var(--ink)',
                  opacity: chat.state.isChatMaximized ? 0.5 : 1,
                  minWidth: '25px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                aria-label="Maximize chat"
                title="Maximize chat"
              >
                +
              </button>
              <button
                onClick={() => {
                  // Minimize chat - restore to normal size
                  chat.actions.setChatMaximized(false);
                  chat.actions.setChatExpanded(false);
                }}
                disabled={!chat.state.isChatMaximized && !chat.state.isChatExpanded}
                style={{
                  padding: '4px 8px',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  cursor: (!chat.state.isChatMaximized && !chat.state.isChatExpanded) ? 'default' : 'pointer',
                  fontSize: '14px',
                  fontWeight: '600',
                  color: (!chat.state.isChatMaximized && !chat.state.isChatExpanded) ? 'var(--muted)' : 'var(--ink)',
                  opacity: (!chat.state.isChatMaximized && !chat.state.isChatExpanded) ? 0.5 : 1,
                  minWidth: '25px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                aria-label="Minimize chat"
                title="Minimize chat"
              >
                −
              </button>
            </div>
          </div>

          {/* Chat input - at top initially, moves to bottom after first message with answer */}
          {(chat.state.chatHistory.length === 0 || (chat.state.chatHistory.length > 0 && !chat.state.chatHistory.some(msg => msg.answer && msg.answer.trim()))) && (
            <div style={{
              padding: '12px',
              borderBottom: '1px solid var(--border)',
            }}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  // Prevent double submission
                  if (isSubmittingChatRef.current || chat.state.isChatLoading) {
                    return;
                  }
                  const textarea = e.currentTarget.querySelector('textarea') as HTMLTextAreaElement;
                  if (textarea?.value?.trim()) {
                    handleChatSubmit(textarea.value.trim());
                    textarea.value = '';
                    textarea.style.height = 'auto';
                  }
                }}
              >
                <div className="chat-input-row" style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                  <textarea
                    placeholder="Ask a question..."
                    disabled={chat.state.isChatLoading}
                    className="chat-input"
                    style={{
                      padding: '10px 14px',
                      fontSize: '14px',
                      minHeight: '44px',
                      maxHeight: '200px',
                      resize: 'none',
                      fontFamily: 'inherit',
                      lineHeight: '1.5',
                    }}
                    onInput={(e) => {
                      const target = e.target as HTMLTextAreaElement;
                      target.style.height = 'auto';
                      target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        const form = e.currentTarget.closest('form');
                        if (form) {
                          form.requestSubmit();
                        }
                      }
                    }}
                  />
                  <button
                    type="submit"
                    disabled={chat.state.isChatLoading}
                    className="pill pill--primary"
                    style={{
                      padding: '10px 20px',
                      flexShrink: 0,
                    }}
                  >
                    {chat.state.isChatLoading ? '...' : 'Ask'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Chat content */}
          <div
            ref={chatStreamRef}
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              overflowX: 'hidden',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '24px',
              scrollBehavior: 'auto', // Changed from 'smooth' to 'auto' for better performance
              WebkitOverflowScrolling: 'touch',
              willChange: 'scroll-position', // Optimize for scrolling
              contain: 'layout style paint', // CSS containment for performance
              transform: 'translateZ(0)', // Force GPU acceleration
              touchAction: 'pan-y', // Enable vertical scrolling on touch devices
              overscrollBehavior: 'contain', // Prevent scroll chaining
            }}
            onScroll={(e) => {
              // Use passive event listener pattern - don't prevent default
              // This allows smooth scrolling without blocking
            }}
          >
            {/* Display chat history - deduplicate by message ID */}
            {/* Limit to last 20 messages for performance, show all if less than 20 */}
            {(() => {
              const historyToRender = chat.state.chatHistory
                .filter((msg, index, self) => 
                  // Remove duplicates: keep only first occurrence of each message ID
                  index === self.findIndex(m => m.id === msg.id)
                )
                .slice(-20); // Only render last 20 messages for performance
              
              // Debug: Log the history being rendered
              if (historyToRender.length > 0) {
                const lastMsg = historyToRender[historyToRender.length - 1];
                if (lastMsg && lastMsg.question && !lastMsg.answer) {
                  console.log('[Chat Render] ⚠️ Last message has question but no answer:', {
                    id: lastMsg.id,
                    question: lastMsg.question.substring(0, 50),
                    hasAnswer: !!lastMsg.answer,
                    answerLength: lastMsg.answer?.length || 0,
                  });
                }
              }
              
              return historyToRender.map((msg) => (
                <div 
                  key={msg.id} 
                  style={{ 
                    display: 'flex', 
                    flexDirection: 'column', 
                    gap: '12px', 
                    marginBottom: '20px',
                    contain: 'layout style', // CSS containment for performance
                    willChange: 'contents', // Optimize rendering
                  }}
                >
                  {/* User question - right aligned */}
                  <div style={{
                    padding: '12px 16px',
                    background: 'var(--panel)',
                    border: '1px solid var(--border)',
                    borderRadius: '12px 12px 4px 12px',
                    alignSelf: 'flex-end',
                    maxWidth: '75%',
                    wordWrap: 'break-word',
                    contain: 'layout style paint', // CSS containment
                  }}>
                    <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.6', color: 'var(--ink)' }}>
                      {msg.question}
                    </p>
                  </div>
                  
                  {/* Assistant answer - left aligned */}
                  {/* CRITICAL: Show answer even if it's an empty string initially (will be updated) */}
                  {(() => {
                    // Check if we have an answer in the message, or in transient state (for this specific message)
                    const hasAnswerInMessage = msg.answer && msg.answer.trim();
                    const isCurrentMessage = chat.state.lastQuestion === msg.question && chat.state.isChatLoading;
                    const hasTransientAnswer = isCurrentMessage && chat.state.chatAnswer && chat.state.chatAnswer.trim();
                    const displayAnswer = hasAnswerInMessage || hasTransientAnswer;
                    const answerText = hasAnswerInMessage ? msg.answer : (hasTransientAnswer ? chat.state.chatAnswer : null);
                    
                    return displayAnswer ? (
                      <div style={{
                        padding: '14px 16px',
                        background: 'var(--panel)',
                        border: '1px solid var(--border)',
                        borderRadius: '12px 12px 12px 4px',
                        alignSelf: 'flex-start',
                        maxWidth: '75%',
                        whiteSpace: 'pre-wrap',
                        fontSize: '14px',
                        lineHeight: '1.7',
                        wordWrap: 'break-word',
                        overflowWrap: 'break-word',
                        wordBreak: 'break-word',
                        contain: 'layout style paint', // CSS containment for performance
                      }}>
                        {answerText}
                      </div>
                    ) : (
                      // Show loading indicator if answer is not set yet
                      <div style={{
                        padding: '14px 16px',
                        background: 'var(--panel)',
                        border: '1px solid var(--border)',
                        borderRadius: '12px 12px 12px 4px',
                        alignSelf: 'flex-start',
                        maxWidth: '75%',
                        fontSize: '14px',
                        color: 'var(--muted)',
                        fontStyle: 'italic',
                      }}>
                        {chat.state.isChatLoading && chat.state.lastQuestion === msg.question ? (chat.state.loadingStage || 'Thinking...') : 'Loading answer...'}
                      </div>
                    );
                  })()}
                  
                  {/* Answer sections with evidence */}
                  {msg.answerSections && msg.answerSections.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {msg.answerSections.map((section) => (
                      <div key={section.id} style={{
                        padding: '12px',
                        background: 'var(--background)',
                        borderRadius: '8px',
                        border: '1px solid var(--border)',
                      }}>
                        {section.heading && (
                          <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600 }}>
                            {section.heading}
                          </h4>
                        )}
                        <p style={{ margin: 0, fontSize: '13px', lineHeight: '1.6' }}>
                          {section.text}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* Suggested actions from history */}
                {msg.suggestedActions && msg.suggestedActions.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '12px' }}>
                    <p style={{ margin: 0, fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>
                      Actions:
                    </p>
                    {msg.suggestedActions.map((action, idx) => (
                      <button
                        key={idx}
                        onClick={async () => {
                          try {
                            chat.actions.setChatLoading(true);
                            chat.actions.setLoadingStage(`Executing: ${action.label}...`);
                            
                            if (action.type === 'add' && action.concept) {
                              const api = await import('../../api-client');
                              
                              // CRITICAL: Set the active graph context in backend before creating concept
                              // This ensures the node is created in the correct graph/workspace
                              console.log('[Action Button] Setting active graph context to:', activeGraphId);
                              await api.selectGraph(activeGraphId);
                              
                              const newConcept = await api.createConcept({
                                name: action.concept,
                                domain: action.domain || 'general',
                                type: 'concept',
                                graph_id: activeGraphId, // Explicitly specify which graph to add to
                              });
                              
                              console.log('[Action] Created concept:', newConcept);
                              
                              // Dispatch event for confirmation button
                              window.dispatchEvent(new CustomEvent('graph-action', { detail: { type: 'added' } }));
                              
                              // Fetch the full concept from backend to ensure we have all data
                              let fullConcept: Concept;
                              try {
                                fullConcept = await api.getConcept(newConcept.node_id);
                                console.log('[Action] Fetched full concept from backend:', fullConcept);
                              } catch (err) {
                                console.warn('[Action] Could not fetch concept, using created one:', err);
                                fullConcept = newConcept;
                              }
                              
                              // Manually add the new node to the graph data immediately
                              const visualNode: Concept & { domain: string; type: string } = {
                                ...fullConcept,
                                domain: action.domain || 'general',
                                type: 'concept',
                              };
                              
                              // Add to graphData state
                              setGraphData((prev: VisualGraph): VisualGraph => {
                                const exists = prev.nodes.some(n => n.node_id === fullConcept.node_id);
                                if (exists) {
                                  console.log('[Action] Node already in graph data, updating');
                                  return {
                                    ...prev,
                                    nodes: prev.nodes.map(n => n.node_id === fullConcept.node_id ? visualNode : n),
                                  } as VisualGraph;
                                }
                                console.log('[Action] Adding node to graph data:', visualNode);
                                return {
                                  ...prev,
                                  nodes: [...prev.nodes, visualNode],
                                } as VisualGraph;
                              });
                              
                              // Also refresh graph to ensure consistency, but preserve our new node
                              await loadGraph(activeGraphId);
                              
                              // After loadGraph completes, ensure our new node is still in the graph
                              setTimeout(() => {
                                setGraphData(prev => {
                                  const nodeExists = prev.nodes.some(n => n.node_id === fullConcept.node_id);
                                  if (!nodeExists) {
                                    console.log('[Action] Node missing after refresh (likely filtered by limits), re-adding it');
                                    return {
                                      ...prev,
                                      nodes: [...prev.nodes, visualNode],
                                    };
                                  }
                                  return prev;
                                });
                                
                                // Now select and center on the node
                                const updatedGraphData = graphRef.current?.graphData();
                                const conceptInGraph = updatedGraphData?.nodes?.find((n: any) => n.node_id === fullConcept.node_id) || visualNode;
                                
                                console.log('[Action] Selecting node:', conceptInGraph);
                                setSelectedNode(conceptInGraph);
                                updateSelectedPosition(conceptInGraph);
                                
                                // Force graph to center on new node after a short delay
                                setTimeout(() => {
                                  if (graphRef.current && conceptInGraph) {
                                    const node = conceptInGraph;
                                    // If node has coordinates, center on it
                                    if (node.x !== undefined && node.y !== undefined) {
                                      graphRef.current.centerAt(node.x, node.y, 1000);
                                      graphRef.current.zoom(1.5, 1000);
                                    } else {
                                      // Otherwise, zoom to fit all nodes
                                      graphRef.current.zoomToFit(1000, 50);
                                    }
                                  }
                                }, 300);
                              }, 600);
                              
                              chat.actions.setChatAnswer(`✅ Created node "${action.concept}" successfully!`);
                            } else if (action.type === 'link' && action.source && action.target) {
                              const api = await import('../../api-client');
                              const sourceConcept = await resolveConceptByName(action.source);
                              const targetConcept = await resolveConceptByName(action.target);
                              
                              if (!sourceConcept || !targetConcept) {
                                throw new Error(`Could not find concepts: ${action.source} or ${action.target}`);
                              }
                              
                              await api.createRelationshipByIds(
                                sourceConcept.node_id,
                                targetConcept.node_id,
                                action.label || 'related_to'
                              );
                              
                              await loadGraph(activeGraphId);
                              chat.actions.setChatAnswer(`✅ Linked "${action.source}" to "${action.target}" successfully!`);
                            } else {
                              chat.actions.setChatAnswer(`Action type "${action.type}" not yet supported.`);
                            }
                          } catch (err: any) {
                            console.error('Action execution error:', err);
                            chat.actions.setChatAnswer(`❌ Failed to execute action: ${err.message || 'Unknown error'}`);
                          } finally {
                            chat.actions.setChatLoading(false);
                            chat.actions.setLoadingStage('');
                          }
                        }}
                        style={{
                          padding: '8px 12px',
                          background: 'var(--panel)',
                          border: '1px solid var(--border)',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          textAlign: 'left',
                          fontSize: '13px',
                          color: 'var(--foreground)',
                        }}
                      >
                        {action.label || `${action.type}: ${action.concept || `${action.source} → ${action.target}`}`}
                      </button>
                    ))}
                  </div>
                  )}
                </div>
              ));
            })()}

            {chat.state.isChatLoading && (
              <div style={{ padding: '12px', background: 'var(--background)', borderRadius: '8px' }}>
                <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
                  {chat.state.loadingStage || 'Processing...'}
                </p>
              </div>
            )}

            {/* Current answer (if not yet saved to history) */}
            {chat.state.chatAnswer && chat.state.answerId && !chat.state.chatHistory.some(msg => msg.answerId === chat.state.answerId && msg.answer && msg.answer.trim()) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
                {/* User question - right aligned - only show if not already in history */}
                {chat.state.lastQuestion && !chat.state.chatHistory.some(msg => msg.question === chat.state.lastQuestion && msg.answer && msg.answer.trim()) && (
                  <div style={{
                    padding: '12px 16px',
                    background: 'var(--panel)',
                    border: '1px solid var(--border)',
                    borderRadius: '12px 12px 4px 12px',
                    alignSelf: 'flex-end',
                    maxWidth: '75%',
                    wordWrap: 'break-word',
                  }}>
                    <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.6', color: 'var(--ink)' }}>
                      {chat.state.lastQuestion}
                    </p>
                  </div>
                )}
                
                {/* Assistant answer - left aligned */}
                <div style={{
                  padding: '14px 16px',
                  background: 'var(--panel)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px 12px 12px 4px',
                  alignSelf: 'flex-start',
                  maxWidth: '75%',
                  whiteSpace: 'pre-wrap',
                  fontSize: '14px',
                  lineHeight: '1.7',
                  wordWrap: 'break-word',
                  overflowWrap: 'break-word',
                  wordBreak: 'break-word',
                }}>
                  {chat.state.chatAnswer}
                </div>

                {/* Answer sections with evidence */}
                {chat.state.answerSections && chat.state.answerSections.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {chat.state.answerSections.map((section) => (
                      <div key={section.id} style={{
                        padding: '12px',
                        background: 'var(--background)',
                        borderRadius: '8px',
                        border: '1px solid var(--border)',
                      }}>
                        {section.heading && (
                          <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600 }}>
                            {section.heading}
                          </h4>
                        )}
                        <p style={{ margin: 0, fontSize: '13px', lineHeight: '1.6' }}>
                          {section.text}
                        </p>
                        {section.supporting_evidence_ids.length > 0 && (
                          <button
                            onClick={() => {
                              const sectionEvidence = chat.state.evidenceUsed.filter(e =>
                                section.supporting_evidence_ids.includes(e.resource_id || e.id || '')
                              );
                              applySectionEvidenceHighlight(
                                section.id,
                                section.supporting_evidence_ids,
                                chat.state.evidenceUsed,
                                chat.state.retrievalMeta
                              );
                            }}
                            style={{
                              marginTop: '8px',
                              padding: '4px 8px',
                              background: 'transparent',
                              border: '1px solid var(--border)',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '11px',
                            }}
                          >
                            Highlight evidence ({section.supporting_evidence_ids.length})
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Style feedback form */}
                {chat.state.answerId && (
                  <div style={{ marginTop: '8px' }}>
                    <StyleFeedbackForm
                      answerId={chat.state.answerId}
                      question={chat.state.lastQuestion || ''}
                      originalResponse={chat.state.chatAnswer}
                      onSubmitted={() => {
                        console.log('✅ Style feedback submitted! This will improve future responses.');
                      }}
                    />
                  </div>
                )}

                {/* Suggested actions */}
                {chat.state.suggestedActions.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '12px' }}>
                    <p style={{ margin: 0, fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>
                      Actions:
                    </p>
                    {chat.state.suggestedActions.map((action, idx) => {
                      console.log('[UI] Rendering action button:', idx, action);
                      return (
                        <button
                        key={idx}
                        onClick={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          console.log('[Action Button] ✅ CLICKED!', action);
                          try {
                            console.log('[Action Button] Starting execution...');
                            chat.actions.setChatLoading(true);
                            chat.actions.setLoadingStage(`Executing: ${action.label}...`);
                            
                            if (action.type === 'add' && action.concept) {
                              console.log('[Action Button] Creating node:', action.concept, 'in domain:', action.domain);
                              // Create a new concept/node
                              const api = await import('../../api-client');
                              
                              // CRITICAL: Set the active graph context in backend before creating concept
                              // This ensures the node is created in the correct graph/workspace
                              console.log('[Action Button] Setting active graph context to:', activeGraphId);
                              await api.selectGraph(activeGraphId);
                              
                              const newConcept = await api.createConcept({
                                name: action.concept,
                                domain: action.domain || 'general',
                                type: 'concept',
                                graph_id: activeGraphId, // Explicitly specify which graph to add to
                              });
                              
                              console.log('[Action] Created concept:', newConcept);
                              
                              // Fetch the full concept from backend to ensure we have all data
                              let fullConcept: Concept;
                              try {
                                fullConcept = await api.getConcept(newConcept.node_id);
                                console.log('[Action] Fetched full concept from backend:', fullConcept);
                              } catch (err) {
                                console.warn('[Action] Could not fetch concept, using created one:', err);
                                fullConcept = newConcept;
                              }
                              
                              // Manually add the new node to the graph data immediately
                              const visualNode: Concept & { domain: string; type: string } = {
                                ...fullConcept,
                                domain: action.domain || 'general',
                                type: 'concept',
                              };
                              
                              // Add to graphData state
                              setGraphData((prev: VisualGraph): VisualGraph => {
                                // Check if node already exists
                                const exists = prev.nodes.some(n => n.node_id === fullConcept.node_id);
                                if (exists) {
                                  console.log('[Action] Node already in graph data, updating');
                                  return {
                                    ...prev,
                                    nodes: prev.nodes.map(n => n.node_id === fullConcept.node_id ? visualNode : n),
                                  } as VisualGraph;
                                }
                                console.log('[Action] Adding node to graph data:', visualNode);
                                return {
                                  ...prev,
                                  nodes: [...prev.nodes, visualNode],
                                } as VisualGraph;
                              });
                              
                              // Also refresh graph to ensure consistency
                              // Also refresh graph to ensure consistency, but preserve our new node
                              await loadGraph(activeGraphId);
                              
                              // After loadGraph completes, ensure our new node is still in the graph
                              setTimeout(() => {
                                setGraphData(prev => {
                                  const nodeExists = prev.nodes.some(n => n.node_id === fullConcept.node_id);
                                  if (!nodeExists) {
                                    console.log('[Action] Node missing after refresh (likely filtered by limits), re-adding it');
                                    return {
                                      ...prev,
                                      nodes: [...prev.nodes, visualNode],
                                    };
                                  }
                                  return prev;
                                });
                                
                                // Now select and center on the node
                                const updatedGraphData = graphRef.current?.graphData();
                                const conceptInGraph = updatedGraphData?.nodes?.find((n: any) => n.node_id === fullConcept.node_id) || visualNode;
                                
                                console.log('[Action] Selecting node:', conceptInGraph);
                                setSelectedNode(conceptInGraph);
                                updateSelectedPosition(conceptInGraph);
                                
                                // Force graph to center on new node after a short delay
                                setTimeout(() => {
                                  if (graphRef.current && conceptInGraph) {
                                    const node = conceptInGraph;
                                    // If node has coordinates, center on it
                                    if (node.x !== undefined && node.y !== undefined) {
                                      graphRef.current.centerAt(node.x, node.y, 1000);
                                      graphRef.current.zoom(1.5, 1000);
                                    } else {
                                      // Otherwise, zoom to fit all nodes
                                      graphRef.current.zoomToFit(1000, 50);
                                    }
                                  }
                                }, 300);
                              }, 600);
                              
                              chat.actions.setChatAnswer(`✅ Created node "${action.concept}" successfully!`);
                              chat.actions.setLoadingStage('');
                            } else if (action.type === 'link' && action.source && action.target) {
                              // Create a relationship between concepts
                              const api = await import('../../api-client');
                              
                              // Resolve concept names to IDs
                              const sourceConcept = await resolveConceptByName(action.source);
                              const targetConcept = await resolveConceptByName(action.target);
                              
                              if (!sourceConcept || !targetConcept) {
                                throw new Error(`Could not find concepts: ${action.source} or ${action.target}`);
                              }
                              
                              // Create relationship
                              await api.createRelationshipByIds(
                                sourceConcept.node_id,
                                targetConcept.node_id,
                                action.label || 'related_to'
                              );
                              
                              // Refresh graph to show new link
                              await loadGraph(activeGraphId);
                              
                              chat.actions.setChatAnswer(`✅ Linked "${action.source}" to "${action.target}" successfully!`);
                              chat.actions.setLoadingStage('');
                            } else {
                              chat.actions.setChatAnswer(`Action type "${action.type}" not yet supported.`);
                            }
                          } catch (err: any) {
                            console.error('Action execution error:', err);
                            chat.actions.setChatAnswer(`❌ Failed to execute action: ${err.message || 'Unknown error'}`);
                          } finally {
                            chat.actions.setChatLoading(false);
                            chat.actions.setLoadingStage('');
                          }
                        }}
                        style={{
                          padding: '8px 12px',
                          background: 'var(--panel)',
                          border: '1px solid var(--border)',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          textAlign: 'left',
                          fontSize: '13px',
                          color: 'var(--foreground)',
                        }}
                      >
                        {action.label || `${action.type}: ${action.concept || `${action.source} → ${action.target}`}`}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Suggested questions */}
                {chat.state.suggestedQuestions.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '12px' }}>
                    <p style={{ margin: 0, fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>
                      Suggested questions:
                    </p>
                    {chat.state.suggestedQuestions.map((q, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleChatSubmit(q)}
                        style={{
                          padding: '8px 12px',
                          background: 'var(--background)',
                          border: '1px solid var(--border)',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          textAlign: 'left',
                          fontSize: '13px',
                        }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Chat input - at bottom after first message with answer */}
          {chat.state.chatHistory.length > 0 && chat.state.chatHistory.some(msg => msg.answer) && (
            <div style={{
              padding: '12px',
              borderTop: '1px solid var(--border)',
            }}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  // Prevent double submission
                  if (isSubmittingChatRef.current || chat.state.isChatLoading) {
                    return;
                  }
                  const textarea = e.currentTarget.querySelector('textarea') as HTMLTextAreaElement;
                  if (textarea?.value?.trim()) {
                    handleChatSubmit(textarea.value.trim());
                    textarea.value = '';
                    textarea.style.height = 'auto';
                  }
                }}
              >
                <div className="chat-input-row" style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                  <textarea
                    placeholder="Type your message..."
                    disabled={chat.state.isChatLoading}
                    className="chat-input"
                    style={{
                      padding: '10px 14px',
                      fontSize: '14px',
                      minHeight: '44px',
                      maxHeight: '200px',
                      resize: 'none',
                      fontFamily: 'inherit',
                      lineHeight: '1.5',
                    }}
                    onInput={(e) => {
                      const target = e.target as HTMLTextAreaElement;
                      target.style.height = 'auto';
                      target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        const form = e.currentTarget.closest('form');
                        if (form) {
                          form.requestSubmit();
                        }
                      }
                    }}
                  />
                  <button
                    type="submit"
                    disabled={chat.state.isChatLoading}
                    className="pill pill--primary"
                    style={{
                      padding: '10px 20px',
                      flexShrink: 0,
                    }}
                  >
                    {chat.state.isChatLoading ? '...' : 'Send'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
        )}
      </div>

      {/* Controls Panel - fixed position */}
      {ui.state.showControls && (
            <div style={{
              position: 'fixed',
              top: '16px',
              right: '16px',
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '16px',
              boxShadow: 'var(--shadow)',
              zIndex: 1000,
              minWidth: '280px',
              maxWidth: '400px',
              maxHeight: '80vh',
              overflowY: 'auto',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: '600', margin: 0 }}>Graph Controls</h3>
                <button
                  onClick={() => ui.actions.setShowControls(false)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--muted)',
                    cursor: 'pointer',
                    fontSize: '18px',
                    padding: '0',
                    width: '24px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  title="Close controls"
                >
                  ×
                </button>
              </div>
              
              <div className="graph-controls">
                {/* Zoom Level */}
                <div className="control-card">
                  <div className="control-header">
                    <span>Zoom Level</span>
                    <span className="control-value">{Math.round((ui.state.zoomLevel || 1) * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="3"
                    step="0.1"
                    value={ui.state.zoomLevel || 1}
                    onChange={(e) => {
                      const zoom = parseFloat(e.target.value);
                      ui.actions.setZoomLevel(zoom);
                      if (graphRef.current) {
                        graphRef.current.zoom(zoom);
                      }
                    }}
                    style={{ width: '100%', marginTop: '8px' }}
                  />
                  <div className="control-caption">Adjust graph zoom level</div>
                </div>

                {/* Domain Spread */}
                <div className="control-card">
                  <div className="control-header">
                    <span>Domain Spread</span>
                    <span className="control-value">{domainSpread.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="2.5"
                    step="0.1"
                    value={domainSpread}
                    onChange={(e) => {
                      const spread = parseFloat(e.target.value);
                      setDomainSpread(spread);
                      // Trigger recomputation of domain bubbles
                      setTimeout(() => {
                        if (graphRef.current) {
                          recomputeDomainBubbles();
                        }
                      }, 100);
                    }}
                    style={{ width: '100%', marginTop: '8px' }}
                  />
                  <div className="control-caption">Control domain clustering</div>
                </div>

                {/* Domain Visibility */}
                {Array.from(domainColors.keys()).length > 0 && (
                  <div className="control-card control-card--legend">
                    <div className="control-header">
                      <span>Domain Visibility</span>
                    </div>
                    <div className="legend" style={{ marginTop: '8px' }}>
                      {Array.from(domainColors.entries()).map(([domain, color]) => {
                        const isSelected = selectedDomains.has(domain);
                        return (
                          <label
                            key={domain}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              cursor: 'pointer',
                              fontSize: '12px',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                if (isSelected) {
                                  setSelectedDomains(prev => {
                                    const next = new Set(prev);
                                    next.delete(domain);
                                    return next;
                                  });
                                } else {
                                  setSelectedDomains(prev => new Set(prev).add(domain));
                                }
                              }}
                              style={{ cursor: 'pointer' }}
                            />
                            <span
                              className="legend-dot"
                              style={{ backgroundColor: color }}
                            />
                            <span style={{ textTransform: 'capitalize' }}>{domain}</span>
                          </label>
                        );
                      })}
                    </div>
                    <div className="control-caption">Toggle domain visibility</div>
                  </div>
                )}

                {/* Zoom to Fit */}
                <div className="control-card">
                  <button
                    onClick={() => {
                      if (graphRef.current) {
                        graphRef.current.zoomToFit(400, 50);
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      background: 'var(--accent)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '13px',
                      fontWeight: '600',
                      cursor: 'pointer',
                    }}
                  >
                    Zoom to Fit
                  </button>
                </div>
              </div>
            </div>
          )}

      {/* Filters Panel - fixed position */}
      {filters.state.showFilters && (
            <div style={{
              position: 'fixed',
              top: ui.state.showControls ? 'calc(16px + 320px)' : '16px',
              right: '16px',
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '16px',
              boxShadow: 'var(--shadow)',
              zIndex: 999,
              minWidth: '280px',
              maxWidth: '400px',
              maxHeight: ui.state.showControls ? 'calc(80vh - 340px)' : '80vh',
              overflowY: 'auto',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: '600', margin: 0 }}>Relationship Filters</h3>
                <button
                  onClick={() => filters.actions.setShowFilters(false)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--muted)',
                    cursor: 'pointer',
                    fontSize: '18px',
                    padding: '0',
                    width: '24px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  title="Close filters"
                >
                  ×
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Status Filters */}
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '8px' }}>Status</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px' }}>
                      <input
                        type="checkbox"
                        checked={filters.state.filterStatusAccepted}
                        onChange={(e) => filters.actions.setStatusAccepted(e.target.checked)}
                        style={{ cursor: 'pointer' }}
                      />
                      <span>Accepted</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px' }}>
                      <input
                        type="checkbox"
                        checked={filters.state.filterStatusProposed}
                        onChange={(e) => filters.actions.setStatusProposed(e.target.checked)}
                        style={{ cursor: 'pointer' }}
                      />
                      <span>Proposed</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px' }}>
                      <input
                        type="checkbox"
                        checked={filters.state.filterStatusRejected}
                        onChange={(e) => filters.actions.setStatusRejected(e.target.checked)}
                        style={{ cursor: 'pointer' }}
                      />
                      <span>Rejected</span>
                    </label>
                  </div>
                </div>

                {/* Confidence Threshold */}
                <div>
                  <div className="control-header">
                    <span>Confidence Threshold</span>
                    <span className="control-value">{(filters.state.filterConfidenceThreshold * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={filters.state.filterConfidenceThreshold}
                    onChange={(e) => filters.actions.setConfidenceThreshold(parseFloat(e.target.value))}
                    style={{ width: '100%', marginTop: '8px' }}
                  />
                  <div className="control-caption">Hide relationships below this confidence</div>
                </div>

                {/* Source Filters */}
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '8px' }}>Sources</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {['SEC', 'IR', 'NEWS', 'MANUAL'].map((source) => (
                      <label key={source} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px' }}>
                        <input
                          type="checkbox"
                          checked={filters.state.filterSources.has(source)}
                          onChange={() => filters.actions.toggleFilterSource(source)}
                          style={{ cursor: 'pointer' }}
                        />
                        <span>{source}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Reset Filters */}
                <button
                  onClick={() => filters.actions.resetFilters()}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'transparent',
                    color: 'var(--accent)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: 'pointer',
                  }}
                >
                  Reset Filters
                </button>
              </div>
            </div>
          )}
      </div>

      {/* Context panel - show when node is selected, vertical sidebar */}
      {selectedNode && isMounted && (
        <div style={{
          position: 'fixed',
          right: chat.state.isChatCollapsed ? '40px' : (chat.state.isChatMaximized ? '0px' : (chat.state.isChatExpanded ? '500px' : '350px')),
          top: '150px',
          width: '360px',
          height: 'calc(100vh - 150px)',
          transition: 'right 0.3s ease',
          pointerEvents: 'auto',
          zIndex: 100,
          overflow: 'auto',
          background: 'var(--background)',
          borderLeft: '1px solid var(--border)',
          boxShadow: '-2px 0 8px rgba(0, 0, 0, 0.1)',
        }}>
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
            activeTab={ui.state.nodePanelTab as any as ContextPanelTab}
            setActiveTab={(tab: ContextPanelTab) => {
              // Map ContextPanelTab to nodePanelTab values
              // nodePanelTab supports: 'overview' | 'resources' | 'evidence' | 'confusions'
              // ContextPanelTab supports: 'overview' | 'evidence' | 'notes' | 'connections' | 'activity' | 'data'
              if (tab === 'overview' || tab === 'evidence') {
                ui.actions.setNodePanelTab(tab);
              } else {
                // Map other ContextPanelTab values to 'overview'
                ui.actions.setNodePanelTab('overview');
              }
            }}
            onClose={() => {
              // Set flag to prevent useEffect from re-selecting
              isClosingPanelRef.current = true;
              
              // Clear loading states when closing to prevent UI lock
              if (loadingNeighbors) {
                loadingNeighborsRef.current = null;
                setLoadingNeighbors(null);
              }
              
              // Remove select parameter from URL to prevent infinite loop
              // This must happen before clearing selectedNode to prevent useEffect from re-selecting
              const params = new URLSearchParams(searchParams?.toString() || '');
              params.delete('select');
              const newUrl = params.toString() ? `/?${params.toString()}` : '/';
              router.replace(newUrl, { scroll: false });
              
              // Clear selected node - URL param is already removed so useEffect won't re-trigger
              setSelectedNode(null);
              
              // Reset flag after a short delay to allow URL update to complete
              setTimeout(() => {
                isClosingPanelRef.current = false;
              }, 100);
            }}
            onFetchEvidence={async () => {
              if (!selectedNode) return;
              setIsResourceLoading(true);
              setResourceError(null);
              try {
                const resources = await getResourcesForConcept(selectedNode.node_id);
                setSelectedResources(resources);
                resourceCacheRef.current.set(selectedNode.node_id, resources);
              } catch (err) {
                setResourceError(err instanceof Error ? err.message : 'Failed to load resources');
              } finally {
                setIsResourceLoading(false);
              }
            }}
            onResourceUpload={(resource: Resource) => {
              if (!selectedNode) return;
              // Refresh resources after upload
              getResourcesForConcept(selectedNode.node_id).then((resources) => {
                setSelectedResources(resources);
                resourceCacheRef.current.set(selectedNode.node_id, resources);
              }).catch((err) => {
                console.error('Failed to refresh resources after upload:', err);
              });
            }}
            domainColors={domainColors}
            activeGraphId={activeGraphId}
            onSwitchGraph={async (graphId: string, nodeId?: string) => {
              // Switch to the target graph
              setActiveGraphId(graphId);
              await loadGraph(graphId);
              // If nodeId provided, select that node
              if (nodeId) {
                const api = await import('../../api-client');
                const concept = await api.getConcept(nodeId);
                setSelectedNode(concept);
                updateSelectedPosition(concept);
                // Center on the node
                setTimeout(() => {
                  if (graphRef.current && concept) {
                    const node = concept as any;
                    if (node.x !== undefined && node.y !== undefined) {
                      graphRef.current.centerAt(node.x, node.y, 1000);
                      graphRef.current.zoom(1.5, 1000);
                    } else {
                      graphRef.current.zoomToFit(1000, 50);
                    }
                  }
                }, 300);
              }
            }}
            neighborCount={displayGraph.links.filter(l => {
              const sourceId = typeof l.source === 'string' ? l.source : l.source.node_id;
              const targetId = typeof l.target === 'string' ? l.target : l.target.node_id;
              return sourceId === selectedNode.node_id || targetId === selectedNode.node_id;
            }).length}
            connections={connectionsForSelected}
            IS_DEMO_MODE={IS_DEMO_MODE}
            activityEvents={activityEvents}
          />
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div style={{
          position: 'fixed',
          top: '16px',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '12px 20px',
          background: '#ef476f',
          color: 'white',
          borderRadius: '8px',
          boxShadow: 'var(--shadow)',
          zIndex: 1000,
        }}>
          {error}
        </div>
      )}

      {/* Graph switch banner */}
      {ui.state.graphSwitchBanner && (
        <div style={{
          position: 'fixed',
          top: '16px',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '12px 20px',
          background: '#06d6a0',
          color: 'white',
          borderRadius: '8px',
          boxShadow: 'var(--shadow)',
          zIndex: 1000,
        }}>
          {ui.state.graphSwitchBanner.message}
        </div>
      )}
    </div>
  );
}

// Export wrapper component with GraphProvider
export default function GraphVisualization() {
  return (
    <GraphProvider>
      <GraphVisualizationInner />
    </GraphProvider>
  );
}
