'use client';

import { useReducer, useCallback, useMemo } from 'react';
import type { FinanceTrackingConfig, LatestSnapshotMetadata } from '../../../api-client';

interface FinanceState {
  financeLensEnabled: boolean;
  selectedTicker: string;
  financeLens: string;
  financeTracking: FinanceTrackingConfig | null;
  isLoadingTracking: boolean;
  isFetchingSnapshot: boolean;
  trackedTickers: Set<string>;
  trackedCompaniesList: FinanceTrackingConfig[];
  latestSnapshots: Record<string, LatestSnapshotMetadata>;
  refreshingTickers: Set<string>;
  financeSelectedResourceId: string | null;
  showAllNews: boolean;
}

type FinanceAction =
  | { type: 'SET_FINANCE_LENS_ENABLED'; payload: boolean }
  | { type: 'SET_SELECTED_TICKER'; payload: string }
  | { type: 'SET_FINANCE_LENS'; payload: string }
  | { type: 'SET_FINANCE_TRACKING'; payload: FinanceTrackingConfig | null }
  | { type: 'SET_LOADING_TRACKING'; payload: boolean }
  | { type: 'SET_FETCHING_SNAPSHOT'; payload: boolean }
  | { type: 'SET_TRACKED_TICKERS'; payload: Set<string> }
  | { type: 'ADD_TRACKED_TICKER'; payload: string }
  | { type: 'REMOVE_TRACKED_TICKER'; payload: string }
  | { type: 'SET_TRACKED_COMPANIES_LIST'; payload: FinanceTrackingConfig[] }
  | { type: 'SET_LATEST_SNAPSHOTS'; payload: Record<string, LatestSnapshotMetadata> }
  | { type: 'UPDATE_SNAPSHOT'; payload: { ticker: string; snapshot: LatestSnapshotMetadata } }
  | { type: 'SET_REFRESHING_TICKERS'; payload: Set<string> }
  | { type: 'ADD_REFRESHING_TICKER'; payload: string }
  | { type: 'REMOVE_REFRESHING_TICKER'; payload: string }
  | { type: 'SET_FINANCE_SELECTED_RESOURCE_ID'; payload: string | null }
  | { type: 'SET_SHOW_ALL_NEWS'; payload: boolean };

const initialState: FinanceState = {
  financeLensEnabled: false,
  selectedTicker: '',
  financeLens: 'general',
  financeTracking: null,
  isLoadingTracking: false,
  isFetchingSnapshot: false,
  trackedTickers: new Set(),
  trackedCompaniesList: [],
  latestSnapshots: {},
  refreshingTickers: new Set(),
  financeSelectedResourceId: null,
  showAllNews: false,
};

function financeReducer(state: FinanceState, action: FinanceAction): FinanceState {
  switch (action.type) {
    case 'SET_FINANCE_LENS_ENABLED':
      return { ...state, financeLensEnabled: action.payload };
    case 'SET_SELECTED_TICKER':
      return { ...state, selectedTicker: action.payload };
    case 'SET_FINANCE_LENS':
      return { ...state, financeLens: action.payload };
    case 'SET_FINANCE_TRACKING':
      return { ...state, financeTracking: action.payload };
    case 'SET_LOADING_TRACKING':
      return { ...state, isLoadingTracking: action.payload };
    case 'SET_FETCHING_SNAPSHOT':
      return { ...state, isFetchingSnapshot: action.payload };
    case 'SET_TRACKED_TICKERS':
      return { ...state, trackedTickers: action.payload };
    case 'ADD_TRACKED_TICKER': {
      const newSet = new Set(state.trackedTickers);
      newSet.add(action.payload);
      return { ...state, trackedTickers: newSet };
    }
    case 'REMOVE_TRACKED_TICKER': {
      const newSet = new Set(state.trackedTickers);
      newSet.delete(action.payload);
      return { ...state, trackedTickers: newSet };
    }
    case 'SET_TRACKED_COMPANIES_LIST':
      return { ...state, trackedCompaniesList: action.payload };
    case 'SET_LATEST_SNAPSHOTS':
      return { ...state, latestSnapshots: action.payload };
    case 'UPDATE_SNAPSHOT':
      return {
        ...state,
        latestSnapshots: {
          ...state.latestSnapshots,
          [action.payload.ticker]: action.payload.snapshot,
        },
      };
    case 'SET_REFRESHING_TICKERS':
      return { ...state, refreshingTickers: action.payload };
    case 'ADD_REFRESHING_TICKER': {
      const newSet = new Set(state.refreshingTickers);
      newSet.add(action.payload);
      return { ...state, refreshingTickers: newSet };
    }
    case 'REMOVE_REFRESHING_TICKER': {
      const newSet = new Set(state.refreshingTickers);
      newSet.delete(action.payload);
      return { ...state, refreshingTickers: newSet };
    }
    case 'SET_FINANCE_SELECTED_RESOURCE_ID':
      return { ...state, financeSelectedResourceId: action.payload };
    case 'SET_SHOW_ALL_NEWS':
      return { ...state, showAllNews: action.payload };
    default:
      return state;
  }
}

export function useFinanceState() {
  const [state, dispatch] = useReducer(financeReducer, initialState);

  const actions = {
    setFinanceLensEnabled: useCallback((enabled: boolean) => {
      dispatch({ type: 'SET_FINANCE_LENS_ENABLED', payload: enabled });
    }, []),
    setSelectedTicker: useCallback((ticker: string) => {
      dispatch({ type: 'SET_SELECTED_TICKER', payload: ticker });
    }, []),
    setFinanceLens: useCallback((lens: string) => {
      dispatch({ type: 'SET_FINANCE_LENS', payload: lens });
    }, []),
    setFinanceTracking: useCallback((tracking: FinanceTrackingConfig | null) => {
      dispatch({ type: 'SET_FINANCE_TRACKING', payload: tracking });
    }, []),
    setLoadingTracking: useCallback((loading: boolean) => {
      dispatch({ type: 'SET_LOADING_TRACKING', payload: loading });
    }, []),
    setFetchingSnapshot: useCallback((fetching: boolean) => {
      dispatch({ type: 'SET_FETCHING_SNAPSHOT', payload: fetching });
    }, []),
    setTrackedTickers: useCallback((tickers: Set<string>) => {
      dispatch({ type: 'SET_TRACKED_TICKERS', payload: tickers });
    }, []),
    addTrackedTicker: useCallback((ticker: string) => {
      dispatch({ type: 'ADD_TRACKED_TICKER', payload: ticker });
    }, []),
    removeTrackedTicker: useCallback((ticker: string) => {
      dispatch({ type: 'REMOVE_TRACKED_TICKER', payload: ticker });
    }, []),
    setTrackedCompaniesList: useCallback((list: FinanceTrackingConfig[]) => {
      dispatch({ type: 'SET_TRACKED_COMPANIES_LIST', payload: list });
    }, []),
    setLatestSnapshots: useCallback((snapshots: Record<string, LatestSnapshotMetadata>) => {
      dispatch({ type: 'SET_LATEST_SNAPSHOTS', payload: snapshots });
    }, []),
    updateSnapshot: useCallback((ticker: string, snapshot: LatestSnapshotMetadata) => {
      dispatch({ type: 'UPDATE_SNAPSHOT', payload: { ticker, snapshot } });
    }, []),
    setRefreshingTickers: useCallback((tickers: Set<string>) => {
      dispatch({ type: 'SET_REFRESHING_TICKERS', payload: tickers });
    }, []),
    addRefreshingTicker: useCallback((ticker: string) => {
      dispatch({ type: 'ADD_REFRESHING_TICKER', payload: ticker });
    }, []),
    removeRefreshingTicker: useCallback((ticker: string) => {
      dispatch({ type: 'REMOVE_REFRESHING_TICKER', payload: ticker });
    }, []),
    setFinanceSelectedResourceId: useCallback((id: string | null) => {
      dispatch({ type: 'SET_FINANCE_SELECTED_RESOURCE_ID', payload: id });
    }, []),
    setShowAllNews: useCallback((show: boolean) => {
      dispatch({ type: 'SET_SHOW_ALL_NEWS', payload: show });
    }, []),
  };

  return { state, actions };
}

