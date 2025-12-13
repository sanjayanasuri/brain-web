'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getGapsOverview, type GapsOverview } from '../api-client';

export default function GapsViewPage() {
  const router = useRouter();
  const [gaps, setGaps] = useState<GapsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadGaps() {
      try {
        setLoading(true);
        const data = await getGapsOverview(20);
        setGaps(data);
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
            Brain Web is curious...
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '16px' }}>
            Concepts that need attention in your knowledge graph
          </p>
        </div>

        {/* Missing Descriptions */}
        <div style={{
          background: 'var(--panel)',
          borderRadius: '12px',
          padding: '24px',
          boxShadow: 'var(--shadow)',
          marginBottom: '24px',
        }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>
            Concepts you mention but haven&apos;t defined
          </h2>
          {gaps.missing_descriptions.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: '14px' }}>All concepts have descriptions! 🎉</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {gaps.missing_descriptions.map(item => (
                <div
                  key={item.node_id}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
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
                  <div style={{ display: 'flex', gap: '8px' }}>
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
              ))}
            </div>
          )}
        </div>

        {/* Low Connectivity */}
        <div style={{
          background: 'var(--panel)',
          borderRadius: '12px',
          padding: '24px',
          boxShadow: 'var(--shadow)',
          marginBottom: '24px',
        }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>
            Concepts that are under-connected
          </h2>
          {gaps.low_connectivity.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: '14px' }}>All concepts are well-connected! 🎉</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {gaps.low_connectivity.map(item => (
                <div
                  key={item.node_id}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
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
                  <div style={{ display: 'flex', gap: '8px' }}>
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
              ))}
            </div>
          )}
        </div>

        {/* High Interest Low Coverage */}
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
              {gaps.high_interest_low_coverage.map(item => (
                <div
                  key={item.node_id}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
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
                  <div style={{ display: 'flex', gap: '8px' }}>
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
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
