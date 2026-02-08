'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { listGraphs, listGraphConcepts, type GraphSummary, type GraphConceptItem } from '../../api-client';
import GlassCard from '@/app/components/ui/GlassCard';
import Button from '@/app/components/ui/Button';
import Badge from '@/app/components/ui/Badge';
import { Input, Select } from '@/app/components/ui/Input';

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
        const foundGraph = data.graphs?.find(g => g.graph_id === graphId);
        if (!foundGraph) {
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
      const response = await listGraphConcepts(graphId, {
        limit: 500,
      });

      // Filter to only pinned concepts, maintaining order
      const pinnedMap = new Map(pinnedIds.map(id => [id, true]));
      const pinned = response.items
        .filter(item => pinnedMap.has(item.concept_id))
        .sort((a, b) => {
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
    } else {
      // Also update local state for the browse tab immediately
      // Force re-render to update the pin icon
      setPinnedConceptIds(getPinnedConcepts(graphId));
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
      <div style={{ padding: '48px', textAlign: 'center' }}>
        <div style={{ color: 'var(--muted)', fontSize: '15px' }}>Loading graph details...</div>
      </div>
    );
  }

  if (!graph) {
    return (
      <div style={{ padding: '48px', maxWidth: '600px', margin: '0 auto' }}>
        <GlassCard>
          <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>Graph not found</h1>
          <p style={{ marginBottom: '24px', color: 'var(--muted)' }}>The requested graph could not be found.</p>
          <Link href="/home">
            <Button variant="secondary">← Back to Home</Button>
          </Link>
        </GlassCard>
      </div>
    );
  }

  const nodes = graph.node_count ?? 0;
  const edges = graph.edge_count ?? 0;
  const updated = formatRelativeTime(graph.updated_at);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--page-bg)', paddingBottom: '48px' }}>

      {/* Header */}
      <div style={{
        borderBottom: '1px solid var(--border)',
        backgroundColor: 'rgba(255, 255, 255, 0.8)',
        backdropFilter: 'blur(12px)',
        position: 'sticky',
        top: 0,
        zIndex: 10,
        padding: '20px 24px',
      }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <div
            className="responsive-header-stack"
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <Link href="/home" style={{ color: 'var(--muted)', fontSize: '14px', fontWeight: 500 }}>Home</Link>
                <span style={{ color: 'var(--border)' }}>/</span>
                <span style={{ color: 'var(--muted)', fontSize: '14px' }}>Graphs</span>
              </div>
              <h1 style={{ fontSize: '32px', fontWeight: '700', marginBottom: '8px', fontFamily: 'var(--font-display)', color: 'var(--ink)' }}>
                {graph.name || graph.graph_id}
              </h1>
              <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                <span>{nodes} nodes</span>
                <span>{edges} edges</span>
                <span>updated {updated}</span>
              </div>
            </div>

            <Link href="/">
              <Button variant="primary">Open in Explorer →</Button>
            </Link>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: '2px' }}>
            <Button
              variant={activeTab === 'browse' ? 'secondary' : 'ghost'}
              onClick={() => setActiveTab('browse')}
              size="sm"
              className={activeTab === 'browse' ? '!border-b-0 rounded-b-none' : ''}
            >
              Browse Concepts
            </Button>
            <Button
              variant={activeTab === 'pinned' ? 'secondary' : 'ghost'}
              onClick={() => setActiveTab('pinned')}
              size="sm"
              className={activeTab === 'pinned' ? '!border-b-0 rounded-b-none' : ''}
            >
              Pinned ({pinnedConceptIds.length})
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: '1200px', margin: '32px auto', padding: '0 24px' }}>
        {activeTab === 'browse' ? (
          <div>
            <GlassCard className="mb-6">
              {/* Filters */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '16px',
                alignItems: 'end',
              }}>
                <Input
                  label="Search"
                  placeholder="Search concepts..."
                  value={searchQuery}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    setSearchQuery(e.target.value);
                    setPage(0);
                  }}
                />

                <Select
                  label="Domain"
                  value={domainFilter}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                    setDomainFilter(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">All domains</option>
                  {domains.map(domain => (
                    <option key={domain} value={domain}>{domain}</option>
                  ))}
                </Select>

                <Select
                  label="Type"
                  value={typeFilter}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                    setTypeFilter(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">All types</option>
                  {types.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </Select>

                <Select
                  label="Sort By"
                  value={sortBy}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                    setSortBy(e.target.value as 'alphabetical' | 'degree' | 'recent');
                    setPage(0);
                  }}
                >
                  <option value="alphabetical">Alphabetical</option>
                  <option value="degree">Most connected</option>
                  <option value="recent">Recently active</option>
                </Select>
              </div>
            </GlassCard>

            {/* Results */}
            {loadingConcepts ? (
              <div style={{ textAlign: 'center', padding: '60px', color: 'var(--muted)' }}>
                <div className="spinner mb-4" />
                <p>Loading concepts...</p>
              </div>
            ) : concepts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px', color: 'var(--muted)', background: 'var(--panel)', borderRadius: '16px', border: '1px dashed var(--border)' }}>
                <p>No concepts found matching your filters.</p>
                <Button variant="ghost" onClick={() => { setSearchQuery(''); setDomainFilter(''); setTypeFilter(''); }} style={{ marginTop: '12px' }}>Clear Filters</Button>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: '16px', fontSize: '13px', color: 'var(--muted)', fontWeight: 500, paddingLeft: '4px' }}>
                  Showing {concepts.length} of {total} concepts
                </div>

                <GlassCard style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ overflowX: 'auto', width: '100%' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
                      <thead>
                        <tr style={{ backgroundColor: 'rgba(0,0,0,0.02)', borderBottom: '1px solid var(--border)' }}>
                          <th style={{ padding: '16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Concept</th>
                          <th style={{ padding: '16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Domain</th>
                          <th style={{ padding: '16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Type</th>
                          {sortBy === 'degree' && (
                            <th style={{ padding: '16px', textAlign: 'right', fontSize: '12px', fontWeight: '600', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Connections</th>
                          )}
                          <th style={{ padding: '16px', textAlign: 'right', fontSize: '12px', fontWeight: '600', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {concepts.map((concept) => (
                          <tr
                            key={concept.concept_id}
                            style={{
                              borderBottom: '1px solid var(--border)',
                              cursor: 'pointer',
                              transition: 'background 0.1s ease'
                            }}
                            className="hover:bg-black/5 dark:hover:bg-white/5"
                            onClick={() => handleOpenInExplorer(concept.concept_id)}
                          >
                            <td style={{ padding: '16px', fontWeight: '600', color: 'var(--ink)' }}>{concept.name}</td>
                            <td style={{ padding: '16px' }}>
                              <Badge variant="neutral">{concept.domain}</Badge>
                            </td>
                            <td style={{ padding: '16px' }}>
                              <Badge variant="outline">{concept.type}</Badge>
                            </td>
                            {sortBy === 'degree' && (
                              <td style={{ padding: '16px', textAlign: 'right', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                                {concept.degree ?? 0}
                              </td>
                            )}
                            <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e: React.MouseEvent) => {
                                    e.stopPropagation();
                                    handleTogglePin(concept.concept_id);
                                  }}
                                  style={{ color: isConceptPinned(graphId, concept.concept_id) ? '#f59e0b' : 'var(--muted)' }}
                                >
                                  {isConceptPinned(graphId, concept.concept_id) ? 'Unpin' : 'Pin'}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </GlassCard>

                {/* Pagination */}
                {total > pageSize && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '24px' }}>
                    <Button
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={page === 0}
                      variant="secondary"
                    >
                      Previous
                    </Button>
                    <div style={{ fontSize: '14px', color: 'var(--muted)' }}>
                      Page {page + 1} of {Math.ceil(total / pageSize)}
                    </div>
                    <Button
                      onClick={() => setPage(p => p + 1)}
                      disabled={(page + 1) * pageSize >= total}
                      variant="secondary"
                    >
                      Next
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div>
            {loadingPinned ? (
              <div style={{ textAlign: 'center', padding: '60px', color: 'var(--muted)' }}>
                Loading pinned concepts...
              </div>
            ) : pinnedConcepts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px', color: 'var(--muted)', background: 'var(--panel)', borderRadius: '16px' }}>
                <p>No pinned concepts yet.</p>
                <div style={{ fontSize: '13px', marginTop: '8px', opacity: 0.7 }}>Pin concepts from the Browse tab to access them quickly here.</div>
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: '20px',
              }}>
                {pinnedConcepts.map((concept) => (
                  <GlassCard
                    key={concept.concept_id}
                    variant="interactive"
                    onClick={() => handleOpenInExplorer(concept.concept_id)}
                    style={{ padding: '20px' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                      <h3 style={{ fontSize: '18px', fontWeight: '600', margin: 0, fontFamily: 'var(--font-display)' }}>{concept.name}</h3>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTogglePin(concept.concept_id);
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '4px',
                          color: '#f59e0b',
                          fontSize: '16px',
                          opacity: 0.8,
                          transition: 'opacity 0.2s'
                        }}
                        title="Unpin"
                      >
                        📌
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
                      <Badge variant="neutral" size="sm">{concept.domain}</Badge>
                      <Badge variant="outline" size="sm">{concept.type}</Badge>
                    </div>
                    <Button variant="primary" size="sm" style={{ width: '100%' }}>
                      Open in Explorer
                    </Button>
                  </GlassCard>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
