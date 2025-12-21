'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { fetchRecentSessions, type SessionSummary } from '../../lib/eventsClient';
import { getLastSession } from '../../lib/sessionState';
import { useSidebar } from '../context-providers/SidebarContext';

interface SessionDrawerProps {
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function SessionDrawer({ isCollapsed = false, onToggleCollapse }: SessionDrawerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { isMobileSidebarOpen, setIsMobileSidebarOpen } = useSidebar();
  const [recentSessions, setRecentSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSession, setLastSession] = useState<{ graph_id?: string; concept_id?: string } | null>(null);
  const [isMobile, setIsMobile] = useState(false);

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
      } catch (err) {
        console.warn('Failed to load sessions:', err);
        setRecentSessions([]);
      } finally {
        setLoading(false);
      }
    }
    loadData();
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

  const handleResume = () => {
    const mostRecentSession = recentSessions[0];
    if (mostRecentSession) {
      navigateToExplorer({
        conceptId: mostRecentSession.last_concept_id,
        graphId: mostRecentSession.graph_id,
      });
    } else if (lastSession?.concept_id) {
      navigateToExplorer({ conceptId: lastSession.concept_id, graphId: lastSession.graph_id });
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

  const hasLastSession = recentSessions.length > 0 || (lastSession && (lastSession.concept_id || lastSession.graph_id));
  const sessionGroups = groupSessionsByDate(recentSessions);

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
          {/* Mobile header with close button */}
          <div style={{
            padding: '16px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <h2 style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>Sessions</h2>
            <button
              onClick={() => setIsMobileSidebarOpen(false)}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: '4px',
                color: 'var(--muted)',
                fontSize: '18px',
              }}
            >
              ×
            </button>
          </div>
          {/* Rest of sidebar content - reuse the same structure */}
          {hasLastSession && (
            <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Continue
              </div>
              <button
                onClick={() => {
                  handleResume();
                  setIsMobileSidebarOpen(false);
                }}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  background: 'var(--accent)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Resume last
              </button>
            </div>
          )}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--muted)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Sessions
            </div>
            {loading ? (
              <div style={{ color: 'var(--muted)', fontSize: '13px', padding: '8px' }}>Loading...</div>
            ) : sessionGroups.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: '13px', padding: '8px' }}>No recent sessions</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {sessionGroups.map((group) => (
                  <div key={group.label}>
                    <div style={{ fontSize: '11px', fontWeight: '600', color: 'var(--muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {group.label}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {group.sessions.map((session) => (
                        <div
                          key={session.session_id}
                          onClick={() => {
                            handleResumeSession(session);
                            setIsMobileSidebarOpen(false);
                          }}
                          style={{
                            padding: '10px',
                            borderRadius: '8px',
                            border: '1px solid var(--border)',
                            cursor: 'pointer',
                            transition: 'background 0.2s',
                            background: 'var(--background)',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'var(--surface)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'var(--background)';
                          }}
                        >
                          <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>
                            {formatSessionTimeRange(session.start_at, session.end_at)}
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '6px' }}>
                            {session.summary}
                          </div>
                          {session.top_concepts.length > 0 && (
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '6px' }}>
                              {session.top_concepts.slice(0, 2).map((concept) => (
                                <span
                                  key={concept.concept_id}
                                  style={{
                                    fontSize: '10px',
                                    padding: '2px 6px',
                                    background: 'var(--surface)',
                                    borderRadius: '4px',
                                    color: 'var(--ink)',
                                    border: '1px solid var(--border)',
                                  }}
                                >
                                  {concept.concept_name || concept.concept_id}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
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
                href="/"
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
          title="Expand sidebar"
        >
          →
        </button>
        <div style={{ width: '100%', height: '1px', background: 'var(--border)' }} />
        {hasLastSession && (
          <button
            onClick={handleResume}
            style={{
              background: 'var(--accent)',
              border: 'none',
              cursor: 'pointer',
              padding: '8px',
              borderRadius: '6px',
              color: 'white',
              fontSize: '16px',
              width: '40px',
              height: '40px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Resume last session"
          >
            ↻
          </button>
        )}
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
      width: '260px',
      background: 'var(--panel)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <h2 style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>Sessions</h2>
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
          title="Collapse sidebar"
        >
          ←
        </button>
      </div>

      {/* Continue Section */}
      {hasLastSession && (
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Continue
          </div>
          <button
            onClick={handleResume}
            style={{
              width: '100%',
              padding: '10px 16px',
              background: 'var(--accent)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            Resume last
          </button>
        </div>
      )}

      {/* Sessions Section */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--muted)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Sessions
        </div>
        {loading ? (
          <div style={{ color: 'var(--muted)', fontSize: '13px', padding: '8px' }}>Loading...</div>
        ) : sessionGroups.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: '13px', padding: '8px' }}>No recent sessions</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {sessionGroups.map((group) => (
              <div key={group.label}>
                <div style={{ fontSize: '11px', fontWeight: '600', color: 'var(--muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {group.label}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {group.sessions.map((session) => (
                    <div
                      key={session.session_id}
                      onClick={() => handleResumeSession(session)}
                      style={{
                        padding: '10px',
                        borderRadius: '8px',
                        border: '1px solid var(--border)',
                        cursor: 'pointer',
                        transition: 'background 0.2s',
                        background: 'var(--background)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--surface)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'var(--background)';
                      }}
                    >
                      <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>
                        {formatSessionTimeRange(session.start_at, session.end_at)}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '6px' }}>
                        {session.summary}
                      </div>
                      {session.top_concepts.length > 0 && (
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '6px' }}>
                          {session.top_concepts.slice(0, 2).map((concept) => (
                            <span
                              key={concept.concept_id}
                              style={{
                                fontSize: '10px',
                                padding: '2px 6px',
                                background: 'var(--surface)',
                                borderRadius: '4px',
                                color: 'var(--ink)',
                                border: '1px solid var(--border)',
                              }}
                            >
                              {concept.concept_name || concept.concept_id}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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
        </div>
      </div>
    </div>
  );
}

