'use client';

import { Suspense, useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { getLecture, updateLecture, createLecture, upsertLectureBlocks, type Lecture, type LectureMention } from '../api-client';
import { extractBlocksFromEditor } from '../components/lecture-editor/blockUtils';

// Lazy load heavy dependencies
const ConceptPanel = dynamic(
  () => import('../components/lecture-editor/ConceptPanel').then(mod => ({ default: mod.ConceptPanel })),
  { ssr: false }
);

// Lazy load heavy TipTap editor components
const LectureEditor = dynamic(
  () => import('../components/lecture-editor/LectureEditor').then(mod => ({ default: mod.LectureEditor })),
  { ssr: false, loading: () => <div style={{ padding: '40px', textAlign: 'center' }}>Loading editor...</div> }
);

const DocumentOutline = dynamic(
  () => import('../components/lecture-editor/DocumentOutline').then(mod => ({ default: mod.DocumentOutline })),
  { ssr: false }
);

const AIChatSidebar = dynamic(
  () => import('../components/lecture-editor/AIChatSidebar').then(mod => ({ default: mod.AIChatSidebar })),
  { ssr: false }
);

const EnhancedToolbar = dynamic(
  () => import('../components/lecture-editor/EnhancedToolbar').then(mod => ({ default: mod.EnhancedToolbar })),
  { ssr: false }
);

// Note: useEditor is not actually used in this file, removed unused import

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

// Lazy initialize Turndown service for markdown conversion
let turndownServiceInstance: any = null;

async function getTurndownService() {
  if (!turndownServiceInstance) {
    const TurndownService = (await import('turndown')).default;
    turndownServiceInstance = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
    });
    
    // Custom rule for concept mentions
    turndownServiceInstance.addRule('conceptMention', {
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
  }
  return turndownServiceInstance;
}

async function htmlToMarkdown(html: string): Promise<string> {
  const service = await getTurndownService();
  return service.turndown(html);
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
  const [wikipediaHoverEnabled, setWikipediaHoverEnabled] = useState(true);
  const [activeMention, setActiveMention] = useState<LectureMention | null>(null);
  const [rightSidebarTab, setRightSidebarTab] = useState<'chat' | 'concept'>('chat');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const canLink = Boolean(lecture?.lecture_id || lectureId);

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

  useEffect(() => {
    setActiveMention(null);
    setRightSidebarTab('chat');
  }, [lectureId]);

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

            if (editor) {
              try {
                const blocks = extractBlocksFromEditor(editor);
                await upsertLectureBlocks(newLecture.lecture_id, blocks);
              } catch (err) {
                console.error('Failed to sync lecture blocks:', err);
              }
            }
            
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

            if (editor) {
              try {
                const blocks = extractBlocksFromEditor(editor);
                await upsertLectureBlocks(lectureId!, blocks);
              } catch (err) {
                console.error('Failed to sync lecture blocks:', err);
              }
            }
            
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
    [isNew, lectureId, lecture?.title, router, saveStatus, editor]
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

  const handleMentionClick = useCallback((mention: LectureMention) => {
    setActiveMention(mention);
    setRightSidebarTab('concept');
  }, []);

  const resolveMentionRange = useCallback(
    (mention: LectureMention) => {
      if (!editor) {
        return null;
      }
      const doc = editor.state.doc;
      let blockNode: any = null;
      let blockPos = 0;

      doc.descendants((node: any, pos: number) => {
        if (blockNode || !node.isBlock) {
          return;
        }
        if (node.attrs?.blockId === mention.block_id) {
          blockNode = node;
          blockPos = pos;
        }
      });

      if (!blockNode) {
        return null;
      }

      const text = blockNode.textContent || '';
      let start = mention.start_offset;
      let end = mention.end_offset;

      if (start < 0 || end > text.length || text.slice(start, end) !== mention.surface_text) {
        const index = text.indexOf(mention.surface_text);
        if (index === -1) {
          return null;
        }
        start = index;
        end = index + mention.surface_text.length;
      }

      let from: number | null = null;
      let to: number | null = null;
      let offset = 0;

      blockNode.descendants((node: any, pos: number) => {
        if (!node.isText) {
          return;
        }
        const length = node.text?.length ?? 0;
        const nodeStart = offset;
        const nodeEnd = offset + length;
        const absolutePos = blockPos + 1 + pos;

        if (from === null && start >= nodeStart && start <= nodeEnd) {
          from = absolutePos + (start - nodeStart);
        }
        if (to === null && end >= nodeStart && end <= nodeEnd) {
          to = absolutePos + (end - nodeStart);
        }
        offset += length;
      });

      if (from === null || to === null || from >= to) {
        return null;
      }

      return { from, to };
    },
    [editor]
  );

  const handleBacklinkClick = useCallback(
    (mention: LectureMention) => {
      if (!editor) {
        return;
      }
      const range = resolveMentionRange(mention);
      if (!range) {
        return;
      }
      setActiveMention(mention);
      editor.commands.setTextSelection(range);
      editor.view.focus();
    },
    [editor, resolveMentionRange]
  );

  // Export functions
  const handleExportMarkdown = useCallback(async () => {
    const markdown = await htmlToMarkdown(content);
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

  // Close export menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setExportMenuOpen(false);
      }
    };

    if (exportMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [exportMenuOpen]);

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
              router.push('/lecture-studio');
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
          Back to Lectures
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
      {/* Compact Header */}
      <div
        style={{
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, maxWidth: '600px' }}>
          <button
            onClick={() => {
              // If returnTo is specified, use it
              if (returnTo) {
                router.push(returnTo);
              } else {
                // Try to go back in history, fallback to Lecture Studio
                if (window.history.length > 1) {
                  router.back();
                } else {
                  router.push('/lecture-studio');
                }
              }
            }}
            style={{
              color: 'var(--muted)',
              textDecoration: 'none',
              fontSize: '16px',
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
              fontSize: '16px',
              fontWeight: 600,
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
            gap: '12px',
            fontSize: '12px',
            color: 'var(--muted)',
          }}
        >
          <span style={{ color: statusColor }}>{statusText}</span>
          <span>{wordCount} words</span>
          {readingTime > 0 && <span>~{readingTime} min</span>}
          <div
            style={{
              marginLeft: '8px',
              paddingLeft: '16px',
              borderLeft: '1px solid var(--border)',
              position: 'relative',
            }}
            ref={exportMenuRef}
          >
            <button
              onClick={() => setExportMenuOpen(!exportMenuOpen)}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--ink)',
                cursor: 'pointer',
                fontSize: '12px',
                padding: '4px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
              title="Export lecture"
            >
              Export
              <span style={{ fontSize: '10px' }}>▼</span>
            </button>
            {exportMenuOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '4px',
                  background: 'var(--panel)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  boxShadow: 'var(--shadow)',
                  zIndex: 1000,
                  minWidth: '120px',
                  overflow: 'hidden',
                }}
              >
                <button
                  onClick={() => {
                    handleExportMarkdown();
                    setExportMenuOpen(false);
                  }}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--ink)',
                    cursor: 'pointer',
                    fontSize: '12px',
                    textAlign: 'left',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  Markdown (.md)
                </button>
                <button
                  onClick={() => {
                    handleExportHTML();
                    setExportMenuOpen(false);
                  }}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--ink)',
                    cursor: 'pointer',
                    fontSize: '12px',
                    textAlign: 'left',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  HTML (.html)
                </button>
                <button
                  onClick={() => {
                    handleExportPDF();
                    setExportMenuOpen(false);
                  }}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--ink)',
                    cursor: 'pointer',
                    fontSize: '12px',
                    textAlign: 'left',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  PDF (.pdf)
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Enhanced Toolbar */}
      {editor && (
        <EnhancedToolbar
          editor={editor}
          wikipediaHoverEnabled={wikipediaHoverEnabled}
          onToggleWikipediaHover={() => setWikipediaHoverEnabled(!wikipediaHoverEnabled)}
        />
      )}

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
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              flex: 1,
              overflow: 'auto',
              display: 'flex',
              justifyContent: 'center',
              padding: '20px 24px',
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: '1200px',
                background: 'rgb(250, 248, 243)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                boxShadow: 'var(--shadow)',
                padding: '40px 50px',
                minHeight: '800px',
                color: '#000000',
              }}
              className="lecture-editor-content"
            >
              <LectureEditor
                content={content}
                onUpdate={handleContentChange}
                placeholder="Start writing your lecture..."
                graphId={activeGraphId}
                lectureId={lecture?.lecture_id || lectureId || undefined}
                onMentionClick={handleMentionClick}
                onEditorReady={setEditor}
                wikipediaHoverEnabled={wikipediaHoverEnabled}
                onToggleWikipediaHover={() => setWikipediaHoverEnabled(!wikipediaHoverEnabled)}
              />
            </div>
          </div>
        </div>

        {/* Right Sidebar - AI Chat */}
        <div
          style={{
            width: '280px',
            borderLeft: '1px solid var(--border)',
            background: 'var(--surface)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            height: '100%',
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: '8px',
              padding: '12px',
              borderBottom: '1px solid var(--border)',
            }}
          >
            {(['chat', 'concept'] as const).map((tab) => (
              <button
                key={tab}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setRightSidebarTab(tab);
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                }}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  background: rightSidebarTab === tab ? 'var(--panel)' : 'transparent',
                  color: rightSidebarTab === tab ? 'var(--ink)' : 'var(--muted)',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: rightSidebarTab === tab ? 600 : 500,
                  textTransform: 'capitalize',
                  outline: 'none',
                  userSelect: 'none',
                }}
              >
                {tab}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {rightSidebarTab === 'chat' && (
              <AIChatSidebar lectureId={lecture?.lecture_id || lectureId} lectureTitle={title || 'Untitled Lecture'} />
            )}
            {rightSidebarTab === 'concept' && (
              <>
                {activeMention ? (
                  <ConceptPanel
                    conceptId={activeMention.concept.node_id}
                    mention={activeMention}
                    onClose={() => {
                      setRightSidebarTab('chat');
                      setActiveMention(null);
                    }}
                    onBacklinkClick={handleBacklinkClick}
                  />
                ) : (
                  <div style={{ padding: '16px', color: 'var(--muted)', fontSize: '13px' }}>
                    Click a linked span to open the concept panel.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
