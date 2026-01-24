'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useOptimizedNavigation, routePrefetchers, quickNav } from '../../lib/navigationUtils';
import { searchConcepts, type Concept } from '../../api-client';

interface SearchResult {
  type: 'concept' | 'page' | 'action';
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  url?: string;
  icon?: string;
  graphId?: string;
}

interface EnhancedSearchBoxProps {
  placeholder?: string;
  activeGraphId?: string;
  onNavigate?: () => void;
}

const QUICK_ACTIONS: SearchResult[] = [
  {
    type: 'action',
    id: 'new-chat',
    title: 'Start New Chat',
    description: 'Begin a new conversation',
    icon: '💬',
    url: '/?chat=new'
  },
  {
    type: 'action',
    id: 'upload-pdf',
    title: 'Upload PDF',
    description: 'Add new documents to your knowledge base',
    icon: '📄',
    url: '/ingest'
  },
  {
    type: 'page',
    id: 'gaps',
    title: 'Knowledge Gaps',
    description: 'Identify areas for further study',
    icon: '⚠️',
    url: '/gaps'
  },
  {
    type: 'page',
    id: 'review',
    title: 'Review Session',
    description: 'Practice and reinforce learning',
    icon: '✓',
    url: '/review'
  }
];

export default function EnhancedSearchBox({ 
  placeholder = 'Search concepts, start chat, or navigate...', 
  activeGraphId,
  onNavigate 
}: EnhancedSearchBoxProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  
  const router = useRouter();
  const pathname = usePathname();
  const { navigateWithOptimization } = useOptimizedNavigation();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Search concepts and generate results
  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults(QUICK_ACTIONS);
      return;
    }
    
    setIsLoading(true);
    
    try {
      // Search concepts if we have a graph
      const searchResults: SearchResult[] = [];
      
      if (activeGraphId) {
        const concepts = await searchConcepts(searchQuery, { graphId: activeGraphId });
        concepts.slice(0, 5).forEach(concept => {
          searchResults.push({
            type: 'concept',
            id: concept.node_id,
            title: concept.name,
            subtitle: concept.domain || 'Concept',
            description: concept.description,
            graphId: activeGraphId,
            url: quickNav.toConcept(concept.node_id, activeGraphId)
          });
        });
      }
      
      // Add matching quick actions
      const matchingActions = QUICK_ACTIONS.filter(action =>
        action.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        action.description?.toLowerCase().includes(searchQuery.toLowerCase())
      );
      
      searchResults.push(...matchingActions);
      
      // Add page suggestions
      const pageResults: SearchResult[] = [
        { type: 'page', id: 'home', title: 'Home', url: '/home', icon: '🏠' },
        { type: 'page', id: 'explorer', title: 'Explorer', url: quickNav.toExplorer(activeGraphId), icon: '🗺️' },
        { type: 'page', id: 'source-management', title: 'Source Management', url: '/source-management', icon: '📚' }
      ].filter(page =>
        page.title.toLowerCase().includes(searchQuery.toLowerCase())
      );
      
      searchResults.push(...pageResults);
      
      setResults(searchResults.slice(0, 8));
    } catch (error) {
      console.error('Search error:', error);
      setResults(QUICK_ACTIONS);
    } finally {
      setIsLoading(false);
    }
  }, [activeGraphId]);
  
  // Debounced search
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (query.trim() || isOpen) {
        performSearch(query);
      }
    }, 200);
    
    return () => clearTimeout(timeoutId);
  }, [query, performSearch, isOpen]);
  
  // Handle input changes
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setSelectedIndex(0);
    setIsOpen(true);
  }, []);
  
  // Handle keyboard navigation
  const handleKeyDown = useCallback(async (e: React.KeyboardEvent) => {
    if (!isOpen && e.key !== 'Enter') return;
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
        break;
        
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        break;
        
      case 'Enter':
        e.preventDefault();
        if (results[selectedIndex]) {
          await handleSelectResult(results[selectedIndex]);
        } else if (query.trim()) {
          // Start a chat with the query
          const chatUrl = quickNav.toChat(activeGraphId);
          await navigateWithOptimization(`${chatUrl}&q=${encodeURIComponent(query)}`, {
            prefetch: () => routePrefetchers.chat()
          });
        }
        break;
        
      case 'Escape':
        setIsOpen(false);
        setQuery('');
        inputRef.current?.blur();
        break;
    }
  }, [isOpen, results, selectedIndex, navigateWithOptimization, activeGraphId, query]);
  
  // Handle result selection
  const handleSelectResult = useCallback(async (result: SearchResult) => {
    const url = result.url || '/';
    
    setIsOpen(false);
    setQuery('');
    inputRef.current?.blur();
    onNavigate?.();
    
    // Navigate with appropriate prefetching
    await navigateWithOptimization(url, {
      prefetch: async () => {
        switch (result.type) {
          case 'concept':
            if (result.graphId) {
              await routePrefetchers.concept(result.id, result.graphId);
            }
            break;
          case 'page':
            if (result.id === 'explorer' && activeGraphId) {
              await routePrefetchers.explorer(activeGraphId);
            }
            break;
        }
      }
    });
  }, [navigateWithOptimization, onNavigate, activeGraphId]);
  
  // Handle clicks outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  // Focus shortcuts
  useEffect(() => {
    // Skip on server-side
    if (typeof window === 'undefined') return;
    
    const handleGlobalKeydown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      } else if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
    };
    
    window.addEventListener('keydown', handleGlobalKeydown);
    return () => window.removeEventListener('keydown', handleGlobalKeydown);
  }, []);
  
  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', maxWidth: '600px' }}>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          style={{
            width: '100%',
            padding: '12px 16px',
            paddingRight: '48px',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            fontSize: '14px',
            background: 'var(--surface)',
            color: 'var(--ink)',
            outline: 'none',
            transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
        
        {/* Search icon */}
        <div style={{
          position: 'absolute',
          right: '16px',
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--muted)',
          pointerEvents: 'none',
        }}>
          {isLoading ? '⋯' : '🔍'}
        </div>
        
        {/* Keyboard hint */}
        <div style={{
          position: 'absolute',
          right: '48px',
          top: '50%',
          transform: 'translateY(-50%)',
          fontSize: '11px',
          color: 'var(--muted)',
          pointerEvents: 'none',
          opacity: query ? 0 : 1,
          transition: 'opacity 200ms',
        }}>
          ⌘K
        </div>
      </div>
      
      {/* Results dropdown */}
      {isOpen && results.length > 0 && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          marginTop: '4px',
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)',
          zIndex: 1000,
          maxHeight: '300px',
          overflowY: 'auto',
        }}>
          {results.map((result, index) => (
            <div
              key={result.id}
              onClick={() => handleSelectResult(result)}
              style={{
                padding: '12px 16px',
                cursor: 'pointer',
                borderBottom: index < results.length - 1 ? '1px solid var(--border)' : 'none',
                background: index === selectedIndex ? 'var(--surface)' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                transition: 'background-color 150ms',
              }}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              {result.icon && (
                <span style={{ fontSize: '16px', flexShrink: 0 }}>
                  {result.icon}
                </span>
              )}
              
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontWeight: '500',
                  color: 'var(--ink)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {result.title}
                </div>
                
                {(result.subtitle || result.description) && (
                  <div style={{
                    fontSize: '12px',
                    color: 'var(--muted)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {result.subtitle || result.description}
                  </div>
                )}
              </div>
              
              {result.type === 'concept' && (
                <div style={{
                  fontSize: '10px',
                  color: 'var(--muted)',
                  padding: '2px 6px',
                  background: 'var(--border)',
                  borderRadius: '4px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}>
                  {result.type}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}