'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useOptimizedNavigation, quickNav, routePrefetchers } from '../../lib/navigationUtils';
import { useSidebar } from '../context-providers/SidebarContext';
import { useChat } from '../graph/hooks/useChatState';

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
  const { isMobileSidebarOpen, setIsMobileSidebarOpen, showVoiceAgent, setShowVoiceAgent } = useSidebar();
  const chat = useChat();

  // Draggable state - Default offset to move it away from the bottom corner
  const [position, setPosition] = useState({ x: 0, y: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const positionRef = useRef({ x: 0, y: 100 });

  // Memoize quick actions to prevent unnecessary re-renders
  const quickActions = useMemo<QuickAction[]>(() => [
    {
      id: 'voice',
      label: 'Voice Companion',
      icon: '🎙️',
      url: '#',
      shortcut: 'v',
      description: 'Open voice learning assistant'
    },
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
      url: '/lecture-editor',
      shortcut: 'n',
      description: 'Handwriting and rich notes'
    }
  ], [activeGraphId]);

  // Handle dragging
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only drag with left click
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    e.stopPropagation();
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;

      const newPos = {
        x: positionRef.current.x - dx, // Moving left increases x (offset from right)
        y: positionRef.current.y - dy  // Moving up increases y (offset from bottom)
      };

      setPosition(newPos);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      positionRef.current = position;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, position]);

  // Handle action clicks
  const handleActionClick = useCallback(async (action: QuickAction) => {
    // Prevent action if we were dragging (small threshold)
    if (isDragging) return;

    setIsExpanded(false);

    if (action.id === 'voice') {
      setShowVoiceAgent(!showVoiceAgent);
      return;
    }

    // On explorer page, toggle side chat instead of navigating to dedicated chat
    if (action.id === 'chat' && pathname === '/') {
      chat.actions.setChatCollapsed(false);
      return;
    }

    try {
      await navigateWithOptimization(action.url, {
        prefetch: action.prefetch,
        onSuccess: () => console.log('FAB: Navigation successful to', action.url),
        onError: (error) => console.error('FAB: Navigation failed', error)
      });
    } catch (error) {
      console.error('FAB: Action click failed', error);
      router.push(action.url);
    }
  }, [isDragging, showVoiceAgent, setShowVoiceAgent, pathname, chat.actions, navigateWithOptimization, router]);

  // Handle scroll to show/hide FAB
  useEffect(() => {
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
    if (typeof window === 'undefined') return;

    const handleKeydown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement;
      if (
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.getAttribute('contenteditable') === 'true'
      ) {
        return;
      }

      if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setIsExpanded(prev => !prev);
        return;
      }

      const action = quickActions.find(a =>
        a.shortcut?.toLowerCase() === e.key.toLowerCase()
      );

      if (action && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        handleActionClick(action);
        return;
      }
    };

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [isExpanded, quickActions, handleActionClick]);

  // Handle main FAB click
  const handleMainClick = useCallback(() => {
    if (isDragging) return;

    if (isExpanded) {
      setIsExpanded(false);
      return;
    }

    if (pathname === '/') {
      chat.actions.setChatCollapsed(!chat.state.isChatCollapsed);
    } else {
      const explorerUrl = quickNav.toExplorer(activeGraphId);
      navigateWithOptimization(explorerUrl, {
        prefetch: () => routePrefetchers.explorer(activeGraphId)
      });
    }
  }, [pathname, activeGraphId, navigateWithOptimization, isExpanded, chat.actions, chat.state.isChatCollapsed, isDragging]);

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
      className={`fab-container ${className || ''} ${isDragging ? 'dragging' : ''}`}
      style={{
        position: 'fixed',
        bottom: `${24 + position.y}px`,
        right: `${24 + position.x}px`,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: '12px',
        opacity: isVisible ? 1 : 0,
        transform: `translateY(${isVisible ? 0 : 100}px)`,
        transition: isDragging ? 'none' : 'all 300ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {/* Quick action buttons */}
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
        onMouseDown={handleMouseDown}
        onClick={() => !isDragging && setIsExpanded(prev => !prev)}
        onDoubleClick={handleMainClick}
        title={isDragging ? 'Dragging...' : (isExpanded ? 'Close menu (F)' : 'Quick actions (F or Drag to move)')}
        style={{
          transform: isExpanded ? 'rotate(45deg)' : 'rotate(0deg)',
          cursor: isDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          touchAction: 'none'
        }}
      >
        {isExpanded ? '✕' : (pathname === '/' ? '💬' : '🗺️')}
      </button>

      {/* Keyboard hint */}
      {!isExpanded && !isDragging && (
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
          Quick Actions
        </div>
      )}

      <style jsx global>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .fab-nav {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: var(--accent);
          color: white;
          border: none;
          box-shadow: 0 4px 20px rgba(0,0,0,0.2);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), background 0.3s ease;
        }
        .fab-nav:hover {
          transform: scale(1.1);
        }
        .dragging .fab-nav {
          background: var(--surface-vibrant);
          transform: scale(0.95);
        }

        @media (max-width: 768px) {
          .fab-container {
            bottom: 80px !important;
            right: 16px !important;
          }
        }
      `}</style>
    </div>
  );
}