'use client';

import { useReducer, useCallback, useMemo } from 'react';

interface GraphFiltersState {
  filterStatusAccepted: boolean;
  filterStatusProposed: boolean;
  filterStatusRejected: boolean;
  filterConfidenceThreshold: number;
  filterSources: Set<string>;
  showFilters: boolean;
  sourceLayer: 'concepts' | 'evidence' | 'snapshots';
}

type GraphFiltersAction =
  | { type: 'SET_STATUS_ACCEPTED'; payload: boolean }
  | { type: 'SET_STATUS_PROPOSED'; payload: boolean }
  | { type: 'SET_STATUS_REJECTED'; payload: boolean }
  | { type: 'SET_CONFIDENCE_THRESHOLD'; payload: number }
  | { type: 'SET_FILTER_SOURCES'; payload: Set<string> }
  | { type: 'TOGGLE_FILTER_SOURCE'; payload: string }
  | { type: 'SET_SHOW_FILTERS'; payload: boolean }
  | { type: 'SET_SOURCE_LAYER'; payload: 'concepts' | 'evidence' | 'snapshots' }
  | { type: 'RESET_FILTERS' };

const initialState: GraphFiltersState = {
  filterStatusAccepted: true,
  filterStatusProposed: true,
  filterStatusRejected: false,
  filterConfidenceThreshold: 0.0,
  filterSources: new Set(),
  showFilters: false,
  sourceLayer: 'concepts',
};

function graphFiltersReducer(state: GraphFiltersState, action: GraphFiltersAction): GraphFiltersState {
  switch (action.type) {
    case 'SET_STATUS_ACCEPTED':
      return { ...state, filterStatusAccepted: action.payload };
    case 'SET_STATUS_PROPOSED':
      return { ...state, filterStatusProposed: action.payload };
    case 'SET_STATUS_REJECTED':
      return { ...state, filterStatusRejected: action.payload };
    case 'SET_CONFIDENCE_THRESHOLD':
      return { ...state, filterConfidenceThreshold: action.payload };
    case 'SET_FILTER_SOURCES':
      return { ...state, filterSources: action.payload };
    case 'TOGGLE_FILTER_SOURCE': {
      const newSources = new Set(state.filterSources);
      if (newSources.has(action.payload)) {
        newSources.delete(action.payload);
      } else {
        newSources.add(action.payload);
      }
      return { ...state, filterSources: newSources };
    }
    case 'SET_SHOW_FILTERS':
      return { ...state, showFilters: action.payload };
    case 'SET_SOURCE_LAYER':
      return { ...state, sourceLayer: action.payload };
    case 'RESET_FILTERS':
      return initialState;
    default:
      return state;
  }
}

export function useGraphFilters() {
  const [state, dispatch] = useReducer(graphFiltersReducer, initialState);

  const actions = useMemo(() => ({
    setStatusAccepted: (accepted: boolean) => {
      dispatch({ type: 'SET_STATUS_ACCEPTED', payload: accepted });
    },
    setStatusProposed: (proposed: boolean) => {
      dispatch({ type: 'SET_STATUS_PROPOSED', payload: proposed });
    },
    setStatusRejected: (rejected: boolean) => {
      dispatch({ type: 'SET_STATUS_REJECTED', payload: rejected });
    },
    setConfidenceThreshold: (threshold: number) => {
      dispatch({ type: 'SET_CONFIDENCE_THRESHOLD', payload: threshold });
    },
    setFilterSources: (sources: Set<string>) => {
      dispatch({ type: 'SET_FILTER_SOURCES', payload: sources });
    },
    toggleFilterSource: (source: string) => {
      dispatch({ type: 'TOGGLE_FILTER_SOURCE', payload: source });
    },
    setShowFilters: (show: boolean) => {
      dispatch({ type: 'SET_SHOW_FILTERS', payload: show });
    },
    setSourceLayer: (layer: 'concepts' | 'evidence' | 'snapshots') => {
      dispatch({ type: 'SET_SOURCE_LAYER', payload: layer });
    },
    resetFilters: () => {
      dispatch({ type: 'RESET_FILTERS' });
    },
  }), []);

  return useMemo(() => ({ state, actions }), [state, actions]);
}
