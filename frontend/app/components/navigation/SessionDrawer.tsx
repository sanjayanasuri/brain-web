'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { type SessionSummary } from '../../lib/eventsClient';
import { getLastSession } from '../../lib/sessionState';
import { useSidebar } from '../context-providers/SidebarContext';
import { getChatSessions, getChatSession, setCurrentSessionId, type ChatSession } from '../../lib/chatSessions';
import { type GraphSummary } from '../../api-client';
import { useOptimizedNavigation, routePrefetchers, quickNav, useNavigationShortcuts, optimizedStorage } from '../../lib/navigationUtils';
import { useEnhancedNavigation } from '../../lib/navigationHelpers';
import { clearChatStateIfAvailable, closeMobileSidebarIfAvailable, registerMobileSidebarCloseFunction } from '../../lib/globalNavigationState';
import { getUserProfile, getUIPreferences, updateUIPreferences as saveUIPreferences } from '../../api/preferences';
import { useListGraphs, useRecentSessions, useChatSessions } from '../../hooks/useAppQueries';


interface SessionDrawerProps {
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function SessionDrawer({ isCollapsed = false, onToggleCollapse }: SessionDrawerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { isMobileSidebarOpen, setIsMobileSidebarOpen } = useSidebar();
  const { navigateWithOptimization } = useOptimizedNavigation();
  const [lastSession, setLastSession] = useState<{ graph_id?: string; concept_id?: string } | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [userProfile, setUserProfile] = useState<{ name?: string } | null>(null);
  const [uiPreferences, setUIPreferences] = useState<any>(null);

  const graphsQuery = useListGraphs();
  const recentSessionsQuery = useRecentSessions(10);
  const chatSessionsQuery = useChatSessions();

  const loading = graphsQuery.isLoading || recentSessionsQuery.isLoading || chatSessionsQuery.isLoading;
  const recentSessions = recentSessionsQuery.data ?? [];
  const graphsData = graphsQuery.data;
  const activeGraphId = graphsData?.active_graph_id ?? '';
  const graphs = graphsData?.graphs ?? [];
  const chatSessions = useMemo(() => {
    const list = chatSessionsQuery.data ?? getChatSessions();
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10);
  }, [chatSessionsQuery.data]);

  // Add navigation shortcuts
  useNavigationShortcuts(activeGraphId);

  // Enhanced navigation with chat state management
  const enhancedNav = useEnhancedNavigation({
    resetChatState: clearChatStateIfAvailable,
    closeMobileSidebar: () => setIsMobileSidebarOpen(false),
    activeGraphId
  });

  // Register mobile sidebar close function for global access
  useEffect(() => {
    registerMobileSidebarCloseFunction(() => setIsMobileSidebarOpen(false));
  }, [setIsMobileSidebarOpen]);

  // Swipe Gesture Handling for iPad
  useEffect(() => {
    let touchStartX = 0;
    let touchEndX = 0;

    const handleTouchStart = (e: TouchEvent) => {
      touchStartX = e.changedTouches[0].screenX;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      touchEndX = e.changedTouches[0].screenX;
      handleSwipe();
    };

    const handleSwipe = () => {
      const swipeDistance = touchEndX - touchStartX;
      const threshold = 100;

      if (swipeDistance > threshold && isCollapsed) {
        // Swipe right to expand
        onToggleCollapse?.();
      } else if (swipeDistance < -threshold && !isCollapsed) {
        // Swipe left to collapse
        onToggleCollapse?.();
      }
    };

    document.addEventListener('touchstart', handleTouchStart);
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isCollapsed, onToggleCollapse]);

  useEffect(() => {
    const checkMobile = () => {
      // iPad counts as mobile if it's in portrait, but let's be more specific for tablets
      setIsMobile(window.innerWidth < 768 || (window.innerWidth < 1024 && 'ontouchstart' in window));
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    setLastSession(getLastSession());
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([getUserProfile(), getUIPreferences()]).then(([profileResult, uiResult]) => {
      if (cancelled) return;
      if (profileResult.status === 'fulfilled') setUserProfile(profileResult.value);
      else console.warn('Failed to load user profile:', profileResult.reason);
      if (uiResult.status === 'fulfilled') setUIPreferences(uiResult.value);
      else console.warn('Failed to load UI preferences:', uiResult.reason);
    });
    return () => { cancelled = true; };
  }, []);

  const handleUpdateUIPreferences = async (newPrefs: any) => {
    setUIPreferences(newPrefs);
    try {
      await saveUIPreferences(newPrefs);
    } catch (e) {
      console.error('Failed to save UI preferences:', e);
    }
  };

  const navigateToExplorer = useCallback(async (params?: { conceptId?: string; graphId?: string; chat?: string }) => {
    const url = quickNav.toExplorer(params?.graphId, params?.conceptId, params?.chat);

    await navigateWithOptimization(url, {
      prefetch: async () => {
        // Prefetch relevant data based on parameters
        if (params?.graphId) {
          await routePrefetchers.explorer(params.graphId);
        }
        if (params?.chat) {
          await routePrefetchers.chat(params.chat);
        }
        if (params?.conceptId && params?.graphId) {
          await routePrefetchers.concept(params.conceptId, params.graphId);
        }
      }
    });
  }, [navigateWithOptimization]);

  const handleMostRecentGraph = () => {
    const mostRecentSession = recentSessions[0];
    if (mostRecentSession?.graph_id) {
      navigateToExplorer({
        conceptId: mostRecentSession.last_concept_id,
        graphId: mostRecentSession.graph_id,
      });
    } else if (activeGraphId) {
      navigateToExplorer({ graphId: activeGraphId });
    } else {
      navigateToExplorer();
    }
  };

  const handleResumeSession = (session: SessionSummary) => {
    navigateToExplorer({
      conceptId: session.last_concept_id,
      graphId: session.graph_id,
    });
  };

  const handleLoadChatSession = useCallback(async (chatSession: ChatSession) => {
    // Set as current session and navigate to explorer with chat
    setCurrentSessionId(chatSession.id);
    await navigateToExplorer({
      graphId: chatSession.graphId,
      chat: chatSession.id, // Pass session ID to load it
    });
  }, [navigateToExplorer]);

  const formatChatSessionTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  };

  const formatSessionTimeRange = (startAt: string, endAt: string): string => {
    try {
      const start = new Date(startAt);
      const end = new Date(endAt);
      const formatTime = (date: Date): string => {
        const hours = date.getHours();
        const minutes = date.getMinutes();
        const ampm = hours >= 12 ? 'pm' : 'am';
        const displayHours = hours % 12 || 12;
        return `${displayHours}:${minutes.toString().padStart(2, '0')}${ampm}`;
      };
      return `${formatTime(start)}–${formatTime(end)}`;
    } catch (e) {
      return 'Recent session';
    }
  };

  const groupSessionsByDate = (sessions: SessionSummary[]) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const groups: { label: string; sessions: SessionSummary[] }[] = [
      { label: 'Today', sessions: [] },
      { label: 'Yesterday', sessions: [] },
      { label: 'This Week', sessions: [] },
    ];

    sessions.forEach((session) => {
      const sessionDate = new Date(session.end_at);
      const sessionDay = new Date(sessionDate.getFullYear(), sessionDate.getMonth(), sessionDate.getDate());

      if (sessionDay.getTime() === today.getTime()) {
        groups[0].sessions.push(session);
      } else if (sessionDay.getTime() === yesterday.getTime()) {
        groups[1].sessions.push(session);
      } else if (sessionDate >= weekAgo) {
        groups[2].sessions.push(session);
      }
    });

    return groups.filter(group => group.sessions.length > 0);
  };

  const sessionGroups = groupSessionsByDate(recentSessions);
  const mostRecentGraphSession = recentSessions[0];

  // Get graph name for display
  const getGraphName = (graphId?: string): string => {
    if (!graphId) return '';
    const graph = graphs.find((g: GraphSummary) => g.graph_id === graphId);
    return graph?.name || graphId;
  };

  // Find the most recent session for the graph we want to display
  const getMostRecentGraphInfo = () => {
    const targetGraphId = mostRecentGraphSession?.graph_id || activeGraphId;
    if (!targetGraphId) return null;

    // Find all sessions for this graph
    const graphSessions = recentSessions.filter((s: SessionSummary) => s.graph_id === targetGraphId);
    const latestSession = graphSessions[0] || mostRecentGraphSession;

    if (!latestSession) return null;

    return {
      name: getGraphName(targetGraphId),
      session: latestSession,
      graphId: targetGraphId,
    };
  };

  const mostRecentGraphInfo = getMostRecentGraphInfo();
  const mostRecentGraphName = mostRecentGraphInfo?.name || '';

  // Format time for graph session display
  const formatGraphSessionTime = (endAt: string): string => {
    try {
      const date = new Date(endAt);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;

      return date.toLocaleDateString();
    } catch (e) {
      return 'Recent';
    }
  };

  // On mobile, hide sidebar unless explicitly opened
  if (isMobile && !isMobileSidebarOpen) {
    return null;
  }

  // Mobile overlay
  if (isMobile && isMobileSidebarOpen) {
    return (
      <>
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            zIndex: 999,
          }}
          onClick={() => setIsMobileSidebarOpen(false)}
        />
        <div style={{
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          width: '280px',
          background: 'var(--panel)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflowY: 'auto',
          zIndex: 1000,
          boxShadow: '2px 0 8px rgba(0, 0, 0, 0.1)',
        }}>
          <div style={{ padding: '16px', borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--muted)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>
              Pillars
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <Link
                href="/home"
                onClick={() => setIsMobileSidebarOpen(false)}
                className={`nav-link ${pathname === '/home' ? 'active' : ''}`}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderRadius: '8px', textDecoration: 'none', color: 'var(--ink)' }}
              >
                <span style={{ fontWeight: pathname === '/home' ? '600' : '400' }}>Home</span>
              </Link>
              <Link
                href="/"
                onClick={() => setIsMobileSidebarOpen(false)}
                className={`nav-link ${pathname === '/' ? 'active' : ''}`}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderRadius: '8px', textDecoration: 'none', color: 'var(--ink)' }}
              >
                <span style={{ fontWeight: pathname === '/' ? '600' : '400' }}>Explorer</span>
              </Link>
              <Link
                href="/lecture-studio"
                onClick={() => setIsMobileSidebarOpen(false)}
                className={`nav-link ${pathname === '/lecture-studio' ? 'active' : ''}`}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderRadius: '8px', textDecoration: 'none', color: 'var(--ink)' }}
              >
                <span style={{ fontWeight: pathname === '/lecture-studio' ? '600' : '400' }}>Studio</span>
              </Link>
              <Link
                href="/freeform-canvas"
                onClick={() => setIsMobileSidebarOpen(false)}
                className={`nav-link ${pathname === '/freeform-canvas' ? 'active' : ''}`}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderRadius: '8px', textDecoration: 'none', color: 'var(--ink)' }}
              >
                <span style={{ fontWeight: pathname === '/freeform-canvas' ? '600' : '400' }}>Freeform</span>
              </Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (isCollapsed) {
    return (
      <div style={{
        width: '64px',
        background: 'var(--panel)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '16px 8px',
        gap: '16px',
        height: '100%',
        overflowY: 'auto',
      }}>
        <button
          onClick={onToggleCollapse}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '8px',
            borderRadius: '6px',
            color: 'var(--ink)',
            fontSize: '20px',
          }}
          aria-label="Expand sidebar"
          title="Expand sidebar"
        >
          →
        </button>
        <div style={{ width: '100%', height: '1px', background: 'var(--border)' }} />
        <Link
          href="/home"
          style={{
            padding: '10px',
            borderRadius: '10px',
            color: pathname === '/home' ? 'var(--accent)' : 'var(--muted)',
            fontSize: '22px',
            textDecoration: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: pathname === '/home' ? 'var(--surface)' : 'transparent',
          }}
          title="Home"
        >
          H
        </Link>
        <Link
          href="/"
          style={{
            padding: '10px',
            borderRadius: '10px',
            color: pathname === '/' ? 'var(--accent)' : 'var(--muted)',
            fontSize: '22px',
            textDecoration: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: pathname === '/' ? 'var(--surface)' : 'transparent',
          }}
          title="Explorer"
        >
          E
        </Link>
        <Link
          href="/lecture-studio"
          style={{
            padding: '10px',
            borderRadius: '10px',
            color: pathname === '/lecture-studio' ? 'var(--accent)' : 'var(--muted)',
            fontSize: '22px',
            textDecoration: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: pathname === '/lecture-studio' ? 'var(--surface)' : 'transparent',
          }}
          title="Studio"
        >
          U
        </Link>
        <Link
          href="/freeform-canvas"
          style={{
            padding: '10px',
            borderRadius: '10px',
            color: pathname === '/freeform-canvas' ? 'var(--accent)' : 'var(--muted)',
            fontSize: '22px',
            textDecoration: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: pathname === '/freeform-canvas' ? 'var(--surface)' : 'transparent',
          }}
          title="Freeform"
        >
          F
        </Link>
      </div>
    );
  }

  return (
    <div style={{
      width: '280px',
      background: 'var(--panel)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      overflowY: 'hidden',
      flexShrink: 0,
    }}>
      {/* Search/Home Pillar Section */}
      <div style={{ padding: '20px 16px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '12px', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          Brain Web
        </h1>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <Link
            href="/home"
            style={{
              display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderRadius: '10px',
              textDecoration: 'none', color: pathname === '/home' ? 'var(--accent)' : 'var(--ink)',
              background: pathname === '/home' ? 'var(--surface)' : 'transparent',
              fontWeight: pathname === '/home' ? '600' : '400',
              transition: 'all 0.2s ease'
            }}
          >
            <span>Home</span>
          </Link>
          <Link
            href="/"
            style={{
              display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderRadius: '10px',
              textDecoration: 'none', color: pathname === '/' ? 'var(--accent)' : 'var(--ink)',
              background: pathname === '/' ? 'var(--surface)' : 'transparent',
              fontWeight: pathname === '/' ? '600' : '400',
              transition: 'all 0.2s ease'
            }}
          >
            <span>Explorer</span>
          </Link>
          <Link
            href="/lecture-studio"
            style={{
              display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderRadius: '10px',
              textDecoration: 'none', color: pathname === '/lecture-studio' ? 'var(--accent)' : 'var(--ink)',
              background: pathname === '/lecture-studio' ? 'var(--surface)' : 'transparent',
              fontWeight: pathname === '/lecture-studio' ? '600' : '400',
              transition: 'all 0.2s ease'
            }}
          >
            <span>Studio</span>
          </Link>
          <Link
            href="/freeform-canvas"
            style={{
              display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderRadius: '10px',
              textDecoration: 'none', color: pathname === '/freeform-canvas' ? 'var(--accent)' : 'var(--ink)',
              background: pathname === '/freeform-canvas' ? 'var(--surface)' : 'transparent',
              fontWeight: pathname === '/freeform-canvas' ? '600' : '400',
              transition: 'all 0.2s ease'
            }}
          >
            <span>Freeform</span>
          </Link>
        </div>
      </div>

      <div style={{ padding: '0 16px', margin: '8px 0' }}>
        <div style={{ height: '1px', background: 'var(--border)', width: '100%' }} />
      </div>

      {/* Main Content Area (Todos/Sessions) */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      </div>

      {/* Footer / Profile */}
      <div style={{ padding: '16px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          width: '32px', height: '32px', borderRadius: '50%', background: 'var(--accent-gradient)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold', fontSize: '12px'
        }}>
          {(userProfile?.name || 'User').charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {userProfile?.name || 'User'}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--muted)' }}>Pro Member</div>
        </div>
        <Link href="/profile-customization" style={{ color: 'var(--muted)', fontSize: '13px', fontWeight: 'bold' }} title="Settings">Settings</Link>
      </div>
    </div>
  );
}
