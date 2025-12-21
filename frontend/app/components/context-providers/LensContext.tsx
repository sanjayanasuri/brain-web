'use client';

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { getUIPreferences, updateUIPreferences, type UIPreferences } from '../../api-client';
import { logEvent } from '../../lib/eventsClient';

export type LensType = 'NONE' | 'LEARNING' | 'FINANCE';

interface LensContextType {
  activeLens: LensType;
  setActiveLens: (lens: LensType) => Promise<void>;
  isLoading: boolean;
}

const LensContext = createContext<LensContextType | undefined>(undefined);

const LENS_STORAGE_KEY = 'brainweb:active_lens';

// Load from localStorage immediately (synchronous)
function getCachedLens(): LensType {
  if (typeof window === 'undefined') return 'NONE';
  try {
    const cached = localStorage.getItem(LENS_STORAGE_KEY);
    if (cached === 'LEARNING' || cached === 'FINANCE' || cached === 'NONE') {
      return cached;
    }
  } catch (e) {
    // Ignore localStorage errors
  }
  return 'NONE';
}

// Save to localStorage
function setCachedLens(lens: LensType): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LENS_STORAGE_KEY, lens);
  } catch (e) {
    // Ignore localStorage errors
  }
}

export function LensProvider({ children }: { children: ReactNode }) {
  const [activeLens, setActiveLensState] = useState<LensType>(getCachedLens);
  const [isLoading, setIsLoading] = useState(true);

  // Load from backend on mount and reconcile with localStorage
  useEffect(() => {
    async function loadLens() {
      try {
        const prefs = await getUIPreferences();
        const backendLens = (prefs.active_lens || 'NONE') as LensType;
        
        // Reconcile: prefer backend if different, but use cached for instant load
        const cachedLens = getCachedLens();
        if (backendLens !== cachedLens) {
          // Backend is source of truth, update cache
          setCachedLens(backendLens);
          setActiveLensState(backendLens);
        } else {
          // Already in sync
          setActiveLensState(backendLens);
        }
      } catch (error) {
        console.warn('[LensContext] Failed to load lens from backend:', error);
        // Fall back to cached value
        setActiveLensState(getCachedLens());
      } finally {
        setIsLoading(false);
      }
    }
    loadLens();
  }, []);

  const setActiveLens = useCallback(async (lens: LensType) => {
    // Optimistic update
    setActiveLensState(lens);
    setCachedLens(lens);

    // Update backend
    try {
      await updateUIPreferences({ active_lens: lens });
      
      // Log event
      logEvent({
        type: 'GRAPH_LENS_CHANGED',
        payload: { lens },
      });
    } catch (error) {
      console.error('[LensContext] Failed to update lens:', error);
      // Revert on error
      const prefs = await getUIPreferences();
      const backendLens = (prefs.active_lens || 'NONE') as LensType;
      setActiveLensState(backendLens);
      setCachedLens(backendLens);
    }
  }, []);

  return (
    <LensContext.Provider value={{ activeLens, setActiveLens, isLoading }}>
      {children}
    </LensContext.Provider>
  );
}

export function useLens() {
  const context = useContext(LensContext);
  if (context === undefined) {
    throw new Error('useLens must be used within a LensProvider');
  }
  return context;
}

