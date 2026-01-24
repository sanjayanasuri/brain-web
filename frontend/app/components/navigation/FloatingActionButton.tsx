'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useOptimizedNavigation, quickNav, routePrefetchers } from '../../lib/navigationUtils';
import { useSidebar } from '../context-providers/SidebarContext';

interface QuickAction {
  id: string;
  label: string;
  icon: string;
  url: string;
  shortcut?: string;
  description?: string;
  prefetch?: () => Promise<void>;
}

interface FloatingActionButtonProps {
  activeGraphId?: string;
  className?: string;
}

export default function FloatingActionButton({ activeGraphId, className }: FloatingActionButtonProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  
  const router = useRouter();
  const pathname = usePathname();
  const { navigateWithOptimization } = useOptimizedNavigation();
  const { isMobileSidebarOpen, setIsMobileSidebarOpen } = useSidebar();
  
  // Memoize quick actions to prevent unnecessary re-renders
  const quickActions = useMemo<QuickAction[]>(() => [
    {
      id: 'chat',
      label: 'Quick Chat',
      icon: '💬',
      url: quickNav.toChat(activeGraphId),
      shortcut: 'c',
      description: 'Start a new conversation',
      prefetch: () => routePrefetchers.chat()
    },
    {
      id: 'explorer',
      label: 'Graph Explorer',
      icon: '🗺️',
      url: quickNav.toExplorer(activeGraphId),
      shortcut: 'e',
      description: 'Explore knowledge graph',
      prefetch: () => routePrefetchers.explorer(activeGraphId)
    },
    {
      id: 'notes',
      label: 'Take Notes',
      icon: '📝',
      url: '/home?mode=notes',
      shortcut: 'n',
      description: 'Quick note taking'
    },
    {
      id: 'search',
      label: 'Search',
      icon: '🔍',
      url: '/home', // Change to home since /search doesn't exist
      shortcut: 's',
      description: 'Go to search and home'
    }
  ], [activeGraphId]);
  
  // Handle action clicks - Define this first so it can be referenced in useEffect
  const handleActionClick = useCallback(async (action: QuickAction) => {
    console.log('FAB: handleActionClick called', action);
    setIsExpanded(false);
    
    try {
      await navigateWithOptimization(action.url, {
        prefetch: action.prefetch,
        onSuccess: () => console.log('FAB: Navigation successful to', action.url),
        onError: (error) => console.error('FAB: Navigation failed', error)
      });
    } catch (error) {
      console.error('FAB: Action click failed', error);
      // Fallback to direct navigation
      router.push(action.url);
    }
  }, [navigateWithOptimization, router]);

  // Handle scroll to show/hide FAB
  useEffect(() => {
    // Skip on server-side
    if (typeof window === 'undefined') return;
    
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const scrollingDown = currentScrollY > lastScrollY;
      const scrollingUp = currentScrollY < lastScrollY;
      
      if (scrollingDown && currentScrollY > 100) {
        setIsVisible(false);
        setIsExpanded(false);
      } else if (scrollingUp || currentScrollY < 50) {
        setIsVisible(true);
      }
      
      setLastScrollY(currentScrollY);
    };
    
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);
  
  // Handle keyboard shortcuts
  useEffect(() => {
    // Skip on server-side
    if (typeof window === 'undefined') return;
    
    const handleKeydown = (e: KeyboardEvent) => {
      // Only handle when not in input/textarea
      const activeElement = document.activeElement;
      if (
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.getAttribute('contenteditable') === 'true'
      ) {
        return;
      }
      
      // Toggle FAB with F key
      if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        console.log('FAB: Toggling expanded state');
        setIsExpanded(prev => !prev);
        return;
      }
      
      // Handle action shortcuts (works regardless of expanded state for better UX)
      const action = quickActions.find(a => 
        a.shortcut?.toLowerCase() === e.key.toLowerCase()
      );
      
      if (action && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        console.log('FAB: Executing action', action.id, action.url);
        handleActionClick(action);
        return;
      }
    };
    
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [isExpanded, quickActions, handleActionClick]);
  
  // Handle main FAB click
  const handleMainClick = useCallback(() => {
    console.log('FAB: Main click, pathname:', pathname, 'expanded:', isExpanded);
    
    if (isExpanded) {
      setIsExpanded(false);
      return;
    }
    
    if (pathname === '/') {
      // On explorer, toggle chat
      const chatUrl = quickNav.toChat(activeGraphId);
      console.log('FAB: Going to chat:', chatUrl);
      navigateWithOptimization(chatUrl, {
        prefetch: () => routePrefetchers.chat()
      });
    } else {
      // On other pages, go to explorer
      const explorerUrl = quickNav.toExplorer(activeGraphId);
      console.log('FAB: Going to explorer:', explorerUrl);
      navigateWithOptimization(explorerUrl, {
        prefetch: () => routePrefetchers.explorer(activeGraphId)
      });
    }
  }, [pathname, activeGraphId, navigateWithOptimization, isExpanded]);
  
  // Hide on mobile when sidebar is open
  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  const shouldHide = !isVisible || (isMobile && isMobileSidebarOpen);
  
  if (shouldHide) return null;
  
  return (
    <div 
      className={`fab-container ${className || ''}`}
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: '12px',
        opacity: isVisible ? 1 : 0,
        transform: `translateY(${isVisible ? 0 : 100}px)`,
        transition: 'all 300ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {/* Quick action buttons - shown when expanded */}
      {isExpanded && quickActions.map((action, index) => (
        <div
          key={action.id}
          onClick={() => handleActionClick(action)}
          className="fab-action"
          title={`${action.description} (${action.shortcut})`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px 16px',
            background: 'var(--panel)',
            borderRadius: '24px',
            border: '1px solid var(--border)',
            cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
            transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
            transform: `translateY(${isExpanded ? 0 : 20}px)`,
            opacity: isExpanded ? 1 : 0,
            transitionDelay: `${index * 50}ms`,
            fontSize: '14px',
            fontWeight: '500',
            color: 'var(--ink)',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
            e.currentTarget.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.2)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0) scale(1)';
            e.currentTarget.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.15)';
          }}
        >
          <span style={{ fontSize: '18px' }}>{action.icon}</span>
          <span>{action.label}</span>
          {action.shortcut && (
            <span style={{
              fontSize: '11px',
              color: 'var(--muted)',
              background: 'var(--surface)',
              padding: '2px 6px',
              borderRadius: '4px',
              fontFamily: 'monospace',
              textTransform: 'uppercase',
            }}>
              {action.shortcut}
            </span>
          )}
        </div>
      ))}
      
      {/* Main FAB button */}
      <button
        className="fab-nav"
        onClick={() => setIsExpanded(prev => !prev)}
        onDoubleClick={handleMainClick}
        title={isExpanded ? 'Close menu (F)' : 'Quick actions (F to expand) • Double-click for direct action'}
        style={{
          transform: isExpanded ? 'rotate(45deg)' : 'rotate(0deg)',
        }}
      >
        {isExpanded ? '✕' : (pathname === '/' ? '💬' : '🗺️')}
      </button>
      
      {/* Keyboard hint */}
      {!isExpanded && (
        <div style={{
          position: 'absolute',
          bottom: '72px',
          right: '0',
          background: 'var(--panel)',
          color: 'var(--muted)',
          padding: '6px 10px',
          borderRadius: '6px',
          fontSize: '11px',
          border: '1px solid var(--border)',
          opacity: 0,
          animation: 'fadeInUp 300ms ease forwards 2s',
          pointerEvents: 'none',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
          whiteSpace: 'nowrap',
        }}>
          F to expand • C•E•N•S for actions
        </div>
      )}
      
      {/* Expanded shortcuts hint */}
      {isExpanded && (
        <div style={{
          position: 'absolute',
          bottom: '72px',
          right: '0',
          background: 'var(--accent)',
          color: 'white',
          padding: '4px 8px',
          borderRadius: '4px',
          fontSize: '10px',
          opacity: 0.9,
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
        }}>
          Press shortcut keys
        </div>
      )}
      
      <style jsx global>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        @media (max-width: 768px) {
          .fab-container {
            bottom: 80px !important;
            right: 16px !important;
          }
          
          .fab-action {
            font-size: 13px !important;
          }
        }
        
        @media (max-width: 480px) {
          .fab-action span:last-child {
            display: none; /* Hide labels on very small screens */
          }
        }
      `}</style>
    </div>
  );
}