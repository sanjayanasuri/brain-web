'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { forceCollide } from 'd3-force';
import ExplorerToolbar from './ExplorerToolbar';
import GraphMiniMap from './GraphMiniMap';
import ContextPanel, { type ContextPanelTab } from '../context/ContextPanel';
import SessionDrawer from '../navigation/SessionDrawer';
import type { Concept, GraphData, Resource, GraphSummary, BranchSummary } from '../../api-client';
import type { EvidenceItem } from '../../types/evidence';
import { normalizeEvidence } from '../../types/evidence';
import { useEvidenceNavigation } from '../../hooks/useEvidenceNavigation';
import { isFinanceSnapshotResource, getSnapshotAsOf, getFreshnessBadge, formatSnapshotDate, getConfidenceDisplay } from '../../utils/financeSnapshot';
import TrackedCompaniesPanel from '../finance/TrackedCompaniesPanel';
import { computeFreshness } from '../../utils/freshness';
import { formatConfidence } from '../../utils/confidence';
import {
  ingestLecture,
  type LectureIngestResult,
  getLectureSegments,
  type LectureSegment,
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
  fetchFinanceSnapshot,
  getFinanceTracking,
  setFinanceTracking,
  listFinanceTracking,
  getLatestFinanceSnapshots,
  type FinanceTrackingConfig,
  type LatestSnapshotMetadata,
  getGraphOverview,
  getGraphNeighbors,
} from '../../api-client';
import { fetchEvidenceForConcept } from '../../lib/evidenceFetch';
import { setLastSession, getLastSession, pushRecentConceptView, trackConceptViewed, trackEvent } from '../../lib/sessionState';
import { logEvent } from '../../lib/eventsClient';
import { useLens } from '../context-providers/LensContext';
import StyleFeedbackForm from '../ui/StyleFeedbackForm';

// Activity Event Types
type ActivityEventType = 
  | 'RESOURCE_ATTACHED'
  | 'FINANCE_SNAPSHOT'
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
    // Check if it's a finance snapshot
    if (isFinanceSnapshotResource(res) && res.metadata?.identity) {
      const asOf = getSnapshotAsOf(res);
      const meta = res.metadata;
      const size = meta.size || {};
      const price = meta.price || {};
      const confidence = size.confidence || price.confidence;
      
      // Build detail string
      const details: string[] = [];
      if (size.market_cap) {
        const marketCap = typeof size.market_cap === 'number' 
          ? `$${(size.market_cap / 1e9).toFixed(2)}B`
          : String(size.market_cap);
        details.push(`Market cap: ${marketCap}`);
      }
      if (price.price) {
        const priceVal = typeof price.price === 'number'
          ? `$${price.price.toFixed(2)}`
          : String(price.price);
        details.push(`Price: ${priceVal}`);
      }
      if (confidence !== undefined) {
        const confDisplay = getConfidenceDisplay(confidence);
        if (confDisplay) {
          details.push(`Confidence: ${confDisplay}`);
        }
      }
      
      events.push({
        id: `finance-${res.resource_id}`,
        type: 'FINANCE_SNAPSHOT',
        title: 'Finance snapshot fetched',
        timestamp: asOf,
        detail: details.length > 0 ? details.join(', ') : undefined,
        resource_id: res.resource_id,
        url: res.url,
        source_badge: 'browser_use',
        action: {
          label: 'View evidence',
          onClick: () => onViewEvidence(res.resource_id),
        },
      });
    } else {
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

type ChatMessage = { role: 'user' | 'system'; text: string };
type VisualNode = Concept & { domain: string; type: string };
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

// Content import form component
function ContentImportForm({
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

export default function GraphVisualization() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { activeLens } = useLens();
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/a01a33f1-d489-4279-a9af-9a81bd1c1f3e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'GraphVisualization.tsx:276',message:'GraphVisualization component render',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
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
  const [graphSwitchBanner, setGraphSwitchBanner] = useState<{ message: string; graphName: string } | null>(null);
  const [conceptNotFoundBanner, setConceptNotFoundBanner] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [linkingMode, setLinkingMode] = useState<{ source: Concept | null; predicate: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingNeighbors, setLoadingNeighbors] = useState<string | null>(null); // concept_id being loaded
  const [overviewMeta, setOverviewMeta] = useState<{ node_count?: number; sampled?: boolean } | null>(null);
  const neighborCacheRef = useRef<Map<string, { nodes: Concept[]; edges: any[] }>>(new Map());
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
  const [selectedDomains, setSelectedDomains] = useState<Set<string>>(new Set());
  const [selectedPosition, setSelectedPosition] = useState<{ x: number; y: number } | null>(null);
  const [tempNodes, setTempNodes] = useState<TempNode[]>([]);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [highlightRunId, setHighlightRunId] = useState<string | null>(null);
  const [runChanges, setRunChanges] = useState<any>(null);
  const [highlightedConceptIds, setHighlightedConceptIds] = useState<Set<string>>(new Set());
  const [highlightedRelationshipIds, setHighlightedRelationshipIds] = useState<Set<string>>(new Set());
  const [chatAnswer, setChatAnswer] = useState<string | null>(null);
  const [answerId, setAnswerId] = useState<string | null>(null);
  const [answerSections, setAnswerSections] = useState<Array<{
    id: string;
    heading?: string;
    text: string;
    supporting_evidence_ids: string[];
  }> | null>(null);
  const [expandedEvidenceSections, setExpandedEvidenceSections] = useState<Set<string>>(new Set());
  const [lastQuestion, setLastQuestion] = useState<string>('');
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [usedNodes, setUsedNodes] = useState<Concept[]>([]);
  const [suggestedActions, setSuggestedActions] = useState<Array<{type: string; source?: string; target?: string; concept?: string; domain?: string; label: string}>>([]);
  const [retrievalMeta, setRetrievalMeta] = useState<{
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
  } | null>(null);
  const [showingEvidence, setShowingEvidence] = useState(false);
  const [evidenceNodeIds, setEvidenceNodeIds] = useState<Set<string>>(new Set());
  const [evidenceLinkIds, setEvidenceLinkIds] = useState<Set<string>>(new Set());
  const [activeEvidenceSectionId, setActiveEvidenceSectionId] = useState<string | null>(null);
  const [showRetrievalDetails, setShowRetrievalDetails] = useState(false);
  const [showEvidencePreview, setShowEvidencePreview] = useState(false);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState<string>('');
  const [isEditingAnswer, setIsEditingAnswer] = useState(false);
  const [editedAnswer, setEditedAnswer] = useState<string>('');
  const [isChatExpanded, setIsChatExpanded] = useState(false);
  const [isChatMaximized, setIsChatMaximized] = useState(false);
  const [chatMode, setChatMode] = useState<'Ask' | 'Explore Paths' | 'Summaries' | 'Gaps'>('Ask');
  const [chatContentHeight, setChatContentHeight] = useState(0);
  const [financeLensEnabled, setFinanceLensEnabled] = useState(false);
  const [selectedTicker, setSelectedTicker] = useState<string>('');
  const [financeLens, setFinanceLens] = useState<string>('general');
  const [domainBubbles, setDomainBubbles] = useState<DomainBubble[]>([]);
  const [showLectureIngest, setShowLectureIngest] = useState(false);
  const [lectureIngestLoading, setLectureIngestLoading] = useState(false);
  const [lectureIngestResult, setLectureIngestResult] = useState<LectureIngestResult | null>(null);
  const [showSegments, setShowSegments] = useState(false);
  const [lectureSegments, setLectureSegments] = useState<LectureSegment[] | null>(null);
  const [segmentsLoading, setSegmentsLoading] = useState(false);
  const [selectedResources, setSelectedResources] = useState<Resource[]>([]);
  const [isResourceLoading, setIsResourceLoading] = useState(false);
  const [evidenceUsed, setEvidenceUsed] = useState<EvidenceItem[]>([]);
  const [expandedEvidenceItems, setExpandedEvidenceItems] = useState<Set<string>>(new Set());
  const [showAllEvidence, setShowAllEvidence] = useState(false);
  const [navigatingEvidenceId, setNavigatingEvidenceId] = useState<string | null>(null);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [isFetchingConfusions, setIsFetchingConfusions] = useState(false);
  const [nodePanelTab, setNodePanelTab] = useState<ContextPanelTab>('overview');
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
  // Finance tab: selected snapshot resource ID
  const [financeSelectedResourceId, setFinanceSelectedResourceId] = useState<string | null>(null);
  // Finance tab: show all news toggle
  const [showAllNews, setShowAllNews] = useState(false);
  // Finance tab: tracking state
  const [financeTracking, setFinanceTrackingState] = useState<FinanceTrackingConfig | null>(null);
  const [isLoadingTracking, setIsLoadingTracking] = useState(false);
  const [isFetchingSnapshot, setIsFetchingSnapshot] = useState(false);
  // Track all enabled tickers for graph indicators
  const [trackedTickers, setTrackedTickers] = useState<Set<string>>(new Set());
  // Tracked companies panel state
  const [trackedCompaniesList, setTrackedCompaniesList] = useState<FinanceTrackingConfig[]>([]);
  const [latestSnapshots, setLatestSnapshots] = useState<Record<string, LatestSnapshotMetadata>>({});
  const [refreshingTickers, setRefreshingTickers] = useState<Set<string>>(new Set());
  // Graph filters
  const [filterStatusAccepted, setFilterStatusAccepted] = useState(true);
  const [filterStatusProposed, setFilterStatusProposed] = useState(true);
  const [filterStatusRejected, setFilterStatusRejected] = useState(false);
  const [filterConfidenceThreshold, setFilterConfidenceThreshold] = useState(0.0);
  const [filterSources, setFilterSources] = useState<Set<string>>(new Set(['SEC', 'IR', 'NEWS']));
  const [hoveredLink, setHoveredLink] = useState<VisualLink | null>(null);
  const [hoveredLinkPosition, setHoveredLinkPosition] = useState<{ x: number; y: number } | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [sourceLayer, setSourceLayer] = useState<'concepts' | 'evidence' | 'snapshots'>('concepts');
  const chatStreamRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<ForceGraphRef | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const graphCanvasRef = useRef<HTMLDivElement | null>(null);
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
      setGraphData(prev => {
        const existingNodeIds = new Set(prev.nodes.map(n => n.node_id));
        const existingEdgeKeys = new Set(
          prev.links.map(l => `${l.source.node_id || l.source}->${l.target.node_id || l.target}:${l.predicate}`)
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
        };
      });
      return;
    }
    
    // Fetch neighbors
    setLoadingNeighbors(conceptId);
    try {
      const result = await getGraphNeighbors(activeGraphId, conceptId, 1, 80);
      
      // Cache the result
      neighborCacheRef.current.set(cacheKey, {
        nodes: result.nodes,
        edges: result.edges,
      });
      
      // Merge into graph data
      setGraphData(prev => {
        const existingNodeIds = new Set(prev.nodes.map(n => n.node_id));
        const existingEdgeKeys = new Set(
          prev.links.map(l => `${l.source.node_id || l.source}->${l.target.node_id || l.target}:${l.predicate}`)
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
    } catch (err) {
      console.error('Failed to expand neighbors:', err);
    } finally {
      setLoadingNeighbors(null);
    }
  }, [activeGraphId]);

  // Extract evidence highlight logic into reusable functions
  const clearEvidenceHighlight = useCallback(() => {
    setShowingEvidence(false);
    setEvidenceNodeIds(new Set());
    setEvidenceLinkIds(new Set());
    setActiveEvidenceSectionId(null);
    if (graphRef.current?.refresh) {
      graphRef.current.refresh();
    }
  }, []);

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
          
          setEvidenceNodeIds(nodeIds);
          setEvidenceLinkIds(linkIds);
          setShowingEvidence(true);
          
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

      setEvidenceNodeIds(nodeIds);
      setEvidenceLinkIds(linkIds);
      setShowingEvidence(true);

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
    setActiveEvidenceSectionId(sectionId);

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
          const currentZoom = zoomTransform.k || zoomLevel || 1;
          if (currentZoom < 1.5) {
            // Only adjust if zoomed out - gently zoom in
            graphRef.current.zoomToFit(400, 50);
          } else {
            // Just center on the nodes
            graphRef.current.centerAt(centerX, centerY);
          }
        }
      }
    }
  }, [applyEvidenceHighlight, graphData.nodes, zoomTransform, zoomLevel]);

  const ensureConcept = useCallback(
    async (name: string, inherit?: { domain?: string; type?: string }) => {
      try {
        return await resolveConceptByName(name);
      } catch {
        const api = await import('../../api-client');
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
          return { 
            source: sourceNode, 
            target: targetNode, 
            predicate: link.predicate,
            relationship_status: (link as any).relationship_status,
            relationship_confidence: (link as any).relationship_confidence,
            relationship_method: (link as any).relationship_method,
            source_type: (link as any).source_type || (() => {
              // Try to derive source_type from relationship_source_id or method
              const sourceId = (link as any).relationship_source_id;
              if (sourceId) {
                // Pattern matching: SEC filings, IR pages, News articles
                if (sourceId.includes('SEC') || sourceId.includes('edgar')) return 'SEC';
                if (sourceId.includes('IR') || sourceId.includes('investor')) return 'IR';
                if (sourceId.includes('NEWS') || sourceId.includes('news')) return 'NEWS';
              }
              return undefined;
            })(),
            rationale: (link as any).rationale,
          } as VisualLink;
        })
        .filter((link): link is VisualLink => link !== null);
      
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
      // Use overview endpoint for fast initial loading
      const data = await getGraphOverview(activeGraphId, 300, 600);
      const converted = convertGraphData(data, tempNodes);
      setGraphData(converted);
      setOverviewMeta(data.meta || null);
      // Clear cache when switching graphs
      neighborCacheRef.current.clear();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load graph');
    } finally {
      setLoading(false);
    }
  }, [convertGraphData, tempNodes, activeGraphId]);

  const refreshGraphs = useCallback(async (preserveActiveGraph = false) => {
    try {
      const data = await listGraphs();
      setGraphs(data.graphs || []);
      // Only update activeGraphId if we're not preserving it (e.g., during a manual switch)
      if (!preserveActiveGraph) {
        setActiveGraphId(data.active_graph_id || 'default');
      }
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
    // First filter by domain
    let filteredNodes = graphData.nodes;
    let filteredLinks = graphData.links;
    
    if (selectedDomains.size > 0) {
      filteredNodes = graphData.nodes.filter(n => selectedDomains.has(n.domain));
      const nodeIds = new Set(filteredNodes.map(n => n.node_id));
      filteredLinks = graphData.links.filter(
        l => nodeIds.has(l.source.node_id) && nodeIds.has(l.target.node_id),
      );
    }
    
    // Then filter by relationship status, confidence, and source
    filteredLinks = filteredLinks.filter(link => {
      const status = link.relationship_status || 'ACCEPTED';
      
      // Status filter
      if (status === 'ACCEPTED' && !filterStatusAccepted) return false;
      if (status === 'PROPOSED' && !filterStatusProposed) return false;
      if (status === 'REJECTED' && !filterStatusRejected) return false;
      
      // Confidence filter
      const confidence = link.relationship_confidence ?? 1.0;
      if (confidence < filterConfidenceThreshold) return false;
      
      // Source filter (if source_type is available)
      if (link.source_type && filterSources.size > 0 && !filterSources.has(link.source_type)) {
        return false;
      }
      
      return true;
    });
    
    // Keep only nodes that are connected by filtered links
    const connectedNodeIds = new Set<string>();
    filteredLinks.forEach(link => {
      connectedNodeIds.add(link.source.node_id);
      connectedNodeIds.add(link.target.node_id);
    });
    filteredNodes = filteredNodes.filter(n => connectedNodeIds.has(n.node_id));
    
    return { nodes: filteredNodes, links: filteredLinks };
  }, [graphData, selectedDomains, filterStatusAccepted, filterStatusProposed, filterStatusRejected, filterConfidenceThreshold, filterSources]);

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
    if (graphSwitchBanner) {
      const timer = setTimeout(() => {
        setGraphSwitchBanner(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [graphSwitchBanner]);

  // Auto-dismiss concept not found banner after 5 seconds
  useEffect(() => {
    if (conceptNotFoundBanner) {
      const timer = setTimeout(() => {
        setConceptNotFoundBanner(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [conceptNotFoundBanner]);

  // Track if initial load has happened to prevent infinite loops
  const hasInitializedRef = useRef(false);
  const lastGraphIdRef = useRef<string | null>(null);

  // Initial load effect - runs once on mount
  useEffect(() => {
    if (hasInitializedRef.current) return;
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/a01a33f1-d489-4279-a9af-9a81bd1c1f3e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'GraphVisualization.tsx:823',message:'Component mount: starting data load',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    hasInitializedRef.current = true;
    const targetGraphId = getActiveGraphId();
    lastGraphIdRef.current = targetGraphId;
    
    // Initial load
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
  }, []); // Empty deps - only run on mount

  // Extract graph_id from URL for stable dependency
  const urlGraphId = useMemo(() => searchParams?.get('graph_id') || null, [searchParams]);

  // Handle graph_id changes from URL
  useEffect(() => {
    if (!hasInitializedRef.current) return; // Wait for initial load
    
    const targetGraphId = getActiveGraphId();
    
    // Only switch if graph_id actually changed
    if (targetGraphId !== lastGraphIdRef.current && targetGraphId !== activeGraphId) {
      lastGraphIdRef.current = targetGraphId;
      
      selectGraph(targetGraphId).then(() => {
        setActiveGraphId(targetGraphId);
        setSelectedNode(null);
        refreshGraphs(true); // Preserve the graph we just switched to
        refreshBranches();
        loadGraph().then(() => {
          // After graph loads, try to select concept_id if present
          const conceptIdParam = searchParams?.get('select');
          if (conceptIdParam) {
            const { getAllGraphData } = require('../../api-client');
            getAllGraphData().then((data: any) => {
              const conceptExists = data.nodes?.some((n: any) => n.node_id === conceptIdParam);
              if (conceptExists) {
                const concept = data.nodes.find((n: any) => n.node_id === conceptIdParam);
                if (concept) {
                  setSelectedNode(concept);
                }
              } else {
                setConceptNotFoundBanner(conceptIdParam);
              }
            }).catch(() => {
              setConceptNotFoundBanner(conceptIdParam);
            });
          }
        });
        
        // Show switch banner
        refreshGraphs();
        // Get graph name after refresh completes
        setTimeout(() => {
          listGraphs().then((data) => {
            const graph = data.graphs?.find((g: any) => g.graph_id === targetGraphId);
            setGraphSwitchBanner({
              message: `Switched to ${graph?.name || targetGraphId}`,
              graphName: graph?.name || targetGraphId,
            });
          }).catch(() => {
            setGraphSwitchBanner({
              message: `Switched to ${targetGraphId}`,
              graphName: targetGraphId,
            });
          });
        }, 100);
      }).catch((err) => {
        console.error('Failed to switch to graph from URL:', err);
        loadGraph();
        refreshGraphs();
        refreshBranches();
      });
    }
  }, [urlGraphId, activeGraphId, getActiveGraphId]); // Stable dependencies

  // Handle highlight_run_id query param
  useEffect(() => {
    const runIdParam = searchParams?.get('highlight_run_id');
    if (runIdParam && runIdParam !== highlightRunId) {
      setHighlightRunId(runIdParam);
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
    } else if (!runIdParam && highlightRunId) {
      setHighlightRunId(null);
      setRunChanges(null);
      setHighlightedConceptIds(new Set());
      setHighlightedRelationshipIds(new Set());
    }
  }, [searchParams, highlightRunId]);

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

  // Helper function to extract ticker from a node
  const extractTicker = useCallback((node: Concept): string | null => {
    // Check if node has ticker property
    if ((node as any).ticker) {
      return (node as any).ticker;
    }
    // Check if node name contains ticker in parentheses: "Company Name (TICKER)"
    const match = node.name.match(/\(([A-Z]{1,5})\)$/);
    if (match) {
      return match[1];
    }
    // Check tags for ticker:xxx
    if (node.tags) {
      const tickerTag = node.tags.find(t => t.startsWith('ticker:'));
      if (tickerTag) {
        return tickerTag.split(':')[1];
      }
    }
    return null;
  }, []);

  // Load finance tracking state when ticker is available
  useEffect(() => {
    if (!selectedNode) {
      setFinanceTrackingState(null);
      return;
    }

    const ticker = extractTicker(selectedNode);
    if (!ticker) {
      setFinanceTrackingState(null);
      return;
    }

    // Load tracking state
    let cancelled = false;
    const loadTracking = async () => {
      try {
        setIsLoadingTracking(true);
        const config = await getFinanceTracking(ticker);
        if (!cancelled) {
          setFinanceTrackingState(config);
          // Update trackedTickers set
          if (config?.enabled) {
            setTrackedTickers(prev => new Set(prev).add(ticker));
          } else {
            setTrackedTickers(prev => {
              const next = new Set(prev);
              next.delete(ticker);
              return next;
            });
          }
        }
      } catch (err) {
        console.warn('Failed to load finance tracking:', err);
        if (!cancelled) {
          setFinanceTrackingState(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingTracking(false);
        }
      }
    };
    loadTracking();

    return () => {
      cancelled = true;
    };
  }, [selectedNode, extractTicker]);

  // Chat input handler
  const handleChatSubmit = useCallback(async (message: string) => {
    if (!message.trim() || isChatLoading) return;
    
    setIsChatLoading(true);
    setLoadingStage('Processing your question...');
    setLastQuestion(message);
    setChatAnswer(null);
    setAnswerId(null);
    setAnswerSections(null);
    setEvidenceUsed([]);
    setUsedNodes([]);
    setSuggestedQuestions([]);
    setSuggestedActions([]);
    setRetrievalMeta(null);
    clearEvidenceHighlight();
    
    try {
      const response = await fetch('/api/brain-web/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          mode: 'graphrag',
          graph_id: activeGraphId,
          branch_id: activeBranchId,
          lens: activeLens,
        }),
      });
      
      if (!response.ok) {
        throw new Error('Chat request failed');
      }
      
      const data = await response.json();
      setChatAnswer(data.answer || '');
      setAnswerId(data.answerId || null);
      setAnswerSections(data.sections || null);
      setUsedNodes(data.usedNodes || []);
      setSuggestedQuestions(data.suggestedQuestions || []);
      setSuggestedActions(data.suggestedActions || []);
      setRetrievalMeta(data.retrievalMeta || null);
      
      // Normalize and set evidence
      if (data.evidence) {
        const normalized = normalizeEvidence(data.evidence);
        setEvidenceUsed(normalized);
        
        // Auto-highlight evidence if enabled
        if (autoHighlightEvidence && normalized.length > 0) {
          await applyEvidenceHighlightWithRetry(normalized, data.retrievalMeta);
        }
      }
      
      // Scroll chat to bottom
      if (chatStreamRef.current) {
        chatStreamRef.current.scrollTop = chatStreamRef.current.scrollHeight;
      }
    } catch (err) {
      console.error('Chat error:', err);
      setChatAnswer('I encountered an error while processing your question. Please try again.');
    } finally {
      setIsChatLoading(false);
      setLoadingStage('');
    }
  }, [isChatLoading, activeGraphId, activeBranchId, activeLens, autoHighlightEvidence, applyEvidenceHighlightWithRetry, clearEvidenceHighlight]);

  // Node selection handler
  const handleNodeClick = useCallback((node: any) => {
    const concept = graphData.nodes.find(n => n.node_id === node.node_id);
    if (concept) {
      setSelectedNode(concept);
      trackConceptViewed(concept.node_id, concept.name);
      pushRecentConceptView({ id: concept.node_id, name: concept.name });
      updateSelectedPosition(concept);
    }
  }, [graphData.nodes, updateSelectedPosition]);

  // Graph switch handler
  const handleGraphSwitch = useCallback(async (graphId: string) => {
    try {
      await selectGraph(graphId);
      setActiveGraphId(graphId);
      setSelectedNode(null);
      await loadGraph();
      await refreshGraphs();
      await refreshBranches();
    } catch (err) {
      console.error('Failed to switch graph:', err);
      setGraphSwitchError(err instanceof Error ? err.message : 'Failed to switch graph');
    }
  }, [loadGraph, refreshGraphs, refreshBranches]);

  // Focus handler
  const handleFocus = useCallback(() => {
    if (!selectedNode || !graphRef.current) return;
    const data = graphRef.current.graphData();
    const node = data?.nodes?.find((n: any) => n.node_id === selectedNode.node_id);
    if (node && typeof node.x === 'number' && typeof node.y === 'number') {
      graphRef.current.centerAt(node.x, node.y, 500);
      graphRef.current.zoom(2.5, 500);
    }
  }, [selectedNode]);

  // Activity events
  const activityEvents = useMemo(() => {
    return deriveActivityEvents(selectedResources, selectedNode, (resourceId: string) => {
      const resource = selectedResources.find(r => r.resource_id === resourceId);
      if (resource) {
        setExpandedResources(prev => new Set(prev).add(resourceId));
        setNodePanelTab('evidence');
      }
    });
  }, [selectedResources, selectedNode]);

  if (loading) {
    return (
      <div className="loader">
        <div className="loader__ring" />
        <p className="loader__text">Mapping your knowledge…</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {/* Toolbar */}
      <div style={{ padding: '12px 16px' }}>
        <ExplorerToolbar
          demoMode={IS_DEMO_MODE}
          graphs={graphs}
          activeGraphId={activeGraphId}
          onSelectGraph={handleGraphSwitch}
          onRequestCreateGraph={() => setShowGraphModal(true)}
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
          graphSwitchError={graphSwitchError}
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
              const snapshot = await createSnapshot(activeGraphId, activeBranchId);
              console.log('Snapshot created:', snapshot);
            } catch (err) {
              console.error('Failed to create snapshot:', err);
            }
          }}
          onRestore={async () => {
            try {
              const snapshots = await listSnapshots(activeGraphId, activeBranchId);
              if (snapshots.length > 0) {
                await restoreSnapshot(snapshots[0].snapshot_id);
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
          showLectureIngest={showLectureIngest}
          onToggleLectureIngest={() => setShowLectureIngest(!showLectureIngest)}
          lecturePopover={showLectureIngest ? (
            <div style={{ padding: '12px', background: 'var(--panel)', borderRadius: '8px', boxShadow: 'var(--shadow)', minWidth: '300px' }}>
              <ContentImportForm
                onIngest={async (title, text, domain) => {
                  setLectureIngestLoading(true);
                  try {
                    const result = await ingestLecture(activeGraphId, title, text, domain);
                    setLectureIngestResult(result);
                    await loadGraph();
                  } catch (err) {
                    console.error('Failed to ingest lecture:', err);
                  } finally {
                    setLectureIngestLoading(false);
                  }
                }}
                isLoading={lectureIngestLoading}
                result={lectureIngestResult}
                onClose={() => setShowLectureIngest(false)}
              />
            </div>
          ) : undefined}
          showControls={showControls}
          onToggleControls={() => setShowControls(!showControls)}
          focusMode={focusMode}
          onToggleFocusMode={() => setFocusMode(!focusMode)}
          showFilters={showFilters}
          onToggleFilters={() => setShowFilters(!showFilters)}
          sourceLayer={sourceLayer}
          onSourceLayerChange={setSourceLayer}
        />
      </div>

      {/* Main layout */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', gap: '16px', padding: '0 16px 16px' }}>
        {/* Session Drawer (left sidebar) */}
        {!sidebarCollapsed && (
          <SessionDrawer
            isCollapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(true)}
          />
        )}
        {sidebarCollapsed && (
          <div style={{
            width: '40px',
            background: 'var(--panel)',
            borderRight: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'flex-start',
            padding: '12px 8px',
          }}>
            <button
              onClick={() => setSidebarCollapsed(false)}
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
              title="Expand sidebar"
            >
              →
            </button>
          </div>
        )}

        {/* Graph canvas */}
        <div ref={graphCanvasRef} className="graph-canvas" style={{ position: 'relative', flex: 1 }}>
          <ForceGraph2D
            ref={graphRef}
            graphData={displayGraph}
            nodeLabel={(node: any) => {
              const zoom = zoomTransform.k || zoomLevel || 1;
              const isHighDegree = (degreeById.get(node.node_id) || 0) >= highDegreeThreshold;
              const isInNeighborhood = selectedNeighborhoodIds.has(node.node_id);
              const isEvidence = evidenceNodeIds.has(node.node_id);
              const isHighlighted = (node as any).__highlighted;
              
              // Show label if: zoomed in enough, high degree, in neighborhood, evidence, or highlighted
              if (zoom > 1.2 || isHighDegree || isInNeighborhood || isEvidence || isHighlighted) {
                return node.name;
              }
              return '';
            }}
            nodeColor={(node: any) => {
              const domain = node.domain || 'general';
              const color = domainColors.get(domain) || '#94a3b8';
              const isEvidence = evidenceNodeIds.has(node.node_id);
              const isHighlighted = (node as any).__highlighted;
              
              if (isHighlighted) {
                return '#ffb703';
              }
              if (isEvidence) {
                return '#06d6a0';
              }
              if (selectedNode?.node_id === node.node_id) {
                return '#ef476f';
              }
              return color;
            }}
            nodeVal={(node: any) => {
              const degree = degreeById.get(node.node_id) || 0;
              return Math.max(4, Math.min(12, 4 + degree * 0.5));
            }}
            linkColor={(link: any) => {
              const isEvidence = evidenceLinkIds.has(`${link.source.node_id}-${link.target.node_id}-${link.predicate}`);
              const isHighlighted = (link as any).__highlighted;
              
              if (isHighlighted) {
                return '#ffb703';
              }
              if (isEvidence) {
                return '#06d6a0';
              }
              const status = link.relationship_status || 'ACCEPTED';
              if (status === 'PROPOSED') return 'rgba(251, 191, 36, 0.4)';
              if (status === 'REJECTED') return 'rgba(239, 68, 68, 0.3)';
              return 'rgba(15, 23, 42, 0.2)';
            }}
            linkWidth={(link: any) => {
              const isEvidence = evidenceLinkIds.has(`${link.source.node_id}-${link.target.node_id}-${link.predicate}`);
              const isHighlighted = (link as any).__highlighted;
              return isEvidence || isHighlighted ? 3 : 1;
            }}
            onNodeClick={handleNodeClick}
            onNodeDragEnd={(node: any) => {
              node.fx = node.x;
              node.fy = node.y;
            }}
            onBackgroundClick={() => setSelectedNode(null)}
            d3Force={forceCollide().radius((node: any) => {
              const degree = degreeById.get(node.node_id) || 0;
              return Math.max(8, Math.min(20, 8 + degree * 0.3));
            })}
            cooldownTicks={100}
            onEngineStop={() => {
              recomputeDomainBubbles();
            }}
            onZoom={(transform: any) => {
              setZoomTransform(transform);
              setZoomLevel(transform.k);
            }}
          />
          
          {/* Mini map */}
          <div className="graph-mini-map">
            <GraphMiniMap graphRef={graphRef} size={160} />
          </div>
          
          {/* Focus hint */}
          {selectedNode && !focusMode && (
            <div className="focus-hint">
              💡 Press Focus to center on selected node
            </div>
          )}
        </div>

        {/* Context panel */}
        {selectedNode && (
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
            activeTab={nodePanelTab}
            setActiveTab={setNodePanelTab}
            onClose={() => setSelectedNode(null)}
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
            onResourceUpload={async (file: File) => {
              if (!selectedNode) return;
              try {
                await uploadResourceForConcept(selectedNode.node_id, file);
                const resources = await getResourcesForConcept(selectedNode.node_id);
                setSelectedResources(resources);
                resourceCacheRef.current.set(selectedNode.node_id, resources);
              } catch (err) {
                console.error('Failed to upload resource:', err);
              }
            }}
            domainColors={domainColors}
            neighborCount={displayGraph.links.filter(l => 
              l.source.node_id === selectedNode.node_id || l.target.node_id === selectedNode.node_id
            ).length}
            isFinanceRelevant={!!extractTicker(selectedNode)}
            IS_DEMO_MODE={IS_DEMO_MODE}
            activityEvents={activityEvents}
            financeTabContent={financeLensEnabled && selectedNode ? (
              <div style={{ padding: '12px' }}>
                <p>Finance lens content for {selectedNode.name}</p>
              </div>
            ) : undefined}
          />
        )}

        {/* Chat panel */}
        <div style={{
          width: isChatMaximized ? '100%' : isChatExpanded ? '500px' : '350px',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--panel)',
          borderRadius: '16px',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow)',
          transition: 'width 0.3s ease',
        }}>
          {/* Chat header */}
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <select
                value={chatMode}
                onChange={(e) => setChatMode(e.target.value as any)}
                style={{
                  padding: '4px 8px',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  fontSize: '12px',
                  background: 'var(--background)',
                }}
              >
                <option value="Ask">Ask</option>
                <option value="Explore Paths">Explore Paths</option>
                <option value="Summaries">Summaries</option>
                <option value="Gaps">Gaps</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                onClick={() => setIsChatExpanded(!isChatExpanded)}
                style={{
                  padding: '4px 8px',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                {isChatExpanded ? '−' : '+'}
              </button>
              <button
                onClick={() => setIsChatMaximized(!isChatMaximized)}
                style={{
                  padding: '4px 8px',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                {isChatMaximized ? '⊟' : '⊞'}
              </button>
            </div>
          </div>

          {/* Chat content */}
          <div
            ref={chatStreamRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            {isChatLoading && (
              <div style={{ padding: '12px', background: 'var(--background)', borderRadius: '8px' }}>
                <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted)' }}>
                  {loadingStage || 'Processing...'}
                </p>
              </div>
            )}

            {chatAnswer && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{
                  padding: '12px',
                  background: 'var(--background)',
                  borderRadius: '8px',
                  whiteSpace: 'pre-wrap',
                  fontSize: '14px',
                  lineHeight: '1.6',
                }}>
                  {chatAnswer}
                </div>

                {/* Answer sections with evidence */}
                {answerSections && answerSections.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {answerSections.map((section) => (
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
                              const sectionEvidence = evidenceUsed.filter(e =>
                                section.supporting_evidence_ids.includes(e.resource_id || e.id || '')
                              );
                              applySectionEvidenceHighlight(
                                section.id,
                                section.supporting_evidence_ids,
                                evidenceUsed,
                                retrievalMeta
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
                {answerId && (
                  <div style={{ marginTop: '8px' }}>
                    <StyleFeedbackForm
                      answerId={answerId}
                      question={lastQuestion || ''}
                      originalResponse={chatAnswer}
                      onSubmitted={() => {
                        console.log('✅ Style feedback submitted! This will improve future responses.');
                      }}
                    />
                  </div>
                )}

                {/* Suggested questions */}
                {suggestedQuestions.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <p style={{ margin: 0, fontSize: '12px', fontWeight: 600, color: 'var(--muted)' }}>
                      Suggested questions:
                    </p>
                    {suggestedQuestions.map((q, idx) => (
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

          {/* Chat input */}
          <div style={{
            padding: '12px',
            borderTop: '1px solid var(--border)',
          }}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const input = e.currentTarget.querySelector('input') as HTMLInputElement;
                if (input?.value) {
                  handleChatSubmit(input.value);
                  input.value = '';
                }
              }}
            >
              <div className="chat-input-row">
                <input
                  type="text"
                  placeholder="Ask a question..."
                  disabled={isChatLoading}
                  className="chat-input"
                  style={{
                    padding: '10px 14px',
                    fontSize: '14px',
                  }}
                />
                <button
                  type="submit"
                  disabled={isChatLoading}
                  className="pill pill--primary"
                  style={{
                    padding: '10px 20px',
                  }}
                >
                  {isChatLoading ? '...' : 'Ask'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

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
      {graphSwitchBanner && (
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
          {graphSwitchBanner.message}
        </div>
      )}
    </div>
  );
}

