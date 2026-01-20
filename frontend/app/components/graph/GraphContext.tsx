'use client';

import { createContext, useContext, useCallback, useState, ReactNode, Dispatch, SetStateAction } from 'react';
import type { Concept, GraphSummary, BranchSummary, FocusArea } from '../../api-client';

export interface VisualGraph {
  nodes: Concept[];
  links: Array<{
    source: Concept | string;
    target: Concept | string;
    predicate: string;
    relationship_status?: string;
    relationship_confidence?: number;
    relationship_method?: string;
    relationship_rationale?: string;
    relationship_source_id?: string;
    relationship_chunk_id?: string;
    source_type?: string;
    source_id?: string;
    target_id?: string;
  }>;
}

interface GraphContextType {
  // Graph data
  graphData: VisualGraph;
  setGraphData: Dispatch<SetStateAction<VisualGraph>>;
  
  // Selected node
  selectedNode: Concept | null;
  setSelectedNode: (node: Concept | null) => void;
  
  // Graphs and branches
  graphs: GraphSummary[];
  setGraphs: (graphs: GraphSummary[]) => void;
  activeGraphId: string;
  setActiveGraphId: (id: string) => void;
  branches: BranchSummary[];
  setBranches: (branches: BranchSummary[]) => void;
  activeBranchId: string;
  setActiveBranchId: (id: string) => void;
  focusAreas: FocusArea[];
  setFocusAreas: (areas: FocusArea[]) => void;
  
  // Loading and error states
  loading: boolean;
  setLoading: (loading: boolean) => void;
  error: string | null;
  setError: (error: string | null) => void;
  loadingNeighbors: string | null;
  setLoadingNeighbors: (id: string | null) => void;
  overviewMeta: { node_count?: number; sampled?: boolean } | null;
  setOverviewMeta: (meta: { node_count?: number; sampled?: boolean } | null) => void;
  
  // Neighbor cache
  neighborCache: Map<string, { nodes: Concept[]; edges: any[] }>;
  clearNeighborCache: () => void;
  
  // Graph visualization state
  selectedDomains: Set<string>;
  setSelectedDomains: (domains: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  expandedNodes: Set<string>;
  setExpandedNodes: (nodes: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  collapsedGroups: Record<string, string[]>;
  setCollapsedGroups: (groups: Record<string, string[]> | ((prev: Record<string, string[]>) => Record<string, string[]>)) => void;
  focusedNodeId: string | null;
  setFocusedNodeId: (id: string | null) => void;
  domainBubbles: Array<{ domain: string; x: number; y: number; radius: number }>;
  setDomainBubbles: (bubbles: Array<{ domain: string; x: number; y: number; radius: number }>) => void;
  
  // Highlighting
  highlightedConceptIds: Set<string>;
  setHighlightedConceptIds: (ids: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  highlightedRelationshipIds: Set<string>;
  setHighlightedRelationshipIds: (ids: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  
  // Temp nodes
  tempNodes: Array<{ id: string; name: string; domain: string; x?: number; y?: number }>;
  setTempNodes: (nodes: Array<{ id: string; name: string; domain: string; x?: number; y?: number }>) => void;
}

const GraphContext = createContext<GraphContextType | undefined>(undefined);

export function GraphProvider({ children }: { children: ReactNode }) {
  const [graphData, setGraphData] = useState<VisualGraph>({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState<Concept | null>(null);
  const [graphs, setGraphs] = useState<GraphSummary[]>([]);
  const [activeGraphId, setActiveGraphId] = useState<string>('default');
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [activeBranchId, setActiveBranchId] = useState<string>('main');
  const [focusAreas, setFocusAreas] = useState<FocusArea[]>([]);
  const [loading, setLoading] = useState(false); // Start as false so UI renders immediately
  const [error, setError] = useState<string | null>(null);
  const [loadingNeighbors, setLoadingNeighbors] = useState<string | null>(null);
  const [overviewMeta, setOverviewMeta] = useState<{ node_count?: number; sampled?: boolean } | null>(null);
  const [neighborCache] = useState<Map<string, { nodes: Concept[]; edges: any[] }>>(new Map());
  const [selectedDomains, setSelectedDomains] = useState<Set<string>>(new Set());
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, string[]>>({});
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [domainBubbles, setDomainBubbles] = useState<Array<{ domain: string; x: number; y: number; radius: number }>>([]);
  const [highlightedConceptIds, setHighlightedConceptIds] = useState<Set<string>>(new Set());
  const [highlightedRelationshipIds, setHighlightedRelationshipIds] = useState<Set<string>>(new Set());
  const [tempNodes, setTempNodes] = useState<Array<{ id: string; name: string; domain: string; x?: number; y?: number }>>([]);
  
  const clearNeighborCache = useCallback(() => {
    neighborCache.clear();
  }, [neighborCache]);
  
  return (
    <GraphContext.Provider
      value={{
        graphData,
        setGraphData,
        selectedNode,
        setSelectedNode,
        graphs,
        setGraphs,
        activeGraphId,
        setActiveGraphId,
        branches,
        setBranches,
        activeBranchId,
        setActiveBranchId,
        focusAreas,
        setFocusAreas,
        loading,
        setLoading,
        error,
        setError,
        loadingNeighbors,
        setLoadingNeighbors,
        overviewMeta,
        setOverviewMeta,
        neighborCache,
        clearNeighborCache,
        selectedDomains,
        setSelectedDomains,
        expandedNodes,
        setExpandedNodes,
        collapsedGroups,
        setCollapsedGroups,
        focusedNodeId,
        setFocusedNodeId,
        domainBubbles,
        setDomainBubbles,
        highlightedConceptIds,
        setHighlightedConceptIds,
        highlightedRelationshipIds,
        setHighlightedRelationshipIds,
        tempNodes,
        setTempNodes,
      }}
    >
      {children}
    </GraphContext.Provider>
  );
}

export function useGraph() {
  const context = useContext(GraphContext);
  if (!context) {
    throw new Error('useGraph must be used within GraphProvider');
  }
  return context;
}

