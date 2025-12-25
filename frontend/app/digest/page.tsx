'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  getSuggestions, 
  getSuggestedPaths, 
  listProposedRelationships,
  type Suggestion,
  type SuggestedPath,
  type SuggestionType,
} from '../api-client';
import { fetchRecentSessions, fetchRecentEvents, type SessionSummary, type ActivityEvent } from '../lib/eventsClient';
import { getSavedItems, type SavedItem } from '../lib/savedItems';
import { getLastSession } from '../lib/sessionState';
import { filterSuggestions } from '../lib/suggestionPrefs';
import { markDigestOpened } from '../lib/reminders';
import { logEvent } from '../lib/eventsClient';

export default function DigestPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [reviewCount, setReviewCount] = useState<number>(0);
  const [paths, setPaths] = useState<SuggestedPath[]>([]);
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);

  useEffect(() => {
    // Mark digest as opened and log event
    markDigestOpened();
    logEvent({
      type: 'DIGEST_OPENED',
      graph_id: getLastSession()?.graph_id,
    }).catch(() => {});

    async function loadDigest() {
      try {
        setLoading(true);
        const lastSession = getLastSession();
        const graphId = lastSession?.graph_id;

        // Fetch all data in parallel (including review count)
        const [sessionsData, eventsData, suggestionsData, pathsData, reviewData] = await Promise.allSettled([
          fetchRecentSessions(20).catch(() => []),
          fetchRecentEvents({ limit: 200, graph_id: graphId }).catch(() => []),
          graphId ? getSuggestions(20, graphId).catch(() => []) : Promise.resolve([]),
          graphId ? getSuggestedPaths(graphId, undefined, 6).catch(() => []) : Promise.resolve([]),
          graphId ? listProposedRelationships(graphId, 'PROPOSED', 1, 0).catch(() => ({ total: 0 })) : Promise.resolve({ total: 0 }),
        ]);

        if (sessionsData.status === 'fulfilled') setSessions(sessionsData.value);
        if (eventsData.status === 'fulfilled') setEvents(eventsData.value);
        
        if (suggestionsData.status === 'fulfilled') {
          // Filter suggestions by user prefs
          const filtered = filterSuggestions(suggestionsData.value);
          setSuggestions(filtered.slice(0, 8));
        }

        if (pathsData.status === 'fulfilled') {
          setPaths(pathsData.value.slice(0, 3));
        }

        if (reviewData.status === 'fulfilled') {
          setReviewCount(reviewData.value.total || 0);
        }

        // Get saved items (synchronous)
        const saved = getSavedItems();
        setSavedItems(saved.slice(0, 6));
      } catch (err) {
        console.error('Failed to load digest:', err);
      } finally {
        setLoading(false);
      }
    }

    loadDigest();
  }, []);

  // Compute this week's stats
  const thisWeekStart = new Date();
  thisWeekStart.setDate(thisWeekStart.getDate() - 7);
  
  const thisWeekSessions = sessions.filter(s => new Date(s.start_at) >= thisWeekStart);
  const thisWeekEvents = events.filter(e => new Date(e.created_at) >= thisWeekStart);
  
  const conceptsViewed = thisWeekEvents.filter(e => e.type === 'CONCEPT_VIEWED').length;
  const evidenceOpened = thisWeekEvents.filter(e => e.type === 'RESOURCE_OPENED').length;
  const evidenceFetched = thisWeekEvents.filter(e => e.type === 'EVIDENCE_FETCHED').length;
  const answersCreated = thisWeekEvents.filter(e => e.type === 'ANSWER_CREATED').length;

  const handleSuggestionAction = (suggestion: Suggestion) => {
    // For quality suggestions, prefer primary_action if available
    const action = suggestion.primary_action || suggestion.action;
    
    if (action.kind === 'OPEN_CONCEPT' && suggestion.concept_id) {
      router.push(`/concepts/${suggestion.concept_id}`);
    } else if (action.kind === 'OPEN_GAPS') {
      router.push(action.href || '/gaps');
    } else if (action.kind === 'OPEN_DIGEST') {
      router.push(action.href || '/digest');
    } else if (action.kind === 'OPEN_REVIEW') {
      router.push(action.href || '/review?status=PROPOSED');
    } else if (action.href) {
      router.push(action.href);
    }
  };

  const handleStartPath = (path: SuggestedPath) => {
    const lastSession = getLastSession();
    const params = new URLSearchParams();
    if (lastSession?.graph_id) {
      params.set('graph_id', lastSession.graph_id);
    }
    params.set('path', path.path_id);
    router.push(`/?${params.toString()}`);
  };

  const handleOpenSaved = (item: SavedItem) => {
    if (item.kind === 'CONCEPT' && item.concept_id) {
      router.push(`/concepts/${item.concept_id}`);
    } else if (item.kind === 'PATH' && item.path_id) {
      const params = new URLSearchParams();
      if (item.graph_id) {
        params.set('graph_id', item.graph_id);
      }
      params.set('path', item.path_id);
      router.push(`/?${params.toString()}`);
    } else if (item.kind === 'SUGGESTION') {
      router.push('/home');
    }
  };

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--background)',
        padding: '48px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{ color: 'var(--muted)', fontSize: '16px' }}>Loading digest...</div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--background)',
      padding: '48px 24px',
    }}>
      <div style={{
        maxWidth: '1000px',
        margin: '0 auto',
      }}>
        <h1 style={{
          fontSize: '32px',
          fontWeight: '600',
          marginBottom: '32px',
          color: 'var(--ink)',
        }}>
          Digest
        </h1>

        {/* This week in Brain Web */}
        <div style={{
          marginBottom: '32px',
          padding: '24px',
          background: 'var(--surface)',
          borderRadius: '12px',
          border: '1px solid var(--border)',
        }}>
          <h2 style={{
            fontSize: '20px',
            fontWeight: '600',
            marginBottom: '16px',
            color: 'var(--ink)',
          }}>
            This week in Brain Web
          </h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '16px',
          }}>
            <div>
              <div style={{ fontSize: '24px', fontWeight: '600', color: 'var(--accent)', marginBottom: '4px' }}>
                {thisWeekSessions.length}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--muted)' }}>Sessions</div>
            </div>
            <div>
              <div style={{ fontSize: '24px', fontWeight: '600', color: 'var(--accent)', marginBottom: '4px' }}>
                {conceptsViewed}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--muted)' }}>Concepts viewed</div>
            </div>
            <div>
              <div style={{ fontSize: '24px', fontWeight: '600', color: 'var(--accent)', marginBottom: '4px' }}>
                {evidenceOpened}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--muted)' }}>Evidence opened</div>
            </div>
            <div>
              <div style={{ fontSize: '24px', fontWeight: '600', color: 'var(--accent)', marginBottom: '4px' }}>
                {evidenceFetched}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--muted)' }}>Evidence fetched</div>
            </div>
            <div>
              <div style={{ fontSize: '24px', fontWeight: '600', color: 'var(--accent)', marginBottom: '4px' }}>
                {answersCreated}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--muted)' }}>Answers created</div>
            </div>
          </div>
        </div>

        {/* Pending actions */}
        <div style={{
          marginBottom: '32px',
          padding: '24px',
          background: 'var(--surface)',
          borderRadius: '12px',
          border: '1px solid var(--border)',
        }}>
          <h2 style={{
            fontSize: '20px',
            fontWeight: '600',
            marginBottom: '16px',
            color: 'var(--ink)',
          }}>
            Pending actions
          </h2>
          {suggestions.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
              {suggestions.map((suggestion) => (
                <div
                  key={suggestion.id}
                  style={{
                    padding: '12px',
                    background: 'var(--background)',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '4px', color: 'var(--ink)' }}>
                      {suggestion.title}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                      {suggestion.rationale}
                    </div>
                  </div>
                  <button
                    onClick={() => handleSuggestionAction(suggestion)}
                    style={{
                      padding: '6px 12px',
                      background: 'var(--accent)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '13px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {suggestion.action.kind === 'OPEN_REVIEW' ? 'Review' : 'Open'}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '16px' }}>
              No pending suggestions
            </div>
          )}
          
          {/* Quality nudges subsection (max 3 items) */}
          {(() => {
            const qualityTypes: SuggestionType[] = ['COVERAGE_LOW', 'EVIDENCE_STALE', 'GRAPH_HEALTH_ISSUE', 'REVIEW_BACKLOG'];
            const qualitySuggestions = suggestions
              .filter(s => qualityTypes.includes(s.type))
              .slice(0, 3);  // Max 3 items
            
            if (qualitySuggestions.length === 0) return null;
            
            return (
              <div style={{
                marginTop: '24px',
                paddingTop: '24px',
                borderTop: '1px solid var(--border)',
              }}>
                <h3 style={{
                  fontSize: '16px',
                  fontWeight: '600',
                  marginBottom: '12px',
                  color: 'var(--ink)',
                }}>
                  Quality nudges
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {qualitySuggestions.map((suggestion) => (
                    <div
                      key={suggestion.id}
                      style={{
                        padding: '10px',
                        background: 'var(--background)',
                        borderRadius: '6px',
                        border: '1px solid var(--border)',
                        opacity: 0.85,
                      }}
                    >
                      <div style={{ 
                        display: 'flex', 
                        alignItems: 'flex-start', 
                        justifyContent: 'space-between',
                        gap: '12px',
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ 
                            fontSize: '13px', 
                            fontWeight: '500', 
                            color: 'var(--ink)',
                            marginBottom: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}>
                            {suggestion.title}
                            {suggestion.explanation && (
                              <span
                                title={suggestion.explanation}
                                style={{
                                  cursor: 'help',
                                  fontSize: '11px',
                                  color: 'var(--muted)',
                                  opacity: 0.7,
                                }}
                              >
                                ℹ️
                              </span>
                            )}
                          </div>
                          <div style={{ 
                            fontSize: '12px', 
                            color: 'var(--muted)',
                            lineHeight: '1.4',
                          }}>
                            {suggestion.explanation || suggestion.rationale}
                          </div>
                        </div>
                        {(suggestion.primary_action || suggestion.action) && (
                          <button
                            onClick={() => handleSuggestionAction(suggestion)}
                            style={{
                              flexShrink: 0,
                              padding: '6px 12px',
                              fontSize: '12px',
                              fontWeight: '500',
                              background: 'var(--accent)',
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                              opacity: 0.9,
                            }}
                          >
                            {(suggestion.primary_action || suggestion.action).kind === 'OPEN_REVIEW' 
                              ? 'Review' 
                              : (suggestion.primary_action?.label || 'Open')}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
          {reviewCount > 0 && (
            <div style={{
              padding: '12px',
              background: 'var(--background)',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--ink)' }}>
                  {reviewCount} relationship{reviewCount !== 1 ? 's' : ''} pending review
                </div>
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                  Review proposed connections
                </div>
              </div>
              <button
                onClick={() => router.push('/review?status=PROPOSED')}
                style={{
                  padding: '6px 12px',
                  background: 'var(--accent)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Review
              </button>
            </div>
          )}
        </div>

        {/* Continue paths */}
        {paths.length > 0 && (
          <div style={{
            marginBottom: '32px',
            padding: '24px',
            background: 'var(--surface)',
            borderRadius: '12px',
            border: '1px solid var(--border)',
          }}>
            <h2 style={{
              fontSize: '20px',
              fontWeight: '600',
              marginBottom: '16px',
              color: 'var(--ink)',
            }}>
              Continue paths
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {paths.map((path) => (
                <div
                  key={path.path_id}
                  style={{
                    padding: '16px',
                    background: 'var(--background)',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ fontSize: '15px', fontWeight: '600', marginBottom: '8px', color: 'var(--ink)' }}>
                    {path.title}
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '12px' }}>
                    {path.rationale}
                  </div>
                  <button
                    onClick={() => handleStartPath(path)}
                    style={{
                      padding: '8px 16px',
                      background: 'var(--accent)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '13px',
                      fontWeight: '600',
                      cursor: 'pointer',
                    }}
                  >
                    Start
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Saved for later */}
        {savedItems.length > 0 && (
          <div style={{
            marginBottom: '32px',
            padding: '24px',
            background: 'var(--surface)',
            borderRadius: '12px',
            border: '1px solid var(--border)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{
                fontSize: '20px',
                fontWeight: '600',
                color: 'var(--ink)',
                margin: 0,
              }}>
                Saved for later
              </h2>
              <Link
                href="/saved"
                style={{
                  fontSize: '13px',
                  color: 'var(--accent)',
                  textDecoration: 'none',
                  fontWeight: '500',
                }}
              >
                View all →
              </Link>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {savedItems.map((item) => (
                <div
                  key={item.id}
                  style={{
                    padding: '12px',
                    background: 'var(--background)',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: '500', color: 'var(--ink)' }}>
                      {item.title}
                    </div>
                  </div>
                  <button
                    onClick={() => handleOpenSaved(item)}
                    style={{
                      padding: '6px 12px',
                      background: 'var(--accent)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '13px',
                      fontWeight: '600',
                      cursor: 'pointer',
                    }}
                  >
                    Open
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

