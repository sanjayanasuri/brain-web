'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { getGapsOverview, type GapsOverview, getSuggestions, type Suggestion, type SuggestionType, listGraphs, type GraphSummary, getSuggestedPaths, type SuggestedPath, getConcept, getNeighborsWithRelationships, getResourcesForConcept, getClaimsForConcept, getSourcesForConcept, getSegmentsByConcept, getConceptQuality, getNarrativeMetrics, type NarrativeMetricsResponse } from '../api-client';
import { fetchEvidenceForConcept } from '../lib/evidenceFetch';
import {
  getLastSession,
  getRecentConceptViews,
  getPinnedConcepts,
  getActivityEvents,
  formatRelativeTime,
  togglePinConcept,
  isConceptPinned,
  getRecentExplorationSignals,
  EXPLORATION_EVENT_TYPES,
  type LastSession,
  type RecentConceptView,
  type PinnedConcept,
  type ExplorationSignal,
} from '../lib/sessionState';
import {
  filterSuggestions,
  dismissSuggestion,
  snoozeSuggestion,
  getSuggestionPrefs,
  setSuggestionPrefs,
  SNOOZE_DURATIONS,
  type SuggestionCategoryPrefs,
} from '../lib/suggestionPrefs';
import { fetchRecentEvents, fetchRecentSessions, type ActivityEvent, type SessionSummary } from '../lib/eventsClient';
import SessionDrawer from '../components/navigation/SessionDrawer';
import PathRunner from '../components/navigation/PathRunner';
import { saveItem, removeSavedItem, isItemSaved, getSavedItems, type SavedItemKind } from '../lib/savedItems';
import ReminderBanner from '../components/ui/ReminderBanner';
import { evaluateReminders, type ReminderBanner as ReminderBannerType, type ReminderPreferences } from '../lib/reminders';
import { getUIPreferences, listProposedRelationships, getLatestFinanceSnapshots, listFinanceTracking, getGraphQuality, type GraphQuality, listTrails, type TrailStep } from '../api-client';
import { GraphHealthBadge } from '../components/ui/QualityIndicators';
import ContinueBlock from '../components/navigation/ContinueBlock';
import { clearContinuation } from '../lib/continuation';
import NarrativeCard from '../components/home/NarrativeCard';
import CollapsibleSection from '../components/home/CollapsibleSection';
import TrailSidebar from '../components/trails/TrailSidebar';
import ResumeThinkingPrompt from '../components/trails/ResumeThinkingPrompt';
import { getActiveTrailId, setActiveTrailId, clearActiveTrailId } from '../lib/trailState';
import {
  type NarrativeItem,
  type NarrativeSection,
  SECTION_TITLE,
  CTA,
  mapGapToNarrative,
  mapSuggestionToNarrative,
  calculateNarrativeScore,
  buildExplorerUrl,
} from '../lib/homeNarrative';
import { useTheme } from '../components/context-providers/ThemeProvider';

function SkeletonLine({ width, height = 10 }: { width: string | number; height?: number }) {
  return <div className="skeleton skeleton-line" style={{ width, height }} />;
}

function SkeletonCard({ height }: { height: number }) {
  return <div className="skeleton skeleton-card" style={{ height }} />;
}

// Overflow menu component for suggestions
function SuggestionOverflowMenu({
  suggestion,
  onDismiss,
  onSnooze1Day,
  onSnooze1Week,
}: {
  suggestion: Suggestion;
  onDismiss: () => void;
  onSnooze1Day: () => void;
  onSnooze1Week: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div style={{ position: 'relative' }} ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--muted)',
          cursor: 'pointer',
          padding: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '16px',
          lineHeight: 1,
        }}
        title="More options"
      >
        ⋯
      </button>
      {isOpen && (
        <div style={{
          position: 'absolute',
          top: '100%',
          right: 0,
          marginTop: '4px',
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          boxShadow: 'var(--shadow)',
          zIndex: 100,
          minWidth: '140px',
          overflow: 'hidden',
        }}>
          <button
            onClick={() => {
              onDismiss();
              setIsOpen(false);
            }}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              textAlign: 'left',
              fontSize: '12px',
              cursor: 'pointer',
              color: 'var(--ink)',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--background)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            Dismiss
          </button>
          <button
            onClick={() => {
              onSnooze1Day();
              setIsOpen(false);
            }}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              textAlign: 'left',
              fontSize: '12px',
              cursor: 'pointer',
              color: 'var(--ink)',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--background)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            Snooze 1 day
          </button>
          <button
            onClick={() => {
              onSnooze1Week();
              setIsOpen(false);
            }}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              textAlign: 'left',
              fontSize: '12px',
              cursor: 'pointer',
              color: 'var(--ink)',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--background)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            Snooze 1 week
          </button>
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { theme, toggleTheme } = useTheme();
  const [lastSession, setLastSessionState] = useState<LastSession | null>(null);
  const [recentViews, setRecentViews] = useState<RecentConceptView[]>([]);
  const [pinnedConcepts, setPinnedConcepts] = useState<PinnedConcept[]>([]);
  const [gaps, setGaps] = useState<GapsOverview | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [fetchStates, setFetchStates] = useState<Record<string, { status: 'idle' | 'loading' | 'success' | 'error'; addedCount?: number; error?: string }>>({});
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const [recentSessions, setRecentSessions] = useState<SessionSummary[]>([]);
  const [recentSignals, setRecentSignals] = useState<ExplorationSignal[]>([]);
  const [signalSuggestions, setSignalSuggestions] = useState<Record<string, Suggestion[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryPrefs, setCategoryPrefs] = useState<SuggestionCategoryPrefs>(getSuggestionPrefs());
  const [showCustomizePanel, setShowCustomizePanel] = useState(false);
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null);
  const customizePanelRef = useRef<HTMLDivElement>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [suggestedPaths, setSuggestedPaths] = useState<SuggestedPath[]>([]);
  const [activePath, setActivePath] = useState<SuggestedPath | null>(null);
  const [pathsLoading, setPathsLoading] = useState(false);
  const [reminderBanner, setReminderBanner] = useState<ReminderBannerType | null>(null);
  const [graphQualities, setGraphQualities] = useState<Record<string, GraphQuality>>({});
  const [graphs, setGraphs] = useState<GraphSummary[]>([]);
  const [activeGraphId, setActiveGraphId] = useState<string>('');
  const [secondaryLoaded, setSecondaryLoaded] = useState(false);
  const [activeTrailId, setActiveTrailIdState] = useState<string | null>(null);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [narrativeMetrics, setNarrativeMetrics] = useState<NarrativeMetricsResponse>({});

  useEffect(() => {
    router.prefetch('/');
    router.prefetch('/profile-customization');
  }, [router]);

  const getCached = <T,>(key: Array<string | number | null | undefined>) => {
    const cached = queryClient.getQueryData<{ data: T; ts: number }>(key);
    return cached?.data ?? null;
  };

  const setCached = <T,>(key: Array<string | number | null | undefined>, data: T) => {
    queryClient.setQueryData(key, { data, ts: Date.now() });
  };

  const getCachedPaths = (graphId?: string | null): SuggestedPath[] => {
    if (typeof window === 'undefined') return [];
    if (!graphId) return [];
    try {
      const stored = localStorage.getItem(`brainweb:suggestedPaths:${graphId}`);
      if (!stored) return [];
      return JSON.parse(stored);
    } catch {
      return [];
    }
  };

  const setCachedPaths = (graphId: string | undefined | null, paths: SuggestedPath[]) => {
    if (typeof window === 'undefined') return;
    if (!graphId) return;
    try {
      localStorage.setItem(`brainweb:suggestedPaths:${graphId}`, JSON.stringify(paths));
    } catch {
      // Ignore localStorage errors
    }
  };

  const prefetchConceptData = useCallback((conceptId: string, conceptName?: string) => {
    if (!conceptId) return;
    queryClient.prefetchQuery({
      queryKey: ['concept', conceptId],
      queryFn: () => getConcept(conceptId),
    }).then((concept) => {
      const name = conceptName || concept?.name;
      if (name) {
        queryClient.prefetchQuery({
          queryKey: ['concept', conceptId, 'segments', name],
          queryFn: () => getSegmentsByConcept(name),
          staleTime: 30 * 60 * 1000,
        });
      }
    }).catch(() => undefined);

    queryClient.prefetchQuery({
      queryKey: ['concept', conceptId, 'neighbors-with-relationships'],
      queryFn: () => getNeighborsWithRelationships(conceptId),
    }).catch(() => undefined);

    queryClient.prefetchQuery({
      queryKey: ['concept', conceptId, 'resources'],
      queryFn: () => getResourcesForConcept(conceptId),
    }).catch(() => undefined);

    queryClient.prefetchQuery({
      queryKey: ['concept', conceptId, 'claims'],
      queryFn: () => getClaimsForConcept(conceptId),
    }).catch(() => undefined);

    queryClient.prefetchQuery({
      queryKey: ['concept', conceptId, 'sources'],
      queryFn: () => getSourcesForConcept(conceptId),
    }).catch(() => undefined);

    queryClient.prefetchQuery({
      queryKey: ['concept', conceptId, 'quality'],
      queryFn: () => getConceptQuality(conceptId),
      staleTime: 30 * 60 * 1000,
    }).catch(() => undefined);
  }, [queryClient]);

  // Close customize panel when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (customizePanelRef.current && !customizePanelRef.current.contains(event.target as Node)) {
        setShowCustomizePanel(false);
      }
    };
    if (showCustomizePanel) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showCustomizePanel]);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);
    
    // Load immediate data from localStorage (synchronous, fast)
    const cachedSession = getLastSession();
    setLastSessionState(cachedSession);
    setRecentViews(getRecentConceptViews().slice(0, 5));
    setPinnedConcepts(getPinnedConcepts());
    
    // Load cached API data immediately (synchronous, fast)
    const cachedGraphs = getCached<GraphSummary[]>(['home', 'graphs']);
    if (cachedGraphs && cachedGraphs.length > 0) {
      setGraphs(cachedGraphs);
      setSecondaryLoaded(true);
    }
    const cachedSessions = getCached<SessionSummary[]>(['home', 'recent-sessions']);
    if (cachedSessions && cachedSessions.length > 0) {
      setRecentSessions(cachedSessions);
      setSecondaryLoaded(true);
    }
    const cachedActivity = getCached<ActivityEvent[]>(['home', 'activity']);
    if (cachedActivity && cachedActivity.length > 0) {
      setActivityEvents(cachedActivity);
      setSecondaryLoaded(true);
    }
    const cachedGaps = getCached<GapsOverview | null>(['home', 'gaps']);
    if (cachedGaps) {
      setGaps(cachedGaps);
      setSecondaryLoaded(true);
    }
    const cachedSuggestions = getCached<Suggestion[]>(['home', 'suggestions']);
    if (cachedSuggestions && cachedSuggestions.length > 0) {
      setSuggestions(cachedSuggestions);
      setSecondaryLoaded(true);
    }
    const cachedPaths = getCached<SuggestedPath[]>(['home', 'paths', cachedSession?.graph_id || '']);
    if (cachedPaths && cachedPaths.length > 0) {
      setSuggestedPaths(cachedPaths);
      setSecondaryLoaded(true);
    }
    const cachedPathsLocal = getCachedPaths(cachedSession?.graph_id);
    if (cachedPathsLocal.length > 0) {
      setSuggestedPaths(cachedPathsLocal);
      setSecondaryLoaded(true);
    }
    
    // Start loading all data immediately - optimized with parallelization
    const loadAllData = async () => {
      try {
        const lastSession = cachedSession;
        const recentViews = getRecentConceptViews();
        const recentConceptIds = recentViews.slice(0, 10).map(v => v.id);
        const signals = getRecentExplorationSignals(6);
        if (isMounted) {
          setRecentSignals(signals);
        }

        const PINNED_GRAPHS_KEY = 'brainweb:pinnedGraphIds';
        const pinnedGraphIds = typeof window !== 'undefined' 
          ? JSON.parse(localStorage.getItem(PINNED_GRAPHS_KEY) || '[]')
          : [];

        // Load graphs first (needed for pathsGraphId), but in parallel with other calls
        const graphsPromise = listGraphs().catch((err) => {
          console.warn('Failed to load graphs:', err);
          return { graphs: [] };
        });

        // Start all API calls in parallel immediately - no delays
        const [
          graphsResult,
          eventsResult,
          sessionsResult,
          gapsResult,
          suggestionsResult,
          signalSuggestionsResult,
          pathsResult,
          remindersResult,
          ...qualityResults
        ] = await Promise.allSettled([
          // Graphs (load first but still parallel)
          graphsPromise,
          
          // Activity events
          fetchRecentEvents({
            limit: 20,
            graph_id: lastSession?.graph_id,
          }).catch(() => {
            // Fallback to localStorage if backend fails
            const localEvents = getActivityEvents(10);
            return localEvents.map(e => ({
              id: `local-${e.ts}`,
              user_id: 'demo',
              type: e.type as any,
              payload: e.payload,
              created_at: new Date(e.ts).toISOString(),
            }));
          }),
          
          // Recent sessions
          fetchRecentSessions(10).catch(() => []),
          
          // Gaps
          getGapsOverview(20).catch(() => null),
          
          // Regular suggestions
          getSuggestions(
            8,
            lastSession?.graph_id,
            recentConceptIds.length > 0 ? recentConceptIds : undefined
          ).catch(() => []),
          
          // Signal suggestions (if we have signals)
          signals.length > 0
            ? (async () => {
                const uniqueConceptIds = Array.from(new Set(signals.map(s => s.concept_id).filter((id): id is string => id !== undefined)));
                const allSuggestions = await getSuggestions(
                  20,
                  lastSession?.graph_id,
                  uniqueConceptIds.length > 0 ? uniqueConceptIds : undefined
                ).catch(() => []);
                
                // Match suggestions to signals by concept_id
                const matched: Record<string, Suggestion[]> = {};
                signals.forEach(signal => {
                  const matchedForConcept = allSuggestions
                    .filter(s => s.concept_id === signal.concept_id)
                    .slice(0, 1); // Take first suggestion per concept
                  if (matchedForConcept.length > 0) {
                    matched[signal.concept_id] = matchedForConcept;
                  }
                });
                return matched;
              })().catch(() => ({}))
            : Promise.resolve({}),
          
          // Suggested paths (wait for graphs to resolve first)
          (async () => {
            try {
              const graphsData = await graphsPromise;
              const pathsGraphId = lastSession?.graph_id || graphsData.graphs?.[0]?.graph_id;
              if (!pathsGraphId) return [];
              if (isMounted) {
                setPathsLoading(true);
              }
              const paths = await getSuggestedPaths(pathsGraphId, undefined, 3);
              // Filter out dismissed paths
              const dismissed = getDismissedPaths(pathsGraphId);
              return paths.filter(p => !dismissed.includes(p.path_id));
            } catch (err) {
              console.warn('Failed to load suggested paths:', err);
              return [];
            }
          })(),
          
          // Reminders evaluation (run in parallel, don't block main content)
          (async () => {
            try {
              const reminderDefaults: ReminderPreferences = {
                weekly_digest: { enabled: false, day_of_week: 1, hour: 9 },
                review_queue: { enabled: false, cadence_days: 3 },
                finance_stale: { enabled: false, cadence_days: 7 },
              };
              let reminderPrefs = reminderDefaults;
              try {
                const uiPrefs = await getUIPreferences();
                if (uiPrefs?.reminders) {
                  reminderPrefs = { ...reminderDefaults, ...uiPrefs.reminders };
                }
              } catch (err) {
                console.warn('Failed to load UI preferences for reminders:', err);
              }
              
              // Get proposed relationships count
              let proposedCount = 0;
              try {
                if (lastSession?.graph_id) {
                  const reviewData = await listProposedRelationships(lastSession.graph_id, 'PROPOSED', 1, 0);
                  proposedCount = reviewData.total || 0;
                }
              } catch (err) {
                console.warn('Failed to load proposed relationships for reminders:', err);
              }
              
              // Check for stale finance snapshots
              let hasStaleSnapshots = false;
              try {
                if (reminderPrefs.finance_stale?.enabled) {
                  const trackingList = await listFinanceTracking();
                  if (trackingList && trackingList.length > 0) {
                    const tickers = trackingList.map(t => t.ticker);
                    const snapshots = await getLatestFinanceSnapshots(tickers);
                    // Check if any snapshot is stale (older than 7 days by default)
                    const staleThreshold = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
                    hasStaleSnapshots = snapshots.some(s => {
                      if (!s.snapshot_fetched_at) return true;
                      const age = Date.now() - new Date(s.snapshot_fetched_at).getTime();
                      return age > staleThreshold;
                    });
                  }
                }
              } catch (err) {
                console.warn('Failed to check finance snapshots for reminders:', err);
              }
              
              const banner = await evaluateReminders(reminderPrefs, proposedCount, hasStaleSnapshots);
              return banner;
            } catch (err) {
              console.warn('Failed to evaluate reminders:', err);
              return null;
            }
          })(),
          
          // Graph quality checks (now truly parallel with other calls)
          ...pinnedGraphIds.slice(0, 5).map((graphId: string) =>
            getGraphQuality(graphId)
              .then(quality => ({ graphId, quality }))
              .catch(err => {
                console.warn(`Failed to load quality for graph ${graphId}:`, err);
                return null;
              })
          ),
        ]);
        
        // Process results immediately as they come in
        if (graphsResult.status === 'fulfilled' && isMounted) {
          const graphsData = graphsResult.value;
          setGraphs(graphsData.graphs || []);
          setActiveGraphId(graphsData.active_graph_id || '');
          setCached(['home', 'graphs'], graphsData.graphs || []);
        }
        
        if (eventsResult.status === 'fulfilled' && isMounted) {
          setActivityEvents(eventsResult.value);
          setCached(['home', 'activity'], eventsResult.value);
        }
        
        if (sessionsResult.status === 'fulfilled' && isMounted) {
          setRecentSessions(sessionsResult.value);
          setCached(['home', 'recent-sessions'], sessionsResult.value);
        }
        
        if (gapsResult.status === 'fulfilled' && isMounted) {
          setGaps(gapsResult.value);
          setCached(['home', 'gaps'], gapsResult.value);
        }
        
        if (suggestionsResult.status === 'fulfilled' && isMounted) {
          setSuggestions(suggestionsResult.value);
          setCached(['home', 'suggestions'], suggestionsResult.value);
        }
        
        if (signalSuggestionsResult.status === 'fulfilled' && isMounted) {
          setSignalSuggestions(signalSuggestionsResult.value);
        }
        
        // Fetch narrative metrics for all concept IDs from gaps and suggestions
        if (isMounted && (gapsResult.status === 'fulfilled' || suggestionsResult.status === 'fulfilled')) {
          const conceptIds: string[] = [];
          
          // Collect concept IDs from suggestions
          if (suggestionsResult.status === 'fulfilled') {
            suggestionsResult.value.forEach(s => {
              if (s.concept_id) {
                conceptIds.push(s.concept_id);
              }
            });
          }
          
          // Collect concept IDs from gaps
          if (gapsResult.status === 'fulfilled' && gapsResult.value) {
            gapsResult.value.high_interest_low_coverage.forEach(g => conceptIds.push(g.node_id));
            gapsResult.value.missing_descriptions.forEach(g => conceptIds.push(g.node_id));
            gapsResult.value.low_connectivity.forEach(g => conceptIds.push(g.node_id));
          }
          
          // Fetch metrics for unique concept IDs
          if (conceptIds.length > 0) {
            const uniqueConceptIds = Array.from(new Set(conceptIds));
            getNarrativeMetrics(uniqueConceptIds, lastSession?.graph_id)
              .then(metrics => {
                if (isMounted) {
                  setNarrativeMetrics(metrics);
                }
              })
              .catch(err => {
                console.warn('Failed to load narrative metrics:', err);
                // Use empty metrics object as fallback
                if (isMounted) {
                  setNarrativeMetrics({});
                }
              });
          }
        }
        
        if (pathsResult.status === 'fulfilled' && isMounted) {
          const graphsData = await graphsPromise.catch(() => ({ graphs: [] }));
          const pathsGraphId = lastSession?.graph_id || graphsData.graphs?.[0]?.graph_id;
          setSuggestedPaths(pathsResult.value);
          setCached(['home', 'paths', pathsGraphId || ''], pathsResult.value);
          setCachedPaths(pathsGraphId, pathsResult.value);
        }
        
        if (isMounted) {
          setPathsLoading(false);
        }
        
        if (remindersResult.status === 'fulfilled' && isMounted) {
          setReminderBanner(remindersResult.value);
        }
        
        // Process graph quality results (already loaded in parallel above)
        if (isMounted) {
          const qualityMap: Record<string, GraphQuality> = {};
          qualityResults.forEach(result => {
            if (result.status === 'fulfilled' && result.value) {
              qualityMap[result.value.graphId] = result.value.quality;
            }
          });
          setGraphQualities(qualityMap);
          setSecondaryLoaded(true);
        }
        
        // Check for active trail to show resume prompt
        if (isMounted && !getActiveTrailId()) {
          try {
            const trailsResult = await listTrails('active', 1).catch(() => ({ trails: [] }));
            if (trailsResult.trails && trailsResult.trails.length > 0) {
              setShowResumePrompt(true);
            }
          } catch (err) {
            // Ignore errors
          }
        }
        
        // Mark loading as complete
        if (isMounted) {
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load dashboard');
          setLoading(false);
          setSecondaryLoaded(true);
        }
      }
    };

    // Start loading all data immediately - no delays, fully parallelized
    loadAllData();

    return () => {
      isMounted = false;
    };
  }, []);

  // Sync category prefs from localStorage
  useEffect(() => {
    setCategoryPrefs(getSuggestionPrefs());
  }, []);

  // Filter suggestions based on user preferences
  const prioritizedSuggestionsRaw = filterSuggestions(suggestions);
  
  // Separate quality suggestions (max 2) from regular suggestions
  const qualityTypes: SuggestionType[] = ['COVERAGE_LOW', 'EVIDENCE_STALE', 'GRAPH_HEALTH_ISSUE', 'REVIEW_BACKLOG'];
  const qualitySuggestions = prioritizedSuggestionsRaw
    .filter(s => qualityTypes.includes(s.type))
    .slice(0, 2);  // Max 2 quality-based items
  const regularSuggestions = prioritizedSuggestionsRaw
    .filter(s => !qualityTypes.includes(s.type));
  
  // Keep original order for suggestions
  const prioritizedRegularSuggestions = [...regularSuggestions];
  
  // Combine quality suggestions (first) with prioritized regular suggestions
  const prioritizedSuggestions = [...qualitySuggestions, ...prioritizedRegularSuggestions];
  
  const filteredSignalSuggestions: Record<string, Suggestion[]> = {};
  Object.entries(signalSuggestions).forEach(([conceptId, suggestionsList]) => {
    const filtered = filterSuggestions(suggestionsList);
    if (filtered.length > 0) {
      filteredSignalSuggestions[conceptId] = filtered;
    }
  });

  const handleDismissSuggestion = (id: string, type?: SuggestionType) => {
    dismissSuggestion(id, type);
    setSuggestions(prev => prev.filter(s => s.id !== id));
    setSignalSuggestions(prev => {
      const updated: Record<string, Suggestion[]> = {};
      Object.entries(prev).forEach(([conceptId, suggestionsList]) => {
        const filtered = suggestionsList.filter(s => s.id !== id);
        if (filtered.length > 0) {
          updated[conceptId] = filtered;
        }
      });
      return updated;
    });
    setDismissedMessage('Dismissed');
    setTimeout(() => setDismissedMessage(null), 2000);
  };

  const handleSnoozeSuggestion = (id: string, durationMs: number) => {
    snoozeSuggestion(id, durationMs);
    setSuggestions(prev => prev.filter(s => s.id !== id));
    setSignalSuggestions(prev => {
      const updated: Record<string, Suggestion[]> = {};
      Object.entries(prev).forEach(([conceptId, suggestionsList]) => {
        const filtered = suggestionsList.filter(s => s.id !== id);
        if (filtered.length > 0) {
          updated[conceptId] = filtered;
        }
      });
      return updated;
    });
    const durationLabel = durationMs === SNOOZE_DURATIONS.ONE_DAY ? '1 day' : '1 week';
    setDismissedMessage(`Snoozed for ${durationLabel}`);
    setTimeout(() => setDismissedMessage(null), 2000);
  };

  const handleToggleCategory = (category: keyof SuggestionCategoryPrefs) => {
    const newPrefs = { ...categoryPrefs, [category]: !categoryPrefs[category] };
    setCategoryPrefs(newPrefs);
    setSuggestionPrefs(newPrefs);
  };

  const navigateToExplorer = (params?: { conceptId?: string; graphId?: string; chat?: string; path?: string }) => {
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
    if (params?.path) {
      queryParams.set('path', params.path);
    }
    const queryString = queryParams.toString();
    router.push(`/${queryString ? `?${queryString}` : ''}`);
  };

  const handleResume = () => {
    // Use most recent session if available, otherwise fall back to localStorage
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
    // Save last state to localStorage for restoration
    const lastState = {
      session_id: session.session_id,
      graph_id: session.graph_id,
      concept_id: session.last_concept_id,
      path_id: session.highlights?.paths?.[0]?.path_id,
      answer_id: session.highlights?.answers?.[0]?.answer_id,
      timestamp: Date.now(),
    };
    localStorage.setItem(`brainweb:sessions:last_state:${session.session_id}`, JSON.stringify(lastState));
    
    // Navigate to graph with appropriate state
    const params: { conceptId?: string; graphId?: string; chat?: string; path?: string } = {
      graphId: session.graph_id,
    };
    
    // Prefer path if exists, then answer, then concept
    if (session.highlights?.paths?.[0]?.path_id) {
      params.path = session.highlights.paths[0].path_id;
      if (session.last_concept_id) {
        params.conceptId = session.last_concept_id;
      }
    } else if (session.highlights?.answers?.[0]?.answer_id) {
      // For answers, we'll navigate to graph and let chat handle scrolling
      params.conceptId = session.last_concept_id;
    } else if (session.last_concept_id) {
      params.conceptId = session.last_concept_id;
    }
    
    navigateToExplorer(params);
  };
  
  const formatSessionTime = (isoString: string): string => {
    if (!isoString) return 'unknown';
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);
      
      if (diffMins < 1) return 'just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays}d ago`;
      const diffWeeks = Math.floor(diffDays / 7);
      if (diffWeeks < 4) return `${diffWeeks}w ago`;
      const diffMonths = Math.floor(diffDays / 30);
      return `${diffMonths}mo ago`;
    } catch {
      return 'unknown';
    }
  };

  // Format session time range
  const formatSessionTimeRange = (startAt: string, endAt: string): string => {
    try {
      const start = new Date(startAt);
      const end = new Date(endAt);
      const now = new Date();
      
      const startDate = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const endDate = new Date(end.getFullYear(), end.getMonth(), end.getDate());
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      
      const formatTime = (date: Date): string => {
        const hours = date.getHours();
        const minutes = date.getMinutes();
        const ampm = hours >= 12 ? 'pm' : 'am';
        const displayHours = hours % 12 || 12;
        return `${displayHours}:${minutes.toString().padStart(2, '0')}${ampm}`;
      };
      
      if (startDate.getTime() === today.getTime()) {
        // Today
        return `Today ${formatTime(start)}–${formatTime(end)}`;
      } else if (startDate.getTime() === yesterday.getTime()) {
        // Yesterday
        return `Yesterday ${formatTime(start)}–${formatTime(end)}`;
      } else {
        // This week or older
        const daysAgo = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysAgo <= 7) {
          const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const dayName = dayNames[start.getDay()];
          return `${dayName} ${formatTime(start)}–${formatTime(end)}`;
        } else {
          return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${formatTime(start)}–${formatTime(end)}`;
        }
      }
    } catch (e) {
      return 'Recent session';
    }
  };

  const handleOpenExplorer = () => {
    navigateToExplorer();
  };

  const handleConceptClick = (conceptId: string) => {
    navigateToExplorer({ conceptId });
  };

  const handleGapOpen = (nodeId: string) => {
    navigateToExplorer({ conceptId: nodeId });
  };

  const handleGapAsk = (conceptName: string) => {
    const prompt = `Help me resolve ${conceptName}.`;
    navigateToExplorer({ chat: prompt });
  };

  const handleTogglePin = (concept: { id: string; name: string }) => {
    const lastSession = getLastSession();
    togglePinConcept(concept, lastSession?.graph_id);
    setPinnedConcepts(getPinnedConcepts());
  };

  const handleStartPath = (path: SuggestedPath) => {
    setActivePath(path);
    // Clear any continuation for this path
    clearContinuation(`resume_path_${path.path_id}`);
    // Navigate to explorer with the first step selected
    navigateToExplorer({ conceptId: path.start_concept_id });
  };

  const handlePathResume = async (pathId: string) => {
    // Load the path from API and set it as active
    const lastSession = getLastSession();
    if (lastSession?.graph_id) {
      try {
        const paths = await getSuggestedPaths(lastSession.graph_id, undefined, 50);
        const path = paths.find(p => p.path_id === pathId);
        if (path) {
          setActivePath(path);
          // Clear continuation for this path
          clearContinuation(`resume_path_${pathId}`);
          // Navigate to explorer with the first step selected
          navigateToExplorer({ conceptId: path.start_concept_id });
        }
      } catch (err) {
        console.warn('Failed to load path for resumption:', err);
      }
    }
  };

  const handlePathStepSelect = (conceptId: string) => {
    navigateToExplorer({ conceptId });
  };

  const handlePathExit = () => {
    setActivePath(null);
  };

  // localStorage utilities for dismissed paths
  const getDismissedPaths = (graphId: string): string[] => {
    if (typeof window === 'undefined') return [];
    try {
      const key = `brainweb:paths:dismissed:${graphId}`;
      const stored = localStorage.getItem(key);
      if (!stored) return [];
      return JSON.parse(stored);
    } catch {
      return [];
    }
  };

  const dismissPath = (graphId: string, pathId: string) => {
    if (typeof window === 'undefined') return;
    try {
      const key = `brainweb:paths:dismissed:${graphId}`;
      const dismissed = getDismissedPaths(graphId);
      if (!dismissed.includes(pathId)) {
        dismissed.push(pathId);
        localStorage.setItem(key, JSON.stringify(dismissed));
      }
    } catch {
      // Ignore errors
    }
  };

  const handleDismissPath = (pathId: string) => {
    const lastSession = getLastSession();
    if (lastSession?.graph_id) {
      dismissPath(lastSession.graph_id, pathId);
      setSuggestedPaths(prev => prev.filter(p => p.path_id !== pathId));
    }
  };

  const handleRegeneratePaths = async () => {
    const lastSession = getLastSession();
    if (lastSession?.graph_id) {
      setPathsLoading(true);
      try {
        const paths = await getSuggestedPaths(lastSession.graph_id, undefined, 3);
        // Filter out dismissed paths
        const dismissed = getDismissedPaths(lastSession.graph_id);
        const filtered = paths.filter(p => !dismissed.includes(p.path_id));
        setSuggestedPaths(filtered);
      } catch (err) {
        console.warn('Failed to regenerate paths:', err);
      } finally {
        setPathsLoading(false);
      }
    }
  };

  const handleSuggestionAction = async (suggestion: Suggestion) => {
    // For quality suggestions, prefer primary_action if available
    const action = suggestion.primary_action || suggestion.action;
    
    if (action.kind === 'OPEN_CONCEPT') {
      if (suggestion.concept_id) {
        // In Finance lens, add a query param to indicate we should open Finance tab
        // The explorer will check this and route accordingly
        const params = new URLSearchParams();
        params.set('select', suggestion.concept_id);
        if (suggestion.graph_id) {
          params.set('graph_id', suggestion.graph_id);
        }
        router.push(`/?${params.toString()}`);
      } else if (action.href) {
        router.push(action.href);
      }
    } else if (action.kind === 'OPEN_REVIEW') {
      if (action.href) {
        router.push(action.href);
      } else {
        router.push('/review?status=PROPOSED');
      }
    } else if (action.kind === 'OPEN_GAPS') {
      if (action.href) {
        router.push(action.href);
      } else {
        router.push('/gaps');
      }
    } else if (action.kind === 'OPEN_DIGEST') {
      if (action.href) {
        router.push(action.href);
      } else {
        router.push('/digest');
      }
    } else if (action.kind === 'FETCH_EVIDENCE') {
      if (suggestion.concept_id && suggestion.concept_name) {
        const conceptId = suggestion.concept_id;
        setFetchStates(prev => ({ ...prev, [conceptId]: { status: 'loading' } }));
        try {
          const result = await fetchEvidenceForConcept(conceptId, suggestion.concept_name, suggestion.graph_id);
          if (result.error) {
            setFetchStates(prev => ({
              ...prev,
              [conceptId]: { status: 'error', error: result.error },
            }));
          } else {
            setFetchStates(prev => ({
              ...prev,
              [conceptId]: { status: 'success', addedCount: result.addedCount },
            }));
            // Optionally refresh suggestions after fetch
            setTimeout(() => {
              const lastSession = getLastSession();
              const recentViews = getRecentConceptViews();
              const recentConceptIds = recentViews.slice(0, 10).map(v => v.id);
              getSuggestions(8, lastSession?.graph_id, recentConceptIds.length > 0 ? recentConceptIds : undefined)
                .then(setSuggestions)
                .catch(console.warn);
            }, 1000);
          }
        } catch (error) {
          setFetchStates(prev => ({
            ...prev,
            [conceptId]: { status: 'error', error: error instanceof Error ? error.message : 'Failed to fetch evidence' },
          }));
        }
      }
    }
  };

  const getSuggestionTypeLabel = (type: string): string => {
    switch (type) {
      case 'GAP_DEFINE':
        return 'Gap';
      case 'GAP_EVIDENCE':
        return 'Evidence';
      case 'REVIEW_RELATIONSHIPS':
        return 'Review';
      case 'STALE_EVIDENCE':
        return 'Evidence';
      case 'RECENT_LOW_COVERAGE':
        return 'Recent';
      case 'COVERAGE_LOW':
        return 'Quality';
      case 'EVIDENCE_STALE':
        return 'Quality';
      case 'GRAPH_HEALTH_ISSUE':
        return 'Quality';
      case 'REVIEW_BACKLOG':
        return 'Quality';
      default:
        return 'Action';
    }
  };
  
  const isQualitySuggestion = (suggestion: Suggestion): boolean => {
    const qualityTypes: SuggestionType[] = ['COVERAGE_LOW', 'EVIDENCE_STALE', 'GRAPH_HEALTH_ISSUE', 'REVIEW_BACKLOG'];
    return qualityTypes.includes(suggestion.type);
  };

  const getSuggestionActionLabel = (suggestion: Suggestion | { action: { kind: string }; type?: string; primary_action?: { label?: string } }): string => {
    // For quality suggestions, use primary_action label if available
    if ('primary_action' in suggestion && suggestion.primary_action?.label) {
      return suggestion.primary_action.label;
    }
    
    const actionKind = suggestion.action.kind;
    
    const suggestionType = 'type' in suggestion ? suggestion.type : undefined;
    
    switch (actionKind) {
      case 'OPEN_CONCEPT':
        return 'Open';
      case 'OPEN_REVIEW':
        return 'Review';
      case 'FETCH_EVIDENCE':
        return 'Fetch Evidence';
      case 'OPEN_GAPS':
        return 'View Gaps';
      case 'OPEN_DIGEST':
        return 'Open Digest';
      default:
        return 'Action';
    }
  };


  if (loading) {
    return (
      <div style={{ 
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--page-bg)',
      }}>
        <div style={{ fontSize: '18px', color: 'var(--muted)' }}>Loading dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ 
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '16px',
        background: 'var(--page-bg)',
      }}>
        <div style={{ fontSize: '18px', color: 'var(--accent-2)' }}>{error}</div>
        <Link href="/" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
          ← Back to Explorer
        </Link>
      </div>
    );
  }

  // Use most recent session for Continue card, fall back to localStorage
  const mostRecentSession = recentSessions[0];
  const hasLastSession = mostRecentSession || (lastSession && (lastSession.concept_id || lastSession.graph_id));

  // Transform gaps and suggestions into narrative items
  const buildNarrativeItems = (): NarrativeItem[] => {
    const items: NarrativeItem[] = [];
    
    // Map suggestions to "takingShape" section
    prioritizedSuggestions.forEach(suggestion => {
      const narrative = mapSuggestionToNarrative(suggestion);
      const metrics = suggestion.concept_id ? narrativeMetrics[suggestion.concept_id] : null;
      items.push({
        ...narrative,
        recencyWeight: metrics?.recencyWeight ?? 0.5,
        mentionFrequency: metrics?.mentionFrequency ?? 0.3,
        centralityDelta: metrics?.centralityDelta ?? 0.2,
      });
    });
    
    // Map gaps to appropriate sections
    if (gaps) {
      // High interest low coverage -> takingShape
      gaps.high_interest_low_coverage.slice(0, 3).forEach(gap => {
        const narrative = mapGapToNarrative({ ...gap, type: 'high_interest_low_coverage' });
        const metrics = narrativeMetrics[gap.node_id];
        items.push({
          id: `gap-${gap.node_id}`,
          ...narrative,
          section: 'takingShape',
          recencyWeight: metrics?.recencyWeight ?? 0.6,
          mentionFrequency: metrics?.mentionFrequency ?? 0.4,
          centralityDelta: metrics?.centralityDelta ?? 0.3,
        });
      });
      
      // Missing descriptions -> unsettled
      gaps.missing_descriptions.slice(0, 3).forEach(gap => {
        const narrative = mapGapToNarrative({ ...gap, type: 'missing_description' });
        const metrics = narrativeMetrics[gap.node_id];
        items.push({
          id: `gap-${gap.node_id}`,
          ...narrative,
          section: 'unsettled',
          recencyWeight: metrics?.recencyWeight ?? 0.3,
          mentionFrequency: metrics?.mentionFrequency ?? 0.2,
          centralityDelta: metrics?.centralityDelta ?? 0.1,
        });
      });
      
      // Low connectivity -> unsettled
      gaps.low_connectivity.slice(0, 2).forEach(gap => {
        const narrative = mapGapToNarrative({ ...gap, type: 'low_connectivity' });
        const metrics = narrativeMetrics[gap.node_id];
        items.push({
          id: `gap-${gap.node_id}`,
          ...narrative,
          section: 'unsettled',
          recencyWeight: metrics?.recencyWeight ?? 0.3,
          mentionFrequency: metrics?.mentionFrequency ?? 0.2,
          centralityDelta: metrics?.centralityDelta ?? 0.1,
        });
      });
    }
    
    // Sort by section priority, then by score
    const sectionOrder: NarrativeSection[] = ['takingShape', 'unsettled'];
    items.sort((a, b) => {
      const aSectionIdx = sectionOrder.indexOf(a.section);
      const bSectionIdx = sectionOrder.indexOf(b.section);
      if (aSectionIdx !== bSectionIdx) {
        return aSectionIdx - bSectionIdx;
      }
      return calculateNarrativeScore(b) - calculateNarrativeScore(a);
    });
    
    return items;
  };

  // Build narrative items after early returns
  const narrativeItems = buildNarrativeItems();
  const takingShapeItems = narrativeItems.filter(item => item.section === 'takingShape');
  const unsettledItems = narrativeItems.filter(item => item.section === 'unsettled');

  return (
    <div className="fade-in" style={{ 
      minHeight: '100vh',
      background: 'var(--page-bg)',
      display: 'flex',
    }}>
      <SessionDrawer 
        isCollapsed={sidebarCollapsed} 
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)} 
      />
      <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
        <div style={{ maxWidth: '1152px', margin: '0 auto' }}>
        {/* Header - More human, conversational */}
        <div style={{ marginBottom: '40px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <div>
              <h1 style={{ fontSize: '36px', fontWeight: '600', marginBottom: '12px', lineHeight: '1.2', color: 'var(--ink)' }}>
                Welcome back
              </h1>
              <p style={{ color: 'var(--muted)', fontSize: '17px', margin: 0, lineHeight: '1.5', maxWidth: '600px' }}>
                Here's what's happening across your knowledge graphs. I've been keeping track of what you've been exploring and what might be worth looking into next.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <button
                onClick={toggleTheme}
                style={{
                  padding: '10px',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  background: 'var(--panel)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--ink)',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--accent)';
                  e.currentTarget.style.color = 'white';
                  e.currentTarget.style.borderColor = 'var(--accent)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--panel)';
                  e.currentTarget.style.color = 'var(--ink)';
                  e.currentTarget.style.borderColor = 'var(--border)';
                }}
                title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
              >
                {theme === 'light' ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="5"></circle>
                    <line x1="12" y1="1" x2="12" y2="3"></line>
                    <line x1="12" y1="21" x2="12" y2="23"></line>
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                    <line x1="1" y1="12" x2="3" y2="12"></line>
                    <line x1="21" y1="12" x2="23" y2="12"></line>
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
                  </svg>
                )}
              </button>
              <Link 
                href="/" 
                style={{ 
                  color: 'var(--accent)', 
                  textDecoration: 'none', 
                  fontSize: '14px',
                  padding: '10px 18px',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  background: 'var(--panel)',
                  fontWeight: '500',
                }}
              >
                Open Explorer →
              </Link>
            </div>
          </div>
        </div>

        {/* Reminder Banner */}
        {reminderBanner && (
          <ReminderBanner
            banner={reminderBanner}
            onDismiss={() => setReminderBanner(null)}
          />
        )}

        {/* Pinned Concepts - Thin line under header */}
        {pinnedConcepts.length > 0 && (
          <div style={{ 
            marginBottom: '32px',
            padding: '12px 16px',
            background: 'var(--panel)',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--muted)', marginRight: '4px' }}>
              Pinned:
            </span>
            {pinnedConcepts.map((concept) => (
              <button
                key={concept.id}
                onClick={() => handleConceptClick(concept.id)}
                onMouseEnter={() => prefetchConceptData(concept.id, concept.name)}
                style={{
                  padding: '4px 10px',
                  background: 'var(--background)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  fontSize: '12px',
                  color: 'var(--accent)',
                  cursor: 'pointer',
                  fontWeight: '500',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--accent)';
                  e.currentTarget.style.color = 'white';
                  e.currentTarget.style.borderColor = 'var(--accent)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--background)';
                  e.currentTarget.style.color = 'var(--accent)';
                  e.currentTarget.style.borderColor = 'var(--border)';
                }}
              >
                {concept.name}
              </button>
            ))}
          </div>
        )}

        {/* Workspaces - Individual blocks in grid layout */}
        {(() => {
          function formatRelativeTime(isoString: string | null | undefined): string {
            if (!isoString) return 'unknown';
            try {
              const date = new Date(isoString);
              const now = new Date();
              const diffMs = now.getTime() - date.getTime();
              const diffMins = Math.floor(diffMs / 60000);
              const diffHours = Math.floor(diffMs / 3600000);
              const diffDays = Math.floor(diffMs / 86400000);
              
              if (diffMins < 1) return 'just now';
              if (diffMins < 60) return `${diffMins}m ago`;
              if (diffHours < 24) return `${diffHours}h ago`;
              if (diffDays < 7) return `${diffDays}d ago`;
              const diffWeeks = Math.floor(diffDays / 7);
              if (diffWeeks < 4) return `${diffWeeks}w ago`;
              const diffMonths = Math.floor(diffDays / 30);
              return `${diffMonths}mo ago`;
            } catch {
              return 'unknown';
            }
          }
          
          const PINNED_GRAPHS_KEY = 'brainweb:pinnedGraphIds';
          function getPinnedGraphs(): string[] {
            if (typeof window === 'undefined') return [];
            try {
              const stored = localStorage.getItem(PINNED_GRAPHS_KEY);
              if (!stored) return [];
              return JSON.parse(stored);
            } catch {
              return [];
            }
          }
          
          const pinnedGraphIds = getPinnedGraphs();
          
          if (graphs.length === 0 && !secondaryLoaded) {
            return (
              <div style={{ marginBottom: '40px' }}>
                <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px' }}>Workspaces</h2>
                <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                  <SkeletonCard height={200} />
                  <SkeletonCard height={200} />
                  <SkeletonCard height={200} />
                </div>
              </div>
            );
          }
          
          if (graphs.length === 0) {
            return null;
          }
          
          return (
            <div style={{ marginBottom: '40px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '20px', fontWeight: '600' }}>Workspaces</h2>
                <Link
                  href="/control-panel"
                  style={{
                    fontSize: '13px',
                    color: 'var(--accent)',
                    textDecoration: 'none',
                    fontWeight: '500',
                  }}
                >
                  Manage all →
                </Link>
              </div>
              <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                {graphs.slice(0, 6).map((graph, index) => {
                  const nodes = graph.node_count ?? 0;
                  const edges = graph.edge_count ?? 0;
                  const updated = formatRelativeTime(graph.updated_at);
                  const templateLabel = graph.template_label || (graph.template_id === 'blank' ? 'Blank canvas' : graph.template_id || '');
                  const templateTags = graph.template_tags || [];
                  const isPinned = pinnedGraphIds.includes(graph.graph_id);
                  const isActive = graph.graph_id === activeGraphId;
                  
                  return (
                    <div key={graph.graph_id} style={{ position: 'relative' }}>
                      <div
                        style={{
                          background: 'var(--panel)',
                          borderRadius: '18px',
                          padding: '16px',
                          border: isActive ? '2px solid var(--accent)' : `1px solid ${theme === 'dark' ? 'rgba(148, 163, 184, 0.3)' : 'rgba(148, 163, 184, 0.2)'}`,
                          boxShadow: theme === 'dark' ? '0 16px 30px rgba(0, 0, 0, 0.4)' : '0 16px 30px rgba(15, 23, 42, 0.08)',
                          transform: 'translateY(8px)',
                          opacity: 0,
                          animation: `floatIn 0.5s ease ${index * 40}ms forwards`,
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                        }}
                        onClick={() => navigateToExplorer({ graphId: graph.graph_id })}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'translateY(0) scale(1.02)';
                          e.currentTarget.style.boxShadow = theme === 'dark' ? '0 20px 40px rgba(0, 0, 0, 0.5)' : '0 20px 40px rgba(15, 23, 42, 0.12)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'translateY(0) scale(1)';
                          e.currentTarget.style.boxShadow = theme === 'dark' ? '0 16px 30px rgba(0, 0, 0, 0.4)' : '0 16px 30px rgba(15, 23, 42, 0.08)';
                        }}
                      >
                        {/* Graph Cover/Preview - Placeholder for now */}
                        <div style={{
                          height: '120px',
                          background: theme === 'dark' 
                            ? 'linear-gradient(135deg, #1e293b 0%, #0f172a 50%, #1e293b 100%)'
                            : 'linear-gradient(135deg, #eef2ff 0%, #fef9f0 50%, #f8fafc 100%)',
                          borderRadius: '12px',
                          marginBottom: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '12px',
                          color: 'var(--muted)',
                          border: '1px solid var(--border)',
                        }}>
                          Graph preview
                        </div>
                        
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--ink)', marginBottom: '4px' }}>
                              {graph.name || 'Untitled graph'}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{graph.graph_id}</div>
                          </div>
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                            {isActive && (
                              <span style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '999px', backgroundColor: theme === 'dark' ? 'rgba(56, 189, 248, 0.2)' : '#ecfeff', color: theme === 'dark' ? '#7dd3fc' : '#0e7490', fontWeight: 600 }}>
                                Active
                              </span>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(`/graphs/${graph.graph_id}`);
                              }}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '4px',
                                fontSize: '16px',
                                color: 'var(--muted)',
                              }}
                              title="Customize workspace"
                            >
                              ⚙️
                            </button>
                          </div>
                        </div>
                        
                        <div style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          <span style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '999px', backgroundColor: theme === 'dark' ? 'rgba(99, 102, 241, 0.2)' : '#eef2ff', color: theme === 'dark' ? '#a5b4fc' : '#4338ca', fontWeight: 600 }}>
                            {templateLabel}
                          </span>
                          {templateTags.slice(0, 2).map((tag) => (
                            <span
                              key={tag}
                              style={{
                                fontSize: '11px',
                                padding: '4px 8px',
                                borderRadius: '999px',
                                backgroundColor: theme === 'dark' ? 'rgba(30, 41, 59, 0.5)' : '#f8fafc',
                                color: 'var(--muted)',
                                border: '1px solid var(--border)',
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                        
                        <div style={{ marginTop: '12px', fontSize: '13px', color: 'var(--muted)', minHeight: '40px' }}>
                          {graph.intent || graph.template_description || 'No intent captured yet.'}
                        </div>
                        
                        <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--muted)' }}>
                          {nodes} nodes · {edges} edges · updated {updated}
                        </div>
                        
                        <div style={{ marginTop: '14px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigateToExplorer({ graphId: graph.graph_id });
                            }}
                            style={{
                              flex: 1,
                              padding: '8px 12px',
                              borderRadius: '999px',
                              border: 'none',
                              backgroundColor: theme === 'dark' ? '#1e293b' : '#111827',
                              color: 'white',
                              fontSize: '12px',
                              cursor: 'pointer',
                              fontWeight: '500',
                            }}
                          >
                            Open workspace
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <style jsx>{`
                @keyframes floatIn {
                  to {
                    transform: translateY(0);
                    opacity: 1;
                  }
                }
              `}</style>
            </div>
          );
        })()}



        {/* Main Content Area - Recent Activity + Continue + Sidebar */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'minmax(0, 2fr) minmax(300px, 1fr)', 
          gap: '24px',
          marginTop: '24px',
        }}>
          {/* Main Content - Recent Activity and Continue */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Recent Activity */}
          {(() => {
            const recentAdditions = activityEvents
              .filter(e => {
                return e.type === 'EVIDENCE_FETCHED' || 
                       e.type === 'CONCEPT_VIEWED' ||
                       (e.payload?.source === 'web' || e.payload?.source === 'extension') ||
                       e.type === 'RESOURCE_OPENED';
              })
              .slice(0, 10);
            
            if (recentAdditions.length === 0) return null;
            
            return (
            <CollapsibleSection
                title="Recent activity"
                subtitle="What you've added and explored across your workspaces"
              defaultCollapsed={false}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {recentAdditions.map((event) => {
                    const eventTime = new Date(event.created_at).getTime();
                    const graph = graphs.find(g => g.graph_id === event.graph_id);
                    const graphName = graph?.name || event.graph_id || 'a workspace';
                    
                    let actionText = '';
                    let itemName = event.payload?.concept_name || event.concept_id || 'item';
                    
                    if (event.type === 'EVIDENCE_FETCHED') {
                      const count = event.payload?.addedCount || 0;
                      actionText = `You added ${count} source${count !== 1 ? 's' : ''} for ${itemName}`;
                    } else if (event.type === 'CONCEPT_VIEWED') {
                      actionText = `You explored ${itemName}`;
                    } else if (event.type === 'RESOURCE_OPENED') {
                      actionText = `You opened ${itemName}`;
                    } else if (event.payload?.source === 'web' || event.payload?.source === 'extension') {
                      actionText = `You added ${itemName}`;
                    } else {
                      actionText = `You worked on ${itemName}`;
                    }
                    
                    return (
                      <div
                        key={event.id}
                        onClick={() => {
                          if (event.concept_id && event.graph_id) {
                            navigateToExplorer({ conceptId: event.concept_id, graphId: event.graph_id });
                          } else if (event.graph_id) {
                            navigateToExplorer({ graphId: event.graph_id });
                          }
                        }}
                        style={{
                          padding: '12px 16px',
                          borderRadius: '8px',
                          border: '1px solid var(--border)',
                          background: 'var(--background)',
                          fontSize: '14px',
                          color: 'var(--ink)',
                          lineHeight: '1.5',
                          cursor: (event.concept_id || event.graph_id) ? 'pointer' : 'default',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e) => {
                          if (event.concept_id || event.graph_id) {
                            e.currentTarget.style.background = 'var(--panel)';
                            e.currentTarget.style.borderColor = 'var(--accent)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'var(--background)';
                          e.currentTarget.style.borderColor = 'var(--border)';
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                          <div style={{ flex: 1 }}>
                            <span style={{ color: 'var(--ink)', fontWeight: '500' }}>
                              {actionText}
                            </span>
                            {' '}
                            <span style={{ color: 'var(--muted)', fontSize: '13px' }}>
                              in <span style={{ fontWeight: '500' }}>{graphName}</span>
                            </span>
                          </div>
                          <span style={{ color: 'var(--muted)', fontSize: '12px', whiteSpace: 'nowrap' }}>
                            {formatRelativeTime(eventTime)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </CollapsibleSection>
            );
          })()}

          {/* Continue where you left off - Right under Recent Activity */}
          {(() => {
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            const recentSessionsFiltered = recentSessions.filter(session => {
              try {
                const endDate = new Date(session.end_at);
                return endDate >= sevenDaysAgo;
              } catch {
                return true;
              }
            });
            
            if (recentSessionsFiltered.length === 0) return null;
            
            return (
              <CollapsibleSection
                title={SECTION_TITLE.WHERE_YOU_LEFT_OFF}
                subtitle={`Continue from where you were working — ${recentSessionsFiltered.length} recent session${recentSessionsFiltered.length !== 1 ? 's' : ''}`}
                defaultCollapsed={false}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {recentSessionsFiltered.slice(0, 5).map((session) => {
                    const graph = graphs.find(g => g.graph_id === session.graph_id);
                    const graphName = graph?.name || session.graph_id || 'Unknown workspace';
                    const timeAgo = formatSessionTime(session.end_at);
                    
                    const lastConceptName = session.last_concept_name || session.highlights?.concepts?.[0]?.concept_name;
                    const lastConceptId = session.last_concept_id || session.highlights?.concepts?.[0]?.concept_id;
                    
                    let contextText = '';
                    if (session.highlights?.paths?.[0]) {
                      contextText = `Working on path: ${session.highlights.paths[0].title || session.highlights.paths[0].path_id}`;
                      if (lastConceptName) {
                        contextText += ` • Last node: ${lastConceptName}`;
                      }
                    } else if (lastConceptName) {
                      contextText = `Editing notes for ${lastConceptName}`;
                    } else if (session.highlights?.concepts && session.highlights.concepts.length > 0) {
                      const conceptNames = session.highlights.concepts
                        .slice(0, 3)
                        .map(c => c.concept_name || c.concept_id)
                        .filter(Boolean);
                      if (conceptNames.length > 0) {
                        contextText = `Exploring: ${conceptNames.join(' → ')}`;
                      }
                    } else if (session.highlights?.answers && session.highlights.answers.length > 0) {
                      contextText = `Asked ${session.highlights.answers.length} question${session.highlights.answers.length > 1 ? 's' : ''}`;
                    } else if (session.summary) {
                      contextText = session.summary;
                    } else {
                      contextText = 'Recent session';
                    }
                    
                    return (
                      <div
                        key={session.session_id}
                        style={{
                          padding: '16px',
                          borderRadius: '8px',
                          border: '1px solid var(--border)',
                          background: 'var(--background)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          gap: '12px',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'var(--panel)';
                          e.currentTarget.style.borderColor = 'var(--accent)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'var(--background)';
                          e.currentTarget.style.borderColor = 'var(--border)';
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '8px', 
                            marginBottom: '6px',
                            flexWrap: 'wrap',
                          }}>
                            <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--ink)' }}>
                              {graphName}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                              {timeAgo}
                            </div>
                          </div>
                          <div style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '4px', lineHeight: '1.4' }}>
                            {contextText}
                          </div>
                          {lastConceptName && (
                            <div style={{ 
                              marginTop: '8px',
                              padding: '6px 10px',
                              background: 'var(--panel)',
                              borderRadius: '6px',
                              fontSize: '12px',
                              color: 'var(--accent)',
                              display: 'inline-block',
                            }}>
                              📝 {lastConceptName}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                          <button
                            onClick={() => handleResumeSession(session)}
                            style={{
                              padding: '8px 14px',
                              fontSize: '13px',
                              fontWeight: '500',
                              background: 'var(--accent)',
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            Continue
                          </button>
                          <button
                            onClick={() => navigateToExplorer({ 
                              graphId: session.graph_id,
                              conceptId: lastConceptId,
                            })}
                            style={{
                              padding: '8px 14px',
                              fontSize: '13px',
                              fontWeight: '500',
                              background: 'transparent',
                              color: 'var(--accent)',
                              border: '1px solid var(--border)',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            Open workspace
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CollapsibleSection>
            );
          })()}

          {/* Unsettled Areas - Collapsed by default */}
          {unsettledItems.length > 0 && (
            <CollapsibleSection
              title={SECTION_TITLE.UNSETTLED_AREAS}
              subtitle="Areas that could benefit from more exploration"
              defaultCollapsed={true}
            >
              {unsettledItems.map((item) => (
                <NarrativeCard
                  key={item.id}
                  title={item.title}
                  description={item.description}
                  tag={item.tag}
                  primaryAction={item.primaryAction}
                  secondaryAction={item.secondaryAction}
                />
              ))}
            </CollapsibleSection>
          )}

          {/* Quiet Background Changes - Optional, stub for now */}
          {/* TODO: Implement when system actions/ingestion events are available */}
          
          {/* Because you recently... */}
          {recentSignals.length > 0 && (
            <CollapsibleSection
              title="Because you recently…"
              subtitle="A few suggestions based on what you explored"
              defaultCollapsed={true}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {recentSignals.slice(0, 6).map((signal, idx) => {
                    const signalSuggestionsForConcept = filteredSignalSuggestions[signal.concept_id] || [];
                    const suggestion = signalSuggestionsForConcept[0]; // Take first suggestion
                    
                    // Format signal description
                    let signalDescription = '';
                    if (signal.type === EXPLORATION_EVENT_TYPES.CONCEPT_VIEWED) {
                      signalDescription = `Viewed ${signal.concept_name || 'concept'}`;
                    } else if (signal.type === EXPLORATION_EVENT_TYPES.RESOURCE_OPENED) {
                      signalDescription = `Opened evidence for ${signal.concept_name || 'concept'}`;
                    } else if (signal.type === EXPLORATION_EVENT_TYPES.EVIDENCE_FETCHED) {
                      signalDescription = `Fetched evidence for ${signal.concept_name || 'concept'}`;
                    }
                    
                    return (
                      <div
                        key={`${signal.concept_id}-${signal.ts}-${idx}`}
                        style={{
                          padding: '12px',
                          borderRadius: '8px',
                          border: '1px solid var(--border)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          gap: '12px',
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '4px' }}>
                            {signalDescription} {formatRelativeTime(signal.ts)}
                          </div>
                          {suggestion ? (
                            <>
                              <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '4px' }}>
                                {suggestion.title}
                              </div>
                              <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
                                {suggestion.rationale}
                              </div>
                            </>
                          ) : signal.type === EXPLORATION_EVENT_TYPES.EVIDENCE_FETCHED ? (
                            <div style={{ fontSize: '13px', color: 'var(--muted)' }}>
                              Review the evidence you just fetched
                            </div>
                          ) : (
                            <div style={{ fontSize: '13px', color: 'var(--muted)', fontStyle: 'italic' }}>
                              No suggestions available
                            </div>
                          )}
                        </div>
                        {suggestion ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <SuggestionOverflowMenu
                              suggestion={suggestion}
                              onDismiss={() => handleDismissSuggestion(suggestion.id)}
                              onSnooze1Day={() => handleSnoozeSuggestion(suggestion.id, SNOOZE_DURATIONS.ONE_DAY)}
                              onSnooze1Week={() => handleSnoozeSuggestion(suggestion.id, SNOOZE_DURATIONS.ONE_WEEK)}
                            />
                            <button
                              onClick={() => handleSuggestionAction(suggestion)}
                              disabled={fetchStates[suggestion.concept_id || '']?.status === 'loading'}
                              style={{
                                padding: '6px 12px',
                                background: fetchStates[suggestion.concept_id || '']?.status === 'loading' 
                                  ? 'var(--muted)' 
                                  : 'var(--accent)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: '600',
                                cursor: fetchStates[suggestion.concept_id || '']?.status === 'loading' 
                                  ? 'not-allowed' 
                                  : 'pointer',
                                whiteSpace: 'nowrap',
                                opacity: fetchStates[suggestion.concept_id || '']?.status === 'loading' ? 0.6 : 1,
                              }}
                            >
                              {fetchStates[suggestion.concept_id || '']?.status === 'loading' 
                                ? 'Loading...' 
                                : CTA.EXPLORE}
                            </button>
                          </div>
                        ) : signal.type === EXPLORATION_EVENT_TYPES.EVIDENCE_FETCHED ? (
                          <button
                            onClick={() => navigateToExplorer({ conceptId: signal.concept_id })}
                            style={{
                              padding: '6px 12px',
                              background: 'var(--accent)',
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: '600',
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {CTA.EXPLORE}
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
            </CollapsibleSection>
          )}

            {/* Continue Card - Collapsible */}
            {hasLastSession && (
              <CollapsibleSection
                title="Continue where you left off"
                subtitle={mostRecentSession?.last_concept_name || lastSession?.concept_name 
                  ? `Last exploring: ${mostRecentSession?.last_concept_name || lastSession?.concept_name}`
                  : 'Resume your last session'}
                defaultCollapsed={false}
              >
                <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                  <button
                    onClick={handleResume}
                    style={{
                      padding: '10px 20px',
                      background: 'var(--accent)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: 'pointer',
                    }}
                  >
                    {CTA.CONTINUE_THINKING}
                  </button>
                  <button
                    onClick={handleOpenExplorer}
                    style={{
                      padding: '10px 20px',
                      background: 'transparent',
                      color: 'var(--accent)',
                      border: '1px solid var(--accent)',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: 'pointer',
                    }}
                  >
                    Open Explorer
                  </button>
                </div>
              </CollapsibleSection>
            )}

            {/* Recent Sessions - Collapsible */}
            {(recentSessions.length > 0 || !secondaryLoaded) && (
              <CollapsibleSection
                title="Recent sessions"
                subtitle="Your exploration history"
                defaultCollapsed={true}
              >
                {!secondaryLoaded ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {[0, 1, 2].map((idx) => (
                      <div key={idx} className="skeleton skeleton-card" style={{ padding: '12px', height: '72px' }} />
                    ))}
                  </div>
                ) : recentSessions.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {recentSessions.slice(0, 5).map((session) => (
                      <div
                        key={session.session_id}
                        style={{
                          padding: '12px',
                          borderRadius: '8px',
                          border: '1px solid var(--border)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '12px',
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>
                            {formatSessionTimeRange(session.start_at, session.end_at)}
                          </div>
                          <div style={{ fontSize: '14px', fontWeight: '500', marginBottom: '4px' }}>
                            {session.summary}
                          </div>
                          {session.top_concepts.length > 0 && (
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                              {session.top_concepts.map((concept) => (
                                <span
                                  key={concept.concept_id}
                                  style={{
                                    fontSize: '11px',
                                    padding: '2px 6px',
                                    background: 'var(--background)',
                                    borderRadius: '4px',
                                    color: 'var(--ink)',
                                  }}
                                >
                                  {concept.concept_name || concept.concept_id}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => handleResumeSession(session)}
                          style={{
                            padding: '8px 16px',
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
                          {CTA.CONTINUE_THINKING}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: 'var(--muted)', fontSize: '14px' }}>
                    No recent sessions
                  </div>
                )}
              </CollapsibleSection>
            )}

            {/* Recent Activity - Collapsible */}
            <CollapsibleSection
              title="All activity"
              subtitle="Everything that's happened recently"
              defaultCollapsed={true}
            >
              {!secondaryLoaded ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <SkeletonLine width="60%" />
                  <SkeletonLine width="72%" />
                  <SkeletonLine width="54%" />
                  <SkeletonLine width="68%" />
                </div>
              ) : activityEvents.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {activityEvents.slice(0, 20).map((event) => {
                    const eventTime = new Date(event.created_at).getTime();
                    let displayText = '';
                    
                    switch (event.type) {
                      case 'CONCEPT_VIEWED':
                        displayText = `Viewed ${event.payload?.concept_name || event.concept_id || 'concept'}`;
                        break;
                      case 'RESOURCE_OPENED':
                        displayText = `Opened ${event.payload?.resource_title || event.resource_id || 'resource'}`;
                        break;
                      case 'EVIDENCE_FETCHED':
                        const count = event.payload?.addedCount || 0;
                        displayText = `Fetched ${count} source${count !== 1 ? 's' : ''} for ${event.payload?.concept_name || event.concept_id || 'concept'}`;
                        break;
                      case 'ANSWER_CREATED':
                        displayText = 'Created an answer';
                        break;
                      case 'GRAPH_SWITCHED':
                        displayText = 'Switched graph';
                        break;
                      case 'PINNED':
                        displayText = `Pinned ${event.payload?.targetType === 'CONCEPT' ? 'concept' : 'item'}`;
                        break;
                      default:
                        displayText = event.type;
                    }
                    
                    return (
                      <div key={event.id} style={{ fontSize: '14px', color: 'var(--muted)' }}>
                        {displayText} • {formatRelativeTime(eventTime)}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ color: 'var(--muted)', fontSize: '14px' }}>
                  No recent activity
                </div>
              )}
            </CollapsibleSection>
          </div>
          {/* End Narrative Scroll */}

          {/* Sidebar - Right Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Areas Gaining Momentum - Moved to sidebar */}
            {takingShapeItems.length > 0 && (
              <CollapsibleSection
                title={SECTION_TITLE.WHATS_TAKING_SHAPE}
                subtitle="Areas gaining momentum — new connections and things to explore"
                defaultCollapsed={false}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {takingShapeItems.map((item) => (
                    <NarrativeCard
                      key={item.id}
                      title={item.title}
                      description={item.description}
                      tag={item.tag}
                      primaryAction={item.primaryAction}
                      secondaryAction={item.secondaryAction}
                    />
                  ))}
                </div>
              </CollapsibleSection>
            )}
            {(() => {
              const PINNED_GRAPHS_KEY = 'brainweb:pinnedGraphIds';
              function getPinnedGraphs(): string[] {
                if (typeof window === 'undefined') return [];
                try {
                  const stored = localStorage.getItem(PINNED_GRAPHS_KEY);
                  if (!stored) return [];
                  return JSON.parse(stored);
                } catch {
                  return [];
                }
              }
              function formatRelativeTime(isoString: string | null | undefined): string {
                if (!isoString) return 'unknown';
                try {
                  const date = new Date(isoString);
                  const now = new Date();
                  const diffMs = now.getTime() - date.getTime();
                  const diffMins = Math.floor(diffMs / 60000);
                  const diffHours = Math.floor(diffMs / 3600000);
                  const diffDays = Math.floor(diffMs / 86400000);
                  
                  if (diffMins < 1) return 'just now';
                  if (diffMins < 60) return `${diffMins}m ago`;
                  if (diffHours < 24) return `${diffHours}h ago`;
                  if (diffDays < 7) return `${diffDays}d ago`;
                  const diffWeeks = Math.floor(diffDays / 7);
                  if (diffWeeks < 4) return `${diffWeeks}w ago`;
                  const diffMonths = Math.floor(diffDays / 30);
                  return `${diffMonths}mo ago`;
                } catch {
                  return 'unknown';
                }
              }
              
              // Show all graphs, prioritize pinned ones
              const pinnedGraphIds = getPinnedGraphs();
              const allGraphs = graphs.slice(0, 8); // Show up to 8 graphs
              const pinnedGraphs = pinnedGraphIds
                .slice(0, 5)
                .map(id => graphs.find(g => g.graph_id === id))
                .filter((g): g is GraphSummary => !!g);
              
              // If no graphs loaded yet, show skeleton
              if (graphs.length === 0 && !secondaryLoaded) {
                  return (
                  <CollapsibleSection
                    title="Workspaces"
                    subtitle="Your knowledge graphs"
                    defaultCollapsed={false}
                  >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <SkeletonCard height={80} />
                      <SkeletonCard height={80} />
                      </div>
                  </CollapsibleSection>
                );
              }
              
              // If no graphs, show empty state
              if (graphs.length === 0) {
                return (
                  <CollapsibleSection
                    title="Workspaces"
                    subtitle="Your knowledge graphs"
                    defaultCollapsed={false}
                  >
                    <div style={{ color: 'var(--muted)', fontSize: '14px', padding: '16px', textAlign: 'center' }}>
                      No workspaces yet. Create your first graph to get started.
                    </div>
                  </CollapsibleSection>
                  );
              }
              
              return (
                <CollapsibleSection
                  title="Workspaces"
                  subtitle={`${graphs.length} workspace${graphs.length !== 1 ? 's' : ''} — choose one to enter`}
                  defaultCollapsed={false}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {allGraphs.map((graph) => {
                      const nodes = graph.node_count ?? 0;
                      const edges = graph.edge_count ?? 0;
                      const updated = formatRelativeTime(graph.updated_at);
                      const templateLabel = graph.template_label || (graph.template_id === 'blank' ? 'Blank canvas' : graph.template_id || '');
                      const isPinned = pinnedGraphIds.includes(graph.graph_id);
                      const isActive = graph.graph_id === activeGraphId;
                      
                      return (
                        <div
                          key={graph.graph_id}
                          style={{
                            padding: '14px',
                            borderRadius: '10px',
                            border: isActive ? '2px solid var(--accent)' : '1px solid var(--border)',
                            background: isActive ? 'var(--panel)' : 'var(--background)',
                            transition: 'all 0.2s',
                            cursor: 'pointer',
                          }}
                          onClick={() => navigateToExplorer({ graphId: graph.graph_id })}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'var(--panel)';
                            e.currentTarget.style.borderColor = 'var(--accent)';
                            e.currentTarget.style.transform = 'translateY(-2px)';
                            e.currentTarget.style.boxShadow = 'var(--shadow)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = isActive ? 'var(--panel)' : 'var(--background)';
                            e.currentTarget.style.borderColor = isActive ? 'var(--accent)' : 'var(--border)';
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = 'none';
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '15px', fontWeight: '600', marginBottom: '4px', color: 'var(--ink)' }}>
                              {graph.name || graph.graph_id}
                            </div>
                              <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '6px' }}>
                                {graph.graph_id}
                            </div>
                            </div>
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                              {isActive && (
                                <span style={{ 
                                  fontSize: '10px', 
                                  padding: '3px 8px', 
                                  borderRadius: '999px', 
                                  backgroundColor: theme === 'dark' ? 'rgba(56, 189, 248, 0.2)' : '#ecfeff', 
                                  color: theme === 'dark' ? '#7dd3fc' : '#0e7490', 
                                  fontWeight: '600' 
                                }}>
                                  Active
                                </span>
                              )}
                              {isPinned && (
                                <span style={{ fontSize: '14px' }}>📌</span>
                              )}
                            </div>
                          </div>
                          
                          {templateLabel && (
                              <div style={{ marginBottom: '8px' }}>
                              <span style={{ 
                                fontSize: '10px', 
                                padding: '4px 8px', 
                                borderRadius: '999px', 
                                backgroundColor: theme === 'dark' ? 'rgba(99, 102, 241, 0.2)' : '#eef2ff', 
                                color: theme === 'dark' ? '#a5b4fc' : '#4338ca', 
                                fontWeight: '600' 
                              }}>
                                {templateLabel}
                                </span>
                              </div>
                            )}
                          
                          <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '10px' }}>
                            {nodes} nodes · {edges} edges · updated {updated}
                          </div>
                          
                          {graphQualities[graph.graph_id] && (
                            <div style={{ marginBottom: '10px' }}>
                              <GraphHealthBadge quality={graphQualities[graph.graph_id]} />
                            </div>
                          )}
                          
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigateToExplorer({ graphId: graph.graph_id });
                              }}
                              style={{
                                flex: 1,
                                padding: '8px 12px',
                                background: 'var(--accent)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: '500',
                                cursor: 'pointer',
                              }}
                            >
                              Enter workspace
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(`/graphs/${graph.graph_id}`);
                              }}
                              style={{
                                padding: '8px 12px',
                                background: 'transparent',
                                color: 'var(--accent)',
                                border: '1px solid var(--border)',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: '500',
                                cursor: 'pointer',
                              }}
                              title="Customize workspace"
                            >
                              ⚙️
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    
                    {graphs.length > 8 && (
                      <button
                        onClick={() => router.push('/control-panel')}
                        style={{
                          padding: '12px',
                          background: 'transparent',
                          color: 'var(--accent)',
                          border: '1px dashed var(--border)',
                          borderRadius: '8px',
                          fontSize: '13px',
                          fontWeight: '500',
                          cursor: 'pointer',
                          textAlign: 'center',
                        }}
                      >
                        View all {graphs.length} workspaces →
                      </button>
                    )}
                  </div>
                </CollapsibleSection>
              );
            })()}
            


            {/* Recently Viewed - Collapsible */}
            <CollapsibleSection
              title="Recently viewed"
              subtitle="Concepts you've explored"
              defaultCollapsed={true}
            >
              {recentViews.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {recentViews.map((view) => (
                    <div
                      key={view.id}
                      onClick={() => handleConceptClick(view.id)}
                      onMouseEnter={() => prefetchConceptData(view.id, view.name)}
                      style={{
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: '1px solid var(--border)',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div style={{ fontSize: '14px', color: 'var(--accent)' }}>
                        {view.name}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                        {formatRelativeTime(view.ts)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: 'var(--muted)', fontSize: '14px' }}>
                  No recent views
                </div>
              )}
            </CollapsibleSection>

            {/* Continue Block */}
            <ContinueBlock 
              graphId={lastSession?.graph_id} 
              onPathResume={handlePathResume}
            />

            {/* Suggested Paths - Collapsible */}
            <CollapsibleSection
              title="Suggested paths"
              subtitle="Exploration paths you might find interesting"
              defaultCollapsed={true}
            >
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
                <button
                  onClick={handleRegeneratePaths}
                  disabled={pathsLoading}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--accent)',
                    fontSize: '12px',
                    cursor: pathsLoading ? 'not-allowed' : 'pointer',
                    padding: '4px 8px',
                    opacity: pathsLoading ? 0.5 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                  title="Regenerate paths"
                >
                  <span style={{ fontSize: '14px' }}>↻</span>
                </button>
              </div>
              {pathsLoading || !secondaryLoaded ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div className="skeleton skeleton-card" style={{ padding: '12px', height: '88px' }} />
                  <div className="skeleton skeleton-card" style={{ padding: '12px', height: '88px' }} />
                </div>
              ) : suggestedPaths.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {suggestedPaths.map((path) => (
                    <div
                      key={path.path_id}
                      style={{
                        padding: '12px',
                        borderRadius: '8px',
                        border: '1px solid var(--border)',
                        background: 'var(--background)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '4px', color: 'var(--ink)' }}>
                            {path.title}
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '8px' }}>
                            {path.rationale}
                          </div>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            {path.steps.slice(0, 4).map((step, idx) => (
                              <span
                                key={step.concept_id}
                                style={{
                                  fontSize: '11px',
                                  padding: '2px 6px',
                                  background: idx === 0 ? 'var(--accent)' : 'var(--surface)',
                                  color: idx === 0 ? 'white' : 'var(--ink)',
                                  borderRadius: '4px',
                                }}
                                title={step.name}
                              >
                                {step.name.length > 15 ? `${step.name.substring(0, 15)}...` : step.name}
                              </span>
                            ))}
                            {path.steps.length > 4 && (
                              <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                                +{path.steps.length - 4} more
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isItemSaved('PATH', path.path_id)) {
                                const saved = getSavedItems().find(item => item.path_id === path.path_id);
                                if (saved) removeSavedItem(saved.id);
                              } else {
                                saveItem({
                                  kind: 'PATH',
                                  title: path.title,
                                  graph_id: lastSession?.graph_id,
                                  path_id: path.path_id,
                                });
                              }
                              // Force re-render
                              setSuggestedPaths(prev => [...prev]);
                            }}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: isItemSaved('PATH', path.path_id) ? 'var(--accent)' : 'var(--muted)',
                              cursor: 'pointer',
                              fontSize: '16px',
                              padding: '4px 8px',
                            }}
                            title={isItemSaved('PATH', path.path_id) ? 'Remove from saved' : 'Save path'}
                          >
                            {isItemSaved('PATH', path.path_id) ? '🔖' : '🔗'}
                          </button>
                          <button
                            onClick={() => handleDismissPath(path.path_id)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--muted)',
                              cursor: 'pointer',
                              fontSize: '16px',
                              padding: '4px 8px',
                            }}
                            title="Dismiss"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                        <button
                          onClick={() => handleStartPath(path)}
                          style={{
                            flex: 1,
                            padding: '8px 12px',
                            background: 'var(--accent)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '13px',
                            fontWeight: '600',
                            cursor: 'pointer',
                          }}
                        >
                          Start Path
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: 'var(--muted)', fontSize: '14px' }}>
                  No suggested paths available
                </div>
              )}
            </CollapsibleSection>
          </div>
        </div>
        </div>
      </div>
      {activePath && (
        <PathRunner
          path={activePath}
          onStepSelect={handlePathStepSelect}
          onExit={handlePathExit}
          graphId={getLastSession()?.graph_id}
        />
      )}
      
      {/* Trail Sidebar */}
      <TrailSidebar
        trailId={activeTrailId}
        onClose={() => {
          setActiveTrailIdState(null);
          clearActiveTrailId();
        }}
        onStepClick={(step: TrailStep) => {
          if (step.kind === 'page' && step.ref_id) {
            window.open(step.ref_id, '_blank');
          } else if (step.kind === 'quote' && step.ref_id) {
            // Fetch quote details and navigate to source URL
            const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
            fetch(`${apiBase}/retrieval/focus-context?focus_quote_id=${encodeURIComponent(step.ref_id)}`)
              .then(res => res.json())
              .then(data => {
                if (data.source_url) {
                  window.open(data.source_url, '_blank');
                } else {
                  console.warn('Quote source URL not found:', step.ref_id);
                }
              })
              .catch(err => {
                console.error('Failed to fetch quote details:', err);
              });
          } else if (step.kind === 'concept' && step.ref_id) {
            router.push(`/?select=${step.ref_id}`);
          } else if (step.kind === 'claim' && step.ref_id) {
            // For claims, navigate to the concept page with claims tab
            // Claim ref_id might be a claim_id, we need to find the associated concept
            // For now, try to navigate to a concept that might have this claim
            // A better implementation would fetch the claim and find its concept
            const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
            fetch(`${apiBase}/claims/${encodeURIComponent(step.ref_id)}`)
              .then(res => res.ok ? res.json() : null)
              .then(claim => {
                if (claim && claim.concept_id) {
                  router.push(`/concepts/${claim.concept_id}?tab=claims`);
                } else {
                  // Fallback: try to find concept from claim_id pattern or show in a modal
                  console.log('Claim clicked:', step.ref_id);
                  // Could show a modal with claim details here
                }
              })
              .catch(() => {
                console.log('Claim clicked:', step.ref_id);
              });
          } else if (step.kind === 'search' && step.ref_id) {
            // Show search results by setting search query in the search bar
            const searchQuery = decodeURIComponent(step.ref_id);
            // Could trigger search in the TopBar component
            console.log('Search query:', searchQuery);
          }
        }}
      />
      
      {/* Resume Thinking Prompt */}
      {showResumePrompt && (
        <ResumeThinkingPrompt
          onResume={(trailId: string) => {
            setActiveTrailIdState(trailId);
            setActiveTrailId(trailId);
            setShowResumePrompt(false);
          }}
          onDismiss={() => {
            setShowResumePrompt(false);
          }}
        />
      )}
    </div>
  );
}
