'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  getConcept, 
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

interface NeighborWithRelationship {
  concept: Concept;
  predicate: string;
  is_outgoing: boolean;
}

export default function ConceptBoardPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const conceptId = params?.id ?? '';
  const queryClient = useQueryClient();

  const [error, setError] = useState<string | null>(null);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedDescription, setEditedDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'claims' | 'sources'>('overview');

  const conceptQuery = useQuery<Concept>({
    queryKey: ['concept', conceptId],
    queryFn: () => getConcept(conceptId),
    enabled: !!conceptId,
  });

  const neighborsQuery = useQuery<NeighborWithRelationship[]>({
    queryKey: ['concept', conceptId, 'neighbors-with-relationships'],
    queryFn: async () => (await getNeighborsWithRelationships(conceptId)) as NeighborWithRelationship[],
    enabled: !!conceptId,
  });

  const resourcesQuery = useQuery<Resource[]>({
    queryKey: ['concept', conceptId, 'resources'],
    queryFn: () => getResourcesForConcept(conceptId),
    enabled: !!conceptId,
  });

  const claimsQuery = useQuery<Claim[]>({
    queryKey: ['concept', conceptId, 'claims'],
    queryFn: () => getClaimsForConcept(conceptId),
    enabled: !!conceptId,
  });

  const sourcesQuery = useQuery<Source[]>({
    queryKey: ['concept', conceptId, 'sources'],
    queryFn: () => getSourcesForConcept(conceptId),
    enabled: !!conceptId,
  });

  const conceptName = conceptQuery.data?.name ?? '';

  const segmentsQuery = useQuery<LectureSegment[]>({
    queryKey: ['concept', conceptId, 'segments', conceptName],
    queryFn: () => getSegmentsByConcept(conceptName),
    enabled: Boolean(conceptName),
  });

  const qualityQuery = useQuery<ConceptQuality>({
    queryKey: ['concept', conceptId, 'quality'],
    queryFn: () => getConceptQuality(conceptId),
    enabled: !!conceptId,
  });

  const concept = conceptQuery.data ?? null;
  const neighbors = neighborsQuery.data ?? [];
  const segments = segmentsQuery.data ?? [];
  const resources = resourcesQuery.data ?? [];
  const claims = claimsQuery.data ?? [];
  const sources = sourcesQuery.data ?? [];
  const conceptQuality = qualityQuery.data ?? null;
  const loading = conceptQuery.isLoading;
  const loadError =
    conceptQuery.error instanceof Error ? conceptQuery.error.message : conceptQuery.error ? 'Failed to load concept' : null;

  // Reset edit state when concept changes
  useEffect(() => {
    if (concept) {
      setEditedDescription(concept.description || '');
      setIsEditingDescription(false);
    }
  }, [concept]);

  const handleNeighborClick = (neighborId: string) => {
    router.push(`/concepts/${neighborId}`);
  };

  const handleSegmentClick = (segment: LectureSegment) => {
    router.push(`/reader/segment?lectureId=${segment.lecture_id}&segmentIndex=${segment.segment_index}`);
  };

  const handleSaveDescription = async () => {
    if (!concept) return;
    try {
      setIsSaving(true);
      const updated = await updateConcept(concept.node_id, {
        description: editedDescription,
      });
      queryClient.setQueryData(['concept', concept.node_id], updated);
      setIsEditingDescription(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update description');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditedDescription(concept?.description || '');
    setIsEditingDescription(false);
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

  if (error || loadError || !concept) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: '18px', color: 'var(--accent-2)' }}>{error || loadError || 'Concept not found'}</div>
        <Link href="/" style={{ marginTop: '20px', display: 'inline-block', color: 'var(--accent)' }}>
          ← Back to Graph
        </Link>
      </div>
    );
  }

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: 'var(--page-bg)',
      padding: '20px',
    }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '24px' }}>
          <Link href="/" style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: '14px' }}>
            ← Back to Graph
          </Link>
          <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: '32px', fontWeight: '700', margin: 0 }}>
              {concept.name}
            </h1>
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
          <button
            onClick={() => setActiveTab('overview')}
            style={{
              padding: '12px 24px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'overview' ? '3px solid var(--accent)' : '3px solid transparent',
              color: activeTab === 'overview' ? 'var(--accent)' : 'var(--muted)',
              fontSize: '14px',
              fontWeight: activeTab === 'overview' ? '600' : '400',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('claims')}
            style={{
              padding: '12px 24px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'claims' ? '3px solid var(--accent)' : '3px solid transparent',
              color: activeTab === 'claims' ? 'var(--accent)' : 'var(--muted)',
              fontSize: '14px',
              fontWeight: activeTab === 'claims' ? '600' : '400',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            Claims {claims.length > 0 && `(${claims.length})`}
          </button>
          <button
            onClick={() => setActiveTab('sources')}
            style={{
              padding: '12px 24px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'sources' ? '3px solid var(--accent)' : '3px solid transparent',
              color: activeTab === 'sources' ? 'var(--accent)' : 'var(--muted)',
              fontSize: '14px',
              fontWeight: activeTab === 'sources' ? '600' : '400',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            Sources {sources.length > 0 && `(${sources.length})`}
          </button>
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <>
            {/* Definition & Notes */}
            <div style={{
              background: 'var(--panel)',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: 'var(--shadow)',
              marginBottom: '24px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: '600', margin: 0 }}>
                  Definition & Notes
                </h2>
            {!isEditingDescription && (
              <button
                onClick={() => setIsEditingDescription(true)}
                style={{
                  padding: '6px 12px',
                  background: 'var(--accent)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: '500',
                  cursor: 'pointer',
                }}
              >
                Edit
              </button>
            )}
          </div>
          {isEditingDescription ? (
            <div>
              <textarea
                value={editedDescription}
                onChange={(e) => setEditedDescription(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: '150px',
                  padding: '12px',
                  fontSize: '16px',
                  lineHeight: '1.6',
                  fontFamily: 'inherit',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  resize: 'vertical',
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                }}
                placeholder="Enter concept description..."
              />
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                <button
                  onClick={handleSaveDescription}
                  disabled={isSaving}
                  style={{
                    padding: '8px 16px',
                    background: isSaving ? 'var(--muted)' : 'var(--accent)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: '500',
                    cursor: isSaving ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={handleCancelEdit}
                  disabled={isSaving}
                  style={{
                    padding: '8px 16px',
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
            </div>
          ) : concept.description ? (
            <div style={{ fontSize: '16px', lineHeight: '1.6', color: 'var(--ink)', marginBottom: '16px' }}>
              {concept.description}
            </div>
          ) : (
            <div style={{ fontSize: '14px', color: 'var(--accent-2)', fontStyle: 'italic' }}>
              No description available. Consider adding one!
            </div>
          )}
          {concept.tags && concept.tags.length > 0 && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
              {concept.tags.map(tag => (
                <span
                  key={tag}
                  style={{
                    padding: '4px 10px',
                    background: 'var(--panel)',
                    border: '1px solid var(--border)',
                    color: 'var(--accent)',
                    borderRadius: '12px',
                    fontSize: '12px',
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Two Column Layout for Connections and Lecture Segments */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '1fr 1fr', 
          gap: '24px',
          marginBottom: '24px',
        }}>
          {/* Connections */}
          <div style={{
            background: 'var(--panel)',
            borderRadius: '12px',
            padding: '24px',
            boxShadow: 'var(--shadow)',
          }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>
              Connections
            </h2>
            {neighbors.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: '14px' }}>No connections found</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {neighbors.map((neighbor, index) => (
                  <div
                    key={neighbor.concept.node_id}
                    onClick={() => handleNeighborClick(neighbor.concept.node_id)}
                    style={{
                      padding: '12px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--panel)';
                      e.currentTarget.style.borderColor = 'var(--accent)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.borderColor = 'var(--border)';
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '4px' }}>
                      <div style={{ fontSize: '16px', fontWeight: '600' }}>
                        {neighbor.concept.name}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--muted)', padding: '2px 8px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '12px' }}>
                        {neighbor.predicate}
                      </div>
                    </div>
                    {neighbor.concept.description && (
                      <div style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '4px' }}>
                        {neighbor.concept.description.substring(0, 100)}...
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Where it shows up in lectures */}
          <div style={{
            background: 'var(--panel)',
            borderRadius: '12px',
            padding: '24px',
            boxShadow: 'var(--shadow)',
          }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>
              In Lectures
            </h2>
            {segments.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: '14px' }}>Not mentioned in any lectures</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '500px', overflowY: 'auto' }}>
                {segments.map(segment => (
                  <div
                    key={segment.segment_id}
                    onClick={() => handleSegmentClick(segment)}
                    style={{
                      padding: '12px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--panel)';
                      e.currentTarget.style.borderColor = 'var(--accent)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.borderColor = 'var(--border)';
                    }}
                  >
                    <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>
                      {segment.lecture_title || `Lecture ${segment.lecture_id}`}
                    </div>
                    {segment.summary ? (
                      <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>
                        {segment.summary}
                      </div>
                    ) : (
                      <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>
                        {segment.text.substring(0, 100)}...
                      </div>
                    )}
                    <div style={{ fontSize: '11px', color: 'var(--accent)', marginTop: '6px' }}>
                      Segment #{segment.segment_index + 1} →
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Resources */}
        {resources.length > 0 && (
          <div style={{
            background: 'var(--panel)',
            borderRadius: '12px',
            padding: '24px',
            boxShadow: 'var(--shadow)',
          }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>
              Resources
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' }}>
              {resources.map(resource => (
                <div
                  key={resource.resource_id}
                  style={{
                    padding: '12px',
                    background: 'var(--panel)',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>
                    {resource.title || resource.kind}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '8px' }}>
                    {resource.kind}
                  </div>
                  {resource.url && (
                    <a
                      href={resource.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'inline-block',
                        padding: '4px 12px',
                        background: 'var(--accent)',
                        color: 'white',
                        borderRadius: '6px',
                        fontSize: '12px',
                        textDecoration: 'none',
                      }}
                    >
                      Open →
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        </>
        )}

        {/* Claims Tab */}
        {activeTab === 'claims' && (
          <div style={{
            background: 'var(--panel)',
            borderRadius: '12px',
            padding: '24px',
            boxShadow: 'var(--shadow)',
          }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>
              Claims
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
                      {claim.source_span && (
                        <span style={{
                          padding: '2px 8px',
                          background: 'var(--panel)',
                          border: '1px solid var(--border)',
                          color: 'var(--muted)',
                          borderRadius: '12px',
                          fontSize: '11px',
                        }}>
                          {claim.source_span}
                        </span>
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
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>
              Sources
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
                        {source.company_ticker && (
                          <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>
                            {source.company_ticker}
                          </div>
                        )}
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
                    {source.chunks && source.chunks.length > 0 && (
                      <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
                        <div style={{ fontSize: '12px', fontWeight: '600', marginBottom: '8px', color: 'var(--muted)' }}>
                          {source.chunks.length} chunk{source.chunks.length !== 1 ? 's' : ''}
                        </div>
                        {source.chunks.slice(0, 2).map((chunk, idx) => (
                          <div key={chunk.chunk_id} style={{
                            fontSize: '12px',
                            color: 'var(--muted)',
                            marginBottom: '4px',
                            fontStyle: 'italic',
                          }}>
                            {chunk.text_preview}...
                          </div>
                        ))}
                      </div>
                    )}
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
