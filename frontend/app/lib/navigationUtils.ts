/**
 * Navigation utilities for optimized routing and state management
 * Provides smooth transitions, prefetching, and optimistic updates
 */

import { useRouter } from 'next/navigation';
import { useCallback, useEffect } from 'react';

export interface NavigationOptions {
  /** Whether to show loading state immediately */
  optimistic?: boolean;
  /** Data to prefetch before navigation */
  prefetch?: () => Promise<void>;
  /** Callback after successful navigation */
  onSuccess?: () => void;
  /** Callback on navigation error */
  onError?: (error: Error) => void;
}

/**
 * Enhanced navigation hook with performance optimizations
 */
export function useOptimizedNavigation() {
  const router = useRouter();
  
  const navigateWithOptimization = useCallback(async (
    url: string,
    options: NavigationOptions = {}
  ) => {
    const { optimistic = true, prefetch, onSuccess, onError } = options;
    
    try {
      // Start prefetch if provided
      const prefetchPromise = prefetch ? prefetch() : Promise.resolve();
      
      // Show optimistic loading state
      if (optimistic && typeof document !== 'undefined') {
        document.body.classList.add('page-transitioning');
      }
      
      // Wait for prefetch to complete before navigation
      await prefetchPromise;
      
      // Perform navigation
      router.push(url);
      
      // Clean up loading state after a brief delay to allow route transition
      setTimeout(() => {
        if (typeof document !== 'undefined') {
          document.body.classList.remove('page-transitioning');
        }
        onSuccess?.();
      }, 100);
      
    } catch (error) {
      if (typeof document !== 'undefined') {
        document.body.classList.remove('page-transitioning');
      }
      onError?.(error as Error);
      console.error('Navigation failed:', error);
    }
  }, [router]);
  
  return { navigateWithOptimization };
}

/**
 * Prefetch data for common routes
 */
export const routePrefetchers = {
  explorer: async (graphId?: string) => {
    // Prefetch graph data
    if (graphId) {
      try {
        const response = await fetch(`/api/brain-web/graph?graph_id=${graphId}`);
        if (response.ok) {
          const data = await response.json();
          // Store in cache for immediate use
          sessionStorage.setItem(`graph-cache-${graphId}`, JSON.stringify(data));
        }
      } catch (error) {
        console.warn('Failed to prefetch graph:', error);
      }
    }
  },
  
  chat: async (sessionId?: string) => {
    // Prefetch chat session if provided
    if (sessionId) {
      try {
        // Chat sessions are stored locally, so just validate they exist
        const sessions = localStorage.getItem('brainweb:chatSessions');
        if (sessions) {
          const parsed = JSON.parse(sessions);
          const session = parsed.find((s: any) => s.id === sessionId);
          if (session) {
            // Pre-warm any related graph data
            if (session.graphId) {
              await routePrefetchers.explorer(session.graphId);
            }
          }
        }
      } catch (error) {
        console.warn('Failed to prefetch chat session:', error);
      }
    }
  },
  
  concept: async (conceptId: string, graphId?: string) => {
    // Prefetch concept details
    try {
      const params = new URLSearchParams();
      params.set('node_id', conceptId);
      if (graphId) params.set('graph_id', graphId);
      
      const response = await fetch(`/api/brain-web/concept?${params}`);
      if (response.ok) {
        const data = await response.json();
        sessionStorage.setItem(`concept-cache-${conceptId}`, JSON.stringify(data));
      }
    } catch (error) {
      console.warn('Failed to prefetch concept:', error);
    }
  }
};

/**
 * Quick navigation helpers for common actions
 */
export const quickNav = {
  toExplorer: (graphId?: string, conceptId?: string, chatId?: string) => {
    const params = new URLSearchParams();
    if (graphId) params.set('graph_id', graphId);
    if (conceptId) params.set('select', conceptId);
    if (chatId) params.set('chat', chatId);
    return `/${params.toString() ? `?${params.toString()}` : ''}`;
  },
  
  toConcept: (conceptId: string, graphId?: string) => {
    const params = new URLSearchParams();
    if (graphId) params.set('graph_id', graphId);
    return `/concepts/${conceptId}${params.toString() ? `?${params.toString()}` : ''}`;
  },
  
  toChat: (graphId?: string, chatId?: string) => {
    const params = new URLSearchParams();
    if (graphId) params.set('graph_id', graphId);
    if (chatId) params.set('chat', chatId);
    return `/${params.toString() ? `?${params.toString()}` : ''}`;
  }
};

/**
 * Keyboard shortcuts for quick navigation
 */
export function useNavigationShortcuts(graphId?: string) {
  useEffect(() => {
    // Skip on server-side
    if (typeof window === 'undefined') return;
    
    const handleKeydown = (e: KeyboardEvent) => {
      // Only handle shortcuts when not in input/textarea/contenteditable
      const activeElement = document.activeElement;
      if (
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.getAttribute('contenteditable') === 'true'
      ) {
        return;
      }
      
      // Cmd/Ctrl + key combinations
      if (e.metaKey || e.ctrlKey) {
        switch (e.key) {
          case 'h':
            e.preventDefault();
            window.location.href = '/home';
            break;
          case 'e':
            e.preventDefault();
            window.location.href = quickNav.toExplorer(graphId);
            break;
          case 'k':
            e.preventDefault();
            // Focus search box
            const searchInput = document.querySelector('input[placeholder*="Search"]') as HTMLInputElement;
            searchInput?.focus();
            break;
        }
      }
      
      // Single key shortcuts (when not in input)
      switch (e.key) {
        case 'g':
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            window.location.href = '/gaps';
          }
          break;
        case 'r':
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            window.location.href = '/review';
          }
          break;
        case '/':
          e.preventDefault();
          // Focus search box
          const searchInput = document.querySelector('input[placeholder*="Search"]') as HTMLInputElement;
          searchInput?.focus();
          break;
      }
    };
    
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [graphId]);
}

/**
 * Optimized state persistence
 */
export const optimizedStorage = {
  // Debounced localStorage writes to avoid blocking UI
  debounceMap: new Map<string, NodeJS.Timeout>(),
  
  setItem: (key: string, value: any, delay = 100) => {
    // Skip on server-side
    if (typeof window === 'undefined') return;
    
    // Clear existing timeout
    const existingTimeout = optimizedStorage.debounceMap.get(key);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    
    // Set new timeout
    const timeout = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        optimizedStorage.debounceMap.delete(key);
      } catch (error) {
        console.warn(`Failed to save to localStorage: ${key}`, error);
      }
    }, delay);
    
    optimizedStorage.debounceMap.set(key, timeout);
  },
  
  getItem: (key: string, defaultValue: any = null) => {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch (error) {
      console.warn(`Failed to read from localStorage: ${key}`, error);
      return defaultValue;
    }
  }
};