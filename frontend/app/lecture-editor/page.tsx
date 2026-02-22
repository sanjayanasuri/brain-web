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
  const [viewportWidth, setViewportWidth] = useState(1440);
  const [viewportHeight, setViewportHeight] = useState(900);
  const [showOutlineSidebar, setShowOutlineSidebar] = useState(true);
  const [showChatSidebar, setShowChatSidebar] = useState(true);
  const [overlayPanel, setOverlayPanel] = useState<'outline' | 'chat' | null>(null);

  // Handwriting tool state
  const [activeTool, setActiveTool] = useState<ToolType>('lasso');
  const [activeColor, setActiveColor] = useState('#1c1c1e');
  const [activeWidth, setActiveWidth] = useState(2.5);
  const notebookRef = useRef<NotebookCanvasRef>(null);

  const exportMenuRef = useRef<HTMLDivElement>(null);

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedContentRef = useRef<string>('');
  const isSavingRef = useRef<boolean>(false);
  const lastLayoutPresetRef = useRef<string | null>(null);

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
      const titleChanged = titleToSave !== (lecture?.title || '');
      const contentChanged = contentToSave !== lastSavedContentRef.current;

      if (!contentChanged && !titleChanged && !annotationsChanged) return;

      const doSave = async () => {
        if (isSavingRef.current) return;
        try {
          isSavingRef.current = true;
          setSaveStatus('saving');
          if (isNew) {
            const newLecture = await createLecture({
              title: titleToSave || 'Untitled Lecture',
              raw_text: contentToSave
            });
            lastSavedContentRef.current = contentToSave;
            setLecture(newLecture);
            // Navigate without full reload and mark as not new
            router.replace(`/lecture-editor?lectureId=${newLecture.lecture_id}`, { scroll: false });

            if (editor) {
              const blocks = extractBlocksFromEditor(editor);
              await upsertLectureBlocks(newLecture.lecture_id, blocks);
            }
          } else {
            const updatedLecture = await updateLecture(lectureId!, {
              title: titleToSave,
              raw_text: contentToSave,
              annotations: annotationsToSave !== undefined ? annotationsToSave : annotations
            });
            setLecture(updatedLecture);
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
          // Retry logic (only if not already retrying from elsewhere)
          setTimeout(() => {
            isSavingRef.current = false;
            saveLecture(titleToSave, contentToSave, annotationsToSave, true);
          }, 3000);
        } finally {
          isSavingRef.current = false;
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

  useEffect(() => {
    const isLandscapeViewport = viewportWidth >= viewportHeight;
    const tier =
      viewportWidth >= 1560 ? 'wide' :
        viewportWidth >= 1280 ? 'desktop' :
          viewportWidth >= 900 ? 'tablet' : 'mobile';
    const iPadBand = viewportWidth >= 744 && viewportWidth <= 1366;
    const iPadOrientation = iPadBand ? (isLandscapeViewport ? 'landscape' : 'portrait') : 'none';
    const presetKey = `${tier}:${iPadOrientation}:${isPencilMode ? 'pencil' : 'text'}`;

    if (lastLayoutPresetRef.current === presetKey) return;
    lastLayoutPresetRef.current = presetKey;

    if (isPencilMode) {
      setShowOutlineSidebar(false);
      setShowChatSidebar(false);
      setOverlayPanel(null);
      return;
    }

    if (tier === 'wide') {
      setShowOutlineSidebar(true);
      setShowChatSidebar(true);
      setOverlayPanel(null);
      return;
    }

    if (tier === 'desktop') {
      setShowOutlineSidebar(false);
      setShowChatSidebar(true);
      setOverlayPanel(null);
      return;
    }

    setShowOutlineSidebar(false);
    setShowChatSidebar(false);
    setOverlayPanel(null);
  }, [viewportWidth, viewportHeight, isPencilMode]);

  useEffect(() => {
    const tier =
      viewportWidth >= 1560 ? 'wide' :
        viewportWidth >= 1280 ? 'desktop' :
          viewportWidth >= 900 ? 'tablet' : 'mobile';
    const inlineOutlineAvailable = !isPencilMode && tier === 'wide';
    const inlineChatAvailable = !isPencilMode && (tier === 'wide' || tier === 'desktop');

    if (overlayPanel === 'outline' && inlineOutlineAvailable && showOutlineSidebar) {
      setOverlayPanel(null);
    }

    if (overlayPanel === 'chat' && inlineChatAvailable && showChatSidebar) {
      setOverlayPanel(null);
    }
  }, [viewportWidth, viewportHeight, isPencilMode, overlayPanel, showOutlineSidebar, showChatSidebar]);

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
  const layoutTier =
    viewportWidth >= 1560 ? 'wide' :
      viewportWidth >= 1280 ? 'desktop' :
        viewportWidth >= 900 ? 'tablet' : 'mobile';
  const isLandscapeViewport = viewportWidth >= viewportHeight;
  const isIPadPortrait = viewportWidth >= 744 && viewportWidth <= 1100 && !isLandscapeViewport;
  const isIPadLandscape = viewportWidth >= 900 && viewportWidth <= 1366 && isLandscapeViewport;
  const isCompactScreen = layoutTier === 'tablet' || layoutTier === 'mobile';
  const canShowInlineOutline = !isPencilMode && layoutTier === 'wide';
  const canShowInlineChat = !isPencilMode && (layoutTier === 'wide' || layoutTier === 'desktop');
  const showInlineOutline = canShowInlineOutline && showOutlineSidebar;
  const showInlineChat = canShowInlineChat && showChatSidebar;
  const showOverlayPanel = overlayPanel !== null;
  const overlayAsBottomSheet = layoutTier === 'mobile' || isIPadPortrait;
  const pencilTopInset = isIPadPortrait
    ? 'calc(env(safe-area-inset-top, 0px) + 132px)'
    : viewportWidth < 900
      ? 'calc(env(safe-area-inset-top, 0px) + 116px)'
      : isIPadLandscape
        ? 'calc(env(safe-area-inset-top, 0px) + 82px)'
        : 'calc(env(safe-area-inset-top, 0px) + 88px)';
  const inlineChatWidth = isIPadLandscape
    ? 'clamp(300px, 24vw, 340px)'
    : 'clamp(300px, 26vw, 380px)';
  const headerActionsStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    color: 'var(--muted)',
    flexWrap: 'wrap',
    justifyContent: isIPadPortrait ? 'space-between' : 'flex-end',
    flex: isIPadPortrait ? '1 1 100%' : '0 1 auto',
  };
  const overlayPanelStyle: React.CSSProperties = overlayAsBottomSheet
    ? {
      position: 'absolute',
      right: 'max(8px, env(safe-area-inset-right, 0px))',
      left: 'max(8px, env(safe-area-inset-left, 0px))',
      bottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)',
      height: isPencilMode ? 'min(56%, calc(100% - 20px))' : (isIPadPortrait ? 'min(62%, calc(100% - 20px))' : 'min(70%, calc(100% - 20px))'),
      maxHeight: 'calc(100% - 16px)',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: '16px',
      boxShadow: 'var(--shadow)',
      overflow: 'hidden',
      zIndex: 50,
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
    }
    : {
      position: 'absolute',
      top: isPencilMode ? '12px' : '8px',
      right: 'max(8px, env(safe-area-inset-right, 0px))',
      bottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)',
      width: overlayPanel === 'chat'
        ? (isIPadLandscape ? 'min(480px, calc(100% - 16px))' : 'min(420px, calc(100% - 16px))')
        : (isIPadLandscape ? 'min(420px, calc(100% - 16px))' : 'min(360px, calc(100% - 16px))'),
      maxWidth: 'calc(100% - 16px)',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: '14px',
      boxShadow: 'var(--shadow)',
      overflow: 'hidden',
      zIndex: 50,
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
    };
  const unifiedEditorPadding = isIPadPortrait
    ? '14px 10px 20px'
    : isIPadLandscape
      ? '18px 16px 24px'
      : isCompactScreen
        ? '16px 12px 24px'
        : '20px clamp(10px, 3vw, 24px)';
  const unifiedPaperPadding = isIPadPortrait
    ? '28px clamp(14px, 3vw, 20px)'
    : isIPadLandscape
      ? '40px clamp(24px, 4vw, 44px)'
      : isCompactScreen
        ? '36px clamp(18px, 4vw, 28px)'
        : '60px clamp(40px, 5vw, 100px)';

  const toggleOutlinePanel = () => {
    if (isPencilMode) return;
    if (canShowInlineOutline) {
      setShowOutlineSidebar(prev => !prev);
      setOverlayPanel(null);
      return;
    }
    setOverlayPanel(prev => prev === 'outline' ? null : 'outline');
  };

  const toggleChatPanel = () => {
    if (canShowInlineChat) {
      setShowChatSidebar(prev => !prev);
      setOverlayPanel(null);
      return;
    }
    setOverlayPanel(prev => prev === 'chat' ? null : 'chat');
  };

  const renderOutlineSidebar = () => (
    <>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: '13px', fontWeight: 600 }}>Outline</div>
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ borderBottom: '1px solid var(--border)' }}>
          <DocumentOutline editor={editor} content={content} />
        </div>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: '13px', fontWeight: 600, background: 'var(--surface)' }}>
          Linked Concepts
        </div>
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          <LinkedConceptsList lectureId={lecture?.lecture_id || lectureId || undefined} editor={editor} content={content} />
        </div>
      </div>
    </>
  );

  const renderChatSidebar = () => (
    <FloatingChat
      lectureId={lecture?.lecture_id || lectureId}
      lectureTitle={title}
      triggerMessage={chatTrigger}
      onTriggerProcessed={() => setChatTrigger(null)}
      isSidebar={true}
    />
  );

  const panelToggleButton = (active: boolean): React.CSSProperties => ({
    background: active ? 'rgba(37, 99, 235, 0.10)' : 'transparent',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    color: active ? 'var(--accent)' : 'var(--ink)',
    padding: '4px 10px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  });

  return (
    <div style={{
      height: '100dvh',
      minHeight: '100svh',
      overflow: 'hidden',
      background: isPencilMode ? (paperType === 'dark' ? '#1a1a1e' : '#e8e8e8') : 'var(--background)',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative'
    }}>
      {/* Dynamic Header */}
      {!isPencilMode && (
        <div style={{
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
          paddingRight: 'max(12px, env(safe-area-inset-right, 0px))',
          paddingBottom: '8px',
          paddingLeft: 'max(12px, env(safe-area-inset-left, 0px))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          flexWrap: 'wrap',
          transition: 'all 0.3s ease'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 280px', minWidth: 0 }}>
            <button onClick={() => router.back()} style={{ color: 'var(--muted)', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '16px' }}>←</button>
            <input
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Untitled Lecture"
              style={{ border: 'none', background: 'transparent', color: 'var(--ink)', fontSize: '16px', fontWeight: 600, outline: 'none', flex: 1, minWidth: 0 }}
            />
          </div>
          <div style={headerActionsStyle}>
            <button
              onClick={toggleOutlinePanel}
              style={panelToggleButton(showInlineOutline || overlayPanel === 'outline')}
              title={showInlineOutline ? 'Hide outline sidebar' : 'Show outline panel'}
            >
              Outline
            </button>
            <button
              onClick={toggleChatPanel}
              style={panelToggleButton(showInlineChat || overlayPanel === 'chat')}
              title={showInlineChat ? 'Hide study assistant sidebar' : 'Show study assistant'}
            >
              Assistant
            </button>
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
        top: isPencilMode ? 'calc(env(safe-area-inset-top, 0px) + 8px)' : '0',
        left: isPencilMode ? 'max(12px, env(safe-area-inset-left, 0px))' : '0',
        right: isPencilMode ? 'max(12px, env(safe-area-inset-right, 0px))' : '0',
        zIndex: 1100,
        transition: 'all 0.3s ease',
        background: isPencilMode ? 'rgba(255,255,255,0.92)' : 'var(--surface)',
        borderBottom: isPencilMode ? 'none' : '1px solid var(--border)',
        minHeight: '48px', // Maintain height even if loading
        borderRadius: isPencilMode ? '14px' : 0,
        boxShadow: isPencilMode ? '0 10px 28px rgba(0,0,0,0.12)' : 'none',
        border: isPencilMode ? '1px solid rgba(0,0,0,0.06)' : 'none',
        backdropFilter: isPencilMode ? 'blur(12px)' : undefined,
        overflowX: isPencilMode || isIPadPortrait ? 'auto' : 'visible'
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
      <div style={{
        flex: 1,
        display: 'flex',
        overflow: 'hidden',
        position: 'relative',
        minHeight: 0,
        paddingTop: isPencilMode ? pencilTopInset : 0,
        boxSizing: 'border-box'
      }}>

        {/* Outline Sidebar */}
        {showInlineOutline && (
          <div style={{
            width: 'clamp(220px, 22vw, 300px)',
            borderRight: '1px solid var(--border)',
            background: 'var(--surface)',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            flexShrink: 0
          }}>
            {renderOutlineSidebar()}
          </div>
        )}

        {/* Editor Slate */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
          {isPencilMode && !showInlineChat && (
            <div style={{
              position: 'absolute',
              top: '12px',
              left: '12px',
              zIndex: 30,
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
              paddingTop: 'env(safe-area-inset-top, 0px)'
            }}>
              <button
                onClick={toggleChatPanel}
                style={{
                  ...panelToggleButton(overlayPanel === 'chat'),
                  background: 'rgba(255,255,255,0.95)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.12)'
                }}
              >
                Assistant
              </button>
            </div>
          )}

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
              padding: unifiedEditorPadding,
              background: 'transparent'
            }}>
              <div
                className={`lecture-editor-content paper-texture paper-${paperType} ${paperType === 'ruled' ? 'paper-margin' : ''}`}
                style={{
                  width: isCompactScreen ? '100%' : '92%',
                  maxWidth: showInlineChat || showInlineOutline ? '1400px' : '1600px',
                  background: 'rgb(250, 248, 243)',
                  padding: unifiedPaperPadding,
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
              bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
              left: 'max(12px, env(safe-area-inset-left, 0px))',
              display: 'flex',
              flexDirection: isCompactScreen ? 'row' : 'column',
              alignItems: 'center',
              gap: isCompactScreen ? '6px' : '8px',
              zIndex: 1200,
              background: 'var(--panel)',
              padding: isCompactScreen ? '4px 8px' : '4px',
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
        {showInlineChat && (
          <div style={{
            width: inlineChatWidth,
            borderLeft: '1px solid var(--border)',
            background: 'var(--surface)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 10,
            minHeight: 0,
            flexShrink: 0
          }}>
            {renderChatSidebar()}
          </div>
        )}

        {showOverlayPanel && (
          <>
            <button
              type="button"
              aria-label="Close panel"
              onClick={() => setOverlayPanel(null)}
              style={{
                position: 'absolute',
                inset: 0,
                border: 'none',
                background: 'rgba(15, 23, 42, 0.20)',
                backdropFilter: 'blur(2px)',
                zIndex: 40,
                cursor: 'pointer',
                padding: 0,
              }}
            />
            <div style={overlayPanelStyle}>
              <div style={{
                padding: '10px 12px',
                borderBottom: '1px solid var(--border)',
                background: 'var(--panel)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px'
              }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>
                  {overlayPanel === 'outline' ? 'Outline & Concepts' : 'Study Assistant'}
                </div>
                <button
                  onClick={() => setOverlayPanel(null)}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    color: 'var(--muted)',
                    padding: '4px 8px',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  Close
                </button>
              </div>
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                {overlayPanel === 'outline' ? renderOutlineSidebar() : renderChatSidebar()}
              </div>
            </div>
          </>
        )}
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
