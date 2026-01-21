'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { searchConcepts, searchResources, getConcept, createConcept, deleteConcept, createRelationshipByIds, selectGraph, type Concept, type Resource, type GraphSummary } from '../../api-client';
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
  graphs: GraphSummary[];
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
  const [mounted, setMounted] = useState(false);

  // Ensure we're mounted before rendering portal
  useEffect(() => {
    setMounted(true);
  }, []);

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

  // Handle graph modification commands
  const handleCommand = useCallback(async (command: string, args: string[]) => {
    const baseCommand = command.toLowerCase();
    
    try {
      if (baseCommand === 'add' || baseCommand === 'create') {
        // Parse: /add node "Name" [domain] or /add "Name" [domain] or /add node Name [domain]
        let nodeName = '';
        let domain = 'general';
        
        if (args.length > 0) {
          // Check if first arg is "node"
          if (args[0]?.toLowerCase() === 'node' && args.length > 1) {
            nodeName = args[1];
            domain = args[2] || 'general';
          } else {
            // First arg is the node name
            nodeName = args[0];
            domain = args[1] || 'general';
          }
        }
        
        if (!nodeName) {
          setSearchResults([{
            type: 'action',
            id: 'add-node-prompt',
            label: 'Add Node',
            description: 'Enter node name and domain (e.g., "NodeName domain")',
            command: command,
          }]);
          return;
        }
        
        if (activeGraphId) {
          await selectGraph(activeGraphId);
          const newConcept = await createConcept({
            name: nodeName,
            domain: domain,
            type: 'concept',
            graph_id: activeGraphId,
          });
          // Dispatch event for confirmation button
          window.dispatchEvent(new CustomEvent('graph-action', { detail: { type: 'added' } }));
          // Navigate to the new node
          const params = new URLSearchParams();
          params.set('select', newConcept.node_id);
          if (activeGraphId) {
            params.set('graph_id', activeGraphId);
          }
          router.push(`/?${params.toString()}`);
          setSearchQuery('');
          setSearchFocused(false);
        }
      } else if (baseCommand === 'remove' || baseCommand === 'delete') {
        // Parse: /remove node "Name" or /delete node "Name" or /remove "Name" or /delete "Name"
        let nodeName = '';
        
        if (args.length > 0) {
          // Check if first arg is "node"
          if (args[0]?.toLowerCase() === 'node' && args.length > 1) {
            nodeName = args[1];
          } else {
            nodeName = args[0];
          }
        }
        
        if (!nodeName) {
          setSearchResults([{
            type: 'action',
            id: 'remove-node-prompt',
            label: 'Remove Node',
            description: 'Enter node name to remove',
            command: command,
          }]);
          return;
        }
        
        if (activeGraphId) {
          await selectGraph(activeGraphId);
          // Search for the concept
          const searchResults = await searchConcepts(nodeName, activeGraphId, 5);
          const concept = searchResults.results.find(c => 
            c.name.toLowerCase() === nodeName.toLowerCase()
          ) || searchResults.results[0];
          
          if (!concept) {
            setSearchResults([{
              type: 'action',
              id: 'node-not-found',
              label: 'Node not found',
              description: `Could not find node "${nodeName}"`,
              command: command,
            }]);
            return;
          }
          
          // Confirm deletion
          if (confirm(`Are you sure you want to delete "${concept.name}"? This will remove the node and all its relationships.`)) {
            await deleteConcept(concept.node_id);
            // Dispatch event for confirmation button
            window.dispatchEvent(new CustomEvent('graph-action', { detail: { type: 'deleted' } }));
            // Navigate back to explorer
            const params = new URLSearchParams();
            if (activeGraphId) {
              params.set('graph_id', activeGraphId);
            }
            router.push(`/?${params.toString()}`);
            setSearchQuery('');
            setSearchFocused(false);
          }
        }
      } else if (baseCommand === 'link' || baseCommand === 'connect') {
        // Parse: /link "Source" to "Target" or /link "Source" "Target" or /link Source Target
        let sourceName = '';
        let targetName = '';
        
        if (args.length >= 2) {
          sourceName = args[0];
          // Check if second arg is "to"
          if (args[1]?.toLowerCase() === 'to' && args.length >= 3) {
            targetName = args[2];
          } else {
            targetName = args[1];
          }
        }
        
        if (!sourceName || !targetName) {
          setSearchResults([{
            type: 'action',
            id: 'link-node-prompt',
            label: 'Link Nodes',
            description: 'Enter source and target node names (e.g., "Source to Target")',
            command: command,
          }]);
          return;
        }
        
        if (activeGraphId) {
          await selectGraph(activeGraphId);
          // Search for both concepts
          const [sourceResults, targetResults] = await Promise.all([
            searchConcepts(sourceName, activeGraphId, 5),
            searchConcepts(targetName, activeGraphId, 5),
          ]);
          
          const sourceConcept = sourceResults.results.find(c => 
            c.name.toLowerCase() === sourceName.toLowerCase()
          ) || sourceResults.results[0];
          
          const targetConcept = targetResults.results.find(c => 
            c.name.toLowerCase() === targetName.toLowerCase()
          ) || targetResults.results[0];
          
          if (!sourceConcept) {
            setSearchResults([{
              type: 'action',
              id: 'source-not-found',
              label: 'Source node not found',
              description: `Could not find "${sourceName}"`,
              command: command,
            }]);
            return;
          }
          if (!targetConcept) {
            setSearchResults([{
              type: 'action',
              id: 'target-not-found',
              label: 'Target node not found',
              description: `Could not find "${targetName}"`,
              command: command,
            }]);
            return;
          }
          
          // Create relationship (default predicate: "related_to")
          await createRelationshipByIds(
            sourceConcept.node_id,
            targetConcept.node_id,
            'related_to'
          );
          
          // Navigate to show the link
          const params = new URLSearchParams();
          params.set('select', sourceConcept.node_id);
          if (activeGraphId) {
            params.set('graph_id', activeGraphId);
          }
          router.push(`/?${params.toString()}`);
          setSearchQuery('');
          setSearchFocused(false);
        }
      }
    } catch (err) {
      console.error('Command failed:', err);
      setSearchResults([{
        type: 'action',
        id: 'command-error',
        label: 'Command failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        command: command,
      }]);
    }
  }, [activeGraphId, router]);

  // Search with debounce and command detection
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
        const isCommand = query.startsWith('/') || query.startsWith('>');
        
        if (isCommand) {
          // Parse command
          const commandPart = query.slice(1).trim();
          const [baseCommand, ...args] = commandPart.split(/\s+/);
          
          // Handle commands
          await handleCommand(baseCommand, args);
          setSearchLoading(false);
          return;
        }
        
        // Regular search - prioritize concepts
        // Search concepts (show more results for better matching)
        if (!activeGraphId) {
          console.warn('[SearchBox] No activeGraphId provided, searching all graphs');
        }
        
        const conceptsResult = await searchConcepts(query, activeGraphId || undefined, 10);
        const conceptResults: ConceptSearchResult[] = (conceptsResult?.results || []).map(c => ({ type: 'concept', concept: c }));
        
        // Search resources (show fewer, as concepts are prioritized)
        let resourceResults: EvidenceSearchResult[] = [];
        try {
          const resources = await searchResources(query, activeGraphId || undefined, 2);
          resourceResults = (resources || []).map(r => ({ 
            type: 'evidence', 
            resource: r,
          }));
        } catch (resourceErr) {
          console.warn('[SearchBox] Resource search failed:', resourceErr);
          // Continue without resources
        }

        if (!abortController.signal.aborted) {
          // Prioritize concepts - show them first
          const allResults = [...conceptResults, ...resourceResults];
          console.log('[SearchBox] Search complete:', {
            query,
            activeGraphId,
            conceptCount: conceptResults.length,
            resourceCount: resourceResults.length,
            totalResults: allResults.length,
          });
          setSearchResults(allResults);
          setSelectedResultIndex(-1);
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          console.error('Search failed:', err);
          console.error('Error details:', {
            query: searchQuery,
            activeGraphId,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
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
  }, [searchQuery, activeGraphId, handleCommand]);

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

  // Calculate dropdown position when focused or when there's a query
  useEffect(() => {
    if ((searchFocused || searchQuery.trim()) && searchInputRef.current) {
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
  }, [searchFocused, searchQuery]);

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
        onChange={(e) => {
          setSearchQuery(e.target.value);
          // Auto-focus when typing starts
          if (e.target.value.trim() && !searchFocused) {
            setSearchFocused(true);
          }
        }}
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
      
      {/* Search dropdown - show when typing or focused */}
      {mounted && searchQuery.trim() && (searchResults.length > 0 || searchLoading || (!searchLoading && searchQuery.trim().length > 0)) && dropdownPosition && createPortal(
        <div
          ref={searchDropdownRef}
          style={{
            position: 'fixed',
            top: `${dropdownPosition.top}px`,
            left: `${dropdownPosition.left}px`,
            width: `${dropdownPosition.width}px`,
            backgroundColor: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.1)',
            maxHeight: '400px',
            overflowY: 'auto',
            zIndex: 99999,
            isolation: 'isolate', // Create new stacking context
          }}
        >
          {searchLoading ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>
              Searching...
            </div>
          ) : searchResults.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>
              <div>No matches found</div>
              {activeGraphId && (
                <div style={{ fontSize: '11px', marginTop: '4px', color: '#9ca3af' }}>
                  Searching in graph: {activeGraphId}
                </div>
              )}
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
                    backgroundColor: idx === selectedResultIndex ? '#f3f4f6' : 'transparent',
                    borderBottom: idx < searchResults.length - 1 ? '1px solid #e5e7eb' : 'none',
                    transition: 'background-color 0.15s ease',
                  }}
                  onMouseEnter={() => setSelectedResultIndex(idx)}
                >
                  {result.type === 'concept' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ 
                        width: '8px', 
                        height: '8px', 
                        borderRadius: '50%', 
                        backgroundColor: '#6366f1',
                        flexShrink: 0,
                      }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '14px', fontWeight: '600', color: '#000000' }}>
                          {result.concept.name}
                        </div>
                        {result.concept.domain && (
                          <div style={{ fontSize: '12px', color: '#000000', marginTop: '2px', opacity: 0.7 }}>
                            {result.concept.domain}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {result.type === 'evidence' && (
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: '500', color: '#000000' }}>
                        {result.resource.title || result.resource.kind}
                      </div>
                      {result.concept_name && (
                        <div style={{ fontSize: '12px', color: '#000000', marginTop: '2px', opacity: 0.7 }}>
                          Evidence for {result.concept_name}
                        </div>
                      )}
                    </div>
                  )}
                  {result.type === 'action' && (
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: '500', color: '#000000' }}>
                        {result.icon && <span style={{ marginRight: '8px' }}>{result.icon}</span>}
                        {result.label}
                      </div>
                      {result.description && (
                        <div style={{ fontSize: '12px', color: '#000000', marginTop: '2px', opacity: 0.7 }}>
                          {result.description}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

