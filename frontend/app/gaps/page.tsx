'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getGapsOverview, type GapsOverview, getGraphQuality, listGraphs, type GraphQuality } from '../api-client';
import { fetchEvidenceForConcept } from '../lib/evidenceFetch';

export default function GapsViewPage() {
  const router = useRouter();
  const [gaps, setGaps] = useState<GapsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [graphQuality, setGraphQuality] = useState<GraphQuality | null>(null);
  // Track fetch evidence state per concept (node_id -> state)
  const [fetchStates, setFetchStates] = useState<Record<string, {
    status: 'idle' | 'loading' | 'success' | 'empty' | 'error';
    addedCount?: number;
    error?: string;
  }>>({});

  useEffect(() => {
    async function loadGaps() {
      try {
        setLoading(true);
        // Load gaps and graphs in parallel
        const [gapsData, graphsData] = await Promise.allSettled([
          getGapsOverview(20),
          listGraphs(),
        ]);
        
        if (gapsData.status === 'fulfilled') {
          setGaps(gapsData.value);
        } else {
          setError(gapsData.reason instanceof Error ? gapsData.reason.message : 'Failed to load gaps');
        }
        
        // Load graph quality in parallel with gaps (if we have active graph)
        if (graphsData.status === 'fulfilled' && graphsData.value.active_graph_id) {
          getGraphQuality(graphsData.value.active_graph_id)
            .then(quality => setGraphQuality(quality))
            .catch(err => console.warn('Failed to load graph quality:', err));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load gaps');
      } finally {
        setLoading(false);
      }
    }

    loadGaps();
  }, []);

  const handleConceptClick = (nodeId: string) => {
    router.push(`/concepts/${nodeId}`);
  };

  const handleChatPrompt = (conceptName: string, promptType: 'define' | 'lecture') => {
    const prompt = promptType === 'define'
      ? `Help me define ${conceptName} in my usual style.`
      : `Create a mini-lecture for ${conceptName}.`;
    // Navigate to graph with chat prompt (could be enhanced to auto-fill chat)
    router.push(`/?chat=${encodeURIComponent(prompt)}`);
  };

  const handleFetchEvidence = async (nodeId: string, conceptName: string) => {
    setFetchStates(prev => ({ ...prev, [nodeId]: { status: 'loading' } }));
    try {
      const result = await fetchEvidenceForConcept(nodeId, conceptName, undefined);
      
      if (result.error) {
        setFetchStates(prev => ({
          ...prev,
          [nodeId]: { status: 'error', error: result.error },
        }));
        return;
      }

      // Determine if evidence was found
      const browserUseCount = result.resources?.filter(r => r.source === 'browser_use').length || 0;
      if (browserUseCount === 0) {
        setFetchStates(prev => ({
          ...prev,
          [nodeId]: { status: 'empty' },
        }));
      } else {
        setFetchStates(prev => ({
          ...prev,
          [nodeId]: { status: 'success', addedCount: browserUseCount },
        }));
      }
    } catch (error) {
      setFetchStates(prev => ({
        ...prev,
        [nodeId]: {
          status: 'error',
          error: error instanceof Error ? error.message : 'Failed to fetch evidence',
        },
      }));
    }
  };

  const handleOpenEvidence = (nodeId: string) => {
    // Navigate to graph page with concept selected and Evidence tab open
    // Using URL parameter to indicate which concept to select and which tab to open
    router.push(`/?select=${nodeId}&tab=evidence`);
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: '18px', color: 'var(--muted)' }}>Loading gaps...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: '18px', color: 'var(--accent-2)' }}>{error}</div>
        <Link href="/" style={{ marginTop: '20px', display: 'inline-block', color: 'var(--accent)' }}>
          ← Back to Graph
        </Link>
      </div>
    );
  }

  if (!gaps) {
    return null;
  }

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: 'linear-gradient(180deg, #fdf7ec 0%, #eef6ff 60%, #f7f9fb 100%)',
      padding: '20px',
    }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '24px' }}>
          <Link href="/" style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: '14px' }}>
            ← Back to Graph
          </Link>
          <h1 style={{ fontSize: '32px', fontWeight: '700', marginTop: '12px', marginBottom: '8px' }}>
            Knowledge Gaps
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '16px', marginBottom: '12px' }}>
            Missing concepts, evidence, and stale data in your knowledge map
          </p>
          {graphQuality && (
            <div style={{
              padding: '12px 16px',
              background: 'rgba(17, 138, 178, 0.05)',
              border: '1px solid rgba(17, 138, 178, 0.2)',
              borderRadius: '8px',
              fontSize: '13px',
              color: 'var(--ink)',
            }}>
              <strong>Coverage issues:</strong> {graphQuality.stats.missing_description_pct}% missing descriptions, {graphQuality.stats.no_evidence_pct}% no evidence, {graphQuality.stats.stale_evidence_pct}% stale
            </div>
          )}
        </div>

        {/* Concept Gaps Section */}
        <div style={{
          background: 'var(--panel)',
          borderRadius: '12px',
          padding: '24px',
          boxShadow: 'var(--shadow)',
          marginBottom: '24px',
        }}>
          <div style={{ marginBottom: '20px', paddingBottom: '12px', borderBottom: '2px solid var(--border)' }}>
            <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '4px' }}>
              Concept Gaps (Learning)
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0 }}>
              Concepts that need definition or better connections
            </p>
          </div>

          {/* Missing Descriptions */}
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>
              Concepts you mention but haven&apos;t defined
            </h3>
          {gaps.missing_descriptions.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: '14px' }}>All concepts have descriptions! 🎉</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {gaps.missing_descriptions.map(item => {
                const fetchState = fetchStates[item.node_id] || { status: 'idle' as const };
                const isFetching = fetchState.status === 'loading';
                const fetchSuccess = fetchState.status === 'success';
                const fetchEmpty = fetchState.status === 'empty';
                const fetchError = fetchState.status === 'error';

                return (
                  <div
                    key={item.node_id}
                    style={{
                      padding: '12px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: fetchSuccess || fetchEmpty || fetchError ? '8px' : '0' }}>
                      <div>
                        <div
                          onClick={() => handleConceptClick(item.node_id)}
                          style={{
                            fontSize: '16px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            color: 'var(--accent)',
                            marginBottom: '4px',
                          }}
                        >
                          {item.name}
                        </div>
                        {item.domain && (
                          <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{item.domain}</div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => handleFetchEvidence(item.node_id, item.name)}
                          disabled={isFetching}
                          style={{
                            padding: '6px 12px',
                            background: isFetching ? 'var(--muted)' : 'var(--accent)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '12px',
                            cursor: isFetching ? 'not-allowed' : 'pointer',
                            opacity: isFetching ? 0.6 : 1,
                          }}
                        >
                          {isFetching ? 'Fetching...' : 'Fetch Evidence'}
                        </button>
                        <button
                          onClick={() => handleChatPrompt(item.name, 'define')}
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
                          Define
                        </button>
                        <button
                          onClick={() => handleConceptClick(item.node_id)}
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
                          View
                        </button>
                      </div>
                    </div>
                    {/* Fetch result states */}
                    {fetchSuccess && fetchState.addedCount !== undefined && (
                      <div style={{ 
                        padding: '6px 10px', 
                        background: 'rgba(34, 197, 94, 0.1)', 
                        borderRadius: '6px',
                        fontSize: '12px',
                        color: 'rgb(34, 197, 94)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}>
                        <span>+{fetchState.addedCount} source{fetchState.addedCount !== 1 ? 's' : ''}</span>
                        <button
                          onClick={() => handleOpenEvidence(item.node_id)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'rgb(34, 197, 94)',
                            textDecoration: 'underline',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: '600',
                          }}
                        >
                          Open →
                        </button>
                      </div>
                    )}
                    {fetchEmpty && (
                      <div style={{ 
                        padding: '6px 10px', 
                        background: 'rgba(251, 191, 36, 0.1)', 
                        borderRadius: '6px',
                        fontSize: '12px',
                        color: 'rgb(251, 191, 36)',
                      }}>
                        No sources found
                      </div>
                    )}
                    {fetchError && fetchState.error && (
                      <div style={{ 
                        padding: '6px 10px', 
                        background: 'rgba(239, 68, 68, 0.1)', 
                        borderRadius: '6px',
                        fontSize: '12px',
                        color: 'rgb(239, 68, 68)',
                      }}>
                        {fetchState.error}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          </div>

          {/* Low Connectivity */}
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>
              Concepts that are under-connected
            </h3>
          {gaps.low_connectivity.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: '14px' }}>All concepts are well-connected! 🎉</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {gaps.low_connectivity.map(item => {
                const fetchState = fetchStates[item.node_id] || { status: 'idle' as const };
                const isFetching = fetchState.status === 'loading';
                const fetchSuccess = fetchState.status === 'success';
                const fetchEmpty = fetchState.status === 'empty';
                const fetchError = fetchState.status === 'error';

                return (
                  <div
                    key={item.node_id}
                    style={{
                      padding: '12px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: fetchSuccess || fetchEmpty || fetchError ? '8px' : '0' }}>
                      <div>
                        <div
                          onClick={() => handleConceptClick(item.node_id)}
                          style={{
                            fontSize: '16px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            color: 'var(--accent)',
                            marginBottom: '4px',
                          }}
                        >
                          {item.name}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                          {item.domain} • {item.degree} connection{item.degree !== 1 ? 's' : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => handleFetchEvidence(item.node_id, item.name)}
                          disabled={isFetching}
                          style={{
                            padding: '6px 12px',
                            background: isFetching ? 'var(--muted)' : 'var(--accent)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '12px',
                            cursor: isFetching ? 'not-allowed' : 'pointer',
                            opacity: isFetching ? 0.6 : 1,
                          }}
                        >
                          {isFetching ? 'Fetching...' : 'Fetch Evidence'}
                        </button>
                        <button
                          onClick={() => handleChatPrompt(item.name, 'lecture')}
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
                          Connect
                        </button>
                        <button
                          onClick={() => handleConceptClick(item.node_id)}
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
                          View
                        </button>
                      </div>
                    </div>
                    {/* Fetch result states */}
                    {fetchSuccess && fetchState.addedCount !== undefined && (
                      <div style={{ 
                        padding: '6px 10px', 
                        background: 'rgba(34, 197, 94, 0.1)', 
                        borderRadius: '6px',
                        fontSize: '12px',
                        color: 'rgb(34, 197, 94)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}>
                        <span>+{fetchState.addedCount} source{fetchState.addedCount !== 1 ? 's' : ''}</span>
                        <button
                          onClick={() => handleOpenEvidence(item.node_id)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'rgb(34, 197, 94)',
                            textDecoration: 'underline',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: '600',
                          }}
                        >
                          Open →
                        </button>
                      </div>
                    )}
                    {fetchEmpty && (
                      <div style={{ 
                        padding: '6px 10px', 
                        background: 'rgba(251, 191, 36, 0.1)', 
                        borderRadius: '6px',
                        fontSize: '12px',
                        color: 'rgb(251, 191, 36)',
                      }}>
                        No sources found
                      </div>
                    )}
                    {fetchError && fetchState.error && (
                      <div style={{ 
                        padding: '6px 10px', 
                        background: 'rgba(239, 68, 68, 0.1)', 
                        borderRadius: '6px',
                        fontSize: '12px',
                        color: 'rgb(239, 68, 68)',
                      }}>
                        {fetchState.error}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          </div>
        </div>

        {/* Evidence Gaps Section */}
        <div style={{
          background: 'var(--panel)',
          borderRadius: '12px',
          padding: '24px',
          boxShadow: 'var(--shadow)',
          marginBottom: '24px',
        }}>
          <div style={{ marginBottom: '20px', paddingBottom: '12px', borderBottom: '2px solid var(--border)' }}>
            <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '4px' }}>
              Evidence Gaps (Sourcing)
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0 }}>
              Concepts without attached sources, snapshots, or citations
            </p>
          </div>
          <div style={{ color: 'var(--muted)', fontSize: '14px', fontStyle: 'italic' }}>
            Evidence gap detection coming soon. This will identify concepts that lack:
            <ul style={{ marginTop: '8px', paddingLeft: '20px' }}>
              <li>Attached resources (papers, documents, PDFs)</li>
              <li>Browser Use–generated evidence</li>
              <li>Source citations</li>
              <li>Finance snapshots (for company nodes)</li>
            </ul>
          </div>
        </div>

        {/* Freshness Gaps Section */}
        <div style={{
          background: 'var(--panel)',
          borderRadius: '12px',
          padding: '24px',
          boxShadow: 'var(--shadow)',
          marginBottom: '24px',
        }}>
          <div style={{ marginBottom: '20px', paddingBottom: '12px', borderBottom: '2px solid var(--border)' }}>
            <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '4px' }}>
              Freshness Gaps (Updates)
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0 }}>
              Data that may be outdated or needs refresh
            </p>
          </div>
          <div style={{ color: 'var(--muted)', fontSize: '14px', fontStyle: 'italic' }}>
            Freshness gap detection coming soon. This will identify:
            <ul style={{ marginTop: '8px', paddingLeft: '20px' }}>
              <li>Finance snapshots older than 30 days</li>
              <li>Browser Use resources that haven&apos;t been updated</li>
              <li>Concepts with stale evidence</li>
              <li>Tracked companies needing refresh</li>
            </ul>
          </div>
        </div>

        {/* High Interest Low Coverage - Keep as part of Concept Gaps */}
        <div style={{
          background: 'var(--panel)',
          borderRadius: '12px',
          padding: '24px',
          boxShadow: 'var(--shadow)',
        }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>
            Frequently asked but lightly covered
          </h2>
          {gaps.high_interest_low_coverage.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: '14px' }}>No concepts match this criteria.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {gaps.high_interest_low_coverage.map(item => {
                const fetchState = fetchStates[item.node_id] || { status: 'idle' as const };
                const isFetching = fetchState.status === 'loading';
                const fetchSuccess = fetchState.status === 'success';
                const fetchEmpty = fetchState.status === 'empty';
                const fetchError = fetchState.status === 'error';

                return (
                  <div
                    key={item.node_id}
                    style={{
                      padding: '12px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: fetchSuccess || fetchEmpty || fetchError ? '8px' : '0' }}>
                      <div>
                        <div
                          onClick={() => handleConceptClick(item.node_id)}
                          style={{
                            fontSize: '16px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            color: 'var(--accent)',
                            marginBottom: '4px',
                          }}
                        >
                          {item.name}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                          {item.domain} • {item.question_count} question{item.question_count !== 1 ? 's' : ''} • {item.lecture_count} lecture{item.lecture_count !== 1 ? 's' : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => handleFetchEvidence(item.node_id, item.name)}
                          disabled={isFetching}
                          style={{
                            padding: '6px 12px',
                            background: isFetching ? 'var(--muted)' : 'var(--accent)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '12px',
                            cursor: isFetching ? 'not-allowed' : 'pointer',
                            opacity: isFetching ? 0.6 : 1,
                          }}
                        >
                          {isFetching ? 'Fetching...' : 'Fetch Evidence'}
                        </button>
                        <button
                          onClick={() => handleChatPrompt(item.name, 'lecture')}
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
                          Expand
                        </button>
                        <button
                          onClick={() => handleConceptClick(item.node_id)}
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
                          View
                        </button>
                      </div>
                    </div>
                    {/* Fetch result states */}
                    {fetchSuccess && fetchState.addedCount !== undefined && (
                      <div style={{ 
                        padding: '6px 10px', 
                        background: 'rgba(34, 197, 94, 0.1)', 
                        borderRadius: '6px',
                        fontSize: '12px',
                        color: 'rgb(34, 197, 94)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}>
                        <span>+{fetchState.addedCount} source{fetchState.addedCount !== 1 ? 's' : ''}</span>
                        <button
                          onClick={() => handleOpenEvidence(item.node_id)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'rgb(34, 197, 94)',
                            textDecoration: 'underline',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: '600',
                          }}
                        >
                          Open →
                        </button>
                      </div>
                    )}
                    {fetchEmpty && (
                      <div style={{ 
                        padding: '6px 10px', 
                        background: 'rgba(251, 191, 36, 0.1)', 
                        borderRadius: '6px',
                        fontSize: '12px',
                        color: 'rgb(251, 191, 36)',
                      }}>
                        No sources found
                      </div>
                    )}
                    {fetchError && fetchState.error && (
                      <div style={{ 
                        padding: '6px 10px', 
                        background: 'rgba(239, 68, 68, 0.1)', 
                        borderRadius: '6px',
                        fontSize: '12px',
                        color: 'rgb(239, 68, 68)',
                      }}>
                        {fetchState.error}
                      </div>
                    )}
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
