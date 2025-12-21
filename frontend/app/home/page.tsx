'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getGapsOverview, type GapsOverview, getSuggestions, type Suggestion, listGraphs, type GraphSummary, getSuggestedPaths, type SuggestedPath } from '../api-client';
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
import { useLens } from '../components/context-providers/LensContext';
import PathRunner from '../components/navigation/PathRunner';
import { saveItem, removeSavedItem, isItemSaved, getSavedItems, type SavedItemKind } from '../lib/savedItems';
import ReminderBanner from '../components/ui/ReminderBanner';
import { evaluateReminders, type ReminderBanner as ReminderBannerType, type ReminderPreferences } from '../lib/reminders';
import { getUIPreferences, listProposedRelationships, getLatestFinanceSnapshots, listFinanceTracking, getGraphQuality, type GraphQuality } from '../api-client';
import { GraphHealthBadge } from '../components/ui/QualityIndicators';
import ContinueBlock from '../components/navigation/ContinueBlock';
import { clearContinuation } from '../lib/continuation';

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
  const { activeLens } = useLens();
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
    // Load all data
    const loadData = async () => {
      try {
        setLoading(true);
        
        // Load from localStorage
        setLastSessionState(getLastSession());
        setRecentViews(getRecentConceptViews().slice(0, 5));
        setPinnedConcepts(getPinnedConcepts());
        
        // Load graphs
        try {
          const graphsData = await listGraphs();
          setGraphs(graphsData.graphs || []);
          
          // Load quality for pinned graphs
          const PINNED_GRAPHS_KEY = 'brainweb:pinnedGraphIds';
          const pinnedGraphIds = typeof window !== 'undefined' 
            ? JSON.parse(localStorage.getItem(PINNED_GRAPHS_KEY) || '[]')
            : [];
          
          const qualityPromises = pinnedGraphIds
            .slice(0, 5)
            .map(async (graphId: string) => {
              try {
                const quality = await getGraphQuality(graphId);
                return { graphId, quality };
              } catch (err) {
                console.warn(`Failed to load quality for graph ${graphId}:`, err);
                return null;
              }
            });
          
          const qualityResults = await Promise.all(qualityPromises);
          const qualityMap: Record<string, GraphQuality> = {};
          qualityResults.forEach(result => {
            if (result) {
              qualityMap[result.graphId] = result.quality;
            }
          });
          setGraphQualities(qualityMap);
        } catch (err) {
          console.warn('Failed to load graphs:', err);
          setGraphs([]);
        }
        
        // Load activity events from backend
        try {
          const lastSession = getLastSession();
          const backendEvents = await fetchRecentEvents({
            limit: 20,
            graph_id: lastSession?.graph_id,
          });
          setActivityEvents(backendEvents);
        } catch (err) {
          console.warn('Failed to load backend events, falling back to localStorage:', err);
          // Fallback to localStorage if backend fails
          const localEvents = getActivityEvents(10);
          setActivityEvents(localEvents.map(e => ({
            id: `local-${e.ts}`,
            user_id: 'demo',
            type: e.type as any,
            payload: e.payload,
            created_at: new Date(e.ts).toISOString(),
          })));
        }

        // Load recent sessions from backend
        try {
          const sessions = await fetchRecentSessions(10);
          setRecentSessions(sessions);
        } catch (err) {
          console.warn('Failed to load recent sessions:', err);
          setRecentSessions([]);
        }
        
        // Load recent exploration signals
        const signals = getRecentExplorationSignals(6);
        setRecentSignals(signals);

        // Load gaps from API
        try {
          const gapsData = await getGapsOverview(20);
          setGaps(gapsData);
        } catch (err) {
          console.warn('Failed to load gaps:', err);
          // Don't fail the whole page if gaps fail
        }

        // Load suggestions from API
        try {
          const lastSession = getLastSession();
          const recentViews = getRecentConceptViews();
          const recentConceptIds = recentViews.slice(0, 10).map(v => v.id);
          const suggestionsData = await getSuggestions(
            8,
            lastSession?.graph_id,
            recentConceptIds.length > 0 ? recentConceptIds : undefined
          );
          setSuggestions(suggestionsData);
        } catch (err) {
          console.warn('Failed to load suggestions:', err);
          // Don't fail the whole page if suggestions fail
        }

        // Load suggestions for recent exploration signals (batched)
        try {
          const signals = getRecentExplorationSignals(6);
          if (signals.length > 0) {
            const lastSession = getLastSession();
            const uniqueConceptIds = [...new Set(signals.map(s => s.concept_id))];
            
            // Batch fetch: collect all concept_ids and fetch once
            const allSuggestions = await getSuggestions(
              20,
              lastSession?.graph_id,
              uniqueConceptIds.length > 0 ? uniqueConceptIds : undefined
            );
            
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
            setSignalSuggestions(matched);
          }
        } catch (err) {
          console.warn('Failed to load signal suggestions:', err);
          // Don't fail the whole page if signal suggestions fail
        }

        // Load suggested paths
        try {
          const lastSession = getLastSession();
          if (lastSession?.graph_id) {
            setPathsLoading(true);
            const paths = await getSuggestedPaths(lastSession.graph_id, undefined, 3, activeLens);
            // Filter out dismissed paths
            const dismissed = getDismissedPaths(lastSession.graph_id);
            const filtered = paths.filter(p => !dismissed.includes(p.path_id));
            setSuggestedPaths(filtered);
          }
        } catch (err) {
          console.warn('Failed to load suggested paths:', err);
        } finally {
          setPathsLoading(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        // Evaluate reminders
        try {
          const uiPrefs = await getUIPreferences();
          const reminderPrefs: ReminderPreferences = uiPrefs.reminders || {
            weekly_digest: { enabled: false, day_of_week: 1, hour: 9 },
            review_queue: { enabled: false, cadence_days: 3 },
            finance_stale: { enabled: false, cadence_days: 7 },
          };
          
          // Get proposed relationships count
          let proposedCount = 0;
          try {
            const lastSession = getLastSession();
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
          } catch (err) {
            console.warn('Failed to check finance snapshots for reminders:', err);
          }
          
          const banner = await evaluateReminders(reminderPrefs, proposedCount, hasStaleSnapshots);
          setReminderBanner(banner);
        } catch (err) {
          console.warn('Failed to evaluate reminders:', err);
        }
        
        setLoading(false);
      }
    };

    loadData();
  }, [activeLens]);

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
  
  // Lens-based prioritization: sort suggestions based on active lens
  const prioritizedRegularSuggestions = [...regularSuggestions].sort((a, b) => {
    if (activeLens === 'LEARNING') {
      // Prioritize GAP_* type suggestions
      const aIsGap = a.type?.startsWith('GAP_') || false;
      const bIsGap = b.type?.startsWith('GAP_') || false;
      if (aIsGap && !bIsGap) return -1;
      if (!aIsGap && bIsGap) return 1;
    } else if (activeLens === 'FINANCE') {
      // Prioritize finance-related suggestions (check type or concept domain)
      const aIsFinance = a.type?.includes('FINANCE') || a.concept_domain?.toLowerCase().includes('finance') || false;
      const bIsFinance = b.type?.includes('FINANCE') || b.concept_domain?.toLowerCase().includes('finance') || false;
      if (aIsFinance && !bIsFinance) return -1;
      if (!aIsFinance && bIsFinance) return 1;
    }
    return 0; // Keep original order if no prioritization
  });
  
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
        const paths = await getSuggestedPaths(lastSession.graph_id, undefined, 50, activeLens);
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
        const paths = await getSuggestedPaths(lastSession.graph_id, undefined, 3, activeLens);
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
        if (activeLens === 'FINANCE') {
          params.set('tab', 'data');
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
    
    // In Finance lens, show "Open Finance" for OPEN_CONCEPT actions
    // (we'll route to Finance tab when the concept is opened)
    const isFinanceLens = activeLens === 'FINANCE';
    const isLearningLens = activeLens === 'LEARNING';
    const suggestionType = 'type' in suggestion ? suggestion.type : undefined;
    
    switch (actionKind) {
      case 'OPEN_CONCEPT':
        if (isFinanceLens) return 'Open Finance';
        if (isLearningLens && suggestionType === 'GAP_DEFINE') return 'Learn';
        if (isLearningLens) return 'Explore';
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

  // Get top 5 actionable gaps
  const getTopGaps = (): Array<{ node_id: string; name: string; type: string; domain?: string }> => {
    if (!gaps) return [];
    const allGaps: Array<{ node_id: string; name: string; type: string; domain?: string }> = [];
    
    gaps.missing_descriptions.slice(0, 2).forEach(item => {
      allGaps.push({ ...item, type: 'missing_description' });
    });
    gaps.low_connectivity.slice(0, 2).forEach(item => {
      allGaps.push({ ...item, type: 'low_connectivity' });
    });
    gaps.high_interest_low_coverage.slice(0, 1).forEach(item => {
      allGaps.push({ ...item, type: 'high_interest_low_coverage' });
    });
    
    return allGaps.slice(0, 5);
  };

  const getGapTypeLabel = (type: string): string => {
    switch (type) {
      case 'missing_description':
        return 'Needs definition';
      case 'low_connectivity':
        return 'Low connectivity';
      case 'high_interest_low_coverage':
        return 'Needs coverage';
      default:
        return 'Gap';
    }
  };

  const getGapTypeBadgeColor = (type: string): string => {
    switch (type) {
      case 'missing_description':
        return 'rgba(239, 68, 68, 0.1)';
      case 'low_connectivity':
        return 'rgba(251, 191, 36, 0.1)';
      case 'high_interest_low_coverage':
        return 'rgba(59, 130, 246, 0.1)';
      default:
        return 'rgba(156, 163, 175, 0.1)';
    }
  };

  if (loading) {
    return (
      <div style={{ 
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(180deg, #fdf7ec 0%, #eef6ff 60%, #f7f9fb 100%)',
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
        background: 'linear-gradient(180deg, #fdf7ec 0%, #eef6ff 60%, #f7f9fb 100%)',
      }}>
        <div style={{ fontSize: '18px', color: 'var(--accent-2)' }}>{error}</div>
        <Link href="/" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
          ← Back to Explorer
        </Link>
      </div>
    );
  }

  const topGaps = getTopGaps();
  // Use most recent session for Continue card, fall back to localStorage
  const mostRecentSession = recentSessions[0];
  const hasLastSession = mostRecentSession || (lastSession && (lastSession.concept_id || lastSession.graph_id));

  return (
    <div style={{ 
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #fdf7ec 0%, #eef6ff 60%, #f7f9fb 100%)',
      display: 'flex',
    }}>
      <SessionDrawer 
        isCollapsed={sidebarCollapsed} 
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)} 
      />
      <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
        <div style={{ maxWidth: '1152px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
            <div>
              <h1 style={{ fontSize: '32px', fontWeight: '700', marginBottom: '8px' }}>
                Home
              </h1>
              <p style={{ color: 'var(--muted)', fontSize: '16px', margin: 0 }}>
                Pick up where you left off.
              </p>
            </div>
            <Link 
              href="/" 
              style={{ 
                color: 'var(--accent)', 
                textDecoration: 'none', 
                fontSize: '14px',
                padding: '8px 16px',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                background: 'var(--panel)',
              }}
            >
              Open Explorer →
            </Link>
          </div>
        </div>

        {/* Reminder Banner */}
        {reminderBanner && (
          <ReminderBanner
            banner={reminderBanner}
            onDismiss={() => setReminderBanner(null)}
          />
        )}

        {/* Resume where you left off */}
        {(() => {
          // Filter sessions: show only those from last 7 days by default
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          const recentSessionsFiltered = recentSessions.filter(session => {
            try {
              const endDate = new Date(session.end_at);
              return endDate >= sevenDaysAgo;
            } catch {
              return true; // Include if we can't parse date
            }
          });
          
          if (recentSessionsFiltered.length === 0) return null;
          
          return (
            <div style={{
              background: 'var(--panel)',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: 'var(--shadow)',
              marginBottom: '24px',
            }}>
              <h2 style={{ fontSize: '20px', fontWeight: '600', margin: '0 0 16px 0' }}>
                Resume where you left off
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {recentSessionsFiltered.slice(0, 5).map((session) => {
                const graph = graphs.find(g => g.graph_id === session.graph_id);
                const graphName = graph?.name || session.graph_id || 'Unknown graph';
                const timeAgo = formatSessionTime(session.end_at);
                
                // Build highlights text
                const highlights: string[] = [];
                if (session.highlights?.paths?.[0]) {
                  highlights.push(`Started path: ${session.highlights.paths[0].title || session.highlights.paths[0].path_id}`);
                }
                if (session.highlights?.concepts && session.highlights.concepts.length > 0) {
                  const conceptNames = session.highlights.concepts
                    .slice(0, 3)
                    .map(c => c.concept_name || c.concept_id)
                    .filter(Boolean);
                  if (conceptNames.length > 0) {
                    highlights.push(`Explored: ${conceptNames.join(' → ')}`);
                  }
                }
                if (session.highlights?.answers && session.highlights.answers.length > 0 && highlights.length === 0) {
                  highlights.push(`Asked ${session.highlights.answers.length} question${session.highlights.answers.length > 1 ? 's' : ''}`);
                }
                if (highlights.length === 0 && session.summary) {
                  highlights.push(session.summary);
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
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '8px', 
                        marginBottom: '4px' 
                      }}>
                        <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--ink)' }}>
                          {graphName}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                          {timeAgo}
                        </div>
                      </div>
                      {highlights.length > 0 && (
                        <div style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '4px' }}>
                          {highlights[0]}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                      <button
                        onClick={() => handleResumeSession(session)}
                        style={{
                          padding: '6px 12px',
                          fontSize: '13px',
                          fontWeight: '500',
                          background: 'var(--accent)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: 'pointer',
                        }}
                      >
                        Resume
                      </button>
                      <button
                        onClick={() => navigateToExplorer({ graphId: session.graph_id })}
                        style={{
                          padding: '6px 12px',
                          fontSize: '13px',
                          fontWeight: '500',
                          background: 'transparent',
                          color: 'var(--accent)',
                          border: '1px solid var(--border)',
                          borderRadius: '6px',
                          cursor: 'pointer',
                        }}
                      >
                        Open graph
                      </button>
                    </div>
                  </div>
                );
              })}
              </div>
            </div>
          );
        })()}

        {/* Main Grid */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', 
          gap: '24px',
        }}
        className="home-grid"
        >
          {/* Left Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Next Up */}
            <div style={{
              background: 'var(--panel)',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: 'var(--shadow)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <h2 style={{ fontSize: '20px', fontWeight: '600', margin: 0 }}>
                  Next Up
                </h2>
                <div style={{ position: 'relative' }} ref={customizePanelRef}>
                  <button
                    onClick={() => setShowCustomizePanel(!showCustomizePanel)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--accent)',
                      fontSize: '12px',
                      cursor: 'pointer',
                      padding: '4px 8px',
                      textDecoration: 'underline',
                    }}
                  >
                    Customize
                  </button>
                  {showCustomizePanel && (
                    <div style={{
                      position: 'absolute',
                      top: '100%',
                      right: 0,
                      marginTop: '8px',
                      background: 'var(--panel)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      padding: '12px',
                      boxShadow: 'var(--shadow)',
                      zIndex: 100,
                      minWidth: '200px',
                    }}>
                      <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '8px' }}>
                        Show suggestions for:
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={categoryPrefs.GAPS}
                          onChange={() => handleToggleCategory('GAPS')}
                          style={{ cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: '12px' }}>Gaps</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={categoryPrefs.REVIEW}
                          onChange={() => handleToggleCategory('REVIEW')}
                          style={{ cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: '12px' }}>Review</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={categoryPrefs.EVIDENCE_FRESHNESS}
                          onChange={() => handleToggleCategory('EVIDENCE_FRESHNESS')}
                          style={{ cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: '12px' }}>Evidence freshness</span>
                      </label>
                    </div>
                  )}
                </div>
              </div>
              <p style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '16px', margin: '0 0 16px 0' }}>
                A few high-impact ways to improve your graph.
              </p>
              {dismissedMessage && (
                <div style={{
                  padding: '8px 12px',
                  background: 'var(--accent)',
                  color: 'white',
                  borderRadius: '6px',
                  fontSize: '12px',
                  marginBottom: '12px',
                }}>
                  {dismissedMessage}
                </div>
              )}
              {prioritizedSuggestions.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {prioritizedSuggestions.map((suggestion) => {
                    const fetchState = fetchStates[suggestion.concept_id || ''];
                    const isLoading = fetchState?.status === 'loading';
                    const isSuccess = fetchState?.status === 'success';
                    return (
                      <div
                        key={suggestion.id}
                        style={{
                          padding: '12px',
                          borderRadius: '8px',
                          border: '1px solid var(--border)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          gap: '12px',
                          // Muted styling for quality suggestions
                          opacity: isQualitySuggestion(suggestion) ? 0.85 : 1,
                          background: isQualitySuggestion(suggestion) ? 'var(--surface)' : 'transparent',
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '6px',
                            marginBottom: '4px' 
                          }}>
                            <div style={{ fontSize: '14px', fontWeight: '600' }}>
                              {suggestion.title}
                            </div>
                            {isQualitySuggestion(suggestion) && suggestion.explanation && (
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
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            background: isQualitySuggestion(suggestion) 
                              ? 'rgba(156, 163, 175, 0.08)' 
                              : 'rgba(156, 163, 175, 0.1)',
                            color: 'var(--muted)',
                            marginBottom: '6px',
                          }}>
                            {getSuggestionTypeLabel(suggestion.type)}
                          </div>
                          <div style={{ 
                            fontSize: '13px', 
                            color: 'var(--muted)', 
                            marginTop: '4px',
                            opacity: isQualitySuggestion(suggestion) ? 0.9 : 1,
                          }}>
                            {suggestion.explanation || suggestion.rationale}
                          </div>
                          {isSuccess && fetchState.addedCount !== undefined && (
                            <div style={{ fontSize: '12px', color: 'var(--accent)', marginTop: '4px' }}>
                              Added {fetchState.addedCount} source{fetchState.addedCount !== 1 ? 's' : ''}
                            </div>
                          )}
                          {fetchState?.status === 'error' && (
                            <div style={{ fontSize: '12px', color: 'var(--accent-2)', marginTop: '4px' }}>
                              {fetchState.error || 'Failed'}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isItemSaved('SUGGESTION', suggestion.id)) {
                                const saved = getSavedItems().find(item => item.suggestion_id === suggestion.id);
                                if (saved) removeSavedItem(saved.id);
                              } else {
                                saveItem({
                                  kind: 'SUGGESTION',
                                  title: suggestion.title,
                                  graph_id: suggestion.graph_id,
                                  suggestion_id: suggestion.id,
                                  concept_id: suggestion.concept_id,
                                });
                              }
                              // Force re-render
                              setSuggestions(prev => [...prev]);
                            }}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: isItemSaved('SUGGESTION', suggestion.id) ? 'var(--accent)' : 'var(--muted)',
                              cursor: 'pointer',
                              fontSize: '16px',
                              padding: '4px 8px',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                            title={isItemSaved('SUGGESTION', suggestion.id) ? 'Remove from saved' : 'Save for later'}
                          >
                            {isItemSaved('SUGGESTION', suggestion.id) ? '🔖' : '🔗'}
                          </button>
                          <SuggestionOverflowMenu
                            suggestion={suggestion}
                            onDismiss={() => handleDismissSuggestion(suggestion.id, suggestion.type)}
                            onSnooze1Day={() => handleSnoozeSuggestion(suggestion.id, SNOOZE_DURATIONS.ONE_DAY)}
                            onSnooze1Week={() => handleSnoozeSuggestion(suggestion.id, SNOOZE_DURATIONS.ONE_WEEK)}
                          />
                          <button
                            onClick={() => handleSuggestionAction(suggestion)}
                            disabled={isLoading}
                            style={{
                              padding: '6px 12px',
                              background: isLoading ? 'var(--muted)' : 'var(--accent)',
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: '600',
                              cursor: isLoading ? 'not-allowed' : 'pointer',
                              whiteSpace: 'nowrap',
                              opacity: isLoading ? 0.6 : 1,
                            }}
                          >
                            {isLoading ? 'Loading...' : getSuggestionActionLabel(suggestion)}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ color: 'var(--muted)', fontSize: '14px' }}>
                  No suggestions available
                </div>
              )}
            </div>

            {/* Because you recently... */}
            {recentSignals.length > 0 && (
              <div style={{
                background: 'var(--panel)',
                borderRadius: '12px',
                padding: '24px',
                boxShadow: 'var(--shadow)',
              }}>
                <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '8px' }}>
                  Because you recently…
                </h2>
                <p style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '16px', margin: '0 0 16px 0' }}>
                  A few suggestions based on what you touched last.
                </p>
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
                                : getSuggestionActionLabel(suggestion.action.kind)}
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
                            Review Evidence
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Continue Card */}
            <div style={{
              background: 'var(--panel)',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: 'var(--shadow)',
            }}>
              <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px' }}>
                Continue
              </h2>
              {hasLastSession ? (
                <div>
                  {(mostRecentSession?.last_concept_name || lastSession?.concept_name) && (
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '4px' }}>
                        Last concept
                      </div>
                      <div style={{ fontSize: '16px', fontWeight: '600' }}>
                        {mostRecentSession?.last_concept_name || lastSession?.concept_name}
                      </div>
                    </div>
                  )}
                  {(mostRecentSession?.graph_id || lastSession?.graph_name) && (
                    <div style={{ marginBottom: '16px' }}>
                      <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '4px' }}>
                        Graph
                      </div>
                      <div style={{ fontSize: '14px' }}>
                        {lastSession?.graph_name || mostRecentSession?.graph_id}
                      </div>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
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
                      Resume
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
                </div>
              ) : (
                <div>
                  <div style={{ color: 'var(--muted)', fontSize: '14px', marginBottom: '20px' }}>
                    No recent session
                  </div>
                  <button
                    onClick={handleOpenExplorer}
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
                    Start exploring
                  </button>
                </div>
              )}
            </div>

            {/* Recent Sessions */}
            {recentSessions.length > 0 && (
              <div style={{
                background: 'var(--panel)',
                borderRadius: '12px',
                padding: '24px',
                boxShadow: 'var(--shadow)',
              }}>
                <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px' }}>
                  Recent Sessions
                </h2>
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
                        Resume
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Activity */}
            <div style={{
              background: 'var(--panel)',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: 'var(--shadow)',
            }}>
              <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px' }}>
                Recent Activity
              </h2>
              {activityEvents.length > 0 ? (
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
            </div>
          </div>

          {/* Right Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Pinned Graphs */}
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
              const pinnedGraphIds = getPinnedGraphs();
              const pinnedGraphs = pinnedGraphIds
                .slice(0, 5)
                .map(id => graphs.find(g => g.graph_id === id))
                .filter((g): g is GraphSummary => !!g);
              
              if (pinnedGraphs.length === 0) return null;
              
              return (
                <div style={{
                  background: 'var(--panel)',
                  borderRadius: '12px',
                  padding: '24px',
                  boxShadow: 'var(--shadow)',
                }}>
                  <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px' }}>
                    Graphs
                  </h2>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {pinnedGraphs.map((graph) => {
                      const nodes = graph.node_count ?? 0;
                      const edges = graph.edge_count ?? 0;
                      const updated = formatRelativeTime(graph.updated_at);
                      return (
                        <div
                          key={graph.graph_id}
                          style={{
                            padding: '12px',
                            borderRadius: '8px',
                            border: '1px solid var(--border)',
                            transition: 'background-color 0.1s',
                          }}
                        >
                          <div style={{ marginBottom: '12px' }}>
                            <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '4px', color: 'var(--ink)' }}>
                              {graph.name || graph.graph_id}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '8px' }}>
                              {nodes} nodes · {edges} edges · updated {updated}
                            </div>
                            {graphQualities[graph.graph_id] && (
                              <div style={{ marginBottom: '8px' }}>
                                <GraphHealthBadge quality={graphQualities[graph.graph_id]} />
                                <span style={{ fontSize: '11px', color: 'var(--muted)', marginLeft: '8px' }}>
                                  {graphQualities[graph.graph_id].stats.missing_description_pct}% missing descriptions · {graphQualities[graph.graph_id].stats.stale_evidence_pct}% stale
                                </span>
                              </div>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              onClick={() => navigateToExplorer({ graphId: graph.graph_id })}
                              style={{
                                flex: 1,
                                padding: '8px 12px',
                                background: 'var(--accent)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                fontSize: '13px',
                                fontWeight: '500',
                                cursor: 'pointer',
                              }}
                            >
                              Open
                            </button>
                            <button
                              onClick={() => router.push(`/graphs/${graph.graph_id}`)}
                              style={{
                                flex: 1,
                                padding: '8px 12px',
                                background: 'transparent',
                                color: 'var(--accent)',
                                border: '1px solid var(--accent)',
                                borderRadius: '6px',
                                fontSize: '13px',
                                fontWeight: '500',
                                cursor: 'pointer',
                              }}
                            >
                              Browse
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
            
            {/* Gaps to Resolve */}
            <div style={{
              background: 'var(--panel)',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: 'var(--shadow)',
            }}>
              <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px' }}>
                Gaps to Resolve
              </h2>
              {topGaps.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {topGaps.map((gap) => (
                    <div
                      key={gap.node_id}
                      style={{
                        padding: '12px',
                        borderRadius: '8px',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '4px' }}>
                            {gap.name}
                          </div>
                          <div style={{ 
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            background: getGapTypeBadgeColor(gap.type),
                            color: 'var(--muted)',
                            marginTop: '4px',
                          }}>
                            {getGapTypeLabel(gap.type)}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                        <button
                          onClick={() => handleGapOpen(gap.node_id)}
                          style={{
                            padding: '6px 12px',
                            background: 'transparent',
                            color: 'var(--accent)',
                            border: '1px solid var(--accent)',
                            borderRadius: '6px',
                            fontSize: '12px',
                            cursor: 'pointer',
                          }}
                        >
                          Open
                        </button>
                        <button
                          onClick={() => handleGapAsk(gap.name)}
                          style={{
                            padding: '6px 12px',
                            background: 'var(--accent)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '12px',
                            cursor: 'pointer',
                          }}
                        >
                          Ask
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: 'var(--muted)', fontSize: '14px' }}>
                  {gaps ? 'No gaps to resolve' : 'Loading gaps...'}
                </div>
              )}
            </div>

            {/* Pinned */}
            <div style={{
              background: 'var(--panel)',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: 'var(--shadow)',
            }}>
              <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px' }}>
                Pinned
              </h2>
              {pinnedConcepts.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {pinnedConcepts.map((concept) => (
                    <div
                      key={concept.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <div
                        onClick={() => handleConceptClick(concept.id)}
                        style={{
                          fontSize: '14px',
                          cursor: 'pointer',
                          color: 'var(--accent)',
                          flex: 1,
                        }}
                      >
                        {concept.name}
                      </div>
                      <button
                        onClick={() => handleTogglePin(concept)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--muted)',
                          cursor: 'pointer',
                          fontSize: '16px',
                          padding: '4px 8px',
                        }}
                        title="Unpin"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: 'var(--muted)', fontSize: '14px' }}>
                  No pinned items
                </div>
              )}
              <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                  Answers (Coming soon)
                </div>
              </div>
            </div>

            {/* Recently Viewed */}
            <div style={{
              background: 'var(--panel)',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: 'var(--shadow)',
            }}>
              <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px' }}>
                Recently Viewed
              </h2>
              {recentViews.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {recentViews.map((view) => (
                    <div
                      key={view.id}
                      onClick={() => handleConceptClick(view.id)}
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
            </div>

            {/* Continue Block */}
            <ContinueBlock 
              graphId={lastSession?.graph_id} 
              onPathResume={handlePathResume}
            />

            {/* Suggested Paths */}
            <div style={{
              background: 'var(--panel)',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: 'var(--shadow)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '20px', fontWeight: '600', margin: 0 }}>
                  Suggested Paths
                </h2>
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
              {pathsLoading ? (
                <div style={{ color: 'var(--muted)', fontSize: '14px' }}>
                  Loading paths...
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
            </div>
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
    </div>
  );
}

