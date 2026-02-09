'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import MarkdownIt from 'markdown-it';
import TurndownService from 'turndown';
import { 
  getConcept, 
  getConceptBySlug,
  getNeighborsWithRelationships,
  getSegmentsByConcept,
  getResourcesForConcept,
  updateConcept,
  getClaimsForConcept,
  getSourcesForConcept,
  getConceptQuality,
  type Concept,
  type LectureSegment,
  type Resource,
  type Claim,
  type Source,
  type ConceptQuality,
} from '../../api-client';
import { CoveragePill, FreshnessPill } from '../../components/ui/QualityIndicators';

// Lazy load the rich text editor
const LectureEditor = dynamic(
  () => import('../../components/lecture-editor/LectureEditor').then(mod => ({ default: mod.LectureEditor })),
  { ssr: false, loading: () => <div style={{ padding: '20px' }}>Loading editor...</div> }
);

// Initialize markdown renderer
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
});

// Initialize Turndown for HTML to Markdown conversion
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

interface NeighborWithRelationship {
  concept: Concept;
  predicate: string;
  is_outgoing: boolean;
}

export default function ConceptWikiPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const conceptId = params?.id ?? '';
  const queryClient = useQueryClient();
  const graphId = searchParams?.get('graph_id') || undefined;

  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedHtml, setEditedHtml] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'article' | 'connections' | 'claims' | 'sources'>('article');

  // Check if it's a slug (contains hyphens/letters) or node_id (starts with N)
  const isSlug = !conceptId.startsWith('N') && (conceptId.includes('-') || /^[a-z0-9-]+$/.test(conceptId));

  const conceptQuery = useQuery<Concept>({
    queryKey: ['concept', conceptId, isSlug ? 'slug' : 'id'],
    queryFn: () => isSlug 
      ? getConceptBySlug(conceptId)
      : getConcept(conceptId),
    enabled: !!conceptId,
  });

  const neighborsQuery = useQuery<NeighborWithRelationship[]>({
    queryKey: ['concept', conceptQuery.data?.node_id, 'neighbors-with-relationships'],
    queryFn: async () => {
      if (!conceptQuery.data?.node_id) return [];
      return (await getNeighborsWithRelationships(conceptQuery.data.node_id)) as NeighborWithRelationship[];
    },
    enabled: !!conceptQuery.data?.node_id,
  });

  const resourcesQuery = useQuery<Resource[]>({
    queryKey: ['concept', conceptQuery.data?.node_id, 'resources'],
    queryFn: () => {
      if (!conceptQuery.data?.node_id) return [];
      return getResourcesForConcept(conceptQuery.data.node_id);
    },
    enabled: !!conceptQuery.data?.node_id,
  });

  const claimsQuery = useQuery<Claim[]>({
    queryKey: ['concept', conceptQuery.data?.node_id, 'claims'],
    queryFn: () => {
      if (!conceptQuery.data?.node_id) return [];
      return getClaimsForConcept(conceptQuery.data.node_id);
    },
    enabled: !!conceptQuery.data?.node_id,
  });

  const sourcesQuery = useQuery<Source[]>({
    queryKey: ['concept', conceptQuery.data?.node_id, 'sources'],
    queryFn: () => {
      if (!conceptQuery.data?.node_id) return [];
      return getSourcesForConcept(conceptQuery.data.node_id);
    },
    enabled: !!conceptQuery.data?.node_id,
  });

  const conceptName = conceptQuery.data?.name ?? '';

  const segmentsQuery = useQuery<LectureSegment[]>({
    queryKey: ['concept', conceptQuery.data?.node_id, 'segments', conceptName],
    queryFn: () => getSegmentsByConcept(conceptName),
    enabled: Boolean(conceptName),
  });

  const qualityQuery = useQuery<ConceptQuality>({
    queryKey: ['concept', conceptQuery.data?.node_id, 'quality'],
    queryFn: () => {
      if (!conceptQuery.data?.node_id) return null as any;
      return getConceptQuality(conceptQuery.data.node_id);
    },
    enabled: !!conceptQuery.data?.node_id,
  });

  const concept = conceptQuery.data ?? null;
  const neighbors = neighborsQuery.data ?? [];
  const segments = segmentsQuery.data ?? [];
  const resources = resourcesQuery.data ?? [];
  const claims = claimsQuery.data ?? [];
  const sources = sourcesQuery.data ?? [];
  const conceptQuality = qualityQuery.data ?? null;
  const loading = conceptQuery.isLoading;
  const queryError = conceptQuery.error;
  
  // Update error state from query error
  useEffect(() => {
    if (queryError) {
      setError(queryError instanceof Error ? queryError.message : 'Failed to load concept');
    }
  }, [queryError]);

  // Initialize edit content when entering edit mode
  useEffect(() => {
    if (isEditing && concept) {
      // Convert description to HTML if it's markdown, or use as-is if HTML
      const content = concept.description || '';
      // If it looks like markdown, convert to HTML
      if (content && (content.includes('#') || content.includes('**') || content.includes('*'))) {
        const html = md.render(content);
        setEditedHtml(html);
      } else {
        setEditedHtml(content);
      }
    }
  }, [isEditing, concept]);

  const handleSave = async () => {
    if (!concept) return;
    try {
      setIsSaving(true);
      
      // Convert HTML to markdown for storage
      const markdown = turndownService.turndown(editedHtml);
      
      const updated = await updateConcept(concept.node_id, {
        description: markdown, // Store as markdown
      });
      
      queryClient.setQueryData(['concept', concept.node_id], updated);
      if (concept.url_slug) {
        queryClient.setQueryData(['concept', concept.url_slug, 'slug'], updated);
      }
      // Dispatch event for confirmation button
      window.dispatchEvent(new CustomEvent('graph-action', { detail: { type: 'edited' } }));
      setIsEditing(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update concept');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    if (concept) {
      const content = concept.description || '';
      if (content && (content.includes('#') || content.includes('**') || content.includes('*'))) {
        setEditedHtml(md.render(content));
      } else {
        setEditedHtml(content);
      }
    }
  };

  const handleNeighborClick = (neighbor: Concept) => {
    const slug = neighbor.url_slug || neighbor.node_id;
    router.push(`/concepts/${slug}${graphId ? `?graph_id=${graphId}` : ''}`);
  };

  const handleSegmentClick = (segment: LectureSegment) => {
    router.push(`/lecture-editor?lectureId=${segment.lecture_id}`);
  };

  if (!conceptId) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: '18px', color: 'var(--muted)' }}>No concept ID provided.</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: '18px', color: 'var(--muted)' }}>Loading concept...</div>
      </div>
    );
  }

  // Show error if query failed or concept not found
  if (queryError || error || (!loading && !concept)) {
    const errorMessage = queryError instanceof Error 
      ? queryError.message 
      : error || 'Concept not found';
    
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: '18px', color: 'var(--accent-2)', marginBottom: '12px' }}>
          {errorMessage}
        </div>
        {errorMessage.includes('Failed to fetch') && (
          <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '12px' }}>
            Make sure the backend API is running at {process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000'}
          </div>
        )}
        <Link href="/" style={{ marginTop: '20px', display: 'inline-block', color: 'var(--accent)' }}>
          ← Back to Graph
        </Link>
      </div>
    );
  }

  // At this point, concept must be non-null
  if (!concept) {
    return null;
  }

  // Convert markdown description to HTML for display
  const renderContent = () => {
    if (!concept || !concept.description) {
      return <p style={{ color: 'var(--muted)', fontStyle: 'italic' }}>No content yet. Click Edit to add content.</p>;
    }
    
    // Render markdown to HTML
    const html = md.render(concept.description);
    return <div className="markdown-content" dangerouslySetInnerHTML={{ __html: html }} />;
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: 'var(--page-bg)',
    }}>
      {/* Wikipedia-style header */}
      <div style={{
        borderBottom: '1px solid var(--border)',
        background: 'var(--panel)',
        padding: '12px 0',
        marginBottom: '24px',
      }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Link href="/" style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: '14px' }}>
              ← Back to Graph
            </Link>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              {!isEditing ? (
                <button
                  onClick={() => setIsEditing(true)}
                  style={{
                    padding: '6px 16px',
                    background: 'var(--accent)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: '500',
                    cursor: 'pointer',
                  }}
                >
                  ✏️ Edit
                </button>
              ) : (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    style={{
                      padding: '6px 16px',
                      background: isSaving ? 'var(--muted)' : 'var(--accent)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontWeight: '500',
                      cursor: isSaving ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isSaving ? 'Saving...' : '💾 Save'}
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    disabled={isSaving}
                    style={{
                      padding: '6px 16px',
                      background: 'transparent',
                      color: 'var(--muted)',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontWeight: '500',
                      cursor: isSaving ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 20px' }}>
        {/* Title Section */}
        <div style={{ marginBottom: '32px' }}>
          <h1 style={{ 
            fontSize: '42px', 
            fontWeight: '700', 
            margin: '0 0 12px 0',
            borderBottom: '1px solid var(--border)',
            paddingBottom: '12px',
          }}>
            {concept.name}
          </h1>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
            {concept.domain && (
              <span style={{
                padding: '4px 12px',
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                color: 'var(--accent)',
                borderRadius: '16px',
                fontSize: '12px',
                fontWeight: '500',
              }}>
                {concept.domain}
              </span>
            )}
            {concept.type && (
              <span style={{
                padding: '4px 12px',
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                color: 'var(--muted)',
                borderRadius: '16px',
                fontSize: '12px',
                fontWeight: '500',
              }}>
                {concept.type}
              </span>
            )}
            {conceptQuality && (
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

        {/* Tabs */}
        <div style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '24px',
          borderBottom: '2px solid var(--border)',
        }}>
          {(['article', 'connections', 'claims', 'sources'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '12px 24px',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === tab ? '3px solid var(--accent)' : '3px solid transparent',
                color: activeTab === tab ? 'var(--accent)' : 'var(--muted)',
                fontSize: '14px',
                fontWeight: activeTab === tab ? '600' : '400',
                cursor: 'pointer',
                transition: 'all 0.2s',
                textTransform: 'capitalize',
              }}
            >
              {tab} {tab === 'claims' && claims.length > 0 && `(${claims.length})`}
              {tab === 'sources' && sources.length > 0 && `(${sources.length})`}
            </button>
          ))}
        </div>

        {/* Article Tab - Main Content */}
        {activeTab === 'article' && (
          <div style={{
            background: 'var(--panel)',
            borderRadius: '12px',
            padding: '32px',
            boxShadow: 'var(--shadow)',
            minHeight: '400px',
          }}>
            {isEditing ? (
              <div>
                <LectureEditor
                  content={editedHtml}
                  onUpdate={(html) => {
                    setEditedHtml(html);
                  }}
                  placeholder="Start writing... Use @ to mention other concepts, # for headers..."
                  graphId={graphId}
                />
              </div>
            ) : (
              <div style={{
                fontSize: '16px',
                lineHeight: '1.8',
                color: 'var(--ink)',
              }}>
                {renderContent()}
              </div>
            )}
          </div>
        )}

        {/* Connections Tab */}
        {activeTab === 'connections' && (
          <div style={{
            background: 'var(--panel)',
            borderRadius: '12px',
            padding: '24px',
            boxShadow: 'var(--shadow)',
          }}>
            <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px' }}>
              Related Concepts
            </h2>
            {neighbors.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: '14px' }}>No connections found</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '16px' }}>
                {neighbors.map((neighbor) => (
                  <div
                    key={neighbor.concept.node_id}
                    onClick={() => handleNeighborClick(neighbor.concept)}
                    style={{
                      padding: '16px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--surface)';
                      e.currentTarget.style.borderColor = 'var(--accent)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.borderColor = 'var(--border)';
                    }}
                  >
                    <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}>
                      {neighbor.concept.name}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>
                      {neighbor.predicate}
                    </div>
                    {neighbor.concept.description && (
                      <div style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '8px' }}>
                        {neighbor.concept.description.substring(0, 100)}...
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Claims Tab */}
        {activeTab === 'claims' && (
          <div style={{
            background: 'var(--panel)',
            borderRadius: '12px',
            padding: '24px',
            boxShadow: 'var(--shadow)',
          }}>
            <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px' }}>
              Claims ({claims.length})
            </h2>
            {claims.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: '14px' }}>No claims found for this concept</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {claims.map((claim) => (
                  <div
                    key={claim.claim_id}
                    style={{
                      padding: '16px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '8px' }}>
                      <div style={{ fontSize: '14px', lineHeight: '1.6', flex: 1 }}>
                        {claim.text}
                      </div>
                      <div style={{
                        padding: '4px 10px',
                        background: 'var(--panel)',
                        border: '1px solid var(--border)',
                        color: 'var(--accent)',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: '600',
                        whiteSpace: 'nowrap',
                        marginLeft: '12px',
                      }}>
                        {(claim.confidence * 100).toFixed(0)}%
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                      {claim.source_type && (
                        <span style={{
                          padding: '2px 8px',
                          background: 'var(--panel)',
                          border: '1px solid var(--border)',
                          color: 'var(--muted)',
                          borderRadius: '12px',
                          fontSize: '11px',
                        }}>
                          {claim.source_type}
                        </span>
                      )}
                      {claim.source_url && (
                        <a
                          href={claim.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            padding: '2px 8px',
                            background: 'var(--panel)',
                            border: '1px solid var(--border)',
                            color: 'var(--accent)',
                            borderRadius: '12px',
                            fontSize: '11px',
                            textDecoration: 'none',
                          }}
                        >
                          View source →
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Sources Tab */}
        {activeTab === 'sources' && (
          <div style={{
            background: 'var(--panel)',
            borderRadius: '12px',
            padding: '24px',
            boxShadow: 'var(--shadow)',
          }}>
            <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px' }}>
              Sources ({sources.length})
            </h2>
            {sources.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: '14px' }}>No sources found for this concept</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {sources.map((source) => (
                  <div
                    key={source.doc_id}
                    style={{
                      padding: '16px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '8px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '15px', fontWeight: '600', marginBottom: '4px' }}>
                          {source.doc_type || source.external_id || 'Document'}
                        </div>
                        {source.published_at && (
                          <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                            {new Date(source.published_at).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span style={{
                          padding: '4px 10px',
                          background: 'var(--panel)',
                          border: '1px solid var(--border)',
                          color: 'var(--accent)',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: '600',
                        }}>
                          {source.source_type}
                        </span>
                        <span style={{
                          padding: '4px 10px',
                          background: 'var(--panel)',
                          border: '1px solid var(--border)',
                          color: 'var(--muted)',
                          borderRadius: '12px',
                          fontSize: '11px',
                        }}>
                          {source.claim_count} claim{source.claim_count !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                    {source.url && (
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'inline-block',
                          marginTop: '8px',
                          padding: '6px 12px',
                          background: 'var(--accent)',
                          color: 'white',
                          borderRadius: '6px',
                          fontSize: '12px',
                          textDecoration: 'none',
                        }}
                      >
                        Open source →
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <style jsx global>{`
        .markdown-content h1,
        .markdown-content h2,
        .markdown-content h3 {
          margin-top: 24px;
          margin-bottom: 12px;
          font-weight: 600;
        }
        .markdown-content h1 {
          font-size: 28px;
        }
        .markdown-content h2 {
          font-size: 24px;
        }
        .markdown-content h3 {
          font-size: 20px;
        }
        .markdown-content p {
          margin-bottom: 16px;
          line-height: 1.8;
        }
        .markdown-content a {
          color: var(--accent);
          text-decoration: none;
        }
        .markdown-content a:hover {
          text-decoration: underline;
        }
        .markdown-content ul,
        .markdown-content ol {
          margin-bottom: 16px;
          padding-left: 24px;
        }
        .markdown-content li {
          margin-bottom: 8px;
        }
        .markdown-content code {
          background: var(--surface);
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 0.9em;
        }
        .markdown-content pre {
          background: var(--surface);
          padding: 16px;
          border-radius: 8px;
          overflow-x: auto;
          margin-bottom: 16px;
        }
        .markdown-content blockquote {
          border-left: 4px solid var(--accent);
          padding-left: 16px;
          margin-left: 0;
          color: var(--muted);
          font-style: italic;
        }
      `}</style>
    </div>
  );
}
