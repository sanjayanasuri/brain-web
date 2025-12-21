'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import TopBar from '../components/topbar/TopBar';
import { fetchRecentSessions, type SessionSummary } from '../lib/eventsClient';
import { listGraphs, type GraphSummary } from '../api-client';

type DayGroup = 'today' | 'yesterday' | 'thisWeek' | 'older';
type TypeFilter = 'all' | 'concept' | 'evidence' | 'answer' | 'path';

interface TimelineItem {
  type: 'concept' | 'evidence' | 'answer' | 'path';
  id: string;
  label: string;
  session: SessionSummary;
  concept_id?: string;
  resource_id?: string;
  answer_id?: string;
  path_id?: string;
  path_title?: string;
}

export default function HistoryPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [graphs, setGraphs] = useState<GraphSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDayGroup, setSelectedDayGroup] = useState<DayGroup>('today');
  const [selectedGraphId, setSelectedGraphId] = useState<string>('all');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<TypeFilter>('all');
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError(null);
        const [sessionsData, graphsData] = await Promise.all([
          fetchRecentSessions(50),
          listGraphs(),
        ]);
        setSessions(sessionsData);
        setGraphs(graphsData.graphs);
      } catch (err) {
        console.error('Failed to load history:', err);
        setError(err instanceof Error ? err.message : 'Failed to load history');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Group sessions by day
  const groupedSessions = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const thisWeekStart = new Date(today);
    thisWeekStart.setDate(thisWeekStart.getDate() - 7);

    const groups: Record<DayGroup, SessionSummary[]> = {
      today: [],
      yesterday: [],
      thisWeek: [],
      older: [],
    };

    sessions.forEach((session) => {
      try {
        const sessionDate = new Date(session.end_at);
        const sessionDay = new Date(sessionDate.getFullYear(), sessionDate.getMonth(), sessionDate.getDate());

        if (sessionDay.getTime() === today.getTime()) {
          groups.today.push(session);
        } else if (sessionDay.getTime() === yesterday.getTime()) {
          groups.yesterday.push(session);
        } else if (sessionDate >= thisWeekStart) {
          groups.thisWeek.push(session);
        } else {
          groups.older.push(session);
        }
      } catch (e) {
        // Skip invalid dates
      }
    });

    return groups;
  }, [sessions]);

  // Filter sessions by graph and type
  const filteredSessions = useMemo(() => {
    let filtered = groupedSessions[selectedDayGroup];

    // Filter by graph
    if (selectedGraphId !== 'all') {
      filtered = filtered.filter((s) => s.graph_id === selectedGraphId);
    }

    // Filter by type (if not 'all', only show sessions with that type of highlight)
    if (selectedTypeFilter !== 'all') {
      filtered = filtered.filter((s) => {
        if (!s.highlights) return false;
        switch (selectedTypeFilter) {
          case 'concept':
            return s.highlights.concepts && s.highlights.concepts.length > 0;
          case 'evidence':
            // Evidence is tracked via RESOURCE_OPENED events, check counts
            return s.counts.resources_opened > 0;
          case 'answer':
            return s.highlights.answers && s.highlights.answers.length > 0;
          case 'path':
            return s.highlights.paths && s.highlights.paths.length > 0;
          default:
            return true;
        }
      });
    }

    return filtered;
  }, [groupedSessions, selectedDayGroup, selectedGraphId, selectedTypeFilter]);

  // Build timeline items from session highlights
  const buildTimelineItems = (session: SessionSummary): TimelineItem[] => {
    const items: TimelineItem[] = [];

    // Add concepts (from highlights)
    if (session.highlights?.concepts) {
      session.highlights.concepts.forEach((concept) => {
        items.push({
          type: 'concept',
          id: concept.concept_id,
          label: concept.concept_name || concept.concept_id,
          session,
          concept_id: concept.concept_id,
        });
      });
    }

    // Add paths (from highlights)
    if (session.highlights?.paths) {
      session.highlights.paths.forEach((path) => {
        items.push({
          type: 'path',
          id: path.path_id,
          label: path.title || path.path_id,
          session,
          path_id: path.path_id,
          path_title: path.title,
        });
      });
    }

    // Add answers (from highlights)
    if (session.highlights?.answers) {
      session.highlights.answers.forEach((answer) => {
        items.push({
          type: 'answer',
          id: answer.answer_id,
          label: 'Answer created',
          session,
          answer_id: answer.answer_id,
        });
      });
    }

    // Add evidence (from highlights) - only if concept_id is available
    if (session.highlights?.evidence) {
      session.highlights.evidence.forEach((evidence) => {
        // Only add evidence items that have a concept_id (reader requires it)
        if (evidence.concept_id) {
          items.push({
            type: 'evidence',
            id: evidence.resource_id,
            label: evidence.resource_title || 'Evidence opened',
            session,
            resource_id: evidence.resource_id,
            concept_id: evidence.concept_id,
          });
        }
      });
    }

    return items.slice(0, 8); // Max 8 items per session
  };

  // Format time range
  const formatTimeRange = (startAt: string, endAt: string): string => {
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
    } catch {
      return 'Recent session';
    }
  };

  // Get graph name
  const getGraphName = (graphId?: string): string => {
    if (!graphId) return 'Unknown graph';
    const graph = graphs.find((g) => g.graph_id === graphId);
    return graph?.name || graphId;
  };

  // Navigation handlers
  const handleConceptClick = (conceptId: string, graphId?: string) => {
    const params = new URLSearchParams();
    params.set('select', conceptId);
    if (graphId) {
      params.set('graph_id', graphId);
    }
    router.push(`/?${params.toString()}`);
  };

  const handleEvidenceClick = (resourceId: string, conceptId?: string, graphId?: string) => {
    const params = new URLSearchParams();
    params.set('resource_id', resourceId);
    if (conceptId) {
      params.set('concept_id', conceptId);
    }
    if (graphId) {
      params.set('graph_id', graphId);
    }
    router.push(`/reader?${params.toString()}`);
  };

  const handleAnswerClick = (answerId: string, session: SessionSummary) => {
    // Navigate to explorer with the last concept from that session
    const params = new URLSearchParams();
    if (session.last_concept_id) {
      params.set('select', session.last_concept_id);
    }
    if (session.graph_id) {
      params.set('graph_id', session.graph_id);
    }
    // Note: We can't scroll to a specific message yet, but we can navigate to the graph
    router.push(`/?${params.toString()}`);
  };

  const handlePathClick = (pathId: string, session: SessionSummary) => {
    const params = new URLSearchParams();
    params.set('path', pathId);
    if (session.graph_id) {
      params.set('graph_id', session.graph_id);
    }
    if (session.last_concept_id) {
      params.set('select', session.last_concept_id);
    }
    router.push(`/?${params.toString()}`);
  };

  const handleResumeSession = (session: SessionSummary) => {
    const params = new URLSearchParams();
    if (session.graph_id) {
      params.set('graph_id', session.graph_id);
    }
    // Prefer path if exists, then answer, then concept
    if (session.highlights?.paths?.[0]?.path_id) {
      params.set('path', session.highlights.paths[0].path_id);
      if (session.last_concept_id) {
        params.set('select', session.last_concept_id);
      }
    } else if (session.highlights?.answers?.[0]?.answer_id) {
      if (session.last_concept_id) {
        params.set('select', session.last_concept_id);
      }
    } else if (session.last_concept_id) {
      params.set('select', session.last_concept_id);
    }
    router.push(`/?${params.toString()}`);
  };

  const toggleSessionExpanded = (sessionId: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  };

  const getTimelineIcon = (type: TimelineItem['type']): string => {
    switch (type) {
      case 'concept':
        return '🔷';
      case 'evidence':
        return '📄';
      case 'answer':
        return '💬';
      case 'path':
        return '🛤️';
      default:
        return '•';
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
        <TopBar />
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
          Loading history...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
        <TopBar />
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--error)' }}>
          Error: {error}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)' }}>
      <TopBar />
      <div style={{ display: 'flex', height: 'calc(100vh - 60px)' }}>
        {/* Left Sidebar: Day Groups */}
        <div
          style={{
            width: '200px',
            borderRight: '1px solid var(--border)',
            background: 'var(--panel)',
            padding: '24px 0',
            overflowY: 'auto',
          }}
        >
          <div style={{ padding: '0 16px', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '8px' }}>History</h2>
          </div>
          {(['today', 'yesterday', 'thisWeek', 'older'] as DayGroup[]).map((group) => {
            const count = groupedSessions[group].length;
            const isSelected = selectedDayGroup === group;
            return (
              <button
                key={group}
                onClick={() => setSelectedDayGroup(group)}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  textAlign: 'left',
                  background: isSelected ? 'var(--accent)' : 'transparent',
                  color: isSelected ? 'white' : 'var(--ink)',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: isSelected ? '600' : '400',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = 'var(--surface)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                <span style={{ textTransform: 'capitalize' }}>
                  {group === 'thisWeek' ? 'This Week' : group === 'today' ? 'Today' : group === 'yesterday' ? 'Yesterday' : 'Older'}
                </span>
                <span style={{ fontSize: '12px', opacity: 0.8 }}>{count}</span>
              </button>
            );
          })}
        </div>

        {/* Right: Sessions List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          {/* Filter Bar */}
          <div
            style={{
              display: 'flex',
              gap: '16px',
              marginBottom: '24px',
              paddingBottom: '16px',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>
                Graph
              </label>
              <select
                value={selectedGraphId}
                onChange={(e) => setSelectedGraphId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  background: 'var(--panel)',
                  color: 'var(--ink)',
                  fontSize: '14px',
                }}
              >
                <option value="all">All Graphs</option>
                {graphs.map((graph) => (
                  <option key={graph.graph_id} value={graph.graph_id}>
                    {graph.name || graph.graph_id}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>
                Type
              </label>
              <select
                value={selectedTypeFilter}
                onChange={(e) => setSelectedTypeFilter(e.target.value as TypeFilter)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  background: 'var(--panel)',
                  color: 'var(--ink)',
                  fontSize: '14px',
                }}
              >
                <option value="all">All Types</option>
                <option value="concept">Concepts</option>
                <option value="evidence">Evidence</option>
                <option value="answer">Answers</option>
                <option value="path">Paths</option>
              </select>
            </div>
          </div>

          {/* Sessions List */}
          {filteredSessions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>
              No sessions found for the selected filters.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {filteredSessions.map((session) => {
                const timelineItems = buildTimelineItems(session);
                const isExpanded = expandedSessions.has(session.session_id);
                const showAll = isExpanded && timelineItems.length > 8;

                return (
                  <div
                    key={session.session_id}
                    style={{
                      background: 'var(--panel)',
                      border: '1px solid var(--border)',
                      borderRadius: '12px',
                      padding: '20px',
                      boxShadow: 'var(--shadow)',
                    }}
                  >
                    {/* Session Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
                          <span style={{ fontSize: '14px', color: 'var(--muted)' }}>
                            {formatTimeRange(session.start_at, session.end_at)}
                          </span>
                          <span style={{ fontSize: '12px', color: 'var(--muted)' }}>•</span>
                          <span style={{ fontSize: '14px', color: 'var(--muted)' }}>
                            {getGraphName(session.graph_id)}
                          </span>
                        </div>
                        <div style={{ fontSize: '16px', fontWeight: '600', color: 'var(--ink)', marginTop: '4px' }}>
                          {session.summary}
                        </div>
                      </div>
                      <button
                        onClick={() => handleResumeSession(session)}
                        style={{
                          padding: '8px 16px',
                          background: 'var(--accent)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '14px',
                          fontWeight: '500',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.opacity = '0.9';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.opacity = '1';
                        }}
                      >
                        Resume
                      </button>
                    </div>

                    {/* Mini Timeline */}
                    {timelineItems.length > 0 && (
                      <div style={{ marginTop: '16px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          {(showAll ? timelineItems : timelineItems.slice(0, 8)).map((item) => (
                            <button
                              key={item.id}
                              onClick={() => {
                                switch (item.type) {
                                  case 'concept':
                                    handleConceptClick(item.concept_id!, item.session.graph_id);
                                    break;
                                  case 'evidence':
                                    if (item.resource_id) {
                                      handleEvidenceClick(item.resource_id, item.concept_id, item.session.graph_id);
                                    }
                                    break;
                                  case 'answer':
                                    handleAnswerClick(item.answer_id!, item.session);
                                    break;
                                  case 'path':
                                    handlePathClick(item.path_id!, item.session);
                                    break;
                                }
                              }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '6px 12px',
                                background: 'var(--surface)',
                                border: '1px solid var(--border)',
                                borderRadius: '6px',
                                fontSize: '13px',
                                color: 'var(--ink)',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'var(--accent)';
                                e.currentTarget.style.color = 'white';
                                e.currentTarget.style.borderColor = 'var(--accent)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'var(--surface)';
                                e.currentTarget.style.color = 'var(--ink)';
                                e.currentTarget.style.borderColor = 'var(--border)';
                              }}
                            >
                              <span>{getTimelineIcon(item.type)}</span>
                              <span>{item.label}</span>
                            </button>
                          ))}
                        </div>
                        {timelineItems.length > 8 && (
                          <button
                            onClick={() => toggleSessionExpanded(session.session_id)}
                            style={{
                              marginTop: '12px',
                              padding: '6px 12px',
                              background: 'transparent',
                              border: '1px solid var(--border)',
                              borderRadius: '6px',
                              fontSize: '12px',
                              color: 'var(--muted)',
                              cursor: 'pointer',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'var(--surface)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'transparent';
                            }}
                          >
                            {isExpanded ? 'Show less' : `Show all (${timelineItems.length})`}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Session Stats */}
                    <div style={{ marginTop: '12px', display: 'flex', gap: '16px', fontSize: '12px', color: 'var(--muted)' }}>
                      {session.counts.concepts_viewed > 0 && (
                        <span>{session.counts.concepts_viewed} concept{session.counts.concepts_viewed !== 1 ? 's' : ''}</span>
                      )}
                      {session.counts.resources_opened > 0 && (
                        <span>{session.counts.resources_opened} evidence</span>
                      )}
                      {session.counts.answers_created > 0 && (
                        <span>{session.counts.answers_created} answer{session.counts.answers_created !== 1 ? 's' : ''}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

