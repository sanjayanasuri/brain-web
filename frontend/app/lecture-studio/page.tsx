'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  listLectures,
  getLecture,
  getLectureSegments,
  ingestLecture,
  type Lecture,
  type LectureSegment,
  type Concept,
  type Analogy,
  getConcept,
  getNeighborsWithRelationships,
  type TeachingStyleProfile,
  type PDFIngestResponse,
} from '../api-client';
import { optimizedStorage } from '../lib/navigationUtils';
import { focusOnPenPointerDown, getScribbleInputStyle, scribbleInputProps, useIPadLikeDevice } from '../lib/ipadScribble';
import PDFViewer from '../components/pdf/PDFViewer';

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
  const [showIngestModal, setShowIngestModal] = useState(false);
  const [ingestText, setIngestText] = useState('');
  const [ingestDomain, setIngestDomain] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [ingestMode, setIngestMode] = useState<'text' | 'pdf'>('text');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [showPdfViewer, setShowPdfViewer] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(1440);
  const [viewportHeight, setViewportHeight] = useState(900);
  const isIPadLike = useIPadLikeDevice();

  // Landing page state (when no lectureId)
  const [allLectures, setAllLectures] = useState<Lecture[]>(optimizedStorage.getItem('lecture-studio-list', []));
  const [searchQuery, setSearchQuery] = useState('');

  // Persistence for selection
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const updateViewport = () => {
      setViewportWidth(window.innerWidth);
      setViewportHeight(window.innerHeight);
    };
    updateViewport();
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  useEffect(() => {
    if (lectureId) {
      const savedIndex = optimizedStorage.getItem(`lecture-studio-idx-${lectureId}`);
      if (savedIndex !== null) setSelectedSegmentIndex(savedIndex);

      const savedConcepts = optimizedStorage.getItem(`lecture-studio-concepts-${lectureId}`);
      if (savedConcepts) setHighlightedConcepts(new Set(savedConcepts));
    }
  }, [lectureId]);

  useEffect(() => {
    if (lectureId && selectedSegmentIndex !== null) {
      optimizedStorage.setItem(`lecture-studio-idx-${lectureId}`, selectedSegmentIndex);
    }
  }, [lectureId, selectedSegmentIndex]);

  useEffect(() => {
    if (lectureId && highlightedConcepts.size > 0) {
      optimizedStorage.setItem(`lecture-studio-concepts-${lectureId}`, Array.from(highlightedConcepts));
    }
  }, [lectureId, highlightedConcepts]);

  useEffect(() => {
    const id = lectureId;
    if (!id) {
      // Load all lectures for landing page
      const loadAllLectures = async () => {
        try {
          setLoading(true);
          const lectures = await listLectures();
          setAllLectures(lectures);
          optimizedStorage.setItem('lecture-studio-list', lectures);
        } catch (err) {
          console.error('Failed to load lectures:', err);
          setError(err instanceof Error ? err.message : 'Failed to load lectures');
        } finally {
          setLoading(false);
        }
      };
      loadAllLectures();
      return;
    }

    async function loadData(lectureId: string) {
      try {
        setLoading(true);
        // Load lecture and segments first (critical data)
        const [lectureData, segmentsData] = await Promise.all([
          getLecture(lectureId),
          getLectureSegments(lectureId),
        ]);
        setLecture(lectureData);
        setSegments(segmentsData);
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

  const handleIngestLecture = async () => {
    if (!ingestText.trim() || !lectureId) return;

    try {
      setIngesting(true);
      await ingestLecture({
        lecture_title: lecture?.title || 'Untitled Lecture',
        lecture_text: ingestText.trim(),
        domain: ingestDomain.trim() || undefined,
      });

      // Reload the lecture data to show new segments
      const [lectureData, segmentsData] = await Promise.all([
        getLecture(lectureId),
        getLectureSegments(lectureId),
      ]);
      setLecture(lectureData);
      setSegments(segmentsData);

      // Close modal and reset form
      setShowIngestModal(false);
      setIngestText('');
      setIngestDomain('');
    } catch (err) {
      console.error('Failed to ingest lecture:', err);
      alert('Failed to ingest lecture. Please try again.');
    } finally {
      setIngesting(false);
    }
  };

  const handlePdfFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'application/pdf') {
      setPdfFile(file);
      setShowPdfViewer(true);
      setShowIngestModal(false);
    } else {
      alert('Please select a PDF file');
    }
  };

  const handlePdfIngestionComplete = (result: PDFIngestResponse) => {
    setShowPdfViewer(false);
    setPdfFile(null);
    // Reload lectures if on landing page, or reload current lecture if viewing one
    if (lectureId) {
      const loadData = async () => {
        try {
          const [lectureData, segmentsData] = await Promise.all([
            getLecture(lectureId),
            getLectureSegments(lectureId),
          ]);
          setLecture(lectureData);
          setSegments(segmentsData);
        } catch (err) {
          console.error('Failed to reload lecture:', err);
        }
      };
      loadData();
    } else {
      const loadAllLectures = async () => {
        try {
          const lectures = await listLectures();
          setAllLectures(lectures);
        } catch (err) {
          console.error('Failed to reload lectures:', err);
        }
      };
      loadAllLectures();
    }
  };

  const handleSegmentClickToEditor = (segment: LectureSegment) => {
    router.push(`/lecture-editor?lectureId=${lectureId}`);
  };

  const isLandscapeViewport = viewportWidth >= viewportHeight;
  const isIPadPortrait = isIPadLike && viewportWidth <= 1100 && !isLandscapeViewport;
  const isIPadLandscape = isIPadLike && viewportWidth <= 1366 && isLandscapeViewport;
  const isTabletOrNarrow = viewportWidth < 1100;
  const lectureListGridColumns = isTabletOrNarrow
    ? 'minmax(220px, 1.15fr) minmax(220px, 1.35fr) 96px 84px'
    : '1fr 2fr 120px 100px';
  const studioDetailGridColumns = isIPadPortrait
    ? '1fr'
    : isIPadLandscape
      ? '1fr 1fr 0.95fr'
      : 'repeat(auto-fit, minmax(350px, 1fr))';
  const studioPanelMaxHeight = isIPadPortrait
    ? 'none'
    : isIPadLandscape
      ? 'calc(100dvh - 220px)'
      : 'calc(100vh - 250px)';

  // Show landing page when no lectureId
  if (!lectureId) {
    const filteredLectures = allLectures.filter(lecture =>
      lecture.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lecture.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
      <div style={{
        minHeight: '100dvh',
        background: 'var(--background)',
        padding: '0',
        display: 'flex',
        flexDirection: 'column',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}>
        {/* Main Content Area */}
        <div style={{
          flex: 1,
          padding: isIPadPortrait ? '24px 14px 20px' : '40px clamp(20px, 5vw, 80px)',
          maxWidth: '1600px',
          width: '100%',
          margin: '0 auto'
        }}>
          {/* Header Section */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            marginBottom: '40px',
            gap: '24px',
            flexWrap: 'wrap'
          }}>
            <div>
              <h1 style={{
                fontSize: 'clamp(28px, 4vw, 36px)',
                fontWeight: '800',
                letterSpacing: '-1.5px',
                color: 'var(--ink)',
                marginBottom: '8px',
              }}>
                Studio
              </h1>
              <p style={{ color: 'var(--muted)', fontSize: '16px', fontWeight: '500' }}>
                Your knowledge library and lecture drafts.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', width: isIPadPortrait ? '100%' : 'auto' }}>
              <button
                onClick={() => router.push('/freeform-canvas')}
                style={{
                  padding: '12px 24px',
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                  border: '1px solid var(--border)',
                  borderRadius: '14px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: 'var(--shadow)',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.background = 'var(--panel)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.background = 'var(--surface)';
                }}
              >
                <span aria-hidden>🎨</span>
                Freeform Canvas
              </button>

              <button
                onClick={() => router.push('/lecture-editor')}
                style={{
                  padding: '12px 24px',
                  background: 'var(--panel)',
                  color: 'var(--ink)',
                  border: '1px solid var(--border)',
                  borderRadius: '14px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: 'var(--shadow)',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.background = 'var(--surface)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.background = 'var(--panel)';
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                Write Notes
              </button>

              <button
                onClick={() => setShowIngestModal(true)}
                style={{
                  padding: '12px 24px',
                  background: 'var(--accent)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '14px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 12px rgba(37, 99, 235, 0.2)',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 6px 16px rgba(37, 99, 235, 0.3)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(37, 99, 235, 0.2)';
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"></path><path d="M12 5v14"></path></svg>
                Import Document
              </button>
            </div>
          </div>

          {/* Search & Filter Bar */}
          <div style={{
            display: 'flex',
            gap: '16px',
            marginBottom: '32px',
            background: 'var(--panel)',
            padding: '8px',
            borderRadius: '16px',
            border: '1px solid var(--border)',
            alignItems: 'center',
            flexWrap: 'wrap'
          }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <div style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              </div>
              <input
                type="text"
                placeholder="Search lectures, files, or concepts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onPointerDown={focusOnPenPointerDown}
                {...scribbleInputProps}
                style={{
                  width: '100%',
                  padding: '12px 16px 12px 48px',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--ink)',
                  fontSize: isIPadLike ? '16px' : '15px',
                  outline: 'none',
                  ...getScribbleInputStyle(isIPadLike, 'singleline'),
                }}
              />
            </div>
          </div>

          {/* List View (Google Drive Style) */}
          <div style={{
            background: 'var(--panel)',
            borderRadius: '20px',
            border: '1px solid var(--border)',
            overflow: 'hidden',
            boxShadow: '0 4px 24px rgba(0,0,0,0.04)',
            overflowX: isTabletOrNarrow ? 'auto' : 'hidden',
            WebkitOverflowScrolling: 'touch'
          }}>
            {/* List Header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: lectureListGridColumns,
              padding: '16px 24px',
              borderBottom: '1px solid var(--border)',
              background: 'rgba(0,0,0,0.02)',
              fontSize: '12px',
              fontWeight: '700',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--muted)',
              minWidth: isTabletOrNarrow ? '680px' : undefined,
            }}>
              <div>Name</div>
              <div>Description</div>
              <div>Segments</div>
              <div style={{ textAlign: 'right' }}>Action</div>
            </div>

            {loading ? (
              <div style={{ padding: '60px', textAlign: 'center' }}>
                <div style={{ fontSize: '16px', color: 'var(--muted)' }}>Loading your studio...</div>
              </div>
            ) : error ? (
              <div style={{ padding: '60px', textAlign: 'center' }}>
                <div style={{ fontSize: '16px', color: 'var(--accent-2)' }}>{error}</div>
              </div>
            ) : filteredLectures.length === 0 ? (
              <div style={{
                padding: '80px 40px',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '18px', color: 'var(--muted)', marginBottom: '12px', fontWeight: '600' }}>
                  {searchQuery ? 'No results match your search' : 'Your studio is empty'}
                </div>
                {!searchQuery && (
                  <div style={{ fontSize: '14px', color: 'var(--muted)' }}>
                    Start by writing a new note or uploading a document for AI ingestion.
                  </div>
                )}
              </div>
            ) : (
              <div>
                {filteredLectures.map((lecture) => (
                  <div
                    key={lecture.lecture_id}
                    onClick={() => router.push(`/lecture-editor?lectureId=${lecture.lecture_id}`)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: lectureListGridColumns,
                      padding: '16px 24px',
                      borderBottom: '1px solid var(--border)',
                      cursor: 'pointer',
                      alignItems: 'center',
                      transition: 'background 0.2s',
                      minWidth: isTabletOrNarrow ? '680px' : undefined,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(37, 99, 235, 0.03)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '10px',
                        background: 'rgba(37, 99, 235, 0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--accent)'
                      }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"></path><path d="M8 7h6"></path><path d="M8 11h8"></path></svg>
                      </div>
                      <div style={{ fontWeight: '600', color: 'var(--ink)', fontSize: '15px' }}>
                        {lecture.title}
                      </div>
                    </div>
                    <div style={{
                      fontSize: '14px',
                      color: 'var(--muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      paddingRight: '20px'
                    }}>
                      {lecture.description || 'No description provided.'}
                    </div>
                    <div style={{ fontSize: '14px', color: 'var(--muted)', fontWeight: '500' }}>
                      {lecture.segment_count ?? 0} segments
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{
                        fontSize: '13px',
                        color: 'var(--accent)',
                        fontWeight: '600',
                        padding: '6px 12px',
                        borderRadius: '8px',
                        background: 'rgba(37, 99, 235, 0.05)'
                      }}>
                        Edit
                      </span>
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
        <Link href="/lecture-studio" style={{ marginTop: '20px', display: 'inline-block', color: 'var(--accent)' }}>
          ← Back to Lectures
        </Link>
      </div>
    );
  }

  // Show PDF Viewer if PDF is selected
  if (showPdfViewer && pdfFile) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--page-bg)',
        padding: '20px',
      }}>
        <div style={{ marginBottom: '16px' }}>
          <button
            onClick={() => {
              setShowPdfViewer(false);
              setPdfFile(null);
            }}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              color: 'var(--accent)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            ← Back to Lecture Studio
          </button>
        </div>
        <PDFViewer
          file={pdfFile}
          domain={ingestDomain || undefined}
          useOcr={false}
          extractTables={true}
          extractConcepts={true}
          extractClaims={true}
          onComplete={handlePdfIngestionComplete}
          onError={(err) => {
            alert(`PDF ingestion error: ${err.message}`);
            setShowPdfViewer(false);
            setPdfFile(null);
          }}
        />
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--background)',
      padding: isIPadPortrait ? '20px 14px calc(env(safe-area-inset-bottom, 0px) + 20px)' : '40px clamp(20px, 5vw, 60px)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{ maxWidth: '1600px', width: '100%', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '32px' }}>
          <Link href="/lecture-studio" style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: '14px', fontWeight: '600', display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '12px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
            Back to Studio
          </Link>
          <h1
            onClick={() => {
              router.push(`/lecture-editor?lectureId=${lectureId}`);
            }}
            style={{
              fontSize: '32px',
              fontWeight: '700',
              marginTop: '12px',
              marginBottom: '8px',
              cursor: 'pointer',
              transition: 'opacity 0.2s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
            title="Click to open in editor"
          >
            {lecture.title}
          </h1>
          {lecture.description && (
            <p style={{ color: 'var(--muted)', fontSize: '16px' }}>{lecture.description}</p>
          )}
          {segments.length === 0 && (
            <div style={{
              marginTop: '16px',
              padding: '12px 16px',
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              fontSize: '14px',
            }}>
              <strong>Getting Started:</strong> This lecture has no content yet.
              <button
                onClick={() => router.push(`/lecture-editor?lectureId=${lectureId}`)}
                style={{
                  marginLeft: '8px',
                  padding: '6px 12px',
                  background: 'var(--panel)',
                  color: 'var(--ink)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Open Editor
              </button>
              <button
                onClick={() => setShowIngestModal(true)}
                style={{
                  marginLeft: '8px',
                  padding: '6px 12px',
                  background: 'var(--accent)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Import
              </button>
              {' '}to add content to this lecture.
            </div>
          )}
        </div>

        {/* Three Column Layout */}
        <div className="lecture-studio-grid" style={{
          display: 'grid',
          gridTemplateColumns: studioDetailGridColumns,
          gap: '32px',
          alignItems: 'start'
        }}>
          {/* Left Column - Timeline */}
          <div style={{
            background: 'var(--panel)',
            borderRadius: '24px',
            padding: '24px',
            border: '1px solid var(--border)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
            maxHeight: studioPanelMaxHeight,
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: '700', letterSpacing: '-0.5px' }}>Timeline</h2>
              {segments.length === 0 && (
                <button
                  onClick={() => router.push(`/lecture-editor?lectureId=${lectureId}`)}
                  style={{
                    padding: '6px 12px',
                    background: 'var(--panel)',
                    color: 'var(--ink)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: 'pointer',
                  }}
                >
                  Write Notes
                </button>
              )}
            </div>
            {segments.length === 0 ? (
              <div style={{
                color: 'var(--muted)',
                fontSize: '14px',
                padding: '20px',
                textAlign: 'center',
                background: 'var(--surface)',
                borderRadius: '8px',
                border: '1px dashed var(--border)',
              }}>
                <div style={{ marginBottom: '12px' }}>No segments available</div>
                <button
                  onClick={() => router.push(`/lecture-editor?lectureId=${lectureId}`)}
                  style={{
                    padding: '10px 20px',
                    background: 'var(--accent)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: 'pointer',
                  }}
                >
                  Start Writing
                </button>
                <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--muted)' }}>
                  Click &quot;Add Lecture Content&quot; above to get started
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {segments.map((segment, index) => (
                  <div
                    key={segment.segment_id}
                    style={{
                      padding: '12px',
                      borderRadius: '8px',
                      border: selectedSegmentIndex === index ? '2px solid var(--accent)' : '1px solid var(--border)',
                      background: selectedSegmentIndex === index ? 'var(--panel)' : 'transparent',
                      transition: 'all 0.2s',
                    }}
                  >
                    <div
                      onClick={() => handleSegmentClick(index, segment)}
                      style={{
                        cursor: 'pointer',
                        marginBottom: '8px',
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
                                background: 'var(--panel)',
                                border: '1px solid var(--border)',
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
                                  : 'var(--panel)',
                                border: highlightedConcepts.has(concept.node_id) ? 'none' : '1px solid var(--border)',
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
                    <button
                      onClick={() => handleSegmentClickToEditor(segment)}
                      style={{
                        marginTop: '8px',
                        padding: '6px 12px',
                        background: 'var(--surface)',
                        color: 'var(--accent)',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        fontSize: '12px',
                        cursor: 'pointer',
                        width: '100%',
                      }}
                    >
                      Open in Editor →
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Middle Column - Concept Cluster */}
          <div style={{
            background: 'var(--panel)',
            borderRadius: '24px',
            padding: '24px',
            border: '1px solid var(--border)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
            maxHeight: studioPanelMaxHeight,
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
          }}>
            <h2 style={{ fontSize: '20px', fontWeight: '700', letterSpacing: '-0.5px', marginBottom: '24px' }}>Concept Cluster</h2>
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
                          ? 'var(--panel)'
                          : 'transparent',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = 'var(--accent)';
                        e.currentTarget.style.background = 'var(--surface)';
                        // Prefetch concept data
                        getConcept(concept.node_id);
                        getNeighborsWithRelationships(concept.node_id);
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = highlightedConcepts.has(concept.node_id)
                          ? 'var(--accent)'
                          : '1px solid var(--border)';
                        e.currentTarget.style.background = highlightedConcepts.has(concept.node_id)
                          ? 'var(--panel)'
                          : 'transparent';
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
            borderRadius: '24px',
            padding: '24px',
            border: '1px solid var(--border)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.03)',
            maxHeight: studioPanelMaxHeight,
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
          }}>
            <h2 style={{ fontSize: '20px', fontWeight: '700', letterSpacing: '-0.5px', marginBottom: '24px' }}>Insights & Actions</h2>

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
                        background: 'var(--panel)',
                        borderRadius: '6px',
                        border: '1px solid var(--border)',
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

            {/* Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <Link
                href={`/lecture-editor?lectureId=${lectureId}`}
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
                  textAlign: 'center',
                }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
                onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
              >
                Open in Editor →
              </Link>
              <Link
                href={`/lecture-studio/draft?lectureId=${lectureId}`}
                style={{
                  display: 'inline-block',
                  padding: '12px 20px',
                  background: segments.length > 0 ? 'var(--surface)' : 'var(--accent)',
                  color: segments.length > 0 ? 'var(--ink)' : 'white',
                  border: segments.length > 0 ? '1px solid var(--border)' : 'none',
                  borderRadius: '8px',
                  textDecoration: 'none',
                  fontSize: '14px',
                  fontWeight: '600',
                  transition: 'opacity 0.2s',
                  textAlign: 'center',
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

      {/* Ingest Lecture Modal */}
      {
        showIngestModal && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: isIPadPortrait ? 'flex-end' : 'center',
              justifyContent: 'center',
              zIndex: 1000,
              padding: isIPadPortrait ? '8px' : undefined,
            }}
            onClick={() => !ingesting && setShowIngestModal(false)}
            onKeyDown={(e) => {
              // Don't interfere with keyboard events - let them bubble to inputs
              if (e.key === 'Escape' && !ingesting) {
                setShowIngestModal(false);
              }
            }}
          >
            <div
              style={{
                background: 'var(--panel)',
                borderRadius: isIPadPortrait ? '16px' : '12px',
                padding: isIPadPortrait ? '16px' : '24px',
                width: '90%',
                maxWidth: isIPadPortrait ? '100%' : '600px',
                border: '1px solid var(--border)',
                maxHeight: isIPadPortrait ? 'min(86dvh, 860px)' : '90vh',
                overflowY: 'auto',
                WebkitOverflowScrolling: 'touch',
                paddingBottom: 'max(16px, env(safe-area-inset-bottom, 0px))',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 style={{ fontSize: '20px', fontWeight: '600', margin: '0 0 20px 0' }}>
                Add Lecture Content
              </h2>

              {/* Mode Tabs */}
              <div style={{
                display: 'flex',
                gap: '8px',
                marginBottom: '20px',
                borderBottom: '1px solid var(--border)',
              }}>
                <button
                  onClick={() => setIngestMode('text')}
                  style={{
                    padding: '8px 16px',
                    background: ingestMode === 'text' ? 'var(--accent)' : 'transparent',
                    color: ingestMode === 'text' ? 'white' : 'var(--muted)',
                    border: 'none',
                    borderBottom: ingestMode === 'text' ? '2px solid var(--accent)' : '2px solid transparent',
                    borderRadius: '0',
                    fontSize: '14px',
                    fontWeight: ingestMode === 'text' ? '600' : '400',
                    cursor: 'pointer',
                  }}
                >
                  Text Input
                </button>
                <button
                  onClick={() => setIngestMode('pdf')}
                  style={{
                    padding: '8px 16px',
                    background: ingestMode === 'pdf' ? 'var(--accent)' : 'transparent',
                    color: ingestMode === 'pdf' ? 'white' : 'var(--muted)',
                    border: 'none',
                    borderBottom: ingestMode === 'pdf' ? '2px solid var(--accent)' : '2px solid transparent',
                    borderRadius: '0',
                    fontSize: '14px',
                    fontWeight: ingestMode === 'pdf' ? '600' : '400',
                    cursor: 'pointer',
                  }}
                >
                  PDF Upload
                </button>
              </div>

              {ingestMode === 'pdf' ? (
                <div>
                  <p style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '20px' }}>
                    Upload a PDF file to extract concepts, relationships, and create a knowledge graph. You&apos;ll be able to review extractions before confirming.
                  </p>
                  <div style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: 'var(--ink)' }}>
                      Domain/Topic (optional)
                    </label>
                    <input
                      type="text"
                      value={ingestDomain}
                      onChange={(e) => setIngestDomain(e.target.value)}
                      onPointerDown={focusOnPenPointerDown}
                      placeholder="e.g., Software Engineering, Biology, etc."
                      {...scribbleInputProps}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        background: 'var(--surface)',
                        color: 'var(--ink)',
                        fontSize: isIPadLike ? '16px' : '14px',
                        ...getScribbleInputStyle(isIPadLike, 'singleline'),
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: 'var(--ink)' }}>
                      PDF File *
                    </label>
                    <input
                      type="file"
                      accept=".pdf,application/pdf"
                      onChange={handlePdfFileSelect}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        background: 'var(--surface)',
                        color: 'var(--ink)',
                        fontSize: '14px',
                        cursor: 'pointer',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '24px' }}>
                    <button
                      onClick={() => {
                        setShowIngestModal(false);
                        setIngestText('');
                        setIngestDomain('');
                        setIngestMode('text');
                      }}
                      style={{
                        padding: '10px 20px',
                        background: 'transparent',
                        color: 'var(--muted)',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        fontSize: '14px',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '20px' }}>
                    Paste or type your lecture content below. The system will automatically extract concepts, create segments, and link them to your knowledge graph.
                  </p>
                  {isIPadLike && (
                    <div style={{
                      marginBottom: '12px',
                      fontSize: '12px',
                      color: 'var(--muted)',
                    }}>
                      Apple Pencil Scribble supported in the domain and content fields below.
                    </div>
                  )}
                  <div style={{
                    padding: '12px',
                    background: 'var(--surface)',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    marginBottom: '20px',
                    fontSize: '13px',
                    color: 'var(--ink)',
                  }}>
                    <strong>Note:</strong> This will create a new lecture with segments. After ingestion, you can edit the lecture in the editor.
                  </div>

                  <div style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: 'var(--ink)' }}>
                      Domain/Topic (optional)
                    </label>
                    <input
                      type="text"
                      value={ingestDomain}
                      onChange={(e) => setIngestDomain(e.target.value)}
                      onPointerDown={focusOnPenPointerDown}
                      placeholder="e.g., Software Engineering, Biology, etc."
                      disabled={ingesting}
                      {...scribbleInputProps}
                      onKeyDown={(e) => {
                        // Allow standard keyboard shortcuts (Ctrl/Cmd+A, Ctrl/Cmd+C, etc.)
                        if ((e.ctrlKey || e.metaKey) && ['a', 'c', 'v', 'x'].includes(e.key.toLowerCase())) {
                          // Allow default behavior for select all, copy, paste, cut
                          return;
                        }
                      }}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        background: 'var(--surface)',
                        color: 'var(--ink)',
                        fontSize: isIPadLike ? '16px' : '14px',
                        ...getScribbleInputStyle(isIPadLike, 'singleline'),
                      }}
                    />
                  </div>

                  <div style={{ marginBottom: '24px' }}>
                    <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: 'var(--ink)' }}>
                      Lecture Content *
                    </label>
                    <textarea
                      value={ingestText}
                      onChange={(e) => setIngestText(e.target.value)}
                      onPointerDown={focusOnPenPointerDown}
                      placeholder="Paste or type your lecture content here..."
                      disabled={ingesting}
                      rows={12}
                      enterKeyHint="done"
                      {...scribbleInputProps}
                      onKeyDown={(e) => {
                        // Allow standard keyboard shortcuts (Ctrl/Cmd+A, Ctrl/Cmd+C, etc.)
                        if ((e.ctrlKey || e.metaKey) && ['a', 'c', 'v', 'x'].includes(e.key.toLowerCase())) {
                          // Allow default behavior for select all, copy, paste, cut
                          return;
                        }
                      }}
                      style={{
                        width: '100%',
                        padding: isIPadLike ? '14px' : '12px',
                        border: '1px solid var(--border)',
                        borderRadius: isIPadLike ? '12px' : '8px',
                        background: 'var(--surface)',
                        color: 'var(--ink)',
                        fontSize: isIPadLike ? '16px' : '14px',
                        fontFamily: 'inherit',
                        resize: 'vertical',
                        ...getScribbleInputStyle(isIPadLike, 'multiline'),
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => {
                        if (!ingesting) {
                          setShowIngestModal(false);
                          setIngestText('');
                          setIngestDomain('');
                        }
                      }}
                      disabled={ingesting}
                      style={{
                        padding: '10px 20px',
                        background: 'transparent',
                        color: 'var(--muted)',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        fontSize: '14px',
                        cursor: ingesting ? 'not-allowed' : 'pointer',
                        opacity: ingesting ? 0.5 : 1,
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleIngestLecture}
                      disabled={!ingestText.trim() || ingesting}
                      style={{
                        padding: '10px 20px',
                        background: ingestText.trim() && !ingesting ? 'var(--accent)' : 'var(--muted)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: ingestText.trim() && !ingesting ? 'pointer' : 'not-allowed',
                        opacity: ingestText.trim() && !ingesting ? 1 : 0.5,
                      }}
                    >
                      {ingesting ? 'Processing...' : 'Add Content'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )
      }
    </div>
  );
}
