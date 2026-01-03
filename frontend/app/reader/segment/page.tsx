'use client';

import { Suspense, useEffect, useState, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import MarkdownIt from 'markdown-it';
import { useTheme } from '../../components/context-providers/ThemeProvider';
import { 
  getLecture, 
  getLectureSegments, 
  getSegmentsByConcept,
  searchResources,
  createLecture,
  listLectures,
  updateLecture,
  updateSegment,
  getUserProfile,
  ingestAllNotionPages,
  ingestAllNotionPagesParallel,
  type Lecture, 
  type LectureSegment,
  type Concept,
  type Resource,
  type NotionIngestProgressEvent,
} from '../../api-client';
import { LectureEditor } from '../../components/lecture-editor/LectureEditor';
import TurndownService from 'turndown';

// Initialize markdown renderer
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
});

interface Annotation {
  id: string;
  startOffset: number;
  endOffset: number;
  text: string;
  note?: string;
  color: string;
}

interface Comment {
  id: string;
  annotationId: string;
  text: string;
  author: string;
  timestamp: Date;
  replies?: Comment[];
}

export default function SegmentReaderPage() {
  return (
    <Suspense fallback={<div style={{ padding: '40px', textAlign: 'center' }}>Loading…</div>}>
      <SegmentReaderPageInner />
    </Suspense>
  );
}

function SegmentReaderPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const lectureId = searchParams?.get('lectureId') ?? null;
  const segmentIndexParam = searchParams?.get('segmentIndex') ?? null;
  const segmentIndex = segmentIndexParam ? parseInt(segmentIndexParam, 10) : null;
  const resourceId = searchParams?.get('resourceId') ?? null;
  const resourceUrl = searchParams?.get('url') ?? null;

  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [segments, setSegments] = useState<LectureSegment[]>([]);
  const [currentSegment, setCurrentSegment] = useState<LectureSegment | null>(null);
  const [currentResource, setCurrentResource] = useState<Resource | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFullPage, setShowFullPage] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState('');
  const [editedHtml, setEditedHtml] = useState('');
  const [activeGraphId, setActiveGraphId] = useState<string | undefined>(undefined);
  
  // Initialize TurndownService for HTML to Markdown conversion
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [selectedText, setSelectedText] = useState<{ start: number; end: number; text: string } | null>(null);
  const [showCommentBox, setShowCommentBox] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [highlightColor, setHighlightColor] = useState('#ffeb3b');
  const [userName, setUserName] = useState<string>('You');
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  
  const contentRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // If no params, show landing page (handled in render)
    if (!lectureId && !resourceId && !resourceUrl) {
      setLoading(false);
      return;
    }

    async function loadData() {
      try {
        setLoading(true);
        
        // Handle web resource
        if (resourceId || resourceUrl) {
          // Try to get resource from API or use URL directly
          if (resourceUrl) {
            const resource: Resource = {
              resource_id: resourceId || `web-${Date.now()}`,
              kind: 'web_link',
              url: decodeURIComponent(resourceUrl),
              title: null,
              metadata: {
                highlighted_text: null, // This would come from the resource metadata
                full_page_html: null,
              },
            };
            setCurrentResource(resource);
            setEditedText(resource.metadata?.highlighted_text || '');
          }
          setLoading(false);
          return;
        }
        
        // Handle lecture - can work with or without segments
        if (lectureId) {
          const [lectureData, segmentsData] = await Promise.all([
            getLecture(lectureId),
            getLectureSegments(lectureId).catch(() => []), // If segments fail, use empty array
          ]);
          setLecture(lectureData);
          setSegments(segmentsData);
          
          // If segmentIndex is provided, try to find that segment
          if (segmentIndex !== null) {
            const segment = segmentsData.find(s => s.segment_index === segmentIndex);
            if (segment) {
              setCurrentSegment(segment);
              setEditedText(segment.text);
            } else if (segmentsData.length > 0) {
              // If segment not found but segments exist, use first segment
              setCurrentSegment(segmentsData[0]);
              setEditedText(segmentsData[0].text);
            } else {
              // No segments - will display full markdown/raw_text instead
              setCurrentSegment(null);
              setEditedText('');
            }
          } else {
            // No segmentIndex - display full content from metadata_json or raw_text
            setCurrentSegment(null);
            setEditedText('');
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load content');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [lectureId, segmentIndex, resourceId, resourceUrl]);

  // Load active graph ID for editor
  useEffect(() => {
    async function loadGraphId() {
      try {
        const { listGraphs } = await import('../../api-client');
        const data = await listGraphs();
        setActiveGraphId(data.active_graph_id);
      } catch (err) {
        console.error('Failed to load active graph:', err);
      }
    }
    loadGraphId();
  }, []);

  // Load saved annotations and comments from localStorage
  useEffect(() => {
    const storageKey = currentSegment ? `annotations-${currentSegment.segment_id}` : (currentResource ? `annotations-${currentResource.resource_id}` : null);
    if (storageKey) {
      const savedAnnotations = localStorage.getItem(storageKey);
      const savedComments = localStorage.getItem(storageKey.replace('annotations', 'comments'));
      
      if (savedAnnotations) {
        try {
          setAnnotations(JSON.parse(savedAnnotations));
        } catch (e) {
          console.error('Failed to load annotations', e);
        }
      }
      
      if (savedComments) {
        try {
          const parsed = JSON.parse(savedComments);
          setComments(parsed.map((c: any) => ({
            ...c,
            timestamp: new Date(c.timestamp),
          })));
        } catch (e) {
          console.error('Failed to load comments', e);
        }
      }
    }
  }, [currentSegment, currentResource]);

  // Save annotations and comments to localStorage
  useEffect(() => {
    const storageKey = currentSegment ? `annotations-${currentSegment.segment_id}` : (currentResource ? `annotations-${currentResource.resource_id}` : null);
    if (storageKey && annotations.length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(annotations));
    }
  }, [annotations, currentSegment, currentResource]);

  useEffect(() => {
    const storageKey = currentSegment ? `comments-${currentSegment.segment_id}` : (currentResource ? `comments-${currentResource.resource_id}` : null);
    if (storageKey && comments.length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(comments));
    }
  }, [comments, currentSegment, currentResource]);

  const handleTextSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    if (!contentRef.current || !contentRef.current.contains(range.commonAncestorContainer)) {
      return;
    }

    const text = selection.toString().trim();
    if (text.length === 0) {
      setSelectedText(null);
      return;
    }

    // Calculate offsets relative to the text content
    const textContent = contentRef.current.textContent || '';
    const startOffset = textContent.indexOf(text, 0);
    const endOffset = startOffset + text.length;

    if (startOffset >= 0) {
      setSelectedText({ start: startOffset, end: endOffset, text });
    }
  };

  const handleHighlight = () => {
    if (!selectedText || (!currentSegment && !currentResource)) return;

    const newAnnotation: Annotation = {
      id: `ann-${Date.now()}`,
      startOffset: selectedText.start,
      endOffset: selectedText.end,
      text: selectedText.text,
      color: highlightColor,
    };

    setAnnotations([...annotations, newAnnotation]);
    setSelectedText(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleAddComment = () => {
    if (!selectedText || !newComment.trim() || (!currentSegment && !currentResource)) return;

    const annotationId = `ann-${Date.now()}`;
    const newAnnotation: Annotation = {
      id: annotationId,
      startOffset: selectedText.start,
      endOffset: selectedText.end,
      text: selectedText.text,
      color: highlightColor,
    };

    const commentText = newComment;
    const newCommentObj: Comment = {
      id: `comment-${Date.now()}`,
      annotationId,
      text: commentText,
      author: userName,
      timestamp: new Date(),
      replies: [],
    };

    setAnnotations([...annotations, newAnnotation]);
    setComments([...comments, newCommentObj]);
    setSelectedText(null);
    setNewComment('');
    setShowCommentBox(false);
    window.getSelection()?.removeAllRanges();
  };

  const handleSaveEdit = async () => {
    // If we're editing markdown (full document), save to lecture metadata_json
    // This applies when we have markdown content, regardless of whether segments exist
    if (isMarkdown && lecture) {
      try {
        const metadata = { markdown: editedText };
        const updatedLecture = await updateLecture(lecture.lecture_id, {
          metadata_json: JSON.stringify(metadata),
        });
        setLecture(updatedLecture);
        setIsEditing(false);
      } catch (error) {
        console.error('Failed to save lecture markdown:', error);
        setIsEditing(false);
      }
      return;
    }
    
    // Otherwise, save segment text (only if we have a segment)
    if (!currentSegment) return;
    
    try {
      const updatedSegment = await updateSegment(currentSegment.segment_id, {
        text: editedText,
      });
      setCurrentSegment(updatedSegment);
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to save segment:', error);
      // Still update local state on error for better UX
      setCurrentSegment({ ...currentSegment, text: editedText });
      setIsEditing(false);
    }
  };

  const renderTextWithAnnotations = (text: string) => {
    if (annotations.length === 0) {
      return <span>{text}</span>;
    }

    // Sort annotations by start offset
    const sortedAnnotations = [...annotations].sort((a, b) => a.startOffset - b.startOffset);
    
    const elements: JSX.Element[] = [];
    let lastIndex = 0;

    sortedAnnotations.forEach((annotation, idx) => {
      // Add text before annotation
      if (annotation.startOffset > lastIndex) {
        elements.push(
          <span key={`text-${lastIndex}`}>
            {text.substring(lastIndex, annotation.startOffset)}
          </span>
        );
      }

      // Add annotated text
      const annotationComments = comments.filter(c => c.annotationId === annotation.id);
      elements.push(
        <span
          key={annotation.id}
          style={{
            backgroundColor: annotation.color,
            padding: '2px 0',
            position: 'relative',
            cursor: 'pointer',
          }}
          title={annotation.note || (annotationComments.length > 0 ? `${annotationComments.length} comment(s)` : '')}
          onClick={() => {
            // Toggle comment panel for this annotation
            if (selectedAnnotationId === annotation.id) {
              setSelectedAnnotationId(null);
            } else {
              setSelectedAnnotationId(annotation.id);
            }
          }}
        >
          {text.substring(annotation.startOffset, annotation.endOffset)}
        </span>
      );

      lastIndex = annotation.endOffset;
    });

    // Add remaining text
    if (lastIndex < text.length) {
      elements.push(
        <span key={`text-${lastIndex}`}>
          {text.substring(lastIndex)}
        </span>
      );
    }

    return <>{elements}</>;
  };

  const navigateToSegment = (newIndex: number) => {
    if (lectureId !== null) {
      router.push(`/reader/segment?lectureId=${lectureId}&segmentIndex=${newIndex}`);
    }
  };

  // Show landing page only if there are NO params at all
  if (!lectureId && !resourceId && !resourceUrl) {
    return <FileReaderStudioLanding router={router} />;
  }

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', minHeight: '100vh', background: 'var(--page-bg)' }}>
        <div style={{ fontSize: '18px', color: 'var(--muted)' }}>Loading segment...</div>
      </div>
    );
  }

  // Determine content to display
  // Check if lecture has markdown in metadata (for Notion pages)
  let displayText = currentResource?.metadata?.highlighted_text || currentSegment?.text || '';
  let isMarkdown = false;
  
  if (lecture?.metadata_json && !currentResource) {
    try {
      const metadata = JSON.parse(lecture.metadata_json);
      if (metadata.markdown) {
        displayText = metadata.markdown;
        isMarkdown = true;
      }
    } catch (e) {
      // If metadata_json is not valid JSON, fall back to plain text
      console.warn('Failed to parse lecture metadata_json:', e);
    }
  }
  
  // If no display text yet, try raw_text from lecture
  if (!displayText && lecture?.raw_text && !currentResource) {
    displayText = lecture.raw_text;
  }
  
  // Show error only if we truly have no content
  if (error || ((!displayText || !lecture) && !currentResource)) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', minHeight: '100vh', background: 'var(--page-bg)' }}>
        <div style={{ fontSize: '18px', color: 'var(--accent-2)' }}>{error || 'Content not found'}</div>
        <Link href="/reader/segment" style={{ marginTop: '20px', display: 'inline-block', color: 'var(--accent)' }}>
          ← Back to File Reader Studio
        </Link>
      </div>
    );
  }
  
  const displayTitle = currentResource?.title || lecture?.title || 'File Reader Studio';
  const isWebResource = !!currentResource;

  const currentIndex = currentSegment ? segments.findIndex(s => s.segment_id === currentSegment.segment_id) : -1;
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex < segments.length - 1;

  return (
    <>
      <style jsx global>{`
        .markdown-content h1,
        .markdown-content h2,
        .markdown-content h3 {
          margin-top: 1.5em;
          margin-bottom: 0.5em;
          font-weight: 600;
        }
        .markdown-content h1 {
          font-size: 2em;
        }
        .markdown-content h2 {
          font-size: 1.5em;
        }
        .markdown-content h3 {
          font-size: 1.25em;
        }
        .markdown-content code {
          background: var(--panel);
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 0.9em;
          font-family: 'Monaco', 'Courier New', monospace;
        }
        .markdown-content pre {
          background: var(--panel);
          padding: 12px;
          border-radius: 8px;
          overflow: auto;
          border: 1px solid var(--border);
        }
        .markdown-content pre code {
          background: transparent;
          padding: 0;
        }
        .markdown-content blockquote {
          border-left: 4px solid var(--accent);
          padding-left: 16px;
          margin-left: 0;
          color: var(--muted);
          font-style: italic;
        }
        .markdown-content a {
          color: var(--accent);
          text-decoration: underline;
        }
        .markdown-content ul,
        .markdown-content ol {
          margin-left: 1.5em;
          margin-bottom: 1em;
        }
        .markdown-content li {
          margin-bottom: 0.5em;
        }
        .markdown-content p {
          margin-bottom: 1em;
        }
        .markdown-content table {
          width: 100%;
          border-collapse: collapse;
          margin: 1em 0;
        }
        .markdown-content table th,
        .markdown-content table td {
          border: 1px solid var(--border);
          padding: 8px;
        }
        .markdown-content table th {
          background: var(--panel);
          font-weight: 600;
        }
      `}</style>
      <div style={{ 
        minHeight: '100vh', 
        background: 'var(--page-bg)',
        display: 'flex',
        flexDirection: 'column',
      }}>
      {/* Header */}
      <div style={{
        background: 'var(--panel)',
        borderBottom: '1px solid var(--border)',
        padding: '16px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <Link href="/" style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: '14px' }}>
            ← Back to Graph
          </Link>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: '700', margin: 0 }}>
              File Reader Studio
            </h1>
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>
              {isWebResource ? (
                <>
                  {displayTitle}
                  {currentResource?.url && (
                    <> · <a href={currentResource.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{currentResource.url}</a></>
                  )}
                </>
              ) : (
                <>
                  {lecture?.title} · Segment #{currentSegment?.segment_index !== undefined ? currentSegment.segment_index + 1 : 'N/A'} of {segments.length}
                </>
              )}
            </div>
          </div>
        </div>
        
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            style={{
              padding: '10px',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              background: 'var(--panel)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--ink)',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--accent)';
              e.currentTarget.style.color = 'white';
              e.currentTarget.style.borderColor = 'var(--accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--panel)';
              e.currentTarget.style.color = 'var(--ink)';
              e.currentTarget.style.borderColor = 'var(--border)';
            }}
            title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          >
            {theme === 'light' ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
              </svg>
            )}
          </button>
          
          {/* Navigation */}
          <button
            onClick={() => hasPrevious && navigateToSegment(segments[currentIndex - 1].segment_index)}
            disabled={!hasPrevious}
            style={{
              padding: '8px 16px',
              background: hasPrevious ? 'var(--surface)' : 'transparent',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              color: hasPrevious ? 'var(--ink)' : 'var(--muted)',
              cursor: hasPrevious ? 'pointer' : 'not-allowed',
              fontSize: '14px',
            }}
          >
            ← Previous
          </button>
          <button
            onClick={() => hasNext && navigateToSegment(segments[currentIndex + 1].segment_index)}
            disabled={!hasNext}
            style={{
              padding: '8px 16px',
              background: hasNext ? 'var(--surface)' : 'transparent',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              color: hasNext ? 'var(--ink)' : 'var(--muted)',
              cursor: hasNext ? 'pointer' : 'not-allowed',
              fontSize: '14px',
            }}
          >
            Next →
          </button>
          
          {/* Web Resource: Toggle Full Page View */}
          {isWebResource && currentResource?.url && (
            <button
              onClick={() => setShowFullPage(!showFullPage)}
              style={{
                padding: '8px 16px',
                background: showFullPage ? 'var(--accent)' : 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: showFullPage ? 'white' : 'var(--ink)',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              {showFullPage ? 'Show Highlight' : 'Show Full Page'}
            </button>
          )}
          
          {/* Edit Toggle (for segments or full markdown document) */}
          {!isWebResource && (currentSegment || (lecture && isMarkdown)) && (
            <button
              onClick={() => {
                setIsEditing(!isEditing);
                if (!isEditing) {
                  // When entering edit mode, initialize editedText and editedHtml
                  let contentToEdit = '';
                  if (isMarkdown && lecture) {
                    try {
                      const metadata = JSON.parse(lecture.metadata_json || '{}');
                      contentToEdit = metadata.markdown || displayText;
                    } catch (e) {
                      contentToEdit = displayText;
                    }
                  } else if (currentSegment) {
                    contentToEdit = currentSegment.text;
                  } else {
                    contentToEdit = displayText;
                  }
                  
                  // Convert markdown to HTML for the rich editor
                  if (isMarkdown) {
                    // Convert markdown to HTML for editing
                    const htmlContent = md.render(contentToEdit);
                    setEditedHtml(htmlContent);
                    setEditedText(contentToEdit); // Keep markdown for saving
                  } else {
                    // For plain text, just set as HTML (TipTap will handle it)
                    setEditedHtml(contentToEdit);
                    setEditedText(contentToEdit);
                  }
                } else {
                  // When canceling, reset
                  setEditedHtml('');
                  setEditedText('');
                }
              }}
              style={{
                padding: '8px 16px',
                background: isEditing ? 'var(--accent)' : 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: isEditing ? 'white' : 'var(--ink)',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              {isEditing ? 'Cancel' : 'Edit'}
            </button>
          )}
        </div>
      </div>

      {/* Toolbar */}
      {selectedText && (
        <div style={{
          background: 'var(--panel)',
          borderBottom: '1px solid var(--border)',
          padding: '12px 24px',
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
            Selected: "{selectedText.text.substring(0, 50)}{selectedText.text.length > 50 ? '...' : ''}"
          </span>
          <div style={{ display: 'flex', gap: '4px' }}>
            {['#ffeb3b', '#ff9800', '#4caf50', '#2196f3', '#9c27b0'].map(color => (
              <button
                key={color}
                onClick={() => setHighlightColor(color)}
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '4px',
                  background: color,
                  border: highlightColor === color ? '2px solid var(--ink)' : '1px solid var(--border)',
                  cursor: 'pointer',
                }}
                title={`Highlight color: ${color}`}
              />
            ))}
          </div>
          <button
            onClick={handleHighlight}
            style={{
              padding: '6px 12px',
              background: 'var(--accent)',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            Highlight
          </button>
          <button
            onClick={() => setShowCommentBox(true)}
            style={{
              padding: '6px 12px',
              background: 'var(--surface)',
              color: 'var(--ink)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            Add Comment
          </button>
        </div>
      )}

      {/* Comment Box */}
      {showCommentBox && (
        <div style={{
          background: 'var(--panel)',
          borderBottom: '1px solid var(--border)',
          padding: '16px 24px',
        }}>
          <textarea
            ref={textareaRef}
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Add a comment..."
            style={{
              width: '100%',
              minHeight: '80px',
              padding: '12px',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              background: 'var(--surface)',
              color: 'var(--ink)',
              fontSize: '14px',
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px', justifyContent: 'flex-end' }}>
            <button
              onClick={() => {
                setShowCommentBox(false);
                setNewComment('');
              }}
              style={{
                padding: '8px 16px',
                background: 'transparent',
                color: 'var(--muted)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleAddComment}
              disabled={!newComment.trim()}
              style={{
                padding: '8px 16px',
                background: newComment.trim() ? 'var(--accent)' : 'var(--muted)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: newComment.trim() ? 'pointer' : 'not-allowed',
                fontSize: '14px',
              }}
            >
              Post Comment
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div style={{
        flex: 1,
        display: 'flex',
        overflow: 'hidden',
      }}>
        {/* Editor/Viewer */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          padding: '40px',
          maxWidth: isWebResource && showFullPage ? '100%' : '900px',
          margin: '0 auto',
        }}>
          {/* Web Resource: Full Page View */}
          {isWebResource && showFullPage && currentResource?.url && (
            <div style={{ width: '100%', height: '100%' }}>
              <iframe
                src={currentResource.url}
                style={{
                  width: '100%',
                  height: 'calc(100vh - 200px)',
                  border: 'none',
                  borderRadius: '8px',
                }}
                title={currentResource.title || 'Web Resource'}
              />
            </div>
          )}
          
          {/* Web Resource: Highlighted Text View */}
          {isWebResource && !showFullPage && (
            <div>
              <div style={{ marginBottom: '16px', padding: '12px', background: 'var(--panel)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>Highlighted Section</div>
                <div
                  ref={contentRef}
                  onMouseUp={handleTextSelection}
                  style={{
                    fontSize: '16px',
                    lineHeight: '1.8',
                    color: 'var(--ink)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    userSelect: 'text',
                    padding: '16px',
                    background: 'var(--surface)',
                    borderRadius: '8px',
                  }}
                >
                  {displayText || 'No highlighted text available'}
                </div>
              </div>
              {currentResource?.url && (
                <div style={{ marginTop: '16px', textAlign: 'center' }}>
                  <a
                    href={currentResource.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-block',
                      padding: '12px 24px',
                      background: 'var(--accent)',
                      color: 'white',
                      textDecoration: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: '600',
                    }}
                  >
                    Open Full Page in New Tab →
                  </a>
                </div>
              )}
            </div>
          )}
          
          {/* Edit Mode (for segments or full markdown document) */}
          {!isWebResource && isEditing ? (
            <div>
              <div style={{
                border: '1px solid var(--border)',
                borderRadius: '8px',
                background: 'var(--surface)',
                minHeight: '500px',
                padding: '20px',
              }}>
                <LectureEditor
                  content={editedHtml}
                  onUpdate={(html) => {
                    setEditedHtml(html);
                    // Convert HTML to markdown for saving (if it was markdown originally)
                    if (isMarkdown) {
                      try {
                        const markdown = turndownService.turndown(html);
                        setEditedText(markdown);
                      } catch (e) {
                        console.error('Failed to convert HTML to markdown:', e);
                        // Fallback: extract text content
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = html;
                        setEditedText(tempDiv.textContent || '');
                      }
                    } else {
                      // For plain text segments, convert HTML to plain text
                      // TipTap stores as HTML, but segments should be plain text
                      try {
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = html;
                        // Get text content, preserving line breaks
                        const textContent = tempDiv.textContent || tempDiv.innerText || '';
                        setEditedText(textContent);
                      } catch (e) {
                        // Fallback: use HTML as-is
                        setEditedText(html);
                      }
                    }
                  }}
                  placeholder={isMarkdown ? "Edit markdown content..." : "Edit text..."}
                  graphId={activeGraphId}
                />
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => {
                    setIsEditing(false);
                    setEditedHtml('');
                    setEditedText('');
                    if (currentSegment) {
                      setEditedText(currentSegment.text);
                    }
                  }}
                  style={{
                    padding: '10px 20px',
                    background: 'transparent',
                    color: 'var(--muted)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  style={{
                    padding: '10px 20px',
                    background: 'var(--accent)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                  }}
                >
                  Save Changes
                </button>
              </div>
            </div>
          ) : (
            <div
              ref={contentRef}
              onMouseUp={handleTextSelection}
              style={{
                fontSize: '18px',
                lineHeight: '1.8',
                color: 'var(--ink)',
                whiteSpace: isMarkdown ? 'normal' : 'pre-wrap',
                wordBreak: 'break-word',
                userSelect: 'text',
              }}
            >
              {isMarkdown ? (
                <div
                  dangerouslySetInnerHTML={{ __html: md.render(displayText) }}
                  style={{
                    // Markdown content styles
                  }}
                  className="markdown-content"
                />
              ) : (
                renderTextWithAnnotations(displayText)
              )}
            </div>
          )}

          {/* Concepts (segments only) */}
          {!isWebResource && currentSegment && currentSegment.covered_concepts.length > 0 && (
            <div style={{ marginTop: '40px', paddingTop: '24px', borderTop: '1px solid var(--border)' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>Concepts in this segment</h3>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {currentSegment.covered_concepts.map(concept => (
                  <Link
                    key={concept.node_id}
                    href={`/concepts/${concept.node_id}`}
                    style={{
                      padding: '6px 12px',
                      background: 'var(--panel)',
                      border: '1px solid var(--border)',
                      borderRadius: '12px',
                      color: 'var(--accent)',
                      textDecoration: 'none',
                      fontSize: '12px',
                    }}
                  >
                    {concept.name}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Comments Section */}
          {comments.length > 0 && (
            <div style={{ marginTop: '40px', paddingTop: '24px', borderTop: '1px solid var(--border)' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px' }}>Comments</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {comments.map(comment => (
                  <div
                    key={comment.id}
                    style={{
                      padding: '12px',
                      background: 'var(--panel)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ fontSize: '12px', fontWeight: '600' }}>{comment.author}</span>
                      <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                        {comment.timestamp.toLocaleString()}
                      </span>
                    </div>
                    <div style={{ fontSize: '14px', color: 'var(--ink)' }}>{comment.text}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar - Annotations & Comments */}
        <div style={{
          width: '300px',
          background: 'var(--panel)',
          borderLeft: '1px solid var(--border)',
          padding: '24px',
          overflowY: 'auto',
        }}>
          <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px' }}>Annotations</h3>
          {annotations.length === 0 ? (
            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>No annotations yet</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {annotations.map(annotation => {
                const annotationComments = comments.filter(c => c.annotationId === annotation.id);
                return (
                  <div
                    key={annotation.id}
                    style={{
                      padding: '8px',
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                    }}
                  >
                    <div style={{
                      display: 'inline-block',
                      width: '16px',
                      height: '16px',
                      background: annotation.color,
                      borderRadius: '4px',
                      marginRight: '8px',
                      verticalAlign: 'middle',
                    }} />
                    <span style={{ fontSize: '12px', color: 'var(--ink)' }}>
                      "{annotation.text.substring(0, 30)}{annotation.text.length > 30 ? '...' : ''}"
                    </span>
                    {annotationComments.length > 0 && (
                      <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>
                        {annotationComments.length} comment(s)
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Comment Panel - Shows when annotation is clicked */}
        {selectedAnnotationId && (() => {
          const selectedAnnotation = annotations.find(a => a.id === selectedAnnotationId);
          const annotationComments = comments.filter(c => c.annotationId === selectedAnnotationId);
          if (!selectedAnnotation) return null;
          
          return (
            <div style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '500px',
              maxWidth: '90vw',
              maxHeight: '80vh',
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
              zIndex: 1000,
              overflowY: 'auto',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '600' }}>Comments</h3>
                <button
                  onClick={() => setSelectedAnnotationId(null)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    fontSize: '20px',
                    cursor: 'pointer',
                    color: 'var(--muted)',
                    padding: '0',
                    width: '24px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  ×
                </button>
              </div>
              
              <div style={{
                padding: '12px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                marginBottom: '16px',
              }}>
                <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>Highlighted text:</div>
                <div style={{
                  display: 'inline-block',
                  padding: '4px 8px',
                  background: selectedAnnotation.color,
                  borderRadius: '4px',
                  fontSize: '14px',
                }}>
                  "{selectedAnnotation.text}"
                </div>
              </div>

              {annotationComments.length === 0 ? (
                <div style={{ fontSize: '14px', color: 'var(--muted)', textAlign: 'center', padding: '20px' }}>
                  No comments yet
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
                  {annotationComments.map(comment => (
                    <div
                      key={comment.id}
                      style={{
                        padding: '12px',
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ fontSize: '12px', fontWeight: '600' }}>{comment.author}</span>
                        <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                          {comment.timestamp.toLocaleString()}
                        </span>
                      </div>
                      <div style={{ fontSize: '14px', color: 'var(--ink)' }}>{comment.text}</div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{
                padding: '12px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
              }}>
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Add a comment..."
                  style={{
                    width: '100%',
                    minHeight: '80px',
                    padding: '8px',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    background: 'var(--panel)',
                    color: 'var(--ink)',
                    fontSize: '14px',
                    fontFamily: 'inherit',
                    resize: 'vertical',
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                  <button
                    onClick={() => {
                      setSelectedAnnotationId(null);
                      setNewComment('');
                    }}
                    style={{
                      padding: '6px 12px',
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      color: 'var(--ink)',
                      cursor: 'pointer',
                      fontSize: '14px',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (newComment.trim()) {
                        const annotationId = selectedAnnotationId;
                        const newCommentObj: Comment = {
                          id: `comment-${Date.now()}`,
                          annotationId,
                          text: newComment.trim(),
                          author: userName,
                          timestamp: new Date(),
                          replies: [],
                        };
                        setComments([...comments, newCommentObj]);
                        setNewComment('');
                      }
                    }}
                    disabled={!newComment.trim()}
                    style={{
                      padding: '6px 12px',
                      background: newComment.trim() ? 'var(--accent)' : 'var(--muted)',
                      border: 'none',
                      borderRadius: '6px',
                      color: 'white',
                      cursor: newComment.trim() ? 'pointer' : 'not-allowed',
                      fontSize: '14px',
                    }}
                  >
                    Add Comment
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
    </>
  );
}

// Landing page component for File Reader Studio
interface LectureCardData {
  lecture_id: string;
  title: string;
  segment_count: number;
  preview_text?: string;
  last_edited?: number;
  priority?: 'low' | 'medium' | 'high';
  tags?: string[];
  workspace?: string;
  folder_path?: string; // e.g., "default/cloud" or "default/knowledge"
  pinned?: boolean;
}

interface Folder {
  id: string;
  name: string;
  path: string; // Full path like "default/cloud"
  parent_path?: string; // Parent folder path, undefined for root folders
  workspace: string; // Which workspace this folder belongs to
  pinned?: boolean;
  created_at: number;
}

// Folder Tree View Component
function FolderTreeView({
  lectures,
  allLectures,
  folders,
  selectedFolder,
  onSelectFolder,
  expandedFolders,
  onToggleFolder,
  onTogglePin,
  onTogglePinFolder,
  onMoveToFolder,
  onLectureClick,
  onOptionsClick,
  optionsMenuOpen,
  editingLectureId,
  setEditingLectureId,
  onRename,
  onDelete,
  onUpdateMetadata,
  onShowWorkspaceModal,
  onShowTagsModal,
  setLectures,
}: {
  lectures: LectureCardData[];
  allLectures: LectureCardData[];
  folders: Folder[];
  selectedFolder: string | null;
  onSelectFolder: (path: string | null) => void;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onTogglePin: (lectureId: string) => void;
  onTogglePinFolder: (path: string) => void;
  onMoveToFolder: (lectureId: string) => void;
  onLectureClick: (lectureId: string) => void;
  onOptionsClick: (lectureId: string) => void;
  optionsMenuOpen: string | null;
  editingLectureId: string | null;
  setEditingLectureId: (id: string | null) => void;
  onRename: (lectureId: string, newTitle: string) => void;
  onDelete: (lectureId: string) => void;
  onUpdateMetadata: (lectureId: string, updates: any) => void;
  onShowWorkspaceModal: (lectureId: string, workspace: string) => void;
  onShowTagsModal: (lectureId: string, tags?: string[]) => void;
  setLectures: (lectures: LectureCardData[]) => void;
  router: any;
}) {
  const getWorkspaces = () => {
    const workspaces = new Set<string>();
    lectures.forEach(l => workspaces.add(l.workspace || 'default'));
    folders.forEach(f => workspaces.add(f.workspace));
    return Array.from(workspaces).sort();
  };

  const getRootFolders = (workspace: string) => {
    return folders.filter(f => f.workspace === workspace && (!f.parent_path || f.parent_path === workspace));
  };

  const getLecturesInFolder = (folderPath: string | null, workspace: string) => {
    if (folderPath === null) {
      return lectures.filter(l => (l.workspace || 'default') === workspace && (!l.folder_path || l.folder_path === ''));
    }
    return lectures.filter(l => l.folder_path === folderPath);
  };

  const getChildFolders = (parentPath: string) => {
    return folders.filter(f => f.parent_path === parentPath);
  };

  const renderFolder = (folder: Folder, level: number = 0) => {
    const isExpanded = expandedFolders.has(folder.path);
    const childFolders = getChildFolders(folder.path);
    const folderLectures = getLecturesInFolder(folder.path, folder.workspace);
    const hasContent = childFolders.length > 0 || folderLectures.length > 0;

    return (
      <div key={folder.id} style={{ marginLeft: `${level * 20}px` }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '8px',
            borderRadius: '6px',
            cursor: 'pointer',
            background: selectedFolder === folder.path ? 'var(--accent)' : 'transparent',
            color: selectedFolder === folder.path ? 'white' : 'var(--ink)',
          }}
          onClick={() => {
            onSelectFolder(folder.path);
            if (hasContent) {
              onToggleFolder(folder.path);
            }
          }}
          onMouseEnter={(e) => {
            if (selectedFolder !== folder.path) {
              e.currentTarget.style.background = 'var(--surface)';
            }
          }}
          onMouseLeave={(e) => {
            if (selectedFolder !== folder.path) {
              e.currentTarget.style.background = 'transparent';
            }
          }}
        >
          <span style={{ marginRight: '8px', fontSize: '14px' }}>
            {hasContent ? (isExpanded ? '📂' : '📁') : '📁'}
          </span>
          <span style={{ flex: 1, fontSize: '14px' }}>{folder.name}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePinFolder(folder.path);
            }}
            style={{
              padding: '4px 8px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: '12px',
            }}
            title={folder.pinned ? 'Unpin folder' : 'Pin folder'}
          >
            {folder.pinned ? '📌' : '○'}
          </button>
        </div>
        {isExpanded && (
          <div>
            {childFolders.map(child => renderFolder(child, level + 1))}
            {folderLectures.map(lecture => renderLectureCard(lecture, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const renderLectureCard = (lecture: LectureCardData, level: number = 0) => {
    const isEditing = editingLectureId === lecture.lecture_id;
    const showOptions = optionsMenuOpen === lecture.lecture_id;

    return (
      <div
        key={lecture.lecture_id}
        style={{
          marginLeft: `${level * 20}px`,
          padding: '8px',
          borderRadius: '6px',
          background: lecture.pinned ? 'var(--panel)' : 'transparent',
          border: lecture.pinned ? '1px solid var(--accent)' : '1px solid transparent',
          marginBottom: '4px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px' }}>{lecture.pinned ? '📌' : '📄'}</span>
          {isEditing ? (
            <input
              type="text"
              value={lecture.title}
              onChange={(e) => {
                setLectures(allLectures.map(l =>
                  l.lecture_id === lecture.lecture_id ? { ...l, title: e.target.value } : l
                ));
              }}
              onBlur={() => {
                const updated = allLectures.find(l => l.lecture_id === lecture.lecture_id);
                if (updated) {
                  onRename(lecture.lecture_id, updated.title);
                }
                setEditingLectureId(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const updated = allLectures.find(l => l.lecture_id === lecture.lecture_id);
                  if (updated) {
                    onRename(lecture.lecture_id, updated.title);
                  }
                  setEditingLectureId(null);
                } else if (e.key === 'Escape') {
                  setEditingLectureId(null);
                }
              }}
              autoFocus
              style={{
                flex: 1,
                padding: '4px 8px',
                border: '1px solid var(--accent)',
                borderRadius: '4px',
                background: 'var(--surface)',
                color: 'var(--ink)',
                fontSize: '14px',
              }}
            />
          ) : (
            <>
              <span
                style={{ flex: 1, fontSize: '14px', cursor: 'pointer' }}
                onClick={() => onLectureClick(lecture.lecture_id)}
              >
                {lecture.title}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePin(lecture.lecture_id);
                }}
                style={{
                  padding: '4px 8px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
                title={lecture.pinned ? 'Unpin' : 'Pin'}
              >
                {lecture.pinned ? '📌' : '○'}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onOptionsClick(lecture.lecture_id);
                }}
                style={{
                  padding: '4px 8px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                ⋮
              </button>
            </>
          )}
        </div>
        {showOptions && !isEditing && (
          <div
            style={{
              marginTop: '8px',
              padding: '8px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              fontSize: '12px',
            }}
          >
            <div onClick={() => {
              router.push(`/lecture-editor?lectureId=${lecture.lecture_id}`);
              onOptionsClick(null);
            }} style={{ padding: '4px', cursor: 'pointer', color: 'var(--accent)', fontWeight: '600' }}>
              📝 Open in Editor
            </div>
            <div style={{ height: '1px', background: 'var(--border)', margin: '4px 0' }} />
            <div onClick={() => onMoveToFolder(lecture.lecture_id)} style={{ padding: '4px', cursor: 'pointer' }}>
              📂 Move
            </div>
            <div onClick={() => onShowWorkspaceModal(lecture.lecture_id, lecture.workspace || 'default')} style={{ padding: '4px', cursor: 'pointer' }}>
              📁 Workspace
            </div>
            <div onClick={() => onShowTagsModal(lecture.lecture_id, lecture.tags)} style={{ padding: '4px', cursor: 'pointer' }}>
              🏷️ Tags
            </div>
            <div onClick={() => onDelete(lecture.lecture_id)} style={{ padding: '4px', cursor: 'pointer', color: 'var(--accent-2)' }}>
              🗑️ Delete
            </div>
          </div>
        )}
      </div>
    );
  };

  const workspaces = getWorkspaces();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {workspaces.map(workspace => {
        const rootFolders = getRootFolders(workspace);
        const rootLectures = getLecturesInFolder(null, workspace);
        const pinnedFolders = rootFolders.filter(f => f.pinned);
        const unpinnedFolders = rootFolders.filter(f => !f.pinned);
        const pinnedLectures = rootLectures.filter(l => l.pinned);
        const unpinnedLectures = rootLectures.filter(l => !l.pinned);

        return (
          <div key={workspace} style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '12px', padding: '8px', background: 'var(--panel)', borderRadius: '6px' }}>
              📁 {workspace}
            </h3>
            
            {/* Pinned Folders */}
            {pinnedFolders.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                {pinnedFolders.map(folder => renderFolder(folder, 0))}
              </div>
            )}

            {/* Pinned Lectures */}
            {pinnedLectures.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                {pinnedLectures.map(lecture => renderLectureCard(lecture, 0))}
              </div>
            )}

            {/* Unpinned Folders */}
            {unpinnedFolders.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                {unpinnedFolders.map(folder => renderFolder(folder, 0))}
              </div>
            )}

            {/* Unpinned Lectures */}
            {unpinnedLectures.length > 0 && (
              <div>
                {unpinnedLectures.map(lecture => renderLectureCard(lecture, 0))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FileReaderStudioLanding({ router }: { router: any }) {
  const { theme, toggleTheme } = useTheme();
  const [lectures, setLectures] = useState<LectureCardData[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'lectures' | 'resources'>('lectures');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newLectureTitle, setNewLectureTitle] = useState('');
  const [newLectureDescription, setNewLectureDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [syncingNotion, setSyncingNotion] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [editingLectureId, setEditingLectureId] = useState<string | null>(null);
  const [optionsMenuOpen, setOptionsMenuOpen] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'tree'>('tree');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  
  // Modal states
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [showTagsModal, setShowTagsModal] = useState(false);
  const [modalInput, setModalInput] = useState('');
  const [modalContext, setModalContext] = useState<{ lectureId?: string; folderPath?: string | null; workspace?: string }>({});

  // Load folders from localStorage
  const loadFolders = () => {
    try {
      const foldersStr = localStorage.getItem('file_reader_folders');
      if (foldersStr) {
        const foldersData = JSON.parse(foldersStr);
        setFolders(foldersData);
      }
    } catch (err) {
      console.error('Failed to load folders:', err);
    }
  };

  // Save folders to localStorage
  const saveFolders = (foldersToSave: Folder[]) => {
    try {
      localStorage.setItem('file_reader_folders', JSON.stringify(foldersToSave));
      setFolders(foldersToSave);
    } catch (err) {
      console.error('Failed to save folders:', err);
    }
  };

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        
        // Load folders
        loadFolders();
        
        // Get all resources
        const resourcesData = await searchResources('', 100);
        setResources(resourcesData);
        
        // Get all lectures using the list API
        try {
          const lecturesData = await listLectures();
          console.log(`Loaded ${lecturesData.length} lectures from API`);
          
          if (lecturesData.length === 0) {
            console.log('No lectures found. This could mean:');
            console.log('1. You haven\'t created any lectures yet');
            console.log('2. Lectures exist but are in a different graph/branch');
            console.log('3. There was an issue loading lectures');
          }
          
          // Get segment counts, preview text, and metadata for each lecture
          const lecturesWithData = await Promise.all(
            lecturesData.map(async (lecture) => {
              try {
                const segments = await getLectureSegments(lecture.lecture_id);
                
                // Get preview text from first segment, or from markdown in metadata_json, or from raw_text
                let preview_text: string | undefined;
                if (segments.length > 0) {
                  preview_text = segments[0].text.substring(0, 150).trim() + (segments[0].text.length > 150 ? '...' : '');
                } else if (lecture.metadata_json) {
                  try {
                    const metadata = JSON.parse(lecture.metadata_json);
                    if (metadata.markdown) {
                      // Extract plain text from markdown for preview
                      const markdownText = metadata.markdown.replace(/[#*\[\]()]/g, '').replace(/\n/g, ' ').trim();
                      preview_text = markdownText.substring(0, 150) + (markdownText.length > 150 ? '...' : '');
                    }
                  } catch (e) {
                    // If parsing fails, try raw_text
                    if (lecture.raw_text) {
                      preview_text = lecture.raw_text.substring(0, 150).trim() + (lecture.raw_text.length > 150 ? '...' : '');
                    }
                  }
                } else if (lecture.raw_text) {
                  preview_text = lecture.raw_text.substring(0, 150).trim() + (lecture.raw_text.length > 150 ? '...' : '');
                }
                
                // Get last edited time from localStorage
                const lastEditedKey = `lecture_${lecture.lecture_id}_last_edited`;
                const lastEdited = localStorage.getItem(lastEditedKey);
                const lastEditedTime = lastEdited ? parseInt(lastEdited, 10) : undefined;
                
                // Get metadata from localStorage
                const metadataKey = `lecture_${lecture.lecture_id}_metadata`;
                const metadataStr = localStorage.getItem(metadataKey);
                const metadata = metadataStr ? JSON.parse(metadataStr) : {};
                
                return {
                  lecture_id: lecture.lecture_id,
                  title: lecture.title,
                  segment_count: segments.length,
                  preview_text,
                  last_edited: lastEditedTime,
                  priority: metadata.priority || 'medium',
                  tags: metadata.tags || [],
                  workspace: metadata.workspace || 'default',
                  folder_path: metadata.folder_path,
                  pinned: metadata.pinned || false,
                };
              } catch (err) {
                console.error(`Failed to get segments for lecture ${lecture.lecture_id}:`, err);
                const lastEditedKey = `lecture_${lecture.lecture_id}_last_edited`;
                const lastEdited = localStorage.getItem(lastEditedKey);
                const lastEditedTime = lastEdited ? parseInt(lastEdited, 10) : undefined;
                const metadataKey = `lecture_${lecture.lecture_id}_metadata`;
                const metadataStr = localStorage.getItem(metadataKey);
                const metadata = metadataStr ? JSON.parse(metadataStr) : {};
                
                return {
                  lecture_id: lecture.lecture_id,
                  title: lecture.title,
                  segment_count: 0,
                  last_edited: lastEditedTime,
                  priority: metadata.priority || 'medium',
                  tags: metadata.tags || [],
                  workspace: metadata.workspace || 'default',
                  folder_path: metadata.folder_path,
                  pinned: metadata.pinned || false,
                };
              }
            })
          );
          
          // Sort by last edited (most recent first), but pinned items first
          lecturesWithData.sort((a, b) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            if (!a.last_edited && !b.last_edited) return 0;
            if (!a.last_edited) return 1;
            if (!b.last_edited) return -1;
            return b.last_edited - a.last_edited;
          });
          
          setLectures(lecturesWithData);
          setError(null); // Clear any previous errors
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          console.error('Failed to load lectures:', err);
          console.error('Error details:', errorMessage);
          setError(`Failed to load lectures: ${errorMessage}`);
          // Fallback: try to get lectures from resources
          const lectureMap = new Map<string, { title: string; segment_count: number }>();
          const lectureResources = resourcesData.filter(r => r.metadata?.lecture_id);
          
          lectureResources.forEach(r => {
            const lectureId = r.metadata?.lecture_id;
            if (lectureId && !lectureMap.has(lectureId)) {
              lectureMap.set(lectureId, {
                title: r.metadata?.lecture_title || r.title || `Lecture ${lectureId}`,
                segment_count: 0,
              });
            }
          });
          
          const lecturesArray = Array.from(lectureMap.entries()).map(([lecture_id, data]) => ({
            lecture_id,
            ...data,
          }));
          setLectures(lecturesArray);
        }
      } catch (err) {
        console.error('Failed to load data:', err);
      } finally {
        setLoading(false);
      }
    }
    
    loadData();
  }, []);

  // Function to reload lectures after sync
  const reloadLectures = async () => {
    try {
      const lecturesData = await listLectures();
      console.log(`Reloaded ${lecturesData.length} lectures from API`);
      
      // Get segment counts, preview text, and metadata for each lecture
      const lecturesWithData = await Promise.all(
        lecturesData.map(async (lecture) => {
          try {
            const segments = await getLectureSegments(lecture.lecture_id);
            
            // Get preview text from first segment, or from markdown in metadata_json, or from raw_text
            let preview_text: string | undefined;
            if (segments.length > 0) {
              preview_text = segments[0].text.substring(0, 150).trim() + (segments[0].text.length > 150 ? '...' : '');
            } else if (lecture.metadata_json) {
              try {
                const metadata = JSON.parse(lecture.metadata_json);
                if (metadata.markdown) {
                  // Extract plain text from markdown for preview
                  const markdownText = metadata.markdown.replace(/[#*\[\]()]/g, '').replace(/\n/g, ' ').trim();
                  preview_text = markdownText.substring(0, 150) + (markdownText.length > 150 ? '...' : '');
                }
              } catch (e) {
                // If parsing fails, try raw_text
                if (lecture.raw_text) {
                  preview_text = lecture.raw_text.substring(0, 150).trim() + (lecture.raw_text.length > 150 ? '...' : '');
                }
              }
            } else if (lecture.raw_text) {
              preview_text = lecture.raw_text.substring(0, 150).trim() + (lecture.raw_text.length > 150 ? '...' : '');
            }
            
            // Get last edited time from localStorage
            const lastEditedKey = `lecture_${lecture.lecture_id}_last_edited`;
            const lastEdited = localStorage.getItem(lastEditedKey);
            const lastEditedTime = lastEdited ? parseInt(lastEdited, 10) : undefined;
            
            // Get metadata from localStorage
            const metadataKey = `lecture_${lecture.lecture_id}_metadata`;
            const metadataStr = localStorage.getItem(metadataKey);
            const metadata = metadataStr ? JSON.parse(metadataStr) : {};
            
            return {
              lecture_id: lecture.lecture_id,
              title: lecture.title,
              segment_count: segments.length,
              preview_text,
              last_edited: lastEditedTime,
              priority: metadata.priority || 'medium',
              tags: metadata.tags || [],
              workspace: metadata.workspace || 'default',
              folder_path: metadata.folder_path,
              pinned: metadata.pinned || false,
            };
          } catch (err) {
            console.error(`Failed to get segments for lecture ${lecture.lecture_id}:`, err);
            const lastEditedKey = `lecture_${lecture.lecture_id}_last_edited`;
            const lastEdited = localStorage.getItem(lastEditedKey);
            const lastEditedTime = lastEdited ? parseInt(lastEdited, 10) : undefined;
            const metadataKey = `lecture_${lecture.lecture_id}_metadata`;
            const metadataStr = localStorage.getItem(metadataKey);
            const metadata = metadataStr ? JSON.parse(metadataStr) : {};
            
            return {
              lecture_id: lecture.lecture_id,
              title: lecture.title,
              segment_count: 0,
              last_edited: lastEditedTime,
              priority: metadata.priority || 'medium',
              tags: metadata.tags || [],
              workspace: metadata.workspace || 'default',
              folder_path: metadata.folder_path,
              pinned: metadata.pinned || false,
            };
          }
        })
      );
      
      // Sort by last edited (most recent first), but pinned items first
      lecturesWithData.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        if (!a.last_edited && !b.last_edited) return 0;
        if (!a.last_edited) return 1;
        if (!b.last_edited) return -1;
        return b.last_edited - a.last_edited;
      });
      
      setLectures(lecturesWithData);
    } catch (err) {
      console.error('Failed to reload lectures:', err);
      throw err;
    }
  };

  // Handle canceling sync
  const handleCancelSync = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setSyncingNotion(false);
    setSyncStatus('Sync cancelled. Pages already ingested will remain in your database.');
    setTimeout(() => {
      setSyncStatus(null);
    }, 5000);
  };

  // Handle full sync from Notion (with parallel processing and progress)
  const handleFullSyncFromNotion = async () => {
    if (!confirm('This will ingest all Notion pages into Brain Web. This may take a while. Continue?')) {
      return;
    }
    
    setSyncingNotion(true);
    setSyncStatus('Starting sync from Notion...');
    setError(null);
    
    // Create abort controller for cancellation
    abortControllerRef.current = new AbortController();
    
    try {
      const results = await ingestAllNotionPagesParallel(
        'pages',
        'Software Engineering',
        5, // maxWorkers
        true, // useParallel
        (event: NotionIngestProgressEvent) => {
          if (event.type === 'start') {
            setSyncStatus(`Starting ingestion of ${event.total} pages...`);
          } else if (event.type === 'progress') {
            const percent = event.total ? Math.round((event.processed! / event.total) * 100) : 0;
            setSyncStatus(
              `Processing page ${event.processed}/${event.total} (${percent}%)${event.success ? ' ✓' : ' ✗'}`
            );
          } else if (event.type === 'complete') {
            const totalPages = event.total || 0;
            const totalNodes = event.summary?.nodes || 0;
            const totalLinks = event.summary?.links || 0;
            const totalSegments = event.summary?.segments || 0;
            setSyncStatus(
              `✓ Successfully synced ${totalPages} Notion pages: ${totalNodes} concepts, ${totalLinks} links, ${totalSegments} segments created. Reloading...`
            );
            // Reload lectures to show newly ingested ones
            reloadLectures().catch(err => {
              console.error('Failed to reload lectures after sync:', err);
              setError('Sync completed but failed to reload lectures. Please refresh the page.');
            });
          } else if (event.type === 'error') {
            setError(event.message || 'Unknown error during sync');
            setSyncStatus(null);
          }
        },
        abortControllerRef.current // Pass abort controller for cancellation
      );
      
      // Reload lectures to show newly ingested ones
      await reloadLectures();
      
      // Clear sync status after 10 seconds
      setTimeout(() => {
        setSyncStatus(null);
      }, 10000);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setSyncStatus('Sync cancelled. Pages already ingested will remain in your database.');
        setTimeout(() => {
          setSyncStatus(null);
        }, 5000);
      } else {
        const errorMessage = err instanceof Error ? err.message : 'Failed to sync from Notion';
        setError(errorMessage);
        setSyncStatus(null);
        console.error('Failed to sync from Notion:', err);
      }
    } finally {
      setSyncingNotion(false);
      abortControllerRef.current = null;
    }
  };

  // Close options menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (optionsMenuOpen && !(e.target as HTMLElement).closest('[data-options-menu]')) {
        setOptionsMenuOpen(null);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [optionsMenuOpen]);

  const filteredLectures = lectures.filter(l =>
    !searchQuery || l.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredResources = resources.filter(r =>
    !searchQuery || 
    (r.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (r.url || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Helper function to format time ago
  const formatTimeAgo = (timestamp: number): string => {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days} day${days !== 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    return 'just now';
  };

  const handleLectureClick = async (lectureId: string) => {
    console.log('handleLectureClick called with:', lectureId);
    try {
      // Track that this lecture was opened
      const lastEditedKey = `lecture_${lectureId}_last_edited`;
      localStorage.setItem(lastEditedKey, Date.now().toString());
      
      // Navigate to file reader studio (without segmentIndex to show full content)
      // The file reader will display markdown from metadata_json if available
      console.log('Navigating to:', `/reader/segment?lectureId=${lectureId}`);
      router.push(`/reader/segment?lectureId=${lectureId}`);
    } catch (error) {
      console.error('Error in handleLectureClick:', error);
    }
  };

  const handleRenameLecture = async (lectureId: string, newTitle: string) => {
    try {
      await updateLecture(lectureId, { title: newTitle });
      setLectures(lectures.map(l => 
        l.lecture_id === lectureId ? { ...l, title: newTitle } : l
      ));
      setEditingLectureId(null);
    } catch (err) {
      console.error('Failed to rename lecture:', err);
      alert('Failed to rename lecture. Please try again.');
    }
  };

  const handleDeleteLecture = async (lectureId: string) => {
    if (!confirm('Are you sure you want to delete this lecture? This action cannot be undone.')) {
      return;
    }
    
    try {
      // Note: We'll need to add a delete endpoint, for now just remove from list
      // await deleteLecture(lectureId);
      setLectures(lectures.filter(l => l.lecture_id !== lectureId));
      localStorage.removeItem(`lecture_${lectureId}_last_edited`);
      localStorage.removeItem(`lecture_${lectureId}_metadata`);
      setOptionsMenuOpen(null);
    } catch (err) {
      console.error('Failed to delete lecture:', err);
      alert('Failed to delete lecture. Please try again.');
    }
  };

  const handleUpdateMetadata = (lectureId: string, updates: { priority?: 'low' | 'medium' | 'high'; tags?: string[]; workspace?: string; folder_path?: string; pinned?: boolean }) => {
    const metadataKey = `lecture_${lectureId}_metadata`;
    const existingStr = localStorage.getItem(metadataKey);
    const existing = existingStr ? JSON.parse(existingStr) : {};
    const updated = { ...existing, ...updates };
    localStorage.setItem(metadataKey, JSON.stringify(updated));
    
    setLectures(lectures.map(l => 
      l.lecture_id === lectureId ? { ...l, ...updates } : l
    ));
    setOptionsMenuOpen(null);
  };

  const handleCreateFolder = (name: string, workspace: string, parentPath?: string) => {
    if (!name.trim()) return;
    
    const folderId = `folder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const path = parentPath ? `${parentPath}/${name.trim()}` : `${workspace}/${name.trim()}`;
    
    const newFolder: Folder = {
      id: folderId,
      name: name.trim(),
      path,
      parent_path: parentPath || workspace,
      workspace,
      pinned: false,
      created_at: Date.now(),
    };
    
    const updatedFolders = [...folders, newFolder];
    saveFolders(updatedFolders);
    setShowFolderModal(false);
    setModalInput('');
  };

  const handleMoveToFolder = (lectureId: string, folderPath: string | null | undefined) => {
    handleUpdateMetadata(lectureId, { folder_path: folderPath || undefined });
    setShowMoveModal(false);
    setModalContext({});
  };

  const handleTogglePin = (lectureId: string) => {
    const lecture = lectures.find(l => l.lecture_id === lectureId);
    if (lecture) {
      handleUpdateMetadata(lectureId, { pinned: !lecture.pinned });
    }
  };

  const handleTogglePinFolder = (folderPath: string) => {
    const updatedFolders = folders.map(f => 
      f.path === folderPath ? { ...f, pinned: !f.pinned } : f
    );
    saveFolders(updatedFolders);
  };

  const handleToggleFolderExpansion = (folderPath: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folderPath)) {
      newExpanded.delete(folderPath);
    } else {
      newExpanded.add(folderPath);
    }
    setExpandedFolders(newExpanded);
  };

  const getFoldersForWorkspace = (workspace: string) => {
    return folders.filter(f => f.workspace === workspace);
  };

  const getLecturesInFolder = (folderPath: string | null) => {
    if (folderPath === null) {
      // Get lectures in root (no folder_path or folder_path is empty)
      return lectures.filter(l => !l.folder_path || l.folder_path === '');
    }
    return lectures.filter(l => l.folder_path === folderPath);
  };

  const getChildFolders = (parentPath: string) => {
    return folders.filter(f => f.parent_path === parentPath);
  };

  const handleResourceClick = (resource: Resource) => {
    if (resource.kind === 'web_link' && resource.url) {
      // Open web resource in reader view
      router.push(`/reader/segment?resourceId=${resource.resource_id}&url=${encodeURIComponent(resource.url)}`);
    } else {
      // For other resources, open in new tab or handle differently
      window.open(resource.url, '_blank');
    }
  };

  const handleCreateLecture = async () => {
    if (!newLectureTitle.trim()) {
      return;
    }

    try {
      setCreating(true);
      const newLecture = await createLecture({
        title: newLectureTitle.trim(),
        description: newLectureDescription.trim() || null,
      });
      
      // Add the new lecture to the list
      setLectures([...lectures, {
        lecture_id: newLecture.lecture_id,
        title: newLecture.title,
        segment_count: 0,
      }]);
      
      // Reset form and close modal
      setNewLectureTitle('');
      setNewLectureDescription('');
      setShowCreateModal(false);
      
      // Navigate to the new lecture editor
      router.push(`/lecture-editor?lectureId=${newLecture.lecture_id}`);
    } catch (err) {
      console.error('Failed to create lecture:', err);
      alert('Failed to create lecture. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: 'var(--page-bg)',
      padding: '24px',
    }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <Link href="/" style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: '14px', display: 'inline-block' }}>
              ← Back to Graph
            </Link>
            <button
              onClick={toggleTheme}
              style={{
                padding: '10px',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                background: 'var(--panel)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--ink)',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--accent)';
                e.currentTarget.style.color = 'white';
                e.currentTarget.style.borderColor = 'var(--accent)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--panel)';
                e.currentTarget.style.color = 'var(--ink)';
                e.currentTarget.style.borderColor = 'var(--border)';
              }}
              title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            >
              {theme === 'light' ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5"></circle>
                  <line x1="12" y1="1" x2="12" y2="3"></line>
                  <line x1="12" y1="21" x2="12" y2="23"></line>
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                  <line x1="1" y1="12" x2="3" y2="12"></line>
                  <line x1="21" y1="12" x2="23" y2="12"></line>
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
                </svg>
              )}
            </button>
          </div>
          <h1 style={{ fontSize: '32px', fontWeight: '700', margin: '0 0 8px 0' }}>
            File Reader Studio
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '16px', margin: 0 }}>
            Browse lectures, segments, and web resources. Highlight, annotate, and continue your research.
          </p>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px',
          borderBottom: '2px solid var(--border)',
        }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setActiveTab('lectures')}
              style={{
                padding: '12px 24px',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === 'lectures' ? '3px solid var(--accent)' : '3px solid transparent',
                color: activeTab === 'lectures' ? 'var(--accent)' : 'var(--muted)',
                fontSize: '14px',
                fontWeight: activeTab === 'lectures' ? '600' : '400',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              Lectures ({lectures.length})
            </button>
            <button
              onClick={() => setActiveTab('resources')}
              style={{
                padding: '12px 24px',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === 'resources' ? '3px solid var(--accent)' : '3px solid transparent',
                color: activeTab === 'resources' ? 'var(--accent)' : 'var(--muted)',
                fontSize: '14px',
                fontWeight: activeTab === 'resources' ? '600' : '400',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              Web Resources ({resources.filter(r => r.kind === 'web_link').length})
            </button>
          </div>
          {activeTab === 'lectures' && (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => router.push('/lecture-editor')}
                style={{
                  padding: '10px 20px',
                  background: 'transparent',
                  color: 'var(--accent)',
                  border: '1px solid var(--accent)',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--accent)';
                  e.currentTarget.style.color = 'white';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--accent)';
                }}
                title="Open editor to write a new lecture"
              >
                ✏️ New Lecture
              </button>
              <button
                onClick={() => setShowCreateModal(true)}
                style={{
                  padding: '10px 20px',
                  background: 'var(--accent)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = '0.9';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = '1';
                }}
                title="Create lecture with title first"
              >
                + Add Lecture
              </button>
              <button
                onClick={handleFullSyncFromNotion}
                disabled={syncingNotion}
                style={{
                  padding: '10px 20px',
                  background: syncingNotion ? 'var(--muted)' : 'var(--accent-2)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: syncingNotion ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                  opacity: syncingNotion ? 0.7 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!syncingNotion) {
                    e.currentTarget.style.opacity = '0.9';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!syncingNotion) {
                    e.currentTarget.style.opacity = '1';
                  }
                }}
                title="Sync all Notion pages into Brain Web"
              >
                {syncingNotion ? '🔄 Syncing...' : '🔄 Full Sync from Notion'}
              </button>
              {syncingNotion && (
                <button
                  onClick={handleCancelSync}
                  disabled={!syncingNotion}
                  style={{
                    padding: '8px 16px',
                    fontSize: '14px',
                    background: 'var(--accent-2)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: syncingNotion ? 'pointer' : 'not-allowed',
                    marginLeft: '8px',
                    opacity: syncingNotion ? 1 : 0.5,
                  }}
                  onMouseEnter={(e) => {
                    if (syncingNotion) {
                      e.currentTarget.style.background = 'var(--accent-3)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (syncingNotion) {
                      e.currentTarget.style.background = 'var(--accent-2)';
                    }
                  }}
                  title="Cancel sync (pages already ingested will remain)"
                >
                  ✕ Cancel
                </button>
              )}
            </div>
          )}
        </div>

        {/* Search */}
        <div style={{ marginBottom: '24px' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search lectures, resources, or URLs..."
            style={{
              width: '100%',
              maxWidth: '600px',
              padding: '12px 16px',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              background: 'var(--surface)',
              color: 'var(--ink)',
              fontSize: '14px',
            }}
          />
        </div>

        {/* Sync Status Message */}
        {syncStatus && (
          <div style={{
            padding: '12px 16px',
            marginBottom: '16px',
            background: 'var(--panel)',
            border: '1px solid var(--accent)',
            borderRadius: '8px',
            color: 'var(--accent)',
            fontSize: '14px',
          }}>
            {syncStatus}
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div style={{
            padding: '12px 16px',
            marginBottom: '16px',
            background: 'var(--panel)',
            border: '1px solid var(--accent-2)',
            borderRadius: '8px',
            color: 'var(--accent-2)',
            fontSize: '14px',
          }}>
            {error}
          </div>
        )}

        {/* View Mode Toggle */}
        {activeTab === 'lectures' && !loading && (
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'center' }}>
            <button
              onClick={() => setViewMode('tree')}
              style={{
                padding: '8px 16px',
                background: viewMode === 'tree' ? 'var(--accent)' : 'transparent',
                color: viewMode === 'tree' ? 'white' : 'var(--ink)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              📁 Tree View
            </button>
            <button
              onClick={() => setViewMode('grid')}
              style={{
                padding: '8px 16px',
                background: viewMode === 'grid' ? 'var(--accent)' : 'transparent',
                color: viewMode === 'grid' ? 'white' : 'var(--ink)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              ⬜ Grid View
            </button>
            <button
              onClick={() => {
                setModalContext({ workspace: 'default' });
                setModalInput('');
                setShowFolderModal(true);
              }}
              style={{
                padding: '8px 16px',
                background: 'transparent',
                color: 'var(--accent)',
                border: '1px solid var(--accent)',
                borderRadius: '6px',
                fontSize: '14px',
                cursor: 'pointer',
                marginLeft: 'auto',
              }}
            >
              + New Folder
            </button>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
            Loading...
          </div>
        ) : activeTab === 'lectures' ? (
          viewMode === 'tree' ? (
            <FolderTreeView
              lectures={filteredLectures}
              allLectures={lectures}
              folders={folders}
              selectedFolder={selectedFolder}
              onSelectFolder={setSelectedFolder}
              expandedFolders={expandedFolders}
              onToggleFolder={handleToggleFolderExpansion}
              onTogglePin={handleTogglePin}
              onTogglePinFolder={handleTogglePinFolder}
              onMoveToFolder={(lectureId) => {
                setModalContext({ lectureId, folderPath: lectures.find(l => l.lecture_id === lectureId)?.folder_path || undefined });
                setShowMoveModal(true);
              }}
              onLectureClick={handleLectureClick}
              onOptionsClick={(lectureId) => setOptionsMenuOpen(lectureId)}
              optionsMenuOpen={optionsMenuOpen}
              editingLectureId={editingLectureId}
              setEditingLectureId={setEditingLectureId}
              onRename={handleRenameLecture}
              onDelete={handleDeleteLecture}
              onUpdateMetadata={handleUpdateMetadata}
              onShowWorkspaceModal={(lectureId, workspace) => {
                setModalContext({ lectureId, workspace });
                setModalInput(workspace);
                setShowWorkspaceModal(true);
              }}
              onShowTagsModal={(lectureId, tags) => {
                setModalContext({ lectureId });
                setModalInput(tags?.join(', ') || '');
                setShowTagsModal(true);
              }}
              setLectures={setLectures}
              router={router}
            />
          ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
            {filteredLectures.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
                {searchQuery ? 'No lectures match your search' : 'No lectures found. Create lectures to get started.'}
              </div>
            ) : (
              filteredLectures.map(lecture => {
                const isRecentlyEdited = lecture.last_edited && (Date.now() - lecture.last_edited) < 3600000; // Within last hour
                const isEditing = editingLectureId === lecture.lecture_id;
                const showOptions = optionsMenuOpen === lecture.lecture_id;
                
                return (
                  <div
                    key={lecture.lecture_id}
                    style={{
                      padding: '20px',
                      background: 'var(--panel)',
                      border: isRecentlyEdited ? '2px solid var(--accent)' : '1px solid var(--border)',
                      borderRadius: '12px',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      position: 'relative',
                    }}
                    onClick={(e) => {
                      // Don't trigger if clicking on options menu, options button, or editing
                      const target = e.target as HTMLElement;
                      const isOptionsMenu = target.closest('[data-options-menu]');
                      const isOptionsButton = target.closest('button') && target.closest('button')?.parentElement?.querySelector('[data-options-menu]');
                      
                      if (!isEditing && !showOptions && !isOptionsMenu && !isOptionsButton) {
                        console.log('Clicking lecture:', lecture.lecture_id);
                        handleLectureClick(lecture.lecture_id);
                      }
                    }}
                    onMouseEnter={(e) => {
                      if (!isEditing && !showOptions) {
                        e.currentTarget.style.borderColor = 'var(--accent)';
                        e.currentTarget.style.transform = 'translateY(-2px)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isEditing && !showOptions) {
                        e.currentTarget.style.borderColor = isRecentlyEdited ? 'var(--accent)' : 'var(--border)';
                        e.currentTarget.style.transform = 'translateY(0)';
                      }
                    }}
                  >
                    {/* Options Menu Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setOptionsMenuOpen(showOptions ? null : lecture.lecture_id);
                      }}
                      style={{
                        position: 'absolute',
                        top: '12px',
                        right: '12px',
                        padding: '6px',
                        background: 'transparent',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        color: 'var(--muted)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--surface)';
                        e.currentTarget.style.color = 'var(--ink)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = 'var(--muted)';
                      }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="1"></circle>
                        <circle cx="12" cy="5" r="1"></circle>
                        <circle cx="12" cy="19" r="1"></circle>
                      </svg>
                    </button>

                    {/* Options Menu Dropdown */}
                    {showOptions && (
                      <div
                        data-options-menu
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          position: 'absolute',
                          top: '40px',
                          right: '12px',
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                          zIndex: 1000,
                          minWidth: '200px',
                          padding: '8px',
                        }}
                      >
                        <div
                          onClick={() => {
                            router.push(`/lecture-editor?lectureId=${lecture.lecture_id}`);
                            setOptionsMenuOpen(null);
                          }}
                          style={{
                            padding: '8px 12px',
                            cursor: 'pointer',
                            borderRadius: '6px',
                            fontSize: '14px',
                            color: 'var(--accent)',
                            fontWeight: '600',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--panel)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                          📝 Open in Editor
                        </div>
                        <div
                          style={{
                            height: '1px',
                            background: 'var(--border)',
                            margin: '4px 0',
                          }}
                        />
                        <div
                          onClick={() => {
                            setEditingLectureId(lecture.lecture_id);
                            setOptionsMenuOpen(null);
                          }}
                          style={{
                            padding: '8px 12px',
                            cursor: 'pointer',
                            borderRadius: '6px',
                            fontSize: '14px',
                            color: 'var(--ink)',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--panel)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                          ✏️ Rename
                        </div>
                        <div
                          onClick={() => {
                            const newPriority = lecture.priority === 'high' ? 'medium' : lecture.priority === 'medium' ? 'low' : 'high';
                            handleUpdateMetadata(lecture.lecture_id, { priority: newPriority });
                          }}
                          style={{
                            padding: '8px 12px',
                            cursor: 'pointer',
                            borderRadius: '6px',
                            fontSize: '14px',
                            color: 'var(--ink)',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--panel)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                          {lecture.priority === 'high' ? '🔴' : lecture.priority === 'medium' ? '🟡' : '🟢'} Priority: {lecture.priority}
                        </div>
                        <div
                          onClick={() => {
                            setModalContext({ lectureId: lecture.lecture_id, workspace: lecture.workspace || 'default' });
                            setModalInput(lecture.workspace || 'default');
                            setShowWorkspaceModal(true);
                          }}
                          style={{
                            padding: '8px 12px',
                            cursor: 'pointer',
                            borderRadius: '6px',
                            fontSize: '14px',
                            color: 'var(--ink)',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--panel)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                          📁 Workspace: {lecture.workspace || 'default'}
                        </div>
                        <div
                          onClick={() => {
                            setModalContext({ lectureId: lecture.lecture_id });
                            setModalInput(lecture.tags?.join(', ') || '');
                            setShowTagsModal(true);
                          }}
                          style={{
                            padding: '8px 12px',
                            cursor: 'pointer',
                            borderRadius: '6px',
                            fontSize: '14px',
                            color: 'var(--ink)',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--panel)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                          🏷️ Tags
                        </div>
                        <div
                          onClick={() => {
                            setModalContext({ lectureId: lecture.lecture_id, folderPath: lecture.folder_path || undefined });
                            setShowMoveModal(true);
                          }}
                          style={{
                            padding: '8px 12px',
                            cursor: 'pointer',
                            borderRadius: '6px',
                            fontSize: '14px',
                            color: 'var(--ink)',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--panel)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                          📂 Move to Folder
                        </div>
                        <div
                          onClick={() => handleTogglePin(lecture.lecture_id)}
                          style={{
                            padding: '8px 12px',
                            cursor: 'pointer',
                            borderRadius: '6px',
                            fontSize: '14px',
                            color: 'var(--ink)',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--panel)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                          {lecture.pinned ? '📌 Unpin' : '📌 Pin'}
                        </div>
                        <div
                          style={{
                            height: '1px',
                            background: 'var(--border)',
                            margin: '4px 0',
                          }}
                        />
                        <div
                          onClick={() => handleDeleteLecture(lecture.lecture_id)}
                          style={{
                            padding: '8px 12px',
                            cursor: 'pointer',
                            borderRadius: '6px',
                            fontSize: '14px',
                            color: 'var(--accent-2)',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--panel)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                          🗑️ Delete
                        </div>
                      </div>
                    )}

                    {/* Title (editable if editing) */}
                    {isEditing ? (
                      <input
                        type="text"
                        value={lecture.title}
                        onChange={(e) => {
                          setLectures(lectures.map(l => 
                            l.lecture_id === lecture.lecture_id ? { ...l, title: e.target.value } : l
                          ));
                        }}
                        onBlur={() => {
                          handleRenameLecture(lecture.lecture_id, lecture.title);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleRenameLecture(lecture.lecture_id, lecture.title);
                          } else if (e.key === 'Escape') {
                            setEditingLectureId(null);
                          }
                        }}
                        autoFocus
                        style={{
                          fontSize: '18px',
                          fontWeight: '600',
                          margin: '0 0 8px 0',
                          padding: '4px 8px',
                          border: '1px solid var(--accent)',
                          borderRadius: '4px',
                          background: 'var(--surface)',
                          color: 'var(--ink)',
                          width: 'calc(100% - 40px)',
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <h3 
                        style={{ 
                          fontSize: '18px', 
                          fontWeight: '600', 
                          margin: '0 0 8px 0', 
                          paddingRight: '30px',
                          cursor: 'pointer',
                          pointerEvents: 'auto',
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          console.log('Title clicked:', lecture.lecture_id, lecture.title);
                          handleLectureClick(lecture.lecture_id);
                        }}
                      >
                        {lecture.title}
                      </h3>
                    )}

                    {/* Preview Text */}
                    {lecture.preview_text && (
                      <div style={{ 
                        fontSize: '13px', 
                        color: 'var(--muted)', 
                        marginBottom: '8px',
                        lineHeight: '1.5',
                        maxHeight: '60px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>
                        {lecture.preview_text}
                      </div>
                    )}

                    {/* Metadata Row */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                      <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                        {lecture.segment_count} segment{lecture.segment_count !== 1 ? 's' : ''}
                      </div>
                      {lecture.last_edited && (
                        <div style={{ 
                          fontSize: '12px', 
                          color: isRecentlyEdited ? 'var(--accent)' : 'var(--muted)',
                          fontWeight: isRecentlyEdited ? '600' : '400',
                        }}>
                          {isRecentlyEdited && '✏️ '}
                          {formatTimeAgo(lecture.last_edited)}
                        </div>
                      )}
                    </div>

                    {/* Tags */}
                    {lecture.tags && lecture.tags.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' }}>
                        {lecture.tags.slice(0, 3).map((tag, idx) => (
                          <span
                            key={idx}
                            style={{
                              fontSize: '10px',
                              padding: '2px 6px',
                              background: 'rgba(17, 138, 178, 0.1)',
                              color: 'var(--accent)',
                              borderRadius: '4px',
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                        {lecture.tags.length > 3 && (
                          <span style={{ fontSize: '10px', color: 'var(--muted)' }}>
                            +{lecture.tags.length - 3}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Workspace Badge */}
                    {lecture.workspace && lecture.workspace !== 'default' && (
                      <div style={{ 
                        marginTop: '8px', 
                        fontSize: '11px', 
                        color: 'var(--muted)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}>
                        <span>📁</span>
                        <span>{lecture.workspace}</span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
            {filteredResources.filter(r => r.kind === 'web_link').length === 0 ? (
              <div style={{ gridColumn: '1 / -1', padding: '40px', textAlign: 'center', color: 'var(--muted)' }}>
                {searchQuery ? 'No web resources match your search' : 'No web resources found.'}
              </div>
            ) : (
              filteredResources
                .filter(r => r.kind === 'web_link')
                .map(resource => (
                  <div
                    key={resource.resource_id}
                    onClick={() => handleResourceClick(resource)}
                    style={{
                      padding: '20px',
                      background: 'var(--panel)',
                      border: '1px solid var(--border)',
                      borderRadius: '12px',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--accent)';
                      e.currentTarget.style.transform = 'translateY(-2px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border)';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    <h3 style={{ fontSize: '16px', fontWeight: '600', margin: '0 0 8px 0' }}>
                      {resource.title || 'Untitled Resource'}
                    </h3>
                    <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '8px', wordBreak: 'break-all' }}>
                      {resource.url}
                    </div>
                    {resource.caption && (
                      <div style={{ fontSize: '13px', color: 'var(--ink)', marginTop: '8px' }}>
                        {resource.caption.substring(0, 100)}...
                      </div>
                    )}
                  </div>
                ))
            )}
          </div>
        )}

        {/* Folder Creation Modal */}
        {showFolderModal && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            }}
            onClick={() => setShowFolderModal(false)}
          >
            <div
              style={{
                background: 'var(--panel)',
                borderRadius: '12px',
                padding: '24px',
                width: '90%',
                maxWidth: '500px',
                border: '1px solid var(--border)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 style={{ fontSize: '20px', fontWeight: '600', margin: '0 0 20px 0' }}>
                Create New Folder
              </h2>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: 'var(--ink)' }}>
                  Folder Name *
                </label>
                <input
                  type="text"
                  value={modalInput}
                  onChange={(e) => setModalInput(e.target.value)}
                  placeholder="Enter folder name"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    background: 'var(--surface)',
                    color: 'var(--ink)',
                    fontSize: '14px',
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && modalInput.trim()) {
                      handleCreateFolder(modalInput, modalContext.workspace || 'default', modalContext.folderPath || undefined);
                    } else if (e.key === 'Escape') {
                      setShowFolderModal(false);
                    }
                  }}
                  autoFocus
                />
              </div>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => {
                    setShowFolderModal(false);
                    setModalInput('');
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
                <button
                  onClick={() => handleCreateFolder(modalInput, modalContext.workspace || 'default', modalContext.folderPath || undefined)}
                  disabled={!modalInput.trim()}
                  style={{
                    padding: '10px 20px',
                    background: modalInput.trim() ? 'var(--accent)' : 'var(--muted)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: modalInput.trim() ? 'pointer' : 'not-allowed',
                    opacity: modalInput.trim() ? 1 : 0.5,
                  }}
                >
                  Create Folder
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Move to Folder Modal */}
        {showMoveModal && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            }}
            onClick={() => setShowMoveModal(false)}
          >
            <div
              style={{
                background: 'var(--panel)',
                borderRadius: '12px',
                padding: '24px',
                width: '90%',
                maxWidth: '500px',
                border: '1px solid var(--border)',
                maxHeight: '80vh',
                overflow: 'auto',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 style={{ fontSize: '20px', fontWeight: '600', margin: '0 0 20px 0' }}>
                Move to Folder
              </h2>
              <div style={{ marginBottom: '16px' }}>
                <div
                  onClick={() => handleMoveToFolder(modalContext.lectureId!, null)}
                  style={{
                    padding: '12px',
                    cursor: 'pointer',
                    borderRadius: '6px',
                    background: modalContext.folderPath === null ? 'var(--accent)' : 'transparent',
                    color: modalContext.folderPath === null ? 'white' : 'var(--ink)',
                    marginBottom: '8px',
                    border: '1px solid var(--border)',
                  }}
                  onMouseEnter={(e) => {
                    if (modalContext.folderPath !== null) {
                      e.currentTarget.style.background = 'var(--surface)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (modalContext.folderPath !== null) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  📁 Root (No folder)
                </div>
                {folders.map(folder => (
                  <div
                    key={folder.id}
                    onClick={() => handleMoveToFolder(modalContext.lectureId!, folder.path)}
                    style={{
                      padding: '12px',
                      cursor: 'pointer',
                      borderRadius: '6px',
                      background: modalContext.folderPath === folder.path ? 'var(--accent)' : 'transparent',
                      color: modalContext.folderPath === folder.path ? 'white' : 'var(--ink)',
                      marginBottom: '8px',
                      border: '1px solid var(--border)',
                    }}
                    onMouseEnter={(e) => {
                      if (modalContext.folderPath !== folder.path) {
                        e.currentTarget.style.background = 'var(--surface)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (modalContext.folderPath !== folder.path) {
                        e.currentTarget.style.background = 'transparent';
                      }
                    }}
                  >
                    📁 {folder.path}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setShowMoveModal(false)}
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
          </div>
        )}

        {/* Workspace Modal */}
        {showWorkspaceModal && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            }}
            onClick={() => setShowWorkspaceModal(false)}
          >
            <div
              style={{
                background: 'var(--panel)',
                borderRadius: '12px',
                padding: '24px',
                width: '90%',
                maxWidth: '500px',
                border: '1px solid var(--border)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 style={{ fontSize: '20px', fontWeight: '600', margin: '0 0 20px 0' }}>
                Set Workspace
              </h2>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: 'var(--ink)' }}>
                  Workspace Name *
                </label>
                <input
                  type="text"
                  value={modalInput}
                  onChange={(e) => setModalInput(e.target.value)}
                  placeholder="Enter workspace name"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    background: 'var(--surface)',
                    color: 'var(--ink)',
                    fontSize: '14px',
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && modalInput.trim()) {
                      handleUpdateMetadata(modalContext.lectureId!, { workspace: modalInput.trim() });
                      setShowWorkspaceModal(false);
                      setModalInput('');
                    } else if (e.key === 'Escape') {
                      setShowWorkspaceModal(false);
                    }
                  }}
                  autoFocus
                />
              </div>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => {
                    setShowWorkspaceModal(false);
                    setModalInput('');
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
                <button
                  onClick={() => {
                    if (modalInput.trim()) {
                      handleUpdateMetadata(modalContext.lectureId!, { workspace: modalInput.trim() });
                      setShowWorkspaceModal(false);
                      setModalInput('');
                    }
                  }}
                  disabled={!modalInput.trim()}
                  style={{
                    padding: '10px 20px',
                    background: modalInput.trim() ? 'var(--accent)' : 'var(--muted)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: modalInput.trim() ? 'pointer' : 'not-allowed',
                    opacity: modalInput.trim() ? 1 : 0.5,
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tags Modal */}
        {showTagsModal && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            }}
            onClick={() => setShowTagsModal(false)}
          >
            <div
              style={{
                background: 'var(--panel)',
                borderRadius: '12px',
                padding: '24px',
                width: '90%',
                maxWidth: '500px',
                border: '1px solid var(--border)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 style={{ fontSize: '20px', fontWeight: '600', margin: '0 0 20px 0' }}>
                Edit Tags
              </h2>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: 'var(--ink)' }}>
                  Tags (comma-separated)
                </label>
                <input
                  type="text"
                  value={modalInput}
                  onChange={(e) => setModalInput(e.target.value)}
                  placeholder="Enter tags separated by commas"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    background: 'var(--surface)',
                    color: 'var(--ink)',
                    fontSize: '14px',
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const tags = modalInput.split(',').map(t => t.trim()).filter(t => t);
                      handleUpdateMetadata(modalContext.lectureId!, { tags });
                      setShowTagsModal(false);
                      setModalInput('');
                    } else if (e.key === 'Escape') {
                      setShowTagsModal(false);
                    }
                  }}
                  autoFocus
                />
              </div>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => {
                    setShowTagsModal(false);
                    setModalInput('');
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
                <button
                  onClick={() => {
                    const tags = modalInput.split(',').map(t => t.trim()).filter(t => t);
                    handleUpdateMetadata(modalContext.lectureId!, { tags });
                    setShowTagsModal(false);
                    setModalInput('');
                  }}
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
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Create Lecture Modal */}
        {showCreateModal && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            }}
            onClick={() => !creating && setShowCreateModal(false)}
            onKeyDown={(e) => {
              // Don't interfere with keyboard events - let them bubble to inputs
              if (e.key === 'Escape' && !creating) {
                setShowCreateModal(false);
              }
            }}
          >
            <div
              style={{
                background: 'var(--panel)',
                borderRadius: '12px',
                padding: '24px',
                width: '90%',
                maxWidth: '500px',
                border: '1px solid var(--border)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 style={{ fontSize: '20px', fontWeight: '600', margin: '0 0 20px 0' }}>
                Create New Lecture
              </h2>
              
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: 'var(--ink)' }}>
                  Title *
                </label>
                <input
                  type="text"
                  value={newLectureTitle}
                  onChange={(e) => setNewLectureTitle(e.target.value)}
                  placeholder="Enter lecture title"
                  disabled={creating}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    background: 'var(--surface)',
                    color: 'var(--ink)',
                    fontSize: '14px',
                  }}
                  onKeyDown={(e) => {
                    // Allow standard keyboard shortcuts (Ctrl/Cmd+A, Ctrl/Cmd+C, etc.)
                    if ((e.ctrlKey || e.metaKey) && ['a', 'c', 'v', 'x'].includes(e.key.toLowerCase())) {
                      // Allow default behavior for select all, copy, paste, cut
                      return;
                    }
                    if (e.key === 'Enter' && newLectureTitle.trim() && !creating) {
                      handleCreateLecture();
                    }
                  }}
                />
              </div>

              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: 'var(--ink)' }}>
                  Description (optional)
                </label>
                <textarea
                  value={newLectureDescription}
                  onChange={(e) => setNewLectureDescription(e.target.value)}
                  placeholder="Enter lecture description"
                  disabled={creating}
                  rows={4}
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
                    fontSize: '14px',
                    fontFamily: 'inherit',
                    resize: 'vertical',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => {
                    if (!creating) {
                      setShowCreateModal(false);
                      setNewLectureTitle('');
                      setNewLectureDescription('');
                    }
                  }}
                  disabled={creating}
                  style={{
                    padding: '10px 20px',
                    background: 'transparent',
                    color: 'var(--muted)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    fontSize: '14px',
                    cursor: creating ? 'not-allowed' : 'pointer',
                    opacity: creating ? 0.5 : 1,
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateLecture}
                  disabled={!newLectureTitle.trim() || creating}
                  style={{
                    padding: '10px 20px',
                    background: newLectureTitle.trim() && !creating ? 'var(--accent)' : 'var(--muted)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: newLectureTitle.trim() && !creating ? 'pointer' : 'not-allowed',
                    opacity: newLectureTitle.trim() && !creating ? 1 : 0.5,
                  }}
                >
                  {creating ? 'Creating...' : 'Create Lecture'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

