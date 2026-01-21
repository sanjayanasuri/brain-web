'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { listGraphs, listGraphConcepts, type GraphSummary, type GraphConceptItem, type GraphConceptsResponse } from '../../api-client';

const PINNED_CONCEPTS_KEY = 'brainweb:pinnedConcepts';

function getPinnedConcepts(graphId: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(`${PINNED_CONCEPTS_KEY}:${graphId}`);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

function togglePinConcept(graphId: string, conceptId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const pinned = getPinnedConcepts(graphId);
    const isPinned = pinned.includes(conceptId);
    if (isPinned) {
      const updated = pinned.filter(id => id !== conceptId);
      localStorage.setItem(`${PINNED_CONCEPTS_KEY}:${graphId}`, JSON.stringify(updated));
    } else {
      const updated = [...pinned, conceptId];
      localStorage.setItem(`${PINNED_CONCEPTS_KEY}:${graphId}`, JSON.stringify(updated));
    }
  } catch {
    // Ignore errors
  }
}

function isConceptPinned(graphId: string, conceptId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const pinned = getPinnedConcepts(graphId);
    return pinned.includes(conceptId);
  } catch {
    return false;
  }
}

export default function GraphBrowserPage() {
  const params = useParams();
  const router = useRouter();
  const graphId = params?.graph_id as string;
  
  const [graph, setGraph] = useState<GraphSummary | null>(null);
  const [graphs, setGraphs] = useState<GraphSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'browse' | 'pinned'>('browse');
  
  // Browse tab state
  const [concepts, setConcepts] = useState<GraphConceptItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingConcepts, setLoadingConcepts] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [domainFilter, setDomainFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState<'alphabetical' | 'degree' | 'recent'>('alphabetical');
  const [page, setPage] = useState(0);
  const [domains, setDomains] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const pageSize = 50;
  
  // Pinned tab state
  const [pinnedConceptIds, setPinnedConceptIds] = useState<string[]>([]);
  const [pinnedConcepts, setPinnedConcepts] = useState<GraphConceptItem[]>([]);
  const [loadingPinned, setLoadingPinned] = useState(false);
  
  // Load graph info
  useEffect(() => {
    async function loadGraph() {
      try {
        setLoading(true);
        const data = await listGraphs();
        setGraphs(data.graphs || []);
        const foundGraph = data.graphs?.find(g => g.graph_id === graphId);
        if (!foundGraph) {
          // Graph not found, redirect or show error
          console.error('Graph not found:', graphId);
          return;
        }
        setGraph(foundGraph);
      } catch (err) {
        console.error('Failed to load graph:', err);
      } finally {
        setLoading(false);
      }
    }
    loadGraph();
  }, [graphId]);
  
  // Load concepts for browse tab
  const loadConcepts = useCallback(async () => {
    if (!graphId) return;
    try {
      setLoadingConcepts(true);
      const response = await listGraphConcepts(graphId, {
        query: searchQuery || undefined,
        domain: domainFilter || undefined,
        type: typeFilter || undefined,
        sort: sortBy,
        limit: pageSize,
        offset: page * pageSize,
      });
      setConcepts(response.items);
      setTotal(response.total);
      
      // Extract unique domains and types for filters
      const uniqueDomains = new Set<string>();
      const uniqueTypes = new Set<string>();
      response.items.forEach(item => {
        if (item.domain) uniqueDomains.add(item.domain);
        if (item.type) uniqueTypes.add(item.type);
      });
      setDomains(Array.from(uniqueDomains).sort());
      setTypes(Array.from(uniqueTypes).sort());
    } catch (err) {
      console.error('Failed to load concepts:', err);
      setConcepts([]);
      setTotal(0);
    } finally {
      setLoadingConcepts(false);
    }
  }, [graphId, searchQuery, domainFilter, typeFilter, sortBy, page]);
  
  useEffect(() => {
    loadConcepts();
  }, [loadConcepts]);
  
  // Load pinned concepts
  const loadPinnedConcepts = useCallback(async () => {
    if (!graphId) return;
    try {
      setLoadingPinned(true);
      const pinnedIds = getPinnedConcepts(graphId);
      setPinnedConceptIds(pinnedIds);
      
      if (pinnedIds.length === 0) {
        setPinnedConcepts([]);
        return;
      }
      
      // Fetch all concepts and filter to pinned ones
      // Since pinned concepts should be a small set, we can fetch a large page
      const response = await listGraphConcepts(graphId, {
        limit: 500, // Should be enough for pinned concepts
      });
      
      // Filter to only pinned concepts, maintaining order
      const pinnedMap = new Map(pinnedIds.map(id => [id, true]));
      const pinned = response.items
        .filter(item => pinnedMap.has(item.concept_id))
        .sort((a, b) => {
          // Maintain the order from pinnedIds
          const indexA = pinnedIds.indexOf(a.concept_id);
          const indexB = pinnedIds.indexOf(b.concept_id);
          return indexA - indexB;
        });
      setPinnedConcepts(pinned);
    } catch (err) {
      console.error('Failed to load pinned concepts:', err);
      setPinnedConcepts([]);
    } finally {
      setLoadingPinned(false);
    }
  }, [graphId]);
  
  useEffect(() => {
    if (activeTab === 'pinned') {
      loadPinnedConcepts();
    }
  }, [activeTab, loadPinnedConcepts]);
  
  const handleOpenInExplorer = (conceptId: string) => {
    const params = new URLSearchParams();
    params.set('graph_id', graphId);
    params.set('concept_id', conceptId);
    router.push(`/?${params.toString()}`);
  };
  
  const handleTogglePin = (conceptId: string) => {
    togglePinConcept(graphId, conceptId);
    if (activeTab === 'pinned') {
      loadPinnedConcepts();
    }
  };
  
  const formatRelativeTime = (isoString: string | null | undefined): string => {
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
  };
  
  if (loading) {
    return (
      <div style={{ padding: '24px', textAlign: 'center' }}>
        Loading graph...
      </div>
    );
  }
  
  if (!graph) {
    return (
      <div style={{ padding: '24px' }}>
        <h1>Graph not found</h1>
        <Link href="/home">← Back to Home</Link>
      </div>
    );
  }
  
  const nodes = graph.node_count ?? 0;
  const edges = graph.edge_count ?? 0;
  const updated = formatRelativeTime(graph.updated_at);
  
  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--background)' }}>
      {/* Header */}
      <div style={{
        borderBottom: '1px solid var(--border)',
        backgroundColor: 'var(--surface)',
        padding: '24px',
      }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
            <div>
              <h1 style={{ fontSize: '28px', fontWeight: '700', marginBottom: '8px' }}>
                {graph.name || graph.graph_id}
              </h1>
              <div style={{ fontSize: '14px', color: 'var(--muted)' }}>
                {nodes} nodes · {edges} edges · updated {updated}
              </div>
            </div>
            <Link
              href="/"
              style={{
                padding: '8px 16px',
                background: 'var(--accent)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '500',
                textDecoration: 'none',
                cursor: 'pointer',
              }}
            >
              Open in Explorer →
            </Link>
          </div>
          
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border)' }}>
            <button
              onClick={() => setActiveTab('browse')}
              style={{
                padding: '8px 16px',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === 'browse' ? '2px solid var(--accent)' : '2px solid transparent',
                color: activeTab === 'browse' ? 'var(--accent)' : 'var(--muted)',
                fontSize: '14px',
                fontWeight: activeTab === 'browse' ? '600' : '400',
                cursor: 'pointer',
              }}
            >
              Browse
            </button>
            <button
              onClick={() => setActiveTab('pinned')}
              style={{
                padding: '8px 16px',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === 'pinned' ? '2px solid var(--accent)' : '2px solid transparent',
                color: activeTab === 'pinned' ? 'var(--accent)' : 'var(--muted)',
                fontSize: '14px',
                fontWeight: activeTab === 'pinned' ? '600' : '400',
                cursor: 'pointer',
              }}
            >
              Pinned ({pinnedConceptIds.length})
            </button>
          </div>
        </div>
      </div>
      
      {/* Content */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px' }}>
        {activeTab === 'browse' ? (
          <div>
            {/* Filters */}
            <div style={{
              display: 'flex',
              gap: '12px',
              marginBottom: '24px',
              flexWrap: 'wrap',
              alignItems: 'center',
            }}>
              <input
                type="text"
                placeholder="Search concepts..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(0);
                }}
                style={{
                  flex: '1',
                  minWidth: '200px',
                  height: '36px',
                  padding: '0 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  fontSize: '14px',
                }}
              />
              <select
                value={domainFilter}
                onChange={(e) => {
                  setDomainFilter(e.target.value);
                  setPage(0);
                }}
                style={{
                  height: '36px',
                  padding: '0 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  fontSize: '14px',
                  backgroundColor: 'var(--surface)',
                }}
              >
                <option value="">All domains</option>
                {domains.map(domain => (
                  <option key={domain} value={domain}>{domain}</option>
                ))}
              </select>
              <select
                value={typeFilter}
                onChange={(e) => {
                  setTypeFilter(e.target.value);
                  setPage(0);
                }}
                style={{
                  height: '36px',
                  padding: '0 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  fontSize: '14px',
                  backgroundColor: 'var(--surface)',
                }}
              >
                <option value="">All types</option>
                {types.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
              <select
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value as 'alphabetical' | 'degree' | 'recent');
                  setPage(0);
                }}
                style={{
                  height: '36px',
                  padding: '0 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  fontSize: '14px',
                  backgroundColor: 'var(--surface)',
                }}
              >
                <option value="alphabetical">Alphabetical</option>
                <option value="degree">Most connected</option>
                <option value="recent">Recently active</option>
              </select>
            </div>
            
            {/* Results */}
            {loadingConcepts ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>
                Loading concepts...
              </div>
            ) : concepts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>
                No concepts found
              </div>
            ) : (
              <>
                <div style={{ marginBottom: '16px', fontSize: '14px', color: 'var(--muted)' }}>
                  Showing {concepts.length} of {total} concepts
                </div>
                <div style={{
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  overflow: 'hidden',
                }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ backgroundColor: 'var(--background)', borderBottom: '1px solid var(--border)' }}>
                        <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: 'var(--muted)' }}>Concept</th>
                        <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: 'var(--muted)' }}>Domain</th>
                        <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: 'var(--muted)' }}>Type</th>
                        {sortBy === 'degree' && (
                          <th style={{ padding: '12px', textAlign: 'right', fontSize: '12px', fontWeight: '600', color: 'var(--muted)' }}>Connections</th>
                        )}
                        <th style={{ padding: '12px', textAlign: 'right', fontSize: '12px', fontWeight: '600', color: 'var(--muted)' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {concepts.map((concept) => (
                        <tr
                          key={concept.concept_id}
                          style={{
                            borderBottom: '1px solid var(--border)',
                            cursor: 'pointer',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8f9fa'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                          onClick={() => handleOpenInExplorer(concept.concept_id)}
                        >
                          <td style={{ padding: '12px', fontWeight: '500' }}>{concept.name}</td>
                          <td style={{ padding: '12px' }}>
                            <span style={{
                              display: 'inline-block',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '12px',
                              background: 'rgba(156, 163, 175, 0.1)',
                              color: 'var(--muted)',
                            }}>
                              {concept.domain}
                            </span>
                          </td>
                          <td style={{ padding: '12px' }}>
                            <span style={{
                              display: 'inline-block',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '12px',
                              background: 'rgba(156, 163, 175, 0.1)',
                              color: 'var(--muted)',
                            }}>
                              {concept.type}
                            </span>
                          </td>
                          {sortBy === 'degree' && (
                            <td style={{ padding: '12px', textAlign: 'right', color: 'var(--muted)' }}>
                              {concept.degree ?? 0}
                            </td>
                          )}
                          <td style={{ padding: '12px', textAlign: 'right' }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleTogglePin(concept.concept_id);
                              }}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '4px 8px',
                                color: isConceptPinned(graphId, concept.concept_id) ? '#f59e0b' : 'var(--muted)',
                                fontSize: '16px',
                              }}
                              title={isConceptPinned(graphId, concept.concept_id) ? 'Unpin' : 'Pin'}
                            >
                              {isConceptPinned(graphId, concept.concept_id) ? '📌' : '📍'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                {/* Pagination */}
                {total > pageSize && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
                    <button
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={page === 0}
                      style={{
                        padding: '8px 16px',
                        background: page === 0 ? 'var(--muted)' : 'var(--accent)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '14px',
                        cursor: page === 0 ? 'not-allowed' : 'pointer',
                        opacity: page === 0 ? 0.5 : 1,
                      }}
                    >
                      Previous
                    </button>
                    <div style={{ fontSize: '14px', color: 'var(--muted)' }}>
                      Page {page + 1} of {Math.ceil(total / pageSize)}
                    </div>
                    <button
                      onClick={() => setPage(p => p + 1)}
                      disabled={(page + 1) * pageSize >= total}
                      style={{
                        padding: '8px 16px',
                        background: (page + 1) * pageSize >= total ? 'var(--muted)' : 'var(--accent)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '14px',
                        cursor: (page + 1) * pageSize >= total ? 'not-allowed' : 'pointer',
                        opacity: (page + 1) * pageSize >= total ? 0.5 : 1,
                      }}
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div>
            {loadingPinned ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>
                Loading pinned concepts...
              </div>
            ) : pinnedConcepts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>
                No pinned concepts. Pin concepts from the Browse tab to see them here.
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: '16px',
              }}>
                {pinnedConcepts.map((concept) => (
                  <div
                    key={concept.concept_id}
                    style={{
                      padding: '16px',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      backgroundColor: 'var(--surface)',
                      cursor: 'pointer',
                    }}
                    onClick={() => handleOpenInExplorer(concept.concept_id)}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8f9fa'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--surface)'}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <h3 style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>{concept.name}</h3>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTogglePin(concept.concept_id);
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '4px 8px',
                          color: '#f59e0b',
                          fontSize: '16px',
                        }}
                        title="Unpin"
                      >
                        📌
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        background: 'rgba(156, 163, 175, 0.1)',
                        color: 'var(--muted)',
                      }}>
                        {concept.domain}
                      </span>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        background: 'rgba(156, 163, 175, 0.1)',
                        color: 'var(--muted)',
                      }}>
                        {concept.type}
                      </span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenInExplorer(concept.concept_id);
                      }}
                      style={{
                        width: '100%',
                        padding: '8px',
                        background: 'var(--accent)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '14px',
                        fontWeight: '500',
                        cursor: 'pointer',
                      }}
                    >
                      Open in Explorer
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

