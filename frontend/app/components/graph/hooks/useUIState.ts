'use client';

import { useReducer, useCallback } from 'react';
import type { Concept } from '../../../api-client';

interface UIState {
  sidebarCollapsed: boolean;
  showGraphModal: boolean;
  newGraphName: string;
  graphSwitchError: string | null;
  graphSwitchBanner: { message: string; graphName: string } | null;
  conceptNotFoundBanner: string | null;
  linkingMode: { source: Concept | null; predicate: string } | null;
  searchTerm: string;
  showControls: boolean;
  currentZoom: number;
  zoomLevel: number;
  zoomTransform: { k: number; x: number; y: number };
  graphViewport: { width: number; height: number };
  focusMode: boolean;
  selectedPosition: { x: number; y: number } | null;
  pendingFocusId: string | null;
  highlightRunId: string | null;
  hoveredLink: { source: string; target: string; predicate: string } | null;
  hoveredLinkPosition: { x: number; y: number } | null;
  showContentIngest: boolean;
  contentIngestLoading: boolean;
  showSegments: boolean;
  segmentsLoading: boolean;
  nodePanelTab: 'overview' | 'resources' | 'evidence' | 'confusions';
  activeDomainPlugins: string[]; // Array of active domain plugin IDs
}

type UIAction =
  | { type: 'SET_SIDEBAR_COLLAPSED'; payload: boolean }
  | { type: 'SET_SHOW_GRAPH_MODAL'; payload: boolean }
  | { type: 'SET_NEW_GRAPH_NAME'; payload: string }
  | { type: 'SET_GRAPH_SWITCH_ERROR'; payload: string | null }
  | { type: 'SET_GRAPH_SWITCH_BANNER'; payload: { message: string; graphName: string } | null }
  | { type: 'SET_CONCEPT_NOT_FOUND_BANNER'; payload: string | null }
  | { type: 'SET_LINKING_MODE'; payload: { source: Concept | null; predicate: string } | null }
  | { type: 'SET_SEARCH_TERM'; payload: string }
  | { type: 'SET_SHOW_CONTROLS'; payload: boolean }
  | { type: 'SET_CURRENT_ZOOM'; payload: number }
  | { type: 'SET_ZOOM_LEVEL'; payload: number }
  | { type: 'SET_ZOOM_TRANSFORM'; payload: { k: number; x: number; y: number } }
  | { type: 'SET_GRAPH_VIEWPORT'; payload: { width: number; height: number } }
  | { type: 'SET_FOCUS_MODE'; payload: boolean }
  | { type: 'SET_SELECTED_POSITION'; payload: { x: number; y: number } | null }
  | { type: 'SET_PENDING_FOCUS_ID'; payload: string | null }
  | { type: 'SET_HIGHLIGHT_RUN_ID'; payload: string | null }
  | { type: 'SET_HOVERED_LINK'; payload: { source: string; target: string; predicate: string } | null }
  | { type: 'SET_HOVERED_LINK_POSITION'; payload: { x: number; y: number } | null }
  | { type: 'SET_SHOW_CONTENT_INGEST'; payload: boolean }
  | { type: 'SET_CONTENT_INGEST_LOADING'; payload: boolean }
  | { type: 'SET_SHOW_SEGMENTS'; payload: boolean }
  | { type: 'SET_SEGMENTS_LOADING'; payload: boolean }
  | { type: 'SET_NODE_PANEL_TAB'; payload: 'overview' | 'resources' | 'evidence' | 'confusions' }
  | { type: 'SET_ACTIVE_DOMAIN_PLUGINS'; payload: string[] };

const initialState: UIState = {
  sidebarCollapsed: false,
  showGraphModal: false,
  newGraphName: '',
  graphSwitchError: null,
  graphSwitchBanner: null,
  conceptNotFoundBanner: null,
  linkingMode: null,
  searchTerm: '',
  showControls: false,
  currentZoom: 1,
  zoomLevel: 1,
  zoomTransform: { k: 1, x: 0, y: 0 },
  graphViewport: { width: 0, height: 0 },
  focusMode: false,
  selectedPosition: null,
  pendingFocusId: null,
  highlightRunId: null,
  hoveredLink: null,
  hoveredLinkPosition: null,
  showContentIngest: false,
  contentIngestLoading: false,
  showSegments: false,
  segmentsLoading: false,
  nodePanelTab: 'overview',
  activeDomainPlugins: [],
};

function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case 'SET_SIDEBAR_COLLAPSED':
      return { ...state, sidebarCollapsed: action.payload };
    case 'SET_SHOW_GRAPH_MODAL':
      return { ...state, showGraphModal: action.payload };
    case 'SET_NEW_GRAPH_NAME':
      return { ...state, newGraphName: action.payload };
    case 'SET_GRAPH_SWITCH_ERROR':
      return { ...state, graphSwitchError: action.payload };
    case 'SET_GRAPH_SWITCH_BANNER':
      return { ...state, graphSwitchBanner: action.payload };
    case 'SET_CONCEPT_NOT_FOUND_BANNER':
      return { ...state, conceptNotFoundBanner: action.payload };
    case 'SET_LINKING_MODE':
      return { ...state, linkingMode: action.payload };
    case 'SET_SEARCH_TERM':
      return { ...state, searchTerm: action.payload };
    case 'SET_SHOW_CONTROLS':
      return { ...state, showControls: action.payload };
    case 'SET_CURRENT_ZOOM':
      return { ...state, currentZoom: action.payload };
    case 'SET_ZOOM_LEVEL':
      return { ...state, zoomLevel: action.payload };
    case 'SET_ZOOM_TRANSFORM':
      return { ...state, zoomTransform: action.payload };
    case 'SET_GRAPH_VIEWPORT':
      return { ...state, graphViewport: action.payload };
    case 'SET_FOCUS_MODE':
      return { ...state, focusMode: action.payload };
    case 'SET_SELECTED_POSITION':
      return { ...state, selectedPosition: action.payload };
    case 'SET_PENDING_FOCUS_ID':
      return { ...state, pendingFocusId: action.payload };
    case 'SET_HIGHLIGHT_RUN_ID':
      return { ...state, highlightRunId: action.payload };
    case 'SET_HOVERED_LINK':
      return { ...state, hoveredLink: action.payload };
    case 'SET_HOVERED_LINK_POSITION':
      return { ...state, hoveredLinkPosition: action.payload };
    case 'SET_SHOW_CONTENT_INGEST':
      return { ...state, showContentIngest: action.payload };
    case 'SET_CONTENT_INGEST_LOADING':
      return { ...state, contentIngestLoading: action.payload };
    case 'SET_SHOW_SEGMENTS':
      return { ...state, showSegments: action.payload };
    case 'SET_SEGMENTS_LOADING':
      return { ...state, segmentsLoading: action.payload };
    case 'SET_NODE_PANEL_TAB':
      return { ...state, nodePanelTab: action.payload };
    case 'SET_ACTIVE_DOMAIN_PLUGINS':
      return { ...state, activeDomainPlugins: action.payload };
    default:
      return state;
  }
}

export function useUIState() {
  const [state, dispatch] = useReducer(uiReducer, initialState);
  
  const actions = {
    setSidebarCollapsed: useCallback((collapsed: boolean) => {
      dispatch({ type: 'SET_SIDEBAR_COLLAPSED', payload: collapsed });
    }, []),
    setShowGraphModal: useCallback((show: boolean) => {
      dispatch({ type: 'SET_SHOW_GRAPH_MODAL', payload: show });
    }, []),
    setNewGraphName: useCallback((name: string) => {
      dispatch({ type: 'SET_NEW_GRAPH_NAME', payload: name });
    }, []),
    setGraphSwitchError: useCallback((error: string | null) => {
      dispatch({ type: 'SET_GRAPH_SWITCH_ERROR', payload: error });
    }, []),
    setGraphSwitchBanner: useCallback((banner: { message: string; graphName: string } | null) => {
      dispatch({ type: 'SET_GRAPH_SWITCH_BANNER', payload: banner });
    }, []),
    setConceptNotFoundBanner: useCallback((banner: string | null) => {
      dispatch({ type: 'SET_CONCEPT_NOT_FOUND_BANNER', payload: banner });
    }, []),
    setLinkingMode: useCallback((mode: { source: Concept | null; predicate: string } | null) => {
      dispatch({ type: 'SET_LINKING_MODE', payload: mode });
    }, []),
    setSearchTerm: useCallback((term: string) => {
      dispatch({ type: 'SET_SEARCH_TERM', payload: term });
    }, []),
    setShowControls: useCallback((show: boolean) => {
      dispatch({ type: 'SET_SHOW_CONTROLS', payload: show });
    }, []),
    setCurrentZoom: useCallback((zoom: number) => {
      dispatch({ type: 'SET_CURRENT_ZOOM', payload: zoom });
    }, []),
    setZoomLevel: useCallback((level: number) => {
      dispatch({ type: 'SET_ZOOM_LEVEL', payload: level });
    }, []),
    setZoomTransform: useCallback((transform: { k: number; x: number; y: number }) => {
      dispatch({ type: 'SET_ZOOM_TRANSFORM', payload: transform });
    }, []),
    setGraphViewport: useCallback((viewport: { width: number; height: number }) => {
      dispatch({ type: 'SET_GRAPH_VIEWPORT', payload: viewport });
    }, []),
    setFocusMode: useCallback((mode: boolean) => {
      dispatch({ type: 'SET_FOCUS_MODE', payload: mode });
    }, []),
    setSelectedPosition: useCallback((position: { x: number; y: number } | null) => {
      dispatch({ type: 'SET_SELECTED_POSITION', payload: position });
    }, []),
    setPendingFocusId: useCallback((id: string | null) => {
      dispatch({ type: 'SET_PENDING_FOCUS_ID', payload: id });
    }, []),
    setHighlightRunId: useCallback((id: string | null) => {
      dispatch({ type: 'SET_HIGHLIGHT_RUN_ID', payload: id });
    }, []),
    setHoveredLink: useCallback((link: { source: string; target: string; predicate: string } | null) => {
      dispatch({ type: 'SET_HOVERED_LINK', payload: link });
    }, []),
    setHoveredLinkPosition: useCallback((position: { x: number; y: number } | null) => {
      dispatch({ type: 'SET_HOVERED_LINK_POSITION', payload: position });
    }, []),
    setShowContentIngest: useCallback((show: boolean) => {
      dispatch({ type: 'SET_SHOW_CONTENT_INGEST', payload: show });
    }, []),
    setContentIngestLoading: useCallback((loading: boolean) => {
      dispatch({ type: 'SET_CONTENT_INGEST_LOADING', payload: loading });
    }, []),
    setShowSegments: useCallback((show: boolean) => {
      dispatch({ type: 'SET_SHOW_SEGMENTS', payload: show });
    }, []),
    setSegmentsLoading: useCallback((loading: boolean) => {
      dispatch({ type: 'SET_SEGMENTS_LOADING', payload: loading });
    }, []),
    setNodePanelTab: useCallback((tab: 'overview' | 'resources' | 'evidence' | 'confusions') => {
      dispatch({ type: 'SET_NODE_PANEL_TAB', payload: tab });
    }, []),
    setActiveDomainPlugins: useCallback((plugins: string[]) => {
      dispatch({ type: 'SET_ACTIVE_DOMAIN_PLUGINS', payload: plugins });
    }, []),
  };
  
  return { state, actions };
}

