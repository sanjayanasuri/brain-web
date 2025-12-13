'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  getLecture, 
  getLectureSegments, 
  type Lecture, 
  type LectureSegment,
  type Concept,
  type Analogy,
  getTeachingStyle,
  type TeachingStyleProfile,
} from '../api-client';

export default function LectureStudioPage() {
  return (
    <Suspense fallback={<div style={{ padding: '40px', textAlign: 'center' }}>Loading…</div>}>
      <LectureStudioPageInner />
    </Suspense>
  );
}

function LectureStudioPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const lectureId = searchParams?.get('lectureId') ?? null;

  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [segments, setSegments] = useState<LectureSegment[]>([]);
  const [teachingStyle, setTeachingStyle] = useState<TeachingStyleProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState<number | null>(null);
  const [highlightedConcepts, setHighlightedConcepts] = useState<Set<string>>(new Set());

  useEffect(() => {
    const id = lectureId;
    if (!id) {
      setError('No lecture ID provided');
      setLoading(false);
      return;
    }

    async function loadData(lectureId: string) {
      try {
        setLoading(true);
        const [lectureData, segmentsData, styleData] = await Promise.all([
          getLecture(lectureId),
          getLectureSegments(lectureId),
          getTeachingStyle().catch(() => null), // Optional, don't fail if missing
        ]);
        setLecture(lectureData);
        setSegments(segmentsData);
        setTeachingStyle(styleData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load lecture');
      } finally {
        setLoading(false);
      }
    }

    loadData(id);
  }, [lectureId]);

  // Collect all unique concepts from segments
  const allConcepts = new Map<string, Concept>();
  segments.forEach(seg => {
    seg.covered_concepts.forEach(concept => {
      if (!allConcepts.has(concept.node_id)) {
        allConcepts.set(concept.node_id, concept);
      }
    });
  });

  // Collect all analogies
  const allAnalogies: Analogy[] = [];
  segments.forEach(seg => {
    seg.analogies.forEach(analogy => {
      if (!allAnalogies.find(a => a.analogy_id === analogy.analogy_id)) {
        allAnalogies.push(analogy);
      }
    });
  });

  const handleSegmentClick = (index: number, segment: LectureSegment) => {
    setSelectedSegmentIndex(index);
    const conceptIds = new Set(segment.covered_concepts.map(c => c.node_id));
    setHighlightedConcepts(conceptIds);
  };

  const handleConceptClick = (concept: Concept) => {
    router.push(`/concepts/${concept.node_id}`);
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: '18px', color: 'var(--muted)' }}>Loading lecture...</div>
      </div>
    );
  }

  if (error || !lecture) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: '18px', color: 'var(--accent-2)' }}>{error || 'Lecture not found'}</div>
        <Link href="/" style={{ marginTop: '20px', display: 'inline-block', color: 'var(--accent)' }}>
          ← Back to Graph
        </Link>
      </div>
    );
  }

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: 'linear-gradient(180deg, #fdf7ec 0%, #eef6ff 60%, #f7f9fb 100%)',
      padding: '20px',
    }}>
      <div style={{ maxWidth: '1600px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '24px' }}>
          <Link href="/" style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: '14px' }}>
            ← Back to Graph
          </Link>
          <h1 style={{ fontSize: '32px', fontWeight: '700', marginTop: '12px', marginBottom: '8px' }}>
            {lecture.title}
          </h1>
          {lecture.description && (
            <p style={{ color: 'var(--muted)', fontSize: '16px' }}>{lecture.description}</p>
          )}
        </div>

        {/* Three Column Layout */}
        <div className="lecture-studio-grid">
          {/* Left Column - Timeline */}
          <div style={{
            background: 'var(--panel)',
            borderRadius: '12px',
            padding: '20px',
            boxShadow: 'var(--shadow)',
            maxHeight: 'calc(100vh - 200px)',
            overflowY: 'auto',
          }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>Timeline</h2>
            {segments.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: '14px' }}>No segments available</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {segments.map((segment, index) => (
                  <div
                    key={segment.segment_id}
                    onClick={() => handleSegmentClick(index, segment)}
                    style={{
                      padding: '12px',
                      borderRadius: '8px',
                      border: selectedSegmentIndex === index ? '2px solid var(--accent)' : '1px solid var(--border)',
                      background: selectedSegmentIndex === index ? 'rgba(17, 138, 178, 0.05)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--muted)', marginBottom: '4px' }}>
                      Segment #{segment.segment_index + 1}
                    </div>
                    {segment.summary ? (
                      <div style={{ fontSize: '14px', marginBottom: '8px' }}>{segment.summary}</div>
                    ) : (
                      <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '8px' }}>
                        {segment.text.substring(0, 100)}...
                      </div>
                    )}
                    {segment.style_tags && segment.style_tags.length > 0 && (
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                        {segment.style_tags.map(tag => (
                          <span
                            key={tag}
                            style={{
                              fontSize: '11px',
                              padding: '2px 8px',
                              background: 'rgba(17, 138, 178, 0.1)',
                              borderRadius: '12px',
                              color: 'var(--accent)',
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {segment.covered_concepts.length > 0 && (
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {segment.covered_concepts.map(concept => (
                          <span
                            key={concept.node_id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleConceptClick(concept);
                            }}
                            style={{
                              fontSize: '11px',
                              padding: '2px 8px',
                              background: highlightedConcepts.has(concept.node_id)
                                ? 'var(--accent)'
                                : 'rgba(17, 138, 178, 0.1)',
                              color: highlightedConcepts.has(concept.node_id) ? 'white' : 'var(--accent)',
                              borderRadius: '12px',
                              cursor: 'pointer',
                            }}
                          >
                            {concept.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Middle Column - Concept Cluster */}
          <div style={{
            background: 'var(--panel)',
            borderRadius: '12px',
            padding: '20px',
            boxShadow: 'var(--shadow)',
            maxHeight: 'calc(100vh - 200px)',
            overflowY: 'auto',
          }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>Concept Cluster</h2>
            {allConcepts.size === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: '14px' }}>No concepts in this lecture</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {Array.from(allConcepts.values()).map(concept => {
                  // Count how many segments mention this concept
                  const segmentCount = segments.filter(seg =>
                    seg.covered_concepts.some(c => c.node_id === concept.node_id)
                  ).length;
                  
                  const hasDescription = concept.description && concept.description.length > 20;
                  
                  return (
                    <div
                      key={concept.node_id}
                      onClick={() => handleConceptClick(concept)}
                      style={{
                        padding: '12px',
                        borderRadius: '8px',
                        border: highlightedConcepts.has(concept.node_id)
                          ? '2px solid var(--accent)'
                          : '1px solid var(--border)',
                        background: highlightedConcepts.has(concept.node_id)
                          ? 'rgba(17, 138, 178, 0.05)'
                          : 'transparent',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '4px' }}>
                        <div style={{ fontSize: '16px', fontWeight: '600' }}>{concept.name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                          {segmentCount} segment{segmentCount !== 1 ? 's' : ''}
                        </div>
                      </div>
                      {concept.domain && (
                        <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>
                          {concept.domain}
                        </div>
                      )}
                      {hasDescription ? (
                        <div style={{ fontSize: '13px', color: 'var(--ink)', marginTop: '4px' }}>
                          {concept.description?.substring(0, 120)}...
                        </div>
                      ) : (
                        <div style={{ fontSize: '12px', color: 'var(--accent-2)', fontStyle: 'italic' }}>
                          Missing description
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Column - Teaching Insights & Actions */}
          <div style={{
            background: 'var(--panel)',
            borderRadius: '12px',
            padding: '20px',
            boxShadow: 'var(--shadow)',
            maxHeight: 'calc(100vh - 200px)',
            overflowY: 'auto',
          }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>Insights & Actions</h2>
            
            {/* Analogies Section */}
            {allAnalogies.length > 0 && (
              <div style={{ marginBottom: '24px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: 'var(--muted)' }}>
                  Analogies in this lecture
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {allAnalogies.map(analogy => (
                    <div
                      key={analogy.analogy_id}
                      style={{
                        padding: '10px',
                        background: 'rgba(17, 138, 178, 0.05)',
                        borderRadius: '6px',
                        border: '1px solid rgba(17, 138, 178, 0.2)',
                      }}
                    >
                      <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>
                        {analogy.label}
                      </div>
                      {analogy.description && (
                        <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                          {analogy.description}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Style Snapshot */}
            {teachingStyle && (
              <div style={{ marginBottom: '24px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: 'var(--muted)' }}>
                  Style snapshot
                </h3>
                <div style={{ fontSize: '12px', color: 'var(--ink)', lineHeight: '1.6' }}>
                  <div style={{ marginBottom: '8px' }}>
                    <strong>Tone:</strong> {teachingStyle.tone}
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <strong>Teaching style:</strong> {teachingStyle.teaching_style}
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <strong>Explanation order:</strong> {teachingStyle.explanation_order.join(' → ')}
                  </div>
                </div>
              </div>
            )}

            {/* Gaps Section */}
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: 'var(--muted)' }}>
                Gaps (this lecture)
              </h3>
              {Array.from(allConcepts.values()).filter(c => 
                !c.description || c.description.length < 20
              ).length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {Array.from(allConcepts.values())
                    .filter(c => !c.description || c.description.length < 20)
                    .map(concept => (
                      <div key={concept.node_id} style={{ fontSize: '12px', color: 'var(--accent-2)' }}>
                        • Consider defining <strong>{concept.name}</strong>
                      </div>
                    ))}
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>All concepts have descriptions</div>
              )}
            </div>

            {/* Draft Follow-up Lecture Button */}
            <div>
              <Link
                href={`/lecture-studio/draft?lectureId=${lectureId}`}
                style={{
                  display: 'inline-block',
                  padding: '12px 20px',
                  background: 'var(--accent)',
                  color: 'white',
                  borderRadius: '8px',
                  textDecoration: 'none',
                  fontSize: '14px',
                  fontWeight: '600',
                  transition: 'opacity 0.2s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
                onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
              >
                Draft follow-up lecture →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
