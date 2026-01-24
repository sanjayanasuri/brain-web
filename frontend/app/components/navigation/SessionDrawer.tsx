'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { fetchRecentSessions, type SessionSummary } from '../../lib/eventsClient';
import { getLastSession } from '../../lib/sessionState';
import { useSidebar } from '../context-providers/SidebarContext';
import { getChatSessions, getChatSession, setCurrentSessionId, type ChatSession } from '../../lib/chatSessions';
import { listGraphs, type GraphSummary } from '../../api-client';
import { useOptimizedNavigation, routePrefetchers, quickNav, useNavigationShortcuts, optimizedStorage } from '../../lib/navigationUtils';
import { useEnhancedNavigation } from '../../lib/navigationHelpers';
import { clearChatStateIfAvailable, closeMobileSidebarIfAvailable, registerMobileSidebarCloseFunction } from '../../lib/globalNavigationState';

// Todo List Component
function TodoList({ onToggleCollapse }: { onToggleCollapse?: () => void }) {
  // Always initialize with empty array to match server render (prevent hydration mismatch)
  const [todos, setTodos] = useState<Array<{ id: string; text: string; completed: boolean }>>([]);
  const [newTodo, setNewTodo] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [isMounted, setIsMounted] = useState(false);

  // Load todos from localStorage after mount (client-only)
  useEffect(() => {
    setIsMounted(true);
    if (typeof window === 'undefined') return;
    
    try {
      const savedTodos = localStorage.getItem('brain-web-todos');
      if (savedTodos) {
        const parsed = JSON.parse(savedTodos);
        if (Array.isArray(parsed)) {
          setTodos(parsed);
        }
      }
    } catch (e) {
      console.error('Failed to load todos:', e);
    }
  }, []);

  // Save todos to localStorage whenever they change (but skip initial empty state)
  useEffect(() => {
    if (typeof window === 'undefined' || !isMounted) return;
    
    // Use optimized storage with debouncing
    optimizedStorage.setItem('brain-web-todos', todos, 300);
  }, [todos, isMounted]);

  const addTodo = () => {
    if (newTodo.trim()) {
      const todo = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        text: newTodo.trim(),
        completed: false,
      };
      const newTodos = [...todos, todo];
      setTodos(newTodos);
      setNewTodo('');
      // Immediate save for user feedback
      optimizedStorage.setItem('brain-web-todos', newTodos, 0);
    }
  };

  const toggleTodo = (id: string) => {
    const newTodos = todos.map(todo => 
      todo.id === id ? { ...todo, completed: !todo.completed } : todo
    );
    setTodos(newTodos);
    optimizedStorage.setItem('brain-web-todos', newTodos, 0);
  };

  const deleteTodo = (id: string) => {
    const newTodos = todos.filter(todo => todo.id !== id);
    setTodos(newTodos);
    optimizedStorage.setItem('brain-web-todos', newTodos, 0);
  };

  const startEdit = (id: string, text: string) => {
    setEditingId(id);
    setEditText(text);
  };

  const saveEdit = (id: string) => {
    if (editText.trim()) {
      const newTodos = todos.map(todo => 
        todo.id === id ? { ...todo, text: editText.trim() } : todo
      );
      setTodos(newTodos);
      optimizedStorage.setItem('brain-web-todos', newTodos, 0);
    }
    setEditingId(null);
    setEditText('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        <h2 style={{ fontSize: 'clamp(15px, 2vw, 17px)', fontWeight: '600', margin: 0 }}>Todo</h2>
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '4px',
              color: 'var(--muted)',
              fontSize: '14px',
            }}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            ←
          </button>
        )}
      </div>

      {/* Todo List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {/* Add Todo Input */}
        <div style={{ marginBottom: '16px', display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={newTodo}
            onChange={(e) => setNewTodo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                addTodo();
              }
            }}
            placeholder="Add a task..."
            style={{
              flex: 1,
              padding: '8px 12px',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              fontSize: 'clamp(13px, 1.8vw, 14px)',
              background: 'var(--surface)',
              color: 'var(--ink)',
              outline: 'none',
            }}
          />
          <button
            onClick={addTodo}
            style={{
              padding: '8px 12px',
              background: 'var(--accent)',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: '500',
            }}
          >
            Add
          </button>
        </div>

        {/* Todo Items */}
        {todos.length === 0 ? (
          <div style={{ 
            color: 'var(--muted)', 
            fontSize: 'clamp(13px, 1.8vw, 14px)', 
            textAlign: 'center', 
            padding: '20px',
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            No tasks yet. Add one above!
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {todos.map((todo) => (
              <div
                key={todo.id}
                style={{
                  padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  background: todo.completed ? 'var(--surface)' : 'var(--background)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  opacity: todo.completed ? 0.6 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={todo.completed}
                  onChange={() => toggleTodo(todo.id)}
                  style={{
                    cursor: 'pointer',
                    width: '16px',
                    height: '16px',
                  }}
                />
                {editingId === todo.id ? (
                  <div style={{ flex: 1, display: 'flex', gap: '4px' }}>
                    <input
                      type="text"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          saveEdit(todo.id);
                        } else if (e.key === 'Escape') {
                          cancelEdit();
                        }
                      }}
                      style={{
                        flex: 1,
                        padding: '4px 8px',
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        fontSize: '13px',
                        background: 'var(--surface)',
                        color: 'var(--ink)',
                        outline: 'none',
                      }}
                      autoFocus
                    />
                    <button
                      onClick={() => saveEdit(todo.id)}
                      style={{
                        padding: '4px 8px',
                        background: 'var(--accent)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '11px',
                      }}
                    >
                      ✓
                    </button>
                    <button
                      onClick={cancelEdit}
                      style={{
                        padding: '4px 8px',
                        background: 'transparent',
                        color: 'var(--muted)',
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '11px',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <>
                    <div
                      onClick={() => startEdit(todo.id, todo.text)}
                      style={{
                        flex: 1,
                      fontSize: 'clamp(13px, 1.8vw, 14px)',
                      color: 'var(--ink)',
                      textDecoration: todo.completed ? 'line-through' : 'none',
                      cursor: 'pointer',
                      }}
                    >
                      {todo.text}
                    </div>
                    <button
                      onClick={() => deleteTodo(todo.id)}
                      style={{
                        padding: '4px 8px',
                        background: 'transparent',
                        color: 'var(--muted)',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '12px',
                        borderRadius: '4px',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--surface)';
                        e.currentTarget.style.color = 'var(--accent-2)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = 'var(--muted)';
                      }}
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface SessionDrawerProps {
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function SessionDrawer({ isCollapsed = false, onToggleCollapse }: SessionDrawerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { isMobileSidebarOpen, setIsMobileSidebarOpen } = useSidebar();
  const { navigateWithOptimization } = useOptimizedNavigation();
  const [recentSessions, setRecentSessions] = useState<SessionSummary[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSession, setLastSession] = useState<{ graph_id?: string; concept_id?: string } | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [activeGraphId, setActiveGraphId] = useState<string>('');
  const [graphs, setGraphs] = useState<GraphSummary[]>([]);
  
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

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const sessions = await fetchRecentSessions(10);
        setRecentSessions(sessions);
        const localLastSession = getLastSession();
        setLastSession(localLastSession);
        
        // Load graphs to get active graph
        const graphsData = await listGraphs();
        setActiveGraphId(graphsData.active_graph_id || '');
        setGraphs(graphsData.graphs || []);
        
        // Load chat sessions
        const chats = getChatSessions();
        // Sort by updatedAt descending
        const sortedChats = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
        setChatSessions(sortedChats.slice(0, 10));
      } catch (err) {
        console.warn('Failed to load sessions:', err);
        setRecentSessions([]);
      } finally {
        setLoading(false);
      }
    }
    loadData();
    
    // Refresh chat sessions periodically
    const interval = setInterval(() => {
      const chats = getChatSessions();
      const sortedChats = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
      setChatSessions(sortedChats.slice(0, 10));
    }, 2000);
    
    return () => clearInterval(interval);
  }, []);

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
    const graph = graphs.find(g => g.graph_id === graphId);
    return graph?.name || graphId;
  };
  
  // Find the most recent session for the graph we want to display
  const getMostRecentGraphInfo = () => {
    const targetGraphId = mostRecentGraphSession?.graph_id || activeGraphId;
    if (!targetGraphId) return null;
    
    // Find all sessions for this graph
    const graphSessions = recentSessions.filter(s => s.graph_id === targetGraphId);
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
          <TodoList onToggleCollapse={() => setIsMobileSidebarOpen(false)} />
          <div style={{ padding: '16px', borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Quick Links
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div
                onClick={enhancedNav.navigateToHome}
                className={`nav-link ${pathname === '/home' ? 'active' : ''}`}
                style={{ cursor: 'pointer' }}
              >
                Home
              </div>
              <Link
                href={`/?graph_id=${activeGraphId || 'default'}`}
                onClick={() => setIsMobileSidebarOpen(false)}
                className={`nav-link ${pathname === '/' ? 'active' : ''}`}
              >
                Explorer
              </Link>
              <Link
                href="/gaps"
                onClick={() => setIsMobileSidebarOpen(false)}
                className={`nav-link ${pathname === '/gaps' ? 'active' : ''}`}
              >
                Gaps
              </Link>
              <Link
                href="/review"
                onClick={() => setIsMobileSidebarOpen(false)}
                className={`nav-link ${pathname === '/review' ? 'active' : ''}`}
              >
                Review
              </Link>
              <Link
                href="/digest"
                onClick={() => setIsMobileSidebarOpen(false)}
                className={`nav-link ${pathname === '/digest' ? 'active' : ''}`}
              >
                Digest
              </Link>
              <Link
                href="/saved"
                onClick={() => setIsMobileSidebarOpen(false)}
                className={`nav-link ${pathname === '/saved' ? 'active' : ''}`}
              >
                Saved
              </Link>
              <Link
                href="/source-management"
                onClick={() => setIsMobileSidebarOpen(false)}
                className={`nav-link ${pathname === '/source-management' ? 'active' : ''}`}
              >
                Source Management
              </Link>
              <Link
                href="/profile-customization"
                onClick={() => setIsMobileSidebarOpen(false)}
                className={`nav-link ${pathname === '/profile-customization' ? 'active' : ''}`}
              >
                Profile Customization
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
            padding: '8px',
            borderRadius: '6px',
            color: pathname === '/home' ? 'var(--accent)' : 'var(--muted)',
            fontSize: '20px',
            textDecoration: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title="Home"
        >
          🏠
        </Link>
        <Link
          href="/"
          style={{
            padding: '8px',
            borderRadius: '6px',
            color: pathname === '/' ? 'var(--accent)' : 'var(--muted)',
            fontSize: '20px',
            textDecoration: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title="Explorer"
        >
          🗺️
        </Link>
        <Link
          href="/gaps"
          style={{
            padding: '8px',
            borderRadius: '6px',
            color: pathname === '/gaps' ? 'var(--accent)' : 'var(--muted)',
            fontSize: '20px',
            textDecoration: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title="Gaps"
        >
          ⚠️
        </Link>
        <Link
          href="/review"
          style={{
            padding: '8px',
            borderRadius: '6px',
            color: pathname === '/review' ? 'var(--accent)' : 'var(--muted)',
            fontSize: '20px',
            textDecoration: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title="Review"
        >
          ✓
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
      overflowY: 'auto',
      flexShrink: 0,
    }}>
      {/* Todo List Section */}
      <TodoList onToggleCollapse={onToggleCollapse} />

      {/* Quick Links Section */}
      <div style={{ 
        padding: '16px', 
        borderTop: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{ 
          fontSize: 'clamp(12px, 1.6vw, 13px)', 
          fontWeight: '600', 
          color: 'var(--muted)', 
          marginBottom: '8px', 
          textTransform: 'uppercase', 
          letterSpacing: '0.5px' 
        }}>
          Quick Links
        </div>
        <div className="nav-section-content">
          <div
            onClick={enhancedNav.navigateToHome}
            className={`nav-link ${pathname === '/home' ? 'active' : ''}`}
            style={{ cursor: 'pointer' }}
          >
            Home
          </div>
          <Link
            href="/"
            className={`nav-link ${pathname === '/' ? 'active' : ''}`}
          >
            Explorer
          </Link>
          <Link
            href="/gaps"
            className={`nav-link ${pathname === '/gaps' ? 'active' : ''}`}
          >
            Gaps
          </Link>
          <Link
            href="/review"
            className={`nav-link ${pathname === '/review' ? 'active' : ''}`}
          >
            Review
          </Link>
          <Link
            href="/ingest"
            className={`nav-link ${pathname === '/ingest' ? 'active' : ''}`}
          >
            Upload PDF
          </Link>
          <Link
            href="/source-management"
            className={`nav-link ${pathname === '/source-management' ? 'active' : ''}`}
          >
            Source Management
          </Link>
          <Link
            href="/profile-customization"
            className={`nav-link ${pathname === '/profile-customization' ? 'active' : ''}`}
          >
            Profile Customization
          </Link>
          <Link
            href="/control-panel"
            className={`nav-link ${pathname === '/control-panel' ? 'active' : ''}`}
          >
            Workspace Library
          </Link>
        </div>
      </div>
    </div>
  );
}

