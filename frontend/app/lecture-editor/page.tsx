'use client';

import { Suspense, useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import TurndownService from 'turndown';
import { getLecture, updateLecture, createLecture, type Lecture } from '../api-client';
import { LectureEditor } from '../components/lecture-editor/LectureEditor';
import { DocumentOutline } from '../components/lecture-editor/DocumentOutline';
import { AIChatSidebar } from '../components/lecture-editor/AIChatSidebar';
import { EnhancedToolbar } from '../components/lecture-editor/EnhancedToolbar';
import { useEditor } from '@tiptap/react';

type SaveStatus = 'saved' | 'saving' | 'error' | 'offline';

function countWords(text: string): number {
  // Strip HTML tags and count words
  const stripped = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return stripped ? stripped.split(' ').length : 0;
}

function calculateReadingTime(wordCount: number): number {
  // Average reading speed: 200-250 words per minute
  // Using 225 as average
  return Math.ceil(wordCount / 225);
}

// Initialize Turndown service for markdown conversion
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

// Custom rule for concept mentions
turndownService.addRule('conceptMention', {
  filter: (node) => {
    return (
      node.nodeName === 'SPAN' &&
      node.getAttribute('data-type') === 'conceptMention'
    );
  },
  replacement: (content, node) => {
    const label = (node as HTMLElement).getAttribute('data-label') || 'concept';
    return `@${label}`;
  },
});

function htmlToMarkdown(html: string): string {
  return turndownService.turndown(html);
}

export default function LectureEditorPage() {
  return (
    <Suspense fallback={<div style={{ padding: '40px', textAlign: 'center' }}>Loading…</div>}>
      <LectureEditorPageInner />
    </Suspense>
  );
}

function LectureEditorPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const lectureId = searchParams?.get('lectureId') ?? null;
  const returnTo = searchParams?.get('returnTo') ?? null;
  const graphId = searchParams?.get('graph_id') ?? null;
  const isNew = !lectureId;

  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wordCount, setWordCount] = useState(0);
  const [readingTime, setReadingTime] = useState(0);
  const [editor, setEditor] = useState<any>(null);
  const [activeGraphId, setActiveGraphId] = useState<string | undefined>(graphId || undefined);

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedContentRef = useRef<string>('');

  // Load active graph if not provided in URL
  useEffect(() => {
    if (graphId) {
      setActiveGraphId(graphId);
      return;
    }
    
    async function loadActiveGraph() {
      try {
        const { listGraphs } = await import('../api-client');
        const data = await listGraphs();
        setActiveGraphId(data.active_graph_id);
      } catch (err) {
        console.error('Failed to load active graph:', err);
      }
    }
    
    loadActiveGraph();
  }, [graphId]);

  // Load lecture if editing existing one
  useEffect(() => {
    if (isNew) {
      setTitle('');
      setContent('');
      setLoading(false);
      return;
    }

    async function loadLecture() {
      try {
        setLoading(true);
        const data = await getLecture(lectureId!);
        setLecture(data);
        setTitle(data.title || '');
        setContent(data.raw_text || '');
        lastSavedContentRef.current = data.raw_text || '';
        const words = countWords(data.raw_text || '');
        setWordCount(words);
        setReadingTime(calculateReadingTime(words));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load lecture');
      } finally {
        setLoading(false);
      }
    }

    loadLecture();
  }, [lectureId, isNew]);

  // Auto-save function
  const saveLecture = useCallback(
    async (titleToSave: string, contentToSave: string, immediate = false) => {
      // Clear existing timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }

      // If content hasn't changed, don't save
      if (contentToSave === lastSavedContentRef.current && titleToSave === lecture?.title) {
        return;
      }

      const doSave = async () => {
        try {
          setSaveStatus('saving');

          if (isNew) {
            // Create new lecture
            const newLecture = await createLecture({
              title: titleToSave || 'Untitled Lecture',
              raw_text: contentToSave,
            });
            setLecture(newLecture);
            // Update URL without reload
            router.replace(`/lecture-editor?lectureId=${newLecture.lecture_id}`);
            lastSavedContentRef.current = contentToSave;
            
            // Track last edited time in localStorage
            const lastEditedKey = `lecture_${newLecture.lecture_id}_last_edited`;
            localStorage.setItem(lastEditedKey, Date.now().toString());
          } else {
            // Update existing lecture
            await updateLecture(lectureId!, {
              title: titleToSave,
              raw_text: contentToSave,
            });
            lastSavedContentRef.current = contentToSave;
            
            // Track last edited time in localStorage
            const lastEditedKey = `lecture_${lectureId}_last_edited`;
            localStorage.setItem(lastEditedKey, Date.now().toString());
          }

          setSaveStatus('saved');
          const words = countWords(contentToSave);
          setWordCount(words);
          setReadingTime(calculateReadingTime(words));
        } catch (err) {
          console.error('Failed to save lecture:', err);
          setSaveStatus('error');
          // Retry after a delay
          setTimeout(() => {
            if (saveStatus !== 'offline') {
              saveLecture(titleToSave, contentToSave, true);
            }
          }, 3000);
        }
      };

      if (immediate) {
        await doSave();
      } else {
        // Debounce: wait 2 seconds after last change
        saveTimeoutRef.current = setTimeout(doSave, 2000);
      }
    },
    [isNew, lectureId, lecture?.title, router, saveStatus]
  );

  // Handle title changes
  const handleTitleChange = useCallback(
    (newTitle: string) => {
      setTitle(newTitle);
      saveLecture(newTitle, content);
    },
    [content, saveLecture]
  );

  // Handle content changes
  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
      const words = countWords(newContent);
      setWordCount(words);
      setReadingTime(calculateReadingTime(words));
      saveLecture(title, newContent);
    },
    [title, saveLecture]
  );

  // Export functions
  const handleExportMarkdown = useCallback(() => {
    const markdown = htmlToMarkdown(content);
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'lecture'}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [content, title]);

  const handleExportHTML = useCallback(() => {
    const blob = new Blob([content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'lecture'}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [content, title]);

  const handleExportPDF = useCallback(async () => {
    try {
      const { default: html2canvas } = await import('html2canvas');
      const { default: jsPDF } = await import('jspdf');

      const editorElement = document.querySelector('.lecture-editor-content');
      if (!editorElement) {
        alert('Could not find editor content');
        return;
      }

      // Show loading state
      const originalStatus = saveStatus;
      setSaveStatus('saving');

      const canvas = await html2canvas(editorElement as HTMLElement, {
        scale: 2,
        useCORS: true,
        logging: false,
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const imgWidth = 210; // A4 width in mm
      const pageHeight = 297; // A4 height in mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`${title || 'lecture'}.pdf`);
      setSaveStatus(originalStatus);
    } catch (error) {
      console.error('Failed to export PDF:', error);
      alert('Failed to export PDF. Please try again.');
      setSaveStatus('saved');
    }
  }, [content, title, saveStatus]);

  // Check online status
  useEffect(() => {
    const handleOnline = () => {
      if (saveStatus === 'offline') {
        setSaveStatus('saved');
        // Try to save any pending changes
        if (content !== lastSavedContentRef.current) {
          saveLecture(title, content, true);
        }
      }
    };

    const handleOffline = () => {
      setSaveStatus('offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [saveStatus, content, title, saveLecture]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + S: Save immediately
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (content !== lastSavedContentRef.current || title !== lecture?.title) {
          saveLecture(title, content, true);
        }
      }
      // Cmd/Ctrl + E: Export markdown
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault();
        handleExportMarkdown();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [title, content, lecture?.title, saveLecture, handleExportMarkdown]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div>Loading lecture...</div>
      </div>
    );
  }

  if (error && !isNew) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ color: 'var(--accent-2)', marginBottom: '16px' }}>{error}</div>
        <button
          onClick={() => {
            if (returnTo) {
              router.push(returnTo);
            } else {
              router.push('/reader/segment');
            }
          }}
          style={{
            color: 'var(--accent)',
            textDecoration: 'underline',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          Back to File Reader Studio
        </button>
      </div>
    );
  }

  const statusText = {
    saved: 'Saved ✓',
    saving: 'Saving...',
    error: 'Error saving',
    offline: 'Offline – changes pending',
  }[saveStatus];

  const statusColor = {
    saved: 'var(--muted)',
    saving: 'var(--accent)',
    error: 'var(--accent-2)',
    offline: 'var(--accent-2)',
  }[saveStatus];

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--background)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
          padding: '20px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '24px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: 1 }}>
          <button
            onClick={() => {
              // If returnTo is specified, use it
              if (returnTo) {
                router.push(returnTo);
              } else {
                // Try to go back in history, fallback to File Reader Studio
                if (window.history.length > 1) {
                  router.back();
                } else {
                  router.push('/reader/segment');
                }
              }
            }}
            style={{
              color: 'var(--muted)',
              textDecoration: 'none',
              fontSize: '18px',
              display: 'flex',
              alignItems: 'center',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
            }}
          >
            ←
          </button>
          <input
            type="text"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Untitled Lecture"
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--ink)',
              fontSize: '24px',
              fontWeight: 700,
              outline: 'none',
              flex: 1,
              minWidth: 0,
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            fontSize: '14px',
            color: 'var(--muted)',
          }}
        >
          <span style={{ color: statusColor }}>{statusText}</span>
          <span>{wordCount} words</span>
          {readingTime > 0 && <span>~{readingTime} min read</span>}
          <div
            style={{
              display: 'flex',
              gap: '8px',
              marginLeft: '8px',
              paddingLeft: '16px',
              borderLeft: '1px solid var(--border)',
            }}
          >
            <button
              onClick={handleExportMarkdown}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--ink)',
                cursor: 'pointer',
                fontSize: '12px',
                padding: '4px 12px',
              }}
              title="Export as Markdown"
            >
              Export MD
            </button>
            <button
              onClick={handleExportHTML}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--ink)',
                cursor: 'pointer',
                fontSize: '12px',
                padding: '4px 12px',
              }}
              title="Export as HTML"
            >
              Export HTML
            </button>
            <button
              onClick={handleExportPDF}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--ink)',
                cursor: 'pointer',
                fontSize: '12px',
                padding: '4px 12px',
              }}
              title="Export as PDF"
            >
              Export PDF
            </button>
          </div>
        </div>
      </div>

      {/* Enhanced Toolbar */}
      {editor && <EnhancedToolbar editor={editor} />}

      {/* Three-Column Layout */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
          background: 'var(--background)',
        }}
      >
        {/* Left Sidebar - Document Outline */}
        <div
          style={{
            width: '240px',
            borderRight: '1px solid var(--border)',
            background: 'var(--surface)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '16px',
              borderBottom: '1px solid var(--border)',
              fontSize: '14px',
              fontWeight: 600,
              color: 'var(--ink)',
            }}
          >
            Document Outline
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {editor && <DocumentOutline editor={editor} />}
          </div>
        </div>

        {/* Center - Editor */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: 'var(--background)',
          }}
        >
          <div
            style={{
              flex: 1,
              overflow: 'auto',
              display: 'flex',
              justifyContent: 'center',
              padding: '40px 24px',
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: '900px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                boxShadow: 'var(--shadow)',
                padding: '60px 80px',
                minHeight: '800px',
              }}
            >
              <LectureEditor
                content={content}
                onUpdate={handleContentChange}
                placeholder="Start writing your lecture..."
                graphId={activeGraphId}
                onEditorReady={setEditor}
              />
            </div>
          </div>
        </div>

        {/* Right Sidebar - AI Chat */}
        <div
          style={{
            width: '320px',
            borderLeft: '1px solid var(--border)',
            background: 'var(--surface)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <AIChatSidebar lectureId={lectureId} lectureTitle={title || 'Untitled Lecture'} />
        </div>
      </div>
    </div>
  );
}

