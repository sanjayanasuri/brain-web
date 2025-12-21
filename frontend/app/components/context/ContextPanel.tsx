'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Concept, Resource, Suggestion } from '../../api-client';
import { fetchEvidenceForConcept, type FetchEvidenceResult } from '../../lib/evidenceFetch';
import { uploadResourceForConcept, getResourcesForConcept, getSuggestions, getSuggestedPaths, type SuggestedPath } from '../../api-client';
import { togglePinConcept, isConceptPinned } from '../../lib/sessionState';
import { isFinanceSnapshotResource, getSnapshotAsOf, formatSnapshotDate } from '../../utils/financeSnapshot';
import { toRgba } from '../../utils/colorUtils';
import { useLens } from '../context-providers/LensContext';
import {
  filterSuggestions,
  dismissSuggestion,
  snoozeSuggestion,
  SNOOZE_DURATIONS,
} from '../../lib/suggestionPrefs';
import { saveItem, removeSavedItem, isItemSaved, getSavedItems } from '../../lib/savedItems';
import { getConceptQuality, type ConceptQuality } from '../../api-client';
import { CoveragePill, FreshnessPill } from '../ui/QualityIndicators';

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

// Notes storage in localStorage
const NOTES_STORAGE_KEY = 'brainweb:conceptNotes';

interface ConceptNote {
  conceptId: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

function getNotesForConcept(conceptId: string): ConceptNote[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(NOTES_STORAGE_KEY);
    if (!stored) return [];
    const allNotes: ConceptNote[] = JSON.parse(stored);
    return allNotes.filter(n => n.conceptId === conceptId);
  } catch {
    return [];
  }
}

function addNoteToConcept(conceptId: string, content: string): void {
  if (typeof window === 'undefined') return;
  try {
    const stored = localStorage.getItem(NOTES_STORAGE_KEY);
    const allNotes: ConceptNote[] = stored ? JSON.parse(stored) : [];
    const newNote: ConceptNote = {
      conceptId,
      content,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    allNotes.push(newNote);
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(allNotes));
  } catch {
    // Ignore errors
  }
}

export type ContextPanelTab = 'overview' | 'evidence' | 'notes' | 'connections' | 'activity' | 'data';

interface ContextPanelProps {
  selectedNode: Concept | null;
  selectedResources: Resource[];
  isResourceLoading: boolean;
  resourceError: string | null;
  expandedResources: Set<string>;
  setExpandedResources: (updater: (prev: Set<string>) => Set<string>) => void;
  evidenceFilter: 'all' | 'browser_use' | 'upload' | 'notion';
  setEvidenceFilter: (filter: 'all' | 'browser_use' | 'upload' | 'notion') => void;
  evidenceSearch: string;
  setEvidenceSearch: (search: string) => void;
  activeTab: ContextPanelTab;
  setActiveTab: (tab: ContextPanelTab) => void;
  onClose?: () => void;
  onFetchEvidence?: (result: FetchEvidenceResult) => void;
  onResourceUpload?: (resource: Resource) => void;
  domainColors: Map<string, string>;
  neighborCount: number;
  isFinanceRelevant: boolean;
  IS_DEMO_MODE: boolean;
  // Activity tab props
  activityEvents?: Array<{
    id: string;
    type: string;
    title: string;
    timestamp: Date | null;
    detail?: string;
    resource_id?: string;
    url?: string;
    source_badge?: string;
    action?: {
      label: string;
      onClick: () => void;
    };
  }>;
  // Finance tab props
  financeTabContent?: React.ReactNode;
}

export default function ContextPanel({
  selectedNode,
  selectedResources,
  isResourceLoading,
  resourceError,
  expandedResources,
  setExpandedResources,
  evidenceFilter,
  setEvidenceFilter,
  evidenceSearch,
  setEvidenceSearch,
  activeTab,
  setActiveTab,
  onClose,
  onFetchEvidence,
  onResourceUpload,
  domainColors,
  neighborCount,
  isFinanceRelevant,
  IS_DEMO_MODE,
  activityEvents = [],
  financeTabContent,
}: ContextPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [fetchEvidenceState, setFetchEvidenceState] = useState<{
    conceptId: string;
    status: 'idle' | 'loading' | 'success' | 'empty' | 'error';
    addedCount?: number;
    error?: string;
  }>({ conceptId: '', status: 'idle' });
  
  const [notes, setNotes] = useState<ConceptNote[]>([]);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [isAddingNote, setIsAddingNote] = useState(false);
  
  // Next steps suggestions state
  const [nextStepsSuggestions, setNextStepsSuggestions] = useState<Suggestion[]>([]);
  const [nextStepsLoading, setNextStepsLoading] = useState(false);
  const nextStepsCacheRef = useRef<Map<string, Suggestion[]>>(new Map());
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null);
  const [learnMenuOpen, setLearnMenuOpen] = useState(false);
  const learnMenuRef = useRef<HTMLDivElement>(null);
  
  // Suggested paths state
  const [suggestedPaths, setSuggestedPaths] = useState<SuggestedPath[]>([]);
  const [pathsLoading, setPathsLoading] = useState(false);
  
  // Quality indicators state
  const [conceptQuality, setConceptQuality] = useState<ConceptQuality | null>(null);
  const [qualityLoading, setQualityLoading] = useState(false);

  // Check if selectedNode is in active path
  const activePathInfo = useMemo(() => {
    if (!selectedNode || typeof window === 'undefined') return null;
    try {
      const saved = localStorage.getItem('brain-web-active-path');
      if (!saved) return null;
      const data = JSON.parse(saved);
      const path = suggestedPaths.find(p => p.path_id === data.path_id);
      if (!path) return null;
      const stepIndex = path.steps.findIndex(s => s.concept_id === selectedNode.node_id);
      if (stepIndex === -1) return null;
      return { path, stepIndex };
    } catch {
      return null;
    }
  }, [selectedNode, suggestedPaths]);

  // localStorage utility for dismissed paths
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

  // Helper to determine if concept is "thin" (gap)
  const isConceptThin = useMemo(() => {
    if (!selectedNode) return false;
    // Missing description
    if (!selectedNode.description || selectedNode.description.length < 20) return true;
    // Low evidence count
    if (evidenceCount === 0) return true;
    // Check if it's flagged as a gap in suggestions
    const hasGapSuggestion = nextStepsSuggestions.some(s => 
      s.type === 'GAP_DEFINE' || s.type === 'GAP_EVIDENCE'
    );
    return hasGapSuggestion;
  }, [selectedNode, evidenceCount, nextStepsSuggestions]);

  // Close learn menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (learnMenuRef.current && !learnMenuRef.current.contains(event.target as Node)) {
        setLearnMenuOpen(false);
      }
    };
    if (learnMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [learnMenuOpen]);

  // Load notes when concept changes
  useEffect(() => {
    if (selectedNode) {
      setNotes(getNotesForConcept(selectedNode.node_id));
    } else {
      setNotes([]);
    }
  }, [selectedNode?.node_id]);
  
  // Load quality indicators when concept changes
  useEffect(() => {
    if (!selectedNode) {
      setConceptQuality(null);
      return;
    }
    
    setQualityLoading(true);
    const graphId = searchParams?.get('graph_id') || undefined;
    getConceptQuality(selectedNode.node_id, graphId)
      .then(setConceptQuality)
      .catch((err) => {
        console.warn('Failed to load concept quality:', err);
        setConceptQuality(null);
      })
      .finally(() => setQualityLoading(false));
  }, [selectedNode?.node_id, searchParams]);

  // Load next steps suggestions when concept changes
  useEffect(() => {
    if (!selectedNode) {
      setNextStepsSuggestions([]);
      return;
    }

    const conceptId = selectedNode.node_id;
    
    // Check cache first
    if (nextStepsCacheRef.current.has(conceptId)) {
      const cached = nextStepsCacheRef.current.get(conceptId)!;
      const filtered = filterSuggestions(cached);
      setNextStepsSuggestions(filtered);
      return;
    }

    // Fetch suggestions
    setNextStepsLoading(true);
    const graphId = searchParams?.get('graph_id') || undefined;
    
    getSuggestions(3, graphId, undefined, conceptId)
      .then((suggestions) => {
        const filtered = filterSuggestions(suggestions);
        setNextStepsSuggestions(filtered);
        // Cache the results
        nextStepsCacheRef.current.set(conceptId, suggestions);
      })
      .catch((error) => {
        console.warn('Failed to load next steps suggestions:', error);
        setNextStepsSuggestions([]);
      })
      .finally(() => {
        setNextStepsLoading(false);
      });
  }, [selectedNode?.node_id, searchParams]);

  // Load suggested paths when concept changes
  useEffect(() => {
    if (!selectedNode) {
      setSuggestedPaths([]);
      return;
    }

    const conceptId = selectedNode.node_id;
    setPathsLoading(true);
    const graphId = searchParams?.get('graph_id') || undefined;
    
    if (!graphId) {
      setPathsLoading(false);
      return;
    }

    getSuggestedPaths(graphId, conceptId, 2, activeLens)
      .then((paths) => {
        // Filter out dismissed paths
        const dismissed = getDismissedPaths(graphId);
        const filtered = paths.filter(p => !dismissed.includes(p.path_id));
        setSuggestedPaths(filtered);
      })
      .catch((error) => {
        console.warn('Failed to load suggested paths:', error);
        setSuggestedPaths([]);
      })
      .finally(() => {
        setPathsLoading(false);
      });
  }, [selectedNode?.node_id, searchParams, activeLens]);

  // Default tab logic: Lens-aware
  // - FINANCE lens + finance-relevant concept → Finance tab
  // - Check for ?tab=finance query param (from suggestions)
  // - Else: Evidence if count > 0, else Overview
  // Only set default when node changes, not when resources change
  const { activeLens } = useLens();
  const prevNodeIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedNode && selectedNode.node_id !== prevNodeIdRef.current) {
      prevNodeIdRef.current = selectedNode.node_id;
      
      // Check for ?tab=data query param first (from suggestions)
      const tabParam = searchParams?.get('tab');
      if (tabParam === 'data' && isFinanceRelevant) {
        setActiveTab('data');
      } else if (activeLens === 'FINANCE' && isFinanceRelevant) {
        // FINANCE lens + finance-relevant → Data tab
        setActiveTab('data');
      } else if (selectedResources.length > 0) {
        setActiveTab('evidence');
      } else {
        setActiveTab('overview');
      }
    }
  }, [selectedNode?.node_id, setActiveTab, isFinanceRelevant, activeLens, searchParams]);

  const evidenceCount = selectedResources.length;
  const notesCount = notes.length;
  const connectionsCount = neighborCount;

  const isPinned = selectedNode ? isConceptPinned(selectedNode.node_id) : false;

  const handleFetchEvidence = async () => {
    if (!selectedNode) return;
    setFetchEvidenceState({ conceptId: selectedNode.node_id, status: 'loading' });
    try {
      const graphId = searchParams?.get('graph_id') || undefined;
      const result = await fetchEvidenceForConcept(selectedNode.node_id, selectedNode.name, graphId);
      
      if (result.error) {
        setFetchEvidenceState({
          conceptId: selectedNode.node_id,
          status: 'error',
          error: result.error,
        });
        return;
      }

      if (result.resources) {
        onFetchEvidence?.(result);
      }

      if (result.addedCount === 0) {
        setFetchEvidenceState({
          conceptId: selectedNode.node_id,
          status: 'empty',
        });
      } else {
        setFetchEvidenceState({
          conceptId: selectedNode.node_id,
          status: 'success',
          addedCount: result.addedCount,
        });
        // Auto-switch to Evidence tab
        setActiveTab('evidence');
        // Invalidate cache for this concept to refresh suggestions
        nextStepsCacheRef.current.delete(selectedNode.node_id);
        // Refresh suggestions after a short delay
        setTimeout(() => {
          const graphId = searchParams?.get('graph_id') || undefined;
          getSuggestions(3, graphId, undefined, selectedNode.node_id)
            .then((suggestions) => {
              setNextStepsSuggestions(suggestions);
              nextStepsCacheRef.current.set(selectedNode.node_id, suggestions);
            })
            .catch(console.warn);
        }, 1000);
      }
    } catch (error) {
      setFetchEvidenceState({
        conceptId: selectedNode.node_id,
        status: 'error',
        error: error instanceof Error ? error.message : 'Failed to fetch evidence',
      });
    }
  };

  const handleDismissSuggestion = (id: string, type?: SuggestionType) => {
    dismissSuggestion(id, type);
    setNextStepsSuggestions(prev => prev.filter(s => s.id !== id));
    setDismissedMessage('Dismissed');
    setTimeout(() => setDismissedMessage(null), 2000);
  };

  const handleSnoozeSuggestion = (id: string, durationMs: number) => {
    snoozeSuggestion(id, durationMs);
    setNextStepsSuggestions(prev => prev.filter(s => s.id !== id));
    const durationLabel = durationMs === SNOOZE_DURATIONS.ONE_DAY ? '1 day' : '1 week';
    setDismissedMessage(`Snoozed for ${durationLabel}`);
    setTimeout(() => setDismissedMessage(null), 2000);
  };

  const handleSuggestionAction = async (suggestion: Suggestion) => {
    // For quality suggestions, prefer primary_action if available
    const action = suggestion.primary_action || suggestion.action;
    
    if (action.kind === 'OPEN_CONCEPT') {
      // Check if suggestion is for a finance-relevant concept and we're in Finance lens
      const shouldOpenFinance = isFinanceRelevant && activeLens === 'FINANCE';
      
      if (action.href) {
        router.push(action.href);
      } else if (suggestion.concept_id) {
        // If this is the current concept and finance-relevant, switch to Data tab
        if (selectedNode?.node_id === suggestion.concept_id && shouldOpenFinance) {
          setActiveTab('data');
          return;
        }
        
        const params = new URLSearchParams();
        params.set('select', suggestion.concept_id);
        if (suggestion.graph_id) {
          params.set('graph_id', suggestion.graph_id);
        }
        router.push(`/?${params.toString()}`);
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
      const payload = action.payload || (suggestion.action as any).payload;
      if (suggestion.concept_id && suggestion.concept_name) {
        const conceptName = payload?.concept_name || suggestion.concept_name;
        const conceptId = suggestion.concept_id;
        setFetchEvidenceState({ conceptId, status: 'loading' });
        try {
          const graphId = searchParams?.get('graph_id') || undefined;
          const result = await fetchEvidenceForConcept(conceptId, conceptName, graphId);
          
          if (result.error) {
            setFetchEvidenceState({
              conceptId,
              status: 'error',
              error: result.error,
            });
            return;
          }

          if (result.resources) {
            onFetchEvidence?.(result);
          }

          if (result.addedCount === 0) {
            setFetchEvidenceState({
              conceptId,
              status: 'empty',
            });
          } else {
            setFetchEvidenceState({
              conceptId,
              status: 'success',
              addedCount: result.addedCount,
            });
            // Auto-switch to Evidence tab
            setActiveTab('evidence');
            // Invalidate cache to refresh suggestions
            nextStepsCacheRef.current.delete(conceptId);
            // Refresh suggestions after a short delay
            setTimeout(() => {
              const graphId = searchParams?.get('graph_id') || undefined;
              getSuggestions(3, graphId, undefined, conceptId)
                .then((suggestions) => {
                  setNextStepsSuggestions(suggestions);
                  nextStepsCacheRef.current.set(conceptId, suggestions);
                })
                .catch(console.warn);
            }, 1000);
          }
        } catch (error) {
          setFetchEvidenceState({
            conceptId,
            status: 'error',
            error: error instanceof Error ? error.message : 'Failed to fetch evidence',
          });
        }
      }
    }
  };

  const handleAttach = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file || !selectedNode) return;
      try {
        const res = await uploadResourceForConcept(file, selectedNode.node_id, file.name);
        onResourceUpload?.(res);
      } catch (err) {
        console.error('Failed to upload resource:', err);
      }
    };
    input.click();
  };

  const handleAddNote = async () => {
    if (!selectedNode || !newNoteContent.trim() || isAddingNote) return;
    setIsAddingNote(true);
    addNoteToConcept(selectedNode.node_id, newNoteContent.trim());
    setNotes(getNotesForConcept(selectedNode.node_id));
    setNewNoteContent('');
    setIsAddingNote(false);
  };

  const handlePin = () => {
    if (!selectedNode) return;
    const graphId = searchParams?.get('graph_id') || undefined;
    togglePinConcept({ id: selectedNode.node_id, name: selectedNode.name }, graphId);
    // Force re-render by toggling state
    setFetchEvidenceState(prev => ({ ...prev }));
  };

  const handleLearnAction = (action: 'explain' | 'example' | 'prerequisites' | 'test') => {
    if (!selectedNode) return;
    setLearnMenuOpen(false);
    
    const conceptName = selectedNode.name;
    let prompt = '';
    
    switch (action) {
      case 'explain':
        prompt = `Explain ${conceptName}`;
        break;
      case 'example':
        prompt = `Give an example of ${conceptName}`;
        break;
      case 'prerequisites':
        prompt = `What are the prerequisites for understanding ${conceptName}?`;
        break;
      case 'test':
        prompt = `Test my understanding of ${conceptName}`;
        break;
    }
    
    // Navigate to explorer with chat prompt
    const params = new URLSearchParams();
    params.set('select', selectedNode.node_id);
    params.set('chat', prompt);
    const graphId = searchParams?.get('graph_id');
    if (graphId) {
      params.set('graph_id', graphId);
    }
    router.push(`/?${params.toString()}`);
  };

  // Empty state
  if (!selectedNode) {
    return (
      <div className="context-panel" style={{
        width: '380px',
        borderLeft: '1px solid var(--border)',
        background: 'var(--background)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}>
        <div style={{
          padding: '48px 24px',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 1,
        }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--ink)', margin: 0 }}>
            Select a concept
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--muted)', margin: 0, maxWidth: '280px' }}>
            Click a node or search to open details.
          </p>
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button
              className="pill"
              style={{
                background: 'var(--accent)',
                color: 'white',
                border: 'none',
                cursor: 'pointer',
              }}
              onClick={() => {
                // Trigger search - this would need to be passed as a prop
                const searchInput = document.querySelector('input[type="search"], input[placeholder*="Search"]') as HTMLInputElement;
                if (searchInput) {
                  searchInput.focus();
                }
              }}
            >
              Search
            </button>
            <button
              className="pill pill--ghost"
              style={{
                cursor: 'pointer',
              }}
            >
              Explore recent
            </button>
          </div>
        </div>
      </div>
    );
  }

  const currentFetchState = fetchEvidenceState.conceptId === selectedNode.node_id 
    ? fetchEvidenceState 
    : { conceptId: selectedNode.node_id, status: 'idle' as const };

  const hasResources = evidenceCount > 0;
  const isFetching = currentFetchState.status === 'loading';
  const fetchSuccess = currentFetchState.status === 'success';
  const fetchEmpty = currentFetchState.status === 'empty';
  const fetchError = currentFetchState.status === 'error';

  const domainColor = domainColors.get(selectedNode.domain) || '#0f172a';

  return (
    <div className="context-panel" style={{
      width: '380px',
      borderLeft: '1px solid var(--border)',
      background: 'var(--background)',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '20px',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ 
              fontSize: '20px', 
              fontWeight: '600', 
              color: 'var(--ink)', 
              margin: 0,
              lineHeight: '1.3',
            }}>
              {selectedNode.name}
            </h2>
            {activePathInfo && (
              <button
                onClick={() => {
                  // Scroll to path runner (it's at the bottom)
                  const runner = document.querySelector('[data-path-runner]');
                  if (runner) {
                    runner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                  }
                }}
                style={{
                  marginTop: '6px',
                  padding: '2px 8px',
                  background: 'rgba(var(--accent-rgb), 0.1)',
                  color: 'var(--accent)',
                  border: '1px solid rgba(var(--accent-rgb), 0.3)',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
                title={`Step ${activePathInfo.stepIndex + 1} of ${activePathInfo.path.steps.length} in path`}
              >
                In path: {activePathInfo.path.title.length > 25 
                  ? `${activePathInfo.path.title.substring(0, 25)}...` 
                  : activePathInfo.path.title}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isItemSaved('CONCEPT', selectedNode.node_id)) {
                  const saved = getSavedItems().find(item => item.concept_id === selectedNode.node_id);
                  if (saved) removeSavedItem(saved.id);
                } else {
                  const graphId = searchParams?.get('graph_id') || undefined;
                  saveItem({
                    kind: 'CONCEPT',
                    title: selectedNode.name,
                    graph_id: graphId,
                    concept_id: selectedNode.node_id,
                  });
                }
                // Force re-render
                setFetchEvidenceState(prev => ({ ...prev }));
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: isItemSaved('CONCEPT', selectedNode.node_id) ? 'var(--accent)' : 'var(--muted)',
                cursor: 'pointer',
                fontSize: '16px',
                padding: '4px 8px',
                display: 'flex',
                alignItems: 'center',
              }}
              title={isItemSaved('CONCEPT', selectedNode.node_id) ? 'Remove from saved' : 'Save concept'}
            >
              {isItemSaved('CONCEPT', selectedNode.node_id) ? '🔖' : '🔗'}
            </button>
            {/* Learn button (only for thin/gap concepts) */}
            {isConceptThin && (
              <div style={{ position: 'relative' }} ref={learnMenuRef}>
                <button
                  onClick={() => setLearnMenuOpen(!learnMenuOpen)}
                  className="pill pill--ghost"
                  style={{
                    fontSize: '12px',
                    cursor: 'pointer',
                    padding: '4px 10px',
                  }}
                  title="Learn about this concept"
                >
                  Learn
                </button>
                {learnMenuOpen && (
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
                    minWidth: '180px',
                    overflow: 'hidden',
                  }}>
                    <button
                      onClick={() => handleLearnAction('explain')}
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
                      Explain this concept
                    </button>
                    <button
                      onClick={() => handleLearnAction('example')}
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
                      Give an example
                    </button>
                    <button
                      onClick={() => handleLearnAction('prerequisites')}
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
                      Show prerequisites
                    </button>
                    <button
                      onClick={() => handleLearnAction('test')}
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
                      Test my understanding
                    </button>
                  </div>
                )}
              </div>
            )}
            <button
              onClick={handlePin}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                color: isPinned ? 'var(--accent)' : 'var(--muted)',
                fontSize: '18px',
              }}
              title={isPinned ? 'Unpin concept' : 'Pin concept'}
            >
              {isPinned ? '📌' : '📍'}
            </button>
            {onClose && (
              <button
                onClick={onClose}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px',
                  color: 'var(--muted)',
                  fontSize: '18px',
                }}
                title="Close"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Chips row */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
          <span className="badge" style={{ 
            background: toRgba(domainColor, 0.16), 
            color: domainColor,
            fontSize: '12px',
          }}>
            {selectedNode.domain}
          </span>
          <span className="badge badge--soft" style={{ fontSize: '12px' }}>
            {selectedNode.type}
          </span>
          {evidenceCount > 0 && (
            <span className="badge badge--soft" style={{ fontSize: '12px' }}>
              Evidence: {evidenceCount}
            </span>
          )}
        </div>

        {/* Finance shortcut button (only for company concepts) */}
        {isFinanceRelevant && (
          <div style={{ marginBottom: '8px' }}>
            <button
              onClick={() => setActiveTab('data')}
              className="pill pill--ghost"
              style={{
                fontSize: '12px',
                cursor: 'pointer',
                padding: '6px 12px',
              }}
            >
              Data
            </button>
          </div>
        )}

        {/* Description preview */}
        {selectedNode.description && (
          <p style={{
            fontSize: '13px',
            lineHeight: '1.5',
            color: 'var(--muted)',
            margin: 0,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {selectedNode.description}
          </p>
        )}
      </div>

      {/* Quick Actions Row */}
      <div style={{
        padding: '12px 20px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        gap: '8px',
        flexWrap: 'wrap',
      }}>
        <button
          onClick={handleFetchEvidence}
          disabled={isFetching}
          style={{
            padding: '8px 16px',
            background: hasResources 
              ? 'transparent' 
              : (isFetching ? 'var(--muted)' : 'var(--accent)'),
            color: hasResources 
              ? 'var(--accent)' 
              : 'white',
            border: hasResources 
              ? '1px solid var(--accent)' 
              : 'none',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: '600',
            cursor: isFetching ? 'not-allowed' : 'pointer',
            flex: hasResources ? 0 : 1,
            minWidth: hasResources ? 'auto' : '120px',
            transition: 'all 0.2s',
          }}
        >
          {isFetching ? 'Fetching...' : 'Fetch Evidence'}
        </button>
        <button
          onClick={handleAttach}
          className="pill pill--ghost"
          style={{
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          Attach
        </button>
        <button
          onClick={handleAddNote}
          disabled={!newNoteContent.trim() || isAddingNote}
          className="pill pill--ghost"
          style={{
            fontSize: '13px',
            cursor: newNoteContent.trim() && !isAddingNote ? 'pointer' : 'not-allowed',
            opacity: newNoteContent.trim() && !isAddingNote ? 1 : 0.5,
          }}
        >
          Add Note
        </button>
        <button
          onClick={handlePin}
          className="pill pill--ghost"
          style={{
            fontSize: '13px',
            cursor: 'pointer',
            color: isPinned ? 'var(--accent)' : 'var(--muted)',
          }}
        >
          Pin
        </button>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        gap: '0',
        borderBottom: '2px solid var(--border)',
        padding: '0 20px',
        overflowX: 'auto',
      }}>
        {(['overview', 'evidence', 'notes', 'connections', 'activity'] as const).map(tab => {
          let label = tab.charAt(0).toUpperCase() + tab.slice(1);
          let badge: number | null = null;
          
          if (tab === 'evidence') {
            badge = evidenceCount;
          } else if (tab === 'notes') {
            badge = notesCount;
          } else if (tab === 'connections') {
            badge = connectionsCount;
          }

          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '10px 12px',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === tab ? '3px solid var(--accent)' : '3px solid transparent',
                color: activeTab === tab ? 'var(--accent)' : 'var(--muted)',
                fontSize: '13px',
                fontWeight: activeTab === tab ? '600' : '400',
                cursor: 'pointer',
                transition: 'all 0.2s',
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {label}
              {badge !== null && badge > 0 && (
                <span style={{
                  background: activeTab === tab ? 'var(--accent)' : 'var(--border)',
                  color: activeTab === tab ? 'white' : 'var(--muted)',
                  fontSize: '11px',
                  padding: '2px 6px',
                  borderRadius: '10px',
                  fontWeight: '600',
                }}>
                  {badge}
                </span>
              )}
            </button>
          );
        })}
        {isFinanceRelevant && (
          <button
            onClick={() => setActiveTab('data')}
            style={{
              padding: '10px 12px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'data' ? '3px solid var(--accent)' : '3px solid transparent',
              color: activeTab === 'data' ? 'var(--accent)' : 'var(--muted)',
              fontSize: '13px',
              fontWeight: activeTab === 'data' ? '600' : '400',
              cursor: 'pointer',
              transition: 'all 0.2s',
              whiteSpace: 'nowrap',
            }}
          >
            Data
          </button>
        )}
      </div>

      {/* Tab Content */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '20px',
      }}>
        {activeTab === 'overview' && (
          <div>
            <div style={{ marginBottom: '16px' }}>
              <h4 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '8px', color: 'var(--ink)' }}>
                {selectedNode.name}
              </h4>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px', alignItems: 'center' }}>
                <span className="badge badge--soft">{selectedNode.type}</span>
                <span className="badge" style={{ 
                  background: toRgba(domainColor, 0.16), 
                  color: domainColor,
                }}>
                  {selectedNode.domain}
                </span>
                {conceptQuality && !qualityLoading && (
                  <>
                    <CoveragePill 
                      coverageScore={conceptQuality.coverage_score} 
                      breakdown={conceptQuality.coverage_breakdown}
                    />
                    <FreshnessPill freshness={conceptQuality.freshness} />
                  </>
                )}
              </div>
            </div>

            {/* Thin concept callout */}
            {isConceptThin && (
              <div style={{
                marginBottom: '16px',
                padding: '12px',
                background: 'rgba(17, 138, 178, 0.05)',
                border: '1px solid rgba(17, 138, 178, 0.2)',
                borderRadius: '8px',
              }}>
                <div style={{ fontSize: '13px', fontWeight: '500', color: 'var(--ink)', marginBottom: '8px' }}>
                  This concept is underdeveloped
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => handleLearnAction('explain')}
                    className="pill pill--ghost"
                    style={{
                      fontSize: '12px',
                      cursor: 'pointer',
                      padding: '6px 12px',
                    }}
                  >
                    Explain
                  </button>
                  <button
                    onClick={handleFetchEvidence}
                    disabled={isFetching}
                    className="pill pill--ghost"
                    style={{
                      fontSize: '12px',
                      cursor: isFetching ? 'not-allowed' : 'pointer',
                      padding: '6px 12px',
                      opacity: isFetching ? 0.5 : 1,
                    }}
                  >
                    Add evidence
                  </button>
                  <button
                    onClick={() => handleLearnAction('prerequisites')}
                    className="pill pill--ghost"
                    style={{
                      fontSize: '12px',
                      cursor: 'pointer',
                      padding: '6px 12px',
                    }}
                  >
                    Connect prerequisites
                  </button>
                </div>
              </div>
            )}

            {/* Next steps module */}
            <div style={{ 
              marginBottom: '16px',
              padding: '12px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              maxHeight: '140px',
              overflowY: 'auto',
            }}>
              <h5 style={{ 
                fontSize: '13px', 
                fontWeight: '600', 
                marginBottom: '8px', 
                color: 'var(--ink)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}>
                Next steps
              </h5>
              
              {dismissedMessage && (
                <div style={{
                  padding: '6px 10px',
                  background: 'var(--accent)',
                  color: 'white',
                  borderRadius: '6px',
                  fontSize: '11px',
                  marginBottom: '8px',
                }}>
                  {dismissedMessage}
                </div>
              )}
              {nextStepsLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[1, 2, 3].map((i) => (
                    <div key={i} style={{ 
                      height: '40px', 
                      background: 'var(--background)', 
                      borderRadius: '6px',
                      animation: 'pulse 1.5s ease-in-out infinite',
                    }} />
                  ))}
                </div>
              ) : nextStepsSuggestions.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {(() => {
                    // Sort suggestions: promote GAP_DEFINE and GAP_EVIDENCE when LEARNING lens is active
                    const sorted = [...nextStepsSuggestions];
                    if (activeLens === 'LEARNING') {
                      sorted.sort((a, b) => {
                        const aIsGap = a.type === 'GAP_DEFINE' || a.type === 'GAP_EVIDENCE';
                        const bIsGap = b.type === 'GAP_DEFINE' || b.type === 'GAP_EVIDENCE';
                        if (aIsGap && !bIsGap) return -1;
                        if (!aIsGap && bIsGap) return 1;
                        return 0;
                      });
                    }
                    return sorted;
                  })().map((suggestion) => (
                    <div 
                      key={suggestion.id}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: '8px',
                        padding: '8px',
                        background: 'var(--background)',
                        borderRadius: '6px',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ 
                          fontSize: '13px', 
                          fontWeight: '500', 
                          color: 'var(--ink)',
                          marginBottom: '2px',
                        }}>
                          {suggestion.title}
                        </div>
                        <div style={{ 
                          fontSize: '11px', 
                          color: 'var(--muted)',
                          lineHeight: '1.4',
                        }}>
                          {suggestion.rationale}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
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
                            setNextStepsSuggestions(prev => [...prev]);
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: isItemSaved('SUGGESTION', suggestion.id) ? 'var(--accent)' : 'var(--muted)',
                            cursor: 'pointer',
                            fontSize: '14px',
                            padding: '4px 6px',
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
                          disabled={
                            suggestion.action.kind === 'FETCH_EVIDENCE' && 
                            fetchEvidenceState.status === 'loading' &&
                            fetchEvidenceState.conceptId === suggestion.concept_id
                          }
                          style={{
                            flexShrink: 0,
                            padding: '6px 12px',
                            fontSize: '12px',
                            fontWeight: '600',
                            background: suggestion.action.kind === 'FETCH_EVIDENCE' && 
                              fetchEvidenceState.status === 'loading' &&
                              fetchEvidenceState.conceptId === suggestion.concept_id
                              ? 'var(--muted)'
                              : 'var(--accent)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: suggestion.action.kind === 'FETCH_EVIDENCE' && 
                              fetchEvidenceState.status === 'loading' &&
                              fetchEvidenceState.conceptId === suggestion.concept_id
                              ? 'not-allowed'
                              : 'pointer',
                            whiteSpace: 'nowrap',
                            transition: 'all 0.2s',
                          }}
                        >
                          {suggestion.action.kind === 'FETCH_EVIDENCE' && 
                           fetchEvidenceState.status === 'loading' &&
                           fetchEvidenceState.conceptId === suggestion.concept_id
                            ? 'Fetching...'
                            : suggestion.action.kind === 'OPEN_REVIEW'
                            ? 'Review'
                            : suggestion.action.kind === 'FETCH_EVIDENCE'
                            ? 'Fetch Evidence'
                            : activeLens === 'LEARNING' && suggestion.type === 'GAP_DEFINE'
                            ? 'Learn'
                            : activeLens === 'LEARNING' && suggestion.action.kind === 'OPEN_CONCEPT'
                            ? 'Explore'
                            : 'Open'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ 
                  padding: '12px',
                  textAlign: 'center',
                  color: 'var(--muted)',
                  fontSize: '13px',
                }}>
                  <div style={{ marginBottom: '8px' }}>Nothing urgent here.</div>
                  <button
                    onClick={() => setActiveTab('connections')}
                    style={{
                      padding: '6px 12px',
                      fontSize: '12px',
                      background: 'transparent',
                      color: 'var(--accent)',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    Explore connections
                  </button>
                </div>
              )}
            </div>

            {/* Quality suggestions (only for this concept) */}
            {(() => {
              const qualityTypes: SuggestionType[] = ['COVERAGE_LOW', 'EVIDENCE_STALE'];
              const qualitySuggestions = nextStepsSuggestions.filter(s => 
                qualityTypes.includes(s.type) && s.concept_id === selectedNode?.node_id
              );
              
              if (qualitySuggestions.length === 0) return null;
              
              return (
                <div style={{ 
                  marginBottom: '16px',
                  padding: '10px',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  opacity: 0.9,
                }}>
                  <div style={{ 
                    fontSize: '12px', 
                    fontWeight: '600', 
                    marginBottom: '8px', 
                    color: 'var(--muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    Quality nudges
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {qualitySuggestions.map((suggestion) => (
                      <div
                        key={suggestion.id}
                        style={{
                          padding: '8px',
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
                          gap: '8px',
                        }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ 
                              fontSize: '12px', 
                              fontWeight: '500', 
                              color: 'var(--ink)',
                              marginBottom: '2px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}>
                              {suggestion.title}
                              {suggestion.explanation && (
                                <span
                                  title={suggestion.explanation}
                                  style={{
                                    cursor: 'help',
                                    fontSize: '10px',
                                    color: 'var(--muted)',
                                    opacity: 0.7,
                                  }}
                                >
                                  ℹ️
                                </span>
                              )}
                            </div>
                            <div style={{ 
                              fontSize: '11px', 
                              color: 'var(--muted)',
                              lineHeight: '1.3',
                            }}>
                              {suggestion.explanation || suggestion.rationale}
                            </div>
                          </div>
                          {suggestion.primary_action && (
                            <button
                              onClick={() => handleSuggestionAction(suggestion)}
                              style={{
                                flexShrink: 0,
                                padding: '4px 8px',
                                fontSize: '11px',
                                fontWeight: '500',
                                background: 'var(--accent)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {suggestion.primary_action.label || 'Action'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Suggested paths module */}
            {suggestedPaths.length > 0 && (
              <div style={{ 
                marginBottom: '16px',
                padding: '12px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
              }}>
                <h5 style={{ 
                  fontSize: '13px', 
                  fontWeight: '600', 
                  marginBottom: '8px', 
                  color: 'var(--ink)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}>
                  Suggested paths
                </h5>
                {pathsLoading ? (
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                    Loading paths...
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {suggestedPaths.map((path) => (
                      <div
                        key={path.path_id}
                        style={{
                          padding: '10px',
                          background: 'var(--background)',
                          borderRadius: '6px',
                          border: '1px solid var(--border)',
                          position: 'relative',
                        }}
                      >
                        <div style={{ position: 'absolute', top: '8px', right: '8px', display: 'flex', gap: '4px' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isItemSaved('PATH', path.path_id)) {
                                const saved = getSavedItems().find(item => item.path_id === path.path_id);
                                if (saved) removeSavedItem(saved.id);
                              } else {
                                const graphId = searchParams?.get('graph_id') || undefined;
                                saveItem({
                                  kind: 'PATH',
                                  title: path.title,
                                  graph_id: graphId,
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
                              fontSize: '14px',
                              padding: '2px 6px',
                            }}
                            title={isItemSaved('PATH', path.path_id) ? 'Remove from saved' : 'Save path'}
                          >
                            {isItemSaved('PATH', path.path_id) ? '🔖' : '🔗'}
                          </button>
                          <button
                            onClick={() => {
                              const graphId = searchParams?.get('graph_id');
                              if (graphId) {
                                const dismissed = getDismissedPaths(graphId);
                                if (!dismissed.includes(path.path_id)) {
                                  dismissed.push(path.path_id);
                                  localStorage.setItem(`brainweb:paths:dismissed:${graphId}`, JSON.stringify(dismissed));
                                }
                                setSuggestedPaths(prev => prev.filter(p => p.path_id !== path.path_id));
                              }
                            }}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--muted)',
                              cursor: 'pointer',
                              fontSize: '16px',
                              padding: '2px 6px',
                            }}
                            title="Dismiss"
                          >
                            ×
                          </button>
                        </div>
                        <div style={{ fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: 'var(--ink)', paddingRight: '24px' }}>
                          {path.title}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '8px' }}>
                          {path.rationale}
                        </div>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '8px' }}>
                          {path.steps.slice(0, 6).map((step, idx) => (
                            <button
                              key={step.concept_id}
                              onClick={() => {
                                const params = new URLSearchParams();
                                params.set('select', step.concept_id);
                                const graphId = searchParams?.get('graph_id');
                                if (graphId) {
                                  params.set('graph_id', graphId);
                                }
                                router.push(`/?${params.toString()}`);
                              }}
                              style={{
                                fontSize: '10px',
                                padding: '3px 8px',
                                background: idx === 0 ? 'var(--accent)' : 'var(--surface)',
                                color: idx === 0 ? 'white' : 'var(--ink)',
                                border: `1px solid ${idx === 0 ? 'var(--accent)' : 'var(--border)'}`,
                                borderRadius: '4px',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                              }}
                              title={step.name}
                            >
                              {step.name.length > 15 ? `${step.name.substring(0, 15)}...` : step.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Data snapshot teaser card (only for tracked concepts) */}
            {isFinanceRelevant && (() => {
              const financeSnapshot = selectedResources.find(res => isFinanceSnapshotResource(res));
              const snapshotAsOf = financeSnapshot ? getSnapshotAsOf(financeSnapshot) : null;
              
              return (
                <div style={{ 
                  marginBottom: '16px',
                  padding: '12px',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                }}>
                  <h5 style={{ 
                    fontSize: '13px', 
                    fontWeight: '600', 
                    marginBottom: '8px', 
                    color: 'var(--ink)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    Data snapshot
                  </h5>
                  
                  {financeSnapshot && snapshotAsOf ? (
                    <div>
                      <div style={{ 
                        fontSize: '12px', 
                        color: 'var(--muted)', 
                        marginBottom: '8px' 
                      }}>
                        Last updated: {formatSnapshotDate(snapshotAsOf)}
                      </div>
                      <button
                        onClick={() => setActiveTab('data')}
                        className="pill pill--ghost"
                        style={{
                          fontSize: '12px',
                          cursor: 'pointer',
                          padding: '6px 12px',
                        }}
                      >
                        Open Data tab
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div style={{ 
                        fontSize: '12px', 
                        color: 'var(--muted)', 
                        marginBottom: '8px' 
                      }}>
                        No snapshot yet
                      </div>
                      <div style={{ 
                        fontSize: '11px', 
                        color: 'var(--muted)', 
                        fontStyle: 'italic',
                        marginBottom: '8px' 
                      }}>
                        Enable Data lens to fetch snapshots
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {selectedNode.description ? (
              <div style={{ fontSize: '14px', lineHeight: '1.6', color: 'var(--ink)', marginBottom: '16px' }}>
                {(() => {
                  const sentences = selectedNode.description.split(/[.!?]+/).filter(s => s.trim().length > 0);
                  const truncated = sentences.slice(0, 6).join('. ').trim();
                  return truncated + (sentences.length > 6 ? '...' : '');
                })()}
              </div>
            ) : (
              <p style={{ fontStyle: 'italic', marginBottom: '16px', color: 'var(--muted)' }}>
                No description available. This node represents: {selectedNode.name}
              </p>
            )}

            {/* Fetch Evidence CTA */}
            <div style={{ 
              padding: '16px', 
              background: hasResources ? 'var(--background)' : 'rgba(17, 138, 178, 0.05)',
              border: hasResources ? '1px solid var(--border)' : '1px solid rgba(17, 138, 178, 0.2)',
              borderRadius: '8px',
              marginBottom: '16px',
            }}>
              <div style={{ marginBottom: '8px' }}>
                <button
                  onClick={handleFetchEvidence}
                  disabled={isFetching}
                  style={{
                    padding: '10px 16px',
                    background: hasResources 
                      ? 'transparent' 
                      : (isFetching ? 'var(--muted)' : 'var(--accent)'),
                    color: hasResources 
                      ? 'var(--accent)' 
                      : 'white',
                    border: hasResources 
                      ? '1px solid var(--accent)' 
                      : 'none',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: isFetching ? 'not-allowed' : 'pointer',
                    width: '100%',
                    transition: 'all 0.2s',
                  }}
                >
                  {isFetching ? 'Fetching...' : 'Fetch Evidence'}
                </button>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '8px' }}>
                Pull supporting sources from the web and attach them to this concept.
              </div>
              
              {fetchSuccess && currentFetchState.addedCount !== undefined && (
                <div style={{ 
                  padding: '8px 12px', 
                  background: 'rgba(34, 197, 94, 0.1)', 
                  borderRadius: '6px',
                  fontSize: '13px',
                  color: 'rgb(34, 197, 94)',
                  marginTop: '8px',
                }}>
                  Added {currentFetchState.addedCount} source{currentFetchState.addedCount !== 1 ? 's' : ''}
                  <button
                    onClick={() => setActiveTab('evidence')}
                    style={{
                      marginLeft: '12px',
                      background: 'transparent',
                      border: 'none',
                      color: 'rgb(34, 197, 94)',
                      textDecoration: 'underline',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: '600',
                    }}
                  >
                    Review evidence →
                  </button>
                </div>
              )}

              {fetchEmpty && (
                <div style={{ 
                  padding: '8px 12px', 
                  background: 'rgba(251, 191, 36, 0.1)', 
                  borderRadius: '6px',
                  fontSize: '13px',
                  color: 'rgb(251, 191, 36)',
                  marginTop: '8px',
                }}>
                  No sources found
                </div>
              )}

              {fetchError && currentFetchState.error && (
                <div style={{ 
                  padding: '8px 12px', 
                  background: 'rgba(239, 68, 68, 0.1)', 
                  borderRadius: '6px',
                  fontSize: '13px',
                  color: 'rgb(239, 68, 68)',
                  marginTop: '8px',
                }}>
                  {currentFetchState.error}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'evidence' && (
          <div>
            {/* Filters and Search */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                {(['all', 'browser_use', 'upload', 'notion'] as const).map(filter => (
                  <button
                    key={filter}
                    onClick={() => setEvidenceFilter(filter)}
                    className="pill pill--small"
                    style={{
                      background: evidenceFilter === filter ? 'var(--accent)' : 'transparent',
                      color: evidenceFilter === filter ? 'white' : 'var(--muted)',
                      border: `1px solid ${evidenceFilter === filter ? 'var(--accent)' : 'var(--border)'}`,
                      cursor: 'pointer',
                      textTransform: 'capitalize',
                    }}
                  >
                    {filter === 'browser_use' ? 'Browser Use' : filter}
                  </button>
                ))}
              </div>
              <input
                type="text"
                placeholder="Search by title or caption..."
                value={evidenceSearch}
                onChange={(e) => setEvidenceSearch(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  fontSize: '13px',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  background: 'var(--background)',
                  color: 'var(--ink)',
                }}
              />
            </div>

            {/* Loading State */}
            {isResourceLoading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      padding: '12px',
                      background: 'var(--background)',
                    }}
                  >
                    <div style={{
                      height: '16px',
                      width: '60%',
                      background: 'var(--border)',
                      borderRadius: '4px',
                      marginBottom: '8px',
                    }} />
                    <div style={{
                      height: '20px',
                      width: '80px',
                      background: 'var(--border)',
                      borderRadius: '4px',
                    }} />
                  </div>
                ))}
              </div>
            )}

            {/* Error State */}
            {resourceError && (
              <div style={{ padding: '12px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', marginBottom: '12px' }}>
                <p style={{ fontSize: '13px', margin: 0, color: 'rgb(239, 68, 68)' }}>{resourceError}</p>
              </div>
            )}

            {/* Filtered Resources */}
            {!isResourceLoading && !resourceError && (() => {
              let filtered = selectedResources;
              
              if (evidenceFilter !== 'all') {
                filtered = filtered.filter(res => {
                  if (evidenceFilter === 'browser_use') return res.source === 'browser_use';
                  if (evidenceFilter === 'upload') return res.source === 'upload';
                  if (evidenceFilter === 'notion') return res.source === 'notion';
                  return true;
                });
              }
              
              if (evidenceSearch.trim()) {
                const searchLower = evidenceSearch.toLowerCase();
                filtered = filtered.filter(res => 
                  (res.title?.toLowerCase().includes(searchLower) || false) ||
                  (res.caption?.toLowerCase().includes(searchLower) || false)
                );
              }
              
              if (filtered.length === 0) {
                return (
                  <div style={{ padding: '32px', textAlign: 'center' }}>
                    <p style={{ fontSize: '14px', margin: 0, color: 'var(--muted)' }}>
                      {selectedResources.length === 0
                        ? 'No evidence attached yet. Fetch or upload sources to ground this node.'
                        : 'No resources match your filters.'}
                    </p>
                  </div>
                );
              }
              
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {/* "View in Reader" button for all evidence */}
                  {selectedNode && filtered.length > 0 && (
                    <div style={{ marginBottom: '8px' }}>
                      <button
                        onClick={() => {
                          const params = new URLSearchParams();
                          params.set('concept_id', selectedNode.node_id);
                          // Use newest resource if none specifically selected
                          const newestResource = filtered.sort((a, b) => {
                            const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
                            const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
                            return bTime - aTime;
                          })[0];
                          if (newestResource) {
                            params.set('resource_id', newestResource.resource_id);
                          }
                          params.set('from', 'evidence');
                          const graphId = searchParams.get('graph_id');
                          if (graphId) {
                            params.set('graph_id', graphId);
                          }
                          router.push(`/reader?${params.toString()}`);
                        }}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          fontSize: '13px',
                          background: 'var(--accent)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: 'pointer',
                        }}
                      >
                        View in Reader
                      </button>
                    </div>
                  )}
                  {filtered.map(res => {
                    const isExpanded = expandedResources.has(res.resource_id);
                    return (
                      <div 
                        key={res.resource_id} 
                        style={{
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                          padding: '12px',
                          background: 'var(--background)',
                        }}
                      >
                        {res.title && (
                          <h5 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '6px', color: 'var(--ink)' }}>
                            {res.title}
                          </h5>
                        )}
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '8px' }}>
                          <span className="badge badge--soft" style={{ fontSize: '11px' }}>
                            {res.source || 'unknown'}
                          </span>
                        </div>
                        {res.caption && (
                          <p style={{ 
                            fontSize: '13px', 
                            lineHeight: '1.5', 
                            color: 'var(--ink)', 
                            marginBottom: '8px',
                            display: '-webkit-box',
                            WebkitLineClamp: isExpanded ? 'none' : 3,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}>
                            {res.caption.length > 240 && !isExpanded 
                              ? `${res.caption.substring(0, 240)}...` 
                              : res.caption}
                          </p>
                        )}
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' }}>
                          <button
                            onClick={() => {
                              setExpandedResources(prev => {
                                const next = new Set<string>(prev);
                                if (next.has(res.resource_id)) {
                                  next.delete(res.resource_id);
                                } else {
                                  next.add(res.resource_id);
                                }
                                return next;
                              });
                            }}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--accent)',
                              fontSize: '12px',
                              cursor: 'pointer',
                              padding: '4px 0',
                              textDecoration: 'underline',
                            }}
                          >
                            {isExpanded ? 'Hide Details' : 'Details'}
                          </button>
                          {selectedNode && (
                            <button
                              onClick={() => {
                                const params = new URLSearchParams();
                                params.set('concept_id', selectedNode.node_id);
                                params.set('resource_id', res.resource_id);
                                params.set('from', 'evidence');
                                const graphId = searchParams.get('graph_id');
                                if (graphId) {
                                  params.set('graph_id', graphId);
                                }
                                router.push(`/reader?${params.toString()}`);
                              }}
                              style={{
                                padding: '6px 12px',
                                fontSize: '12px',
                                background: 'var(--accent)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                              }}
                            >
                              View in Reader
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Upload Control */}
            {selectedNode && !IS_DEMO_MODE && (
              <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
                <label style={{ cursor: 'pointer' }}>
                  <span className="pill pill--ghost">Attach file</span>
                  <input
                    type="file"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const res = await uploadResourceForConcept(file, selectedNode.node_id, file.name);
                        onResourceUpload?.(res);
                      } catch (err) {
                        console.error('Failed to upload resource:', err);
                      } finally {
                        e.target.value = '';
                      }
                    }}
                  />
                </label>
              </div>
            )}
          </div>
        )}

        {activeTab === 'notes' && (
          <div>
            <div style={{ marginBottom: '16px' }}>
              <h4 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px', color: 'var(--ink)' }}>
                Notes
              </h4>
              <div style={{ 
                padding: '12px', 
                background: 'rgba(0, 0, 0, 0.02)', 
                borderRadius: '8px',
                border: '1px dashed var(--border)',
                marginBottom: '12px',
              }}>
                <textarea
                  value={newNoteContent}
                  onChange={(e) => setNewNoteContent(e.target.value)}
                  placeholder="Add a note about this concept..."
                  style={{
                    width: '100%',
                    minHeight: '80px',
                    padding: '8px',
                    fontSize: '13px',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    background: 'var(--background)',
                    color: 'var(--ink)',
                    fontFamily: 'inherit',
                    resize: 'vertical',
                  }}
                />
                <button
                  onClick={handleAddNote}
                  disabled={!newNoteContent.trim() || isAddingNote}
                  style={{
                    marginTop: '8px',
                    padding: '6px 12px',
                    background: newNoteContent.trim() && !isAddingNote ? 'var(--accent)' : 'var(--muted)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: newNoteContent.trim() && !isAddingNote ? 'pointer' : 'not-allowed',
                  }}
                >
                  {isAddingNote ? 'Adding...' : 'Add Note'}
                </button>
              </div>
            </div>

            {notes.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center' }}>
                <p style={{ fontSize: '14px', margin: 0, color: 'var(--muted)' }}>
                  No notes yet. Add your first note above.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {notes.map((note, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '12px',
                      background: 'rgba(0, 0, 0, 0.02)',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <p style={{ fontSize: '13px', lineHeight: '1.5', color: 'var(--ink)', margin: 0 }}>
                      {note.content}
                    </p>
                    <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '8px' }}>
                      {new Date(note.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'connections' && (
          <div>
            <h4 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px', color: 'var(--ink)' }}>
              Connections
            </h4>
            {connectionsCount === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center' }}>
                <p style={{ fontSize: '14px', margin: 0, color: 'var(--muted)' }}>
                  No connections found.
                </p>
              </div>
            ) : (
              <div style={{ padding: '12px', background: 'rgba(0, 0, 0, 0.02)', borderRadius: '8px', border: '1px dashed var(--border)' }}>
                <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0 }}>
                  {connectionsCount} connection{connectionsCount !== 1 ? 's' : ''} found.
                </p>
                <p style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '8px', fontStyle: 'italic' }}>
                  Connection details coming soon.
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'activity' && (
          <div>
            <h4 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px', color: 'var(--ink)' }}>
              Activity Feed
            </h4>
            {activityEvents.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {activityEvents.map((event) => (
                  <div
                    key={event.id}
                    style={{
                      padding: '12px',
                      background: 'rgba(0, 0, 0, 0.02)',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--ink)', marginBottom: '4px' }}>
                      {event.title}
                    </div>
                    {event.detail && (
                      <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>
                        {event.detail}
                      </div>
                    )}
                    {event.timestamp && (
                      <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '8px' }}>
                        {event.timestamp.toLocaleDateString()}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: '24px', textAlign: 'center' }}>
                <p style={{ fontSize: '14px', margin: 0, color: 'var(--muted)' }}>
                  No activity recorded for this node yet.
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'data' && financeTabContent && (
          <div>
            {financeTabContent}
          </div>
        )}
      </div>
    </div>
  );
}

