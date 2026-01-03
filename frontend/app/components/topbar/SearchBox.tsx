'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { searchConcepts, searchResources, getConcept, type Concept, type Resource } from '../../api-client';
import { getRecentConceptViews } from '../../lib/sessionState';
import { fetchRecentEvents } from '../../lib/eventsClient';
import { togglePinConcept, isConceptPinned } from '../../lib/sessionState';
import { logEvent } from '../../lib/eventsClient';

interface ConceptSearchResult {
  type: 'concept';
  concept: Concept;
}

interface EvidenceSearchResult {
  type: 'evidence';
  resource: Resource;
  concept_id?: string;
  concept_name?: string;
}

interface ActionSearchResult {
  type: 'action';
  id: string;
  label: string;
  description: string;
  command: string;
  icon?: string;
}

interface GraphSearchResult {
  type: 'graph';
  graph: { graph_id: string; name?: string; node_count?: number; edge_count?: number; updated_at?: string };
}

type SearchResult = ConceptSearchResult | EvidenceSearchResult | ActionSearchResult | GraphSearchResult;

interface SearchBoxProps {
  activeGraphId: string;
  graphs: Array<{ graph_id: string; name?: string; node_count?: number; edge_count?: number; updated_at?: string }>;
  onSelectResult?: (result: SearchResult) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}

export default function SearchBox({ activeGraphId, graphs, onSelectResult, placeholder = "Search or type a command…", style }: SearchBoxProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchFocused, setSearchFocused] = useState(false);
  const [selectedResultIndex, setSelectedResultIndex] = useState(-1);
  const [searchLoading, setSearchLoading] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  const searchAbortControllerRef = useRef<AbortController | null>(null);

  // Cmd/Ctrl+K shortcut to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setSearchFocused(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Load recents when query is empty
  const loadRecents = useCallback(async () => {
    try {
      const recentConceptViews = getRecentConceptViews().slice(0, 6);
      const recentConcepts: ConceptSearchResult[] = [];
      
      try {
        const events = await fetchRecentEvents({ limit: 20, graph_id: activeGraphId || undefined });
        const conceptEvents = events
          .filter(e => e.type === 'CONCEPT_VIEWED' && e.concept_id)
          .slice(0, 6);
        
        for (const event of conceptEvents) {
          if (event.concept_id) {
            try {
              const concept = await getConcept(event.concept_id);
              recentConcepts.push({ type: 'concept', concept });
            } catch {
              // Skip if concept not found
            }
          }
        }
      } catch {
        // Fallback to localStorage
        for (const view of recentConceptViews) {
          try {
            const concept = await getConcept(view.id);
            recentConcepts.push({ type: 'concept', concept });
          } catch {
            // Skip if concept not found
          }
        }
      }
      
      setSearchResults(recentConcepts);
    } catch (err) {
      console.warn('Failed to load recents:', err);
      setSearchResults([]);
    }
  }, [activeGraphId]);

  useEffect(() => {
    if (!searchQuery.trim() && searchFocused) {
      loadRecents();
    }
  }, [searchQuery, searchFocused, loadRecents]);

  // Search with debounce
  useEffect(() => {
    if (!searchQuery.trim()) {
      if (!searchFocused) {
        setSearchResults([]);
      }
      setSearchLoading(false);
      return;
    }

    if (searchAbortControllerRef.current) {
      searchAbortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    searchAbortControllerRef.current = abortController;

    setSearchLoading(true);

    const timeoutId = setTimeout(async () => {
      try {
        const query = searchQuery.trim();
        
        // Search concepts
        const concepts = await searchConcepts(query, activeGraphId, 5);
        const conceptResults: ConceptSearchResult[] = concepts.map(c => ({ type: 'concept', concept: c }));
        
        // Search resources
        const resources = await searchResources(query, activeGraphId, 3);
        const resourceResults: EvidenceSearchResult[] = resources.map(r => ({ 
          type: 'evidence', 
          resource: r,
          concept_id: r.concept_id,
          concept_name: r.concept_name,
        }));

        if (!abortController.signal.aborted) {
          setSearchResults([...conceptResults, ...resourceResults]);
          setSelectedResultIndex(-1);
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          console.warn('Search failed:', err);
          setSearchResults([]);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setSearchLoading(false);
        }
      }
    }, 300);

    return () => {
      clearTimeout(timeoutId);
      if (searchAbortControllerRef.current) {
        searchAbortControllerRef.current.abort();
      }
    };
  }, [searchQuery, activeGraphId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedResultIndex(prev => 
        prev < searchResults.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedResultIndex(prev => prev > 0 ? prev - 1 : -1);
    } else if (e.key === 'Enter' && selectedResultIndex >= 0 && searchResults[selectedResultIndex]) {
      e.preventDefault();
      const result = searchResults[selectedResultIndex];
      if (result.type === 'concept') {
        const params = new URLSearchParams();
        params.set('select', result.concept.node_id);
        if (activeGraphId) {
          params.set('graph_id', activeGraphId);
        }
        router.push(`/?${params.toString()}`);
      } else if (result.type === 'evidence' && result.concept_id) {
        const params = new URLSearchParams();
        params.set('resource_id', result.resource.resource_id);
        params.set('concept_id', result.concept_id);
        if (activeGraphId) {
          params.set('graph_id', activeGraphId);
        }
        router.push(`/reader?${params.toString()}`);
      }
      setSearchFocused(false);
      setSearchQuery('');
      setSearchResults([]);
      searchInputRef.current?.blur();
    } else if (e.key === 'Escape') {
      setSearchFocused(false);
      setSearchQuery('');
      setSearchResults([]);
      searchInputRef.current?.blur();
    }
  }, [searchResults, selectedResultIndex, activeGraphId, router]);

  // Calculate dropdown position when focused
  useEffect(() => {
    if (searchFocused && searchInputRef.current) {
      const updatePosition = () => {
        if (searchInputRef.current) {
          const rect = searchInputRef.current.getBoundingClientRect();
          setDropdownPosition({
            top: rect.bottom + 4,
            left: rect.left,
            width: rect.width,
          });
        }
      };
      
      updatePosition();
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
      
      return () => {
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
      };
    } else {
      setDropdownPosition(null);
    }
  }, [searchFocused]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchDropdownRef.current && !searchDropdownRef.current.contains(event.target as Node) &&
          searchInputRef.current && !searchInputRef.current.contains(event.target as Node)) {
        setSearchFocused(false);
      }
    };
    if (searchFocused) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [searchFocused]);

  return (
    <div style={{ position: 'relative', ...style }}>
      <input
        ref={searchInputRef}
        type="text"
        placeholder={placeholder}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        onFocus={() => setSearchFocused(true)}
        onKeyDown={handleKeyDown}
        style={{
          width: '100%',
          height: '36px',
          padding: '0 16px',
          borderRadius: '18px',
          border: searchFocused ? '2px solid #6366f1' : '1px solid var(--border)',
          backgroundColor: searchFocused ? '#ffffff' : '#f8f9fa',
          color: searchFocused ? '#0f172a' : 'var(--ink)',
          fontSize: '14px',
          fontFamily: 'inherit',
          outline: 'none',
          transition: 'all 0.2s',
        }}
      />
      
      {/* Search dropdown */}
      {searchFocused && (searchResults.length > 0 || searchLoading) && dropdownPosition && (
        <div
          ref={searchDropdownRef}
          style={{
            position: 'fixed',
            top: `${dropdownPosition.top}px`,
            left: `${dropdownPosition.left}px`,
            width: `${dropdownPosition.width}px`,
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05)',
            maxHeight: '400px',
            overflowY: 'auto',
            zIndex: 9999,
          }}
        >
          {searchLoading ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)' }}>
              Searching...
            </div>
          ) : searchResults.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)' }}>
              No matches
            </div>
          ) : (
            <div style={{ padding: '8px 0' }}>
              {searchResults.map((result, idx) => (
                <div
                  key={idx}
                  onClick={() => {
                    if (result.type === 'concept') {
                      const params = new URLSearchParams();
                      params.set('select', result.concept.node_id);
                      if (activeGraphId) {
                        params.set('graph_id', activeGraphId);
                      }
                      router.push(`/?${params.toString()}`);
                    } else if (result.type === 'evidence' && result.concept_id) {
                      const params = new URLSearchParams();
                      params.set('resource_id', result.resource.resource_id);
                      params.set('concept_id', result.concept_id);
                      if (activeGraphId) {
                        params.set('graph_id', activeGraphId);
                      }
                      router.push(`/reader?${params.toString()}`);
                    }
                    setSearchFocused(false);
                    setSearchQuery('');
                    setSearchResults([]);
                  }}
                  style={{
                    padding: '12px 16px',
                    cursor: 'pointer',
                    backgroundColor: idx === selectedResultIndex ? 'var(--panel)' : 'transparent',
                    borderBottom: idx < searchResults.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                  onMouseEnter={() => setSelectedResultIndex(idx)}
                >
                  {result.type === 'concept' && (
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: '500', color: 'var(--ink)' }}>
                        {result.concept.name}
                      </div>
                      {result.concept.domain && (
                        <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
                          {result.concept.domain}
                        </div>
                      )}
                    </div>
                  )}
                  {result.type === 'evidence' && (
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: '500', color: 'var(--ink)' }}>
                        {result.resource.title || result.resource.kind}
                      </div>
                      {result.concept_name && (
                        <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
                          Evidence for {result.concept_name}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

