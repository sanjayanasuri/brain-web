'use client';

import { Suspense, useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { getLecture, updateLecture, createLecture, upsertLectureBlocks, type Lecture, type LectureMention } from '../api-client';
import { extractBlocksFromEditor } from '../components/lecture-editor/blockUtils';

// Lazy load heavy dependencies
const ConceptPanel = dynamic(
  () => import('../components/lecture-editor/ConceptPanel').then(mod => ({ default: mod.ConceptPanel })),
  { ssr: false }
);

const LectureEditor = dynamic(
  () => import('../components/lecture-editor/LectureEditor').then(mod => ({ default: mod.LectureEditor })),
  { ssr: false, loading: () => <div style={{ padding: '40px', textAlign: 'center' }}>Loading editor...</div> }
);

const DocumentOutline = dynamic(
  () => import('../components/lecture-editor/DocumentOutline').then(mod => ({ default: mod.DocumentOutline })),
  { ssr: false }
);

const FloatingChat = dynamic(
  () => import('../components/chat/FloatingChat').then(mod => ({ default: mod.FloatingChat })),
  { ssr: false }
);

const EnhancedToolbar = dynamic(
  () => import('../components/lecture-editor/EnhancedToolbar').then(mod => ({ default: mod.EnhancedToolbar })),
  { ssr: false }
);

const LinkedConceptsList = dynamic(
  () => import('../components/lecture-editor/LinkedConceptsList').then(mod => ({ default: mod.LinkedConceptsList })),
  { ssr: false }
);

const NotebookCanvas = dynamic(
  () => import('../components/notebook/NotebookCanvas').then(mod => ({ default: mod.NotebookCanvas })),
  { ssr: false, loading: () => <div style={{ padding: '40px', textAlign: 'center' }}>Loading notebook...</div> }
);

type SaveStatus = 'saved' | 'saving' | 'error' | 'offline';

function countWords(text: string): number {
  const stripped = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return stripped ? stripped.split(' ').length : 0;
}

function calculateReadingTime(wordCount: number): number {
  return Math.ceil(wordCount / 225);
}

import type { NotebookCanvasRef } from '../components/notebook/NotebookCanvas';
import type { ToolType } from '../components/notebook/InkLayer';

let turndownServiceInstance: any = null;

async function getTurndownService() {
  if (!turndownServiceInstance) {
    const TurndownService = (await import('turndown')).default;
    turndownServiceInstance = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
    });
    turndownServiceInstance.addRule('conceptMention', {
      filter: (node: any) => node.nodeName === 'SPAN' && node.getAttribute('data-type') === 'conceptMention',
      replacement: (content: any, node: any) => {
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
  const [isPencilMode, setIsPencilMode] = useState(false);
  const [chatTrigger, setChatTrigger] = useState<{ text: string, image?: string, context?: { blockId?: string; blockText?: string } } | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [paperType, setPaperType] = useState('ruled');
  const [annotations, setAnnotations] = useState<string | null>(null);
  const [useNotebookMode, setUseNotebookMode] = useState(true); // Feature flag for notebook mode

  // Handwriting tool state
  const [activeTool, setActiveTool] = useState<ToolType>('lasso');
  const [activeColor, setActiveColor] = useState('#1c1c1e');
  const [activeWidth, setActiveWidth] = useState(2.5);
  const notebookRef = useRef<NotebookCanvasRef>(null);

  const exportMenuRef = useRef<HTMLDivElement>(null);

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedContentRef = useRef<string>('');

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
        setAnnotations(data.annotations || null);
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

  const saveLecture = useCallback(
    async (titleToSave: string, contentToSave: string, annotationsToSave?: string | null, immediate = false) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      // We check if anything changed.
      const annotationsChanged = annotationsToSave !== undefined && annotationsToSave !== (lecture?.annotations || null);
      if (contentToSave === lastSavedContentRef.current && titleToSave === (lecture?.title || '') && !annotationsChanged) return;

      const doSave = async () => {
        try {
          setSaveStatus('saving');
          if (isNew) {
            const newLecture = await createLecture({
              title: titleToSave || 'Untitled Lecture',
              raw_text: contentToSave
            });
            setLecture(newLecture);
            router.replace(`/lecture-editor?lectureId=${newLecture.lecture_id}`);
            lastSavedContentRef.current = contentToSave;
            if (editor) {
              const blocks = extractBlocksFromEditor(editor);
              await upsertLectureBlocks(newLecture.lecture_id, blocks);
            }
          } else {
            await updateLecture(lectureId!, {
              title: titleToSave,
              raw_text: contentToSave,
              annotations: annotationsToSave !== undefined ? annotationsToSave : annotations
            });
            lastSavedContentRef.current = contentToSave;
            if (editor) {
              const blocks = extractBlocksFromEditor(editor);
              await upsertLectureBlocks(lectureId!, blocks);
            }
          }
          setSaveStatus('saved');
          const words = countWords(contentToSave);
          setWordCount(words);
          setReadingTime(calculateReadingTime(words));
        } catch (err) {
          setSaveStatus('error');
          setTimeout(() => saveLecture(titleToSave, contentToSave, annotationsToSave, true), 3000);
        }
      };

      if (immediate) await doSave();
      else saveTimeoutRef.current = setTimeout(doSave, 2000);
    },
    [isNew, lectureId, lecture?.title, lecture?.annotations, router, editor, annotations]
  );

  const handleTitleChange = useCallback((newTitle: string) => {
    setTitle(newTitle);
    saveLecture(newTitle, content, annotations);
  }, [content, annotations, saveLecture]);

  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);
    saveLecture(title, newContent, annotations);
  }, [title, annotations, saveLecture]);

  const handleAnnotationsChange = useCallback((newAnnotations: string) => {
    setAnnotations(newAnnotations);
    saveLecture(title, content, newAnnotations);
  }, [title, content, saveLecture]);

  const handleMentionClick = useCallback((mention: LectureMention) => {
    setActiveMention(mention);
    setRightSidebarTab('concept');
  }, []);

  const handleExportHTML = useCallback(() => {
    const blob = new Blob([content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title || 'lecture'}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [content, title]);

  const handleExportPDF = useCallback(async () => {
    try {
      const { default: html2canvas } = await import('html2canvas');
      const { default: jsPDF } = await import('jspdf');

      if (useNotebookMode) {
        // Find all page containers
        const pageElements = document.querySelectorAll('[id^="page-container-"]');
        if (pageElements.length === 0) return;

        const pdf = new jsPDF('p', 'mm', 'a4', true);

        for (let i = 0; i < pageElements.length; i++) {
          const el = pageElements[i] as HTMLElement;
          // Temporarily remove spacing and zoom for capture
          const canvas = await html2canvas(el, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff'
          });
          const imgData = canvas.toDataURL('image/png');

          if (i > 0) pdf.addPage();
          pdf.addImage(imgData, 'PNG', 0, 0, 210, 297, undefined, 'FAST');
        }

        pdf.save(`${title || 'notebook'}.pdf`);
      } else {
        const el = document.querySelector('.lecture-editor-content');
        if (!el) return;
        const canvas = await html2canvas(el as HTMLElement, { scale: 2 });
        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF('p', 'mm', 'a4');
        pdf.addImage(imgData, 'PNG', 0, 0, 210, (canvas.height * 210) / canvas.width);
        pdf.save(`${title || 'lecture'}.pdf`);
      }
    } catch (e) {
      console.error('PDF Export failed:', e);
    }
  }, [title, useNotebookMode]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    if (exportMenuOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [exportMenuOpen]);

  if (loading && lectureId) {
    return (
      <div style={{
        height: '100vh',
        background: 'var(--background)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--muted)',
        fontSize: '14px'
      }}>
        Loading lecture details...
      </div>
    );
  }


  const statusText = { saved: 'Saved ✓', saving: 'Saving...', error: 'Error', offline: 'Offline' }[saveStatus];
  const statusColor = { saved: 'var(--muted)', saving: 'var(--accent)', error: 'var(--accent-2)', offline: 'var(--accent-2)' }[saveStatus];

  return (
    <div style={{
      height: '100dvh',
      overflow: 'hidden',
      background: isPencilMode ? (paperType === 'dark' ? '#1a1a1e' : '#e8e8e8') : 'var(--background)',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Dynamic Header */}
      {!isPencilMode && (
        <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)', padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', transition: 'all 0.3s ease' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
            <button onClick={() => router.back()} style={{ color: 'var(--muted)', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '16px' }}>←</button>
            <input
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Untitled Lecture"
              style={{ border: 'none', background: 'transparent', color: 'var(--ink)', fontSize: '16px', fontWeight: 600, outline: 'none', flex: 1 }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px', color: 'var(--muted)' }}>
            <span style={{ color: statusColor }}>{statusText}</span>
            <div style={{ position: 'relative' }} ref={exportMenuRef}>
              <button onClick={() => setExportMenuOpen(!exportMenuOpen)} style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--ink)', padding: '4px 12px', cursor: 'pointer' }}>Export ▼</button>
              {exportMenuOpen && (
                <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '6px', boxShadow: 'var(--shadow)', zIndex: 1000, minWidth: '120px' }}>
                  <button onClick={handleExportHTML} style={{ width: '100%', padding: '8px 12px', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', fontSize: '12px' }}>HTML (.html)</button>
                  <button onClick={handleExportPDF} style={{ width: '100%', padding: '8px 12px', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', fontSize: '12px' }}>PDF (.pdf)</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Floating Enhanced Toolbar */}
      <div style={{
        position: isPencilMode ? 'fixed' : 'relative',
        top: isPencilMode ? '20px' : '0',
        left: isPencilMode ? 'auto' : 'auto',
        right: isPencilMode ? '20px' : 'auto',
        zIndex: 1100,
        transition: 'all 0.3s ease',
        background: isPencilMode ? 'transparent' : 'var(--surface)',
        borderBottom: isPencilMode ? 'none' : '1px solid var(--border)',
        minHeight: '48px' // Maintain height even if loading
      }}>
        <EnhancedToolbar
          editor={editor}
          wikipediaHoverEnabled={wikipediaHoverEnabled}
          onToggleWikipediaHover={() => setWikipediaHoverEnabled(!wikipediaHoverEnabled)}
          isPencilMode={isPencilMode}
          onTogglePencilMode={() => setIsPencilMode(!isPencilMode)}
          paperType={paperType}
          onPaperTypeChange={setPaperType}
          activeTool={activeTool}
          onToolChange={setActiveTool}
          activeColor={activeColor}
          onColorChange={setActiveColor}
          activeWidth={activeWidth}
          onWidthChange={setActiveWidth}
          onUndo={() => notebookRef.current?.undo()}
          onRedo={() => notebookRef.current?.redo()}
        />
      </div>

      {/* Main Container */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Outline Sidebar */}
        {!isPencilMode && (
          <div style={{
            width: 'clamp(180px, 18%, 240px)',
            borderRight: '1px solid var(--border)',
            background: 'var(--surface)',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: '13px', fontWeight: 600 }}>Outline</div>
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
              <div style={{ borderBottom: '1px solid var(--border)' }}>
                <DocumentOutline editor={editor} content={content} />
              </div>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: '13px', fontWeight: 600, background: 'var(--surface)' }}>
                Linked Concepts
              </div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                <LinkedConceptsList lectureId={lecture?.lecture_id || lectureId || undefined} editor={editor} content={content} />
              </div>
            </div>
          </div>
        )}

        {/* Editor Slate */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
          {useNotebookMode ? (
            /* Notebook Mode - Paginated ruled paper */
            <NotebookCanvas
              ref={notebookRef}
              initialContent={content}
              initialAnnotations={annotations || undefined}
              onContentChange={handleContentChange}
              onAnnotationsChange={handleAnnotationsChange}
              onEditorReady={setEditor}
              isPencilMode={isPencilMode}
              paperType={paperType as 'ruled' | 'grid' | 'blank' | 'dotted' | 'dark'}
              lectureId={lecture?.lecture_id || lectureId || undefined}
              tool={activeTool}
              color={activeColor}
              width={activeWidth}
            />
          ) : (
            /* Unified Editor View */
            <div style={{
              flex: 1,
              overflowY: 'auto',
              overflowX: 'hidden',
              display: 'flex',
              justifyContent: 'center',
              padding: '20px clamp(10px, 3vw, 24px)',
              background: 'transparent'
            }}>
              <div
                className={`lecture-editor-content paper-texture paper-${paperType} ${paperType === 'ruled' ? 'paper-margin' : ''}`}
                style={{
                  width: '90%',
                  maxWidth: '1400px',
                  background: 'rgb(250, 248, 243)',
                  padding: '60px clamp(40px, 5vw, 100px)',
                  minHeight: '1000px',
                  borderRadius: '12px',
                  boxShadow: 'var(--shadow)',
                  transform: `scale(${zoomLevel})`,
                  transformOrigin: 'top center',
                  transition: 'transform 0.2s ease',
                  zIndex: 1,
                  marginBottom: '100px'
                }}
              >
                <LectureEditor
                  content={content}
                  onUpdate={handleContentChange}
                  placeholder="Start typing..."
                  graphId={activeGraphId}
                  lectureId={lecture?.lecture_id || lectureId || undefined}
                  onMentionClick={handleMentionClick}
                  onEditorReady={(ed) => {
                    setEditor(ed);
                    setTimeout(() => ed?.commands.focus('start'), 100);
                  }}
                  isPencilMode={isPencilMode}
                  onTogglePencilMode={() => setIsPencilMode(!isPencilMode)}
                  onChatTrigger={(text, image, context) => setChatTrigger({ text, image, context })}
                  annotations={annotations}
                  onAnnotationsChange={handleAnnotationsChange}
                  paperType={paperType}
                />
              </div>
            </div>
          )}

          {/* Zoom Control UI - Fixed Bottom Left */}
          {!useNotebookMode && (
            <div style={{
              position: 'fixed',
              bottom: '24px',
              left: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              zIndex: 1200,
              background: 'var(--panel)',
              padding: '4px',
              borderRadius: '24px',
              boxShadow: 'var(--shadow)',
              border: '1px solid var(--border)'
            }}>
              <button onClick={() => setZoomLevel(prev => Math.min(prev + 0.1, 2.0))} style={zoomBtnStyle}>+</button>
              <div style={{ padding: '4px 0', fontSize: '11px', textAlign: 'center', fontWeight: 'bold', color: 'var(--ink)' }}>{Math.round(zoomLevel * 100)}%</div>
              <button onClick={() => setZoomLevel(prev => Math.max(prev - 0.1, 0.5))} style={zoomBtnStyle}>−</button>
            </div>
          )}
        </div>

        {/* Right Sidebar - Chat & Tools */}
        <div style={{
          width: 'clamp(280px, 25%, 360px)',
          borderLeft: '1px solid var(--border)',
          background: 'var(--surface)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 10
        }}>
          <FloatingChat
            lectureId={lecture?.lecture_id || lectureId}
            lectureTitle={title}
            triggerMessage={chatTrigger}
            onTriggerProcessed={() => setChatTrigger(null)}
            isSidebar={true}
          />
        </div>
      </div>
    </div>
  );
}

const zoomBtnStyle: React.CSSProperties = {
  width: '36px', height: '36px', borderRadius: '50%', border: '1px solid rgba(0,0,0,0.1)',
  background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(10px)', color: '#333',
  fontSize: '20px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
};
