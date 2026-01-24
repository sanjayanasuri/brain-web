/**
 * Navigation helpers that properly handle state transitions
 * Ensures chat state is cleared when navigating away from explorer
 */

import { useRouter, usePathname } from 'next/navigation';
import { useCallback } from 'react';
import { useOptimizedNavigation, routePrefetchers } from './navigationUtils';
import { clearChatStateIfAvailable, closeMobileSidebarIfAvailable } from './globalNavigationState';

interface NavigationContext {
  /** Function to reset chat state when leaving explorer */
  resetChatState?: () => void;
  /** Function to close mobile sidebar */
  closeMobileSidebar?: () => void;
  /** Current active graph ID */
  activeGraphId?: string;
}

/**
 * Enhanced navigation hook that properly handles state transitions
 */
export function useEnhancedNavigation(context: NavigationContext = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const { navigateWithOptimization } = useOptimizedNavigation();
  const { resetChatState = clearChatStateIfAvailable, closeMobileSidebar = closeMobileSidebarIfAvailable, activeGraphId } = context;
  
  /**
   * Navigate to home page, clearing chat state if coming from explorer
   */
  const navigateToHome = useCallback(async () => {
    console.log('Enhanced Navigation: Going to home from', pathname);
    
    // Clear chat state if navigating away from explorer
    if (pathname === '/' && resetChatState) {
      console.log('Enhanced Navigation: Clearing chat state');
      resetChatState();
    }
    
    // Close mobile sidebar if open
    closeMobileSidebar?.();
    
    // Navigate with optimization
    await navigateWithOptimization('/home', {
      prefetch: async () => {
        // Prefetch home page data
        try {
          await fetch('/api/offline/bootstrap?graph_id=default&branch_id=main');
        } catch (error) {
          console.warn('Failed to prefetch home data:', error);
        }
      },
      onSuccess: () => {
        console.log('Enhanced Navigation: Successfully navigated to home');
      }
    });
  }, [pathname, resetChatState, closeMobileSidebar, navigateWithOptimization]);
  
  /**
   * Navigate to explorer, optionally with chat/concept selection
   */
  const navigateToExplorer = useCallback(async (params?: { 
    conceptId?: string; 
    graphId?: string; 
    chat?: string; 
    clearChat?: boolean 
  }) => {
    console.log('Enhanced Navigation: Going to explorer with params', params);
    
    const queryParams = new URLSearchParams();
    const targetGraphId = params?.graphId || activeGraphId || 'default';
    
    queryParams.set('graph_id', targetGraphId);
    if (params?.conceptId) {
      queryParams.set('select', params.conceptId);
    }
    if (params?.chat) {
      queryParams.set('chat', params.chat);
    }
    
    // Clear chat state if requested
    if (params?.clearChat && resetChatState) {
      console.log('Enhanced Navigation: Clearing chat state before explorer');
      resetChatState();
    }
    
    // Close mobile sidebar if open
    closeMobileSidebar?.();
    
    const url = `/?${queryParams.toString()}`;
    
    await navigateWithOptimization(url, {
      prefetch: async () => {
        // Prefetch relevant data
        if (targetGraphId) {
          await routePrefetchers.explorer(targetGraphId);
        }
        if (params?.chat) {
          await routePrefetchers.chat(params.chat);
        }
        if (params?.conceptId && targetGraphId) {
          await routePrefetchers.concept(params.conceptId, targetGraphId);
        }
      },
      onSuccess: () => {
        console.log('Enhanced Navigation: Successfully navigated to explorer');
      }
    });
  }, [activeGraphId, resetChatState, closeMobileSidebar, navigateWithOptimization]);
  
  /**
   * Navigate to any page with proper state cleanup
   */
  const navigateToPage = useCallback(async (url: string, options: {
    clearChatState?: boolean;
    prefetch?: () => Promise<void>;
  } = {}) => {
    console.log('Enhanced Navigation: Going to page', url, 'from', pathname);
    
    // Clear chat state if navigating away from explorer and option is enabled
    if (pathname === '/' && options.clearChatState && resetChatState) {
      console.log('Enhanced Navigation: Clearing chat state');
      resetChatState();
    }
    
    // Close mobile sidebar if open
    closeMobileSidebar?.();
    
    await navigateWithOptimization(url, {
      prefetch: options.prefetch,
      onSuccess: () => {
        console.log('Enhanced Navigation: Successfully navigated to', url);
      }
    });
  }, [pathname, resetChatState, closeMobileSidebar, navigateWithOptimization]);
  
  return {
    navigateToHome,
    navigateToExplorer,
    navigateToPage,
    isInExplorer: pathname === '/'
  };
}