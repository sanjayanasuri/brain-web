'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { fetchRecentSessions, type SessionSummary } from '../../lib/eventsClient';
import { getLastSession } from '../../lib/sessionState';
import { useSidebar } from '../context-providers/SidebarContext';
import { getChatSessions, getChatSession, setCurrentSessionId, type ChatSession } from '../../lib/chatSessions';
import { listGraphs, type GraphSummary } from '../../api-client';

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
    
    try {
      const todosToSave = JSON.stringify(todos);
      localStorage.setItem('brain-web-todos', todosToSave);
      console.log('[TodoList] Saved todos to localStorage:', todos.length, 'items');
    } catch (e) {
      console.error('Failed to save todos:', e);
      // If storage is full, try to clear old data
      if (e instanceof DOMException && e.code === 22) {
        console.warn('[TodoList] Storage quota exceeded, clearing old todos');
        try {
          // Keep only last 50 todos
          const trimmed = todos.slice(-50);
          localStorage.setItem('brain-web-todos', JSON.stringify(trimmed));
          setTodos(trimmed);
        } catch (clearErr) {
          console.error('[TodoList] Failed to clear old todos:', clearErr);
        }
      }
    }
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
      // Force immediate save
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('brain-web-todos', JSON.stringify(newTodos));
          console.log('[TodoList] Immediately saved new todo');
        } catch (e) {
          console.error('[TodoList] Failed to immediately save todo:', e);
        }
      }
    }
  };

  const toggleTodo = (id: string) => {
    const newTodos = todos.map(todo => 
      todo.id === id ? { ...todo, completed: !todo.completed } : todo
    );
    setTodos(newTodos);
    // Force immediate save
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('brain-web-todos', JSON.stringify(newTodos));
      } catch (e) {
        console.error('[TodoList] Failed to save toggle:', e);
      }
    }
  };

  const deleteTodo = (id: string) => {
    const newTodos = todos.filter(todo => todo.id !== id);
    setTodos(newTodos);
    // Force immediate save
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('brain-web-todos', JSON.stringify(newTodos));
      } catch (e) {
        console.error('[TodoList] Failed to save delete:', e);
      }
    }
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
      // Force immediate save
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('brain-web-todos', JSON.stringify(newTodos));
        } catch (e) {
          console.error('[TodoList] Failed to save edit:', e);
        }
      }
    }
    setEditingId(null);
    setEditText('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <h2 style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>Todo</h2>
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
              fontSize: '13px',
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
          <div style={{ color: 'var(--muted)', fontSize: '13px', textAlign: 'center', padding: '20px' }}>
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
                        fontSize: '13px',
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
  const [recentSessions, setRecentSessions] = useState<SessionSummary[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSession, setLastSession] = useState<{ graph_id?: string; concept_id?: string } | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [activeGraphId, setActiveGraphId] = useState<string>('');
  const [graphs, setGraphs] = useState<GraphSummary[]>([]);

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

  const navigateToExplorer = (params?: { conceptId?: string; graphId?: string; chat?: string }) => {
    const queryParams = new URLSearchParams();
    if (params?.conceptId) {
      queryParams.set('select', params.conceptId);
    }
    if (params?.graphId) {
      queryParams.set('graph_id', params.graphId);
    }
    if (params?.chat) {
      queryParams.set('chat', params.chat);
    }
    const queryString = queryParams.toString();
    router.push(`/${queryString ? `?${queryString}` : ''}`);
  };

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

  const handleLoadChatSession = (chatSession: ChatSession) => {
    // Set as current session and navigate to explorer with chat
    setCurrentSessionId(chatSession.id);
    navigateToExplorer({
      graphId: chatSession.graphId,
      chat: chatSession.id, // Pass session ID to load it
    });
  };

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
              <Link
                href="/home"
                onClick={() => setIsMobileSidebarOpen(false)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  color: pathname === '/home' ? 'var(--accent)' : 'var(--ink)',
                  fontSize: '14px',
                  textDecoration: 'none',
                  background: pathname === '/home' ? 'var(--surface)' : 'transparent',
                }}
              >
                Home
              </Link>
              <Link
                href={`/?graph_id=${activeGraphId || 'default'}`}
                onClick={() => setIsMobileSidebarOpen(false)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  color: pathname === '/' ? 'var(--accent)' : 'var(--ink)',
                  fontSize: '14px',
                  textDecoration: 'none',
                  background: pathname === '/' ? 'var(--surface)' : 'transparent',
                }}
              >
                Explorer
              </Link>
              <Link
                href="/gaps"
                onClick={() => setIsMobileSidebarOpen(false)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  color: pathname === '/gaps' ? 'var(--accent)' : 'var(--ink)',
                  fontSize: '14px',
                  textDecoration: 'none',
                  background: pathname === '/gaps' ? 'var(--surface)' : 'transparent',
                }}
              >
                Gaps
              </Link>
              <Link
                href="/review"
                onClick={() => setIsMobileSidebarOpen(false)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  color: pathname === '/review' ? 'var(--accent)' : 'var(--ink)',
                  fontSize: '14px',
                  textDecoration: 'none',
                  background: pathname === '/review' ? 'var(--surface)' : 'transparent',
                }}
              >
                Review
              </Link>
              <Link
                href="/digest"
                onClick={() => setIsMobileSidebarOpen(false)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  color: pathname === '/digest' ? 'var(--accent)' : 'var(--ink)',
                  fontSize: '14px',
                  textDecoration: 'none',
                  background: pathname === '/digest' ? 'var(--surface)' : 'transparent',
                }}
              >
                Digest
              </Link>
              <Link
                href="/saved"
                onClick={() => setIsMobileSidebarOpen(false)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  color: pathname === '/saved' ? 'var(--accent)' : 'var(--ink)',
                  fontSize: '14px',
                  textDecoration: 'none',
                  background: pathname === '/saved' ? 'var(--surface)' : 'transparent',
                }}
              >
                Saved
              </Link>
              <Link
                href="/source-management"
                onClick={() => setIsMobileSidebarOpen(false)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  color: pathname === '/source-management' ? 'var(--accent)' : 'var(--ink)',
                  fontSize: '14px',
                  textDecoration: 'none',
                  background: pathname === '/source-management' ? 'var(--surface)' : 'transparent',
                }}
              >
                Source Management
              </Link>
              <Link
                href="/profile-customization"
                onClick={() => setIsMobileSidebarOpen(false)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  color: pathname === '/profile-customization' ? 'var(--accent)' : 'var(--ink)',
                  fontSize: '14px',
                  textDecoration: 'none',
                  background: pathname === '/profile-customization' ? 'var(--surface)' : 'transparent',
                }}
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
      height: '100%',
      overflowY: 'auto',
      flexShrink: 0,
    }}>
      {/* Todo List Section */}
      <TodoList onToggleCollapse={onToggleCollapse} />

      {/* Quick Links Section */}
      <div style={{ padding: '16px', borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Quick Links
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <Link
            href="/home"
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              color: pathname === '/home' ? 'var(--accent)' : 'var(--ink)',
              fontSize: '14px',
              textDecoration: 'none',
              background: pathname === '/home' ? 'var(--surface)' : 'transparent',
            }}
          >
            Home
          </Link>
          <Link
            href="/"
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              color: pathname === '/' ? 'var(--accent)' : 'var(--ink)',
              fontSize: '14px',
              textDecoration: 'none',
              background: pathname === '/' ? 'var(--surface)' : 'transparent',
            }}
          >
            Explorer
          </Link>
          <Link
            href="/gaps"
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              color: pathname === '/gaps' ? 'var(--accent)' : 'var(--ink)',
              fontSize: '14px',
              textDecoration: 'none',
              background: pathname === '/gaps' ? 'var(--surface)' : 'transparent',
            }}
          >
            Gaps
          </Link>
          <Link
            href="/review"
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              color: pathname === '/review' ? 'var(--accent)' : 'var(--ink)',
              fontSize: '14px',
              textDecoration: 'none',
              background: pathname === '/review' ? 'var(--surface)' : 'transparent',
            }}
          >
            Review
          </Link>
          <Link
            href="/source-management"
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              color: pathname === '/source-management' ? 'var(--accent)' : 'var(--ink)',
              fontSize: '14px',
              textDecoration: 'none',
              background: pathname === '/source-management' ? 'var(--surface)' : 'transparent',
            }}
          >
            Source Management
          </Link>
          <Link
            href="/profile-customization"
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              color: pathname === '/profile-customization' ? 'var(--accent)' : 'var(--ink)',
              fontSize: '14px',
              textDecoration: 'none',
              background: pathname === '/profile-customization' ? 'var(--surface)' : 'transparent',
            }}
          >
            Profile Customization
          </Link>
          <Link
            href="/control-panel"
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              color: pathname === '/control-panel' ? 'var(--accent)' : 'var(--ink)',
              fontSize: '14px',
              textDecoration: 'none',
              background: pathname === '/control-panel' ? 'var(--surface)' : 'transparent',
            }}
          >
            Workspace Library
          </Link>
        </div>
      </div>
    </div>
  );
}

