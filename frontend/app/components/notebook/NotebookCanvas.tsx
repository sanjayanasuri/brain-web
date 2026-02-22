'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { NotebookPage } from './NotebookPage';
import { LineAlignedEditor } from './LineAlignedEditor';
import { splitContentIntoPages, mergePages } from './pageBreakUtils';
import { type Stroke, type ToolType } from './InkLayer';
import { updateNotebookPage } from '../../api/lectures';

// Simple debounce utility to avoid external dependency issues
function simpleDebounce<T extends (...args: any[]) => any>(func: T, wait: number) {
    let timeout: NodeJS.Timeout | null = null;
    return function (this: any, ...args: Parameters<T>) {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

interface PageData {
    id: string;
    pageNumber: number;
    content: string;
    inkData: Stroke[]; // Strokes for handwriting
}

interface NotebookCanvasProps {
    initialContent?: string;
    initialAnnotations?: string; // JSON string of strokes
    onContentChange?: (content: string) => void;
    onAnnotationsChange?: (annotations: string) => void;
    paperType?: 'ruled' | 'grid' | 'blank' | 'dotted' | 'dark';
    lectureId?: string;
    tool: ToolType;
    color: string;
    width: number;
    readOnly?: boolean;
    onEditorReady?: (editor: any) => void;
    isPencilMode?: boolean;
}

export interface NotebookCanvasRef {
    undo: () => void;
    redo: () => void;
}

export const NotebookCanvas = React.forwardRef<NotebookCanvasRef, NotebookCanvasProps>(({
    initialContent = '',
    initialAnnotations,
    onContentChange,
    onAnnotationsChange,
    paperType = 'ruled',
    lectureId,
    tool,
    color,
    width,
    readOnly = false,
    onEditorReady,
    isPencilMode = false,
}, ref) => {
    const [pages, setPages] = useState<PageData[]>([
        {
            id: 'page-1',
            pageNumber: 1,
            content: '',
            inkData: [],
        },
    ]);
    const [zoom, setZoom] = useState(0.75);
    const [editors, setEditors] = useState<Map<string, any>>(new Map());
    const [isUpdatingFromPagination, setIsUpdatingFromPagination] = useState(false);
    const [currentPageIndex, setCurrentPageIndex] = useState(0);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [history, setHistory] = useState<PageData[][]>([]);
    const [redoStack, setRedoStack] = useState<PageData[][]>([]);
    const [containerWidth, setContainerWidth] = useState(0);

    // Debounced save for individual pages
    const debouncedSavePage = useMemo(
        () => simpleDebounce(async (lId: string, pData: PageData) => {
            if (!lId) return;
            setSaveStatus('saving');
            try {
                await updateNotebookPage(lId, {
                    page_number: pData.pageNumber,
                    content: pData.content,
                    ink_data: pData.inkData,
                    paper_type: paperType
                });
                setSaveStatus('saved');
                setTimeout(() => setSaveStatus('idle'), 2000);
            } catch (err) {
                console.error('Failed to save page:', err);
                setSaveStatus('error');
            }
        }, 1000),
        [paperType]
    );

    // Track current page on scroll (inside the notebook scroll container, not window)
    useEffect(() => {
        const handleScroll = () => {
            const scrollContainer = scrollContainerRef.current;
            if (!scrollContainer) return;

            const pageElements = pages.map(p => document.getElementById(`page-container-${p.id}`));
            const containerRect = scrollContainer.getBoundingClientRect();
            const thresholdY = containerRect.top + containerRect.height / 3;

            for (let i = pageElements.length - 1; i >= 0; i--) {
                const el = pageElements[i];
                if (el && el.getBoundingClientRect().top <= thresholdY) {
                    if (currentPageIndex !== i) {
                        setCurrentPageIndex(i);
                        // Expose the editor of the current page to the parent
                        const page = pages[i];
                        if (page && editors.has(page.id) && onEditorReady) {
                            onEditorReady(editors.get(page.id));
                        }
                    }
                    break;
                }
            }
        };

        const scrollContainer = scrollContainerRef.current;
        if (!scrollContainer) return;

        handleScroll();
        scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
        window.addEventListener('resize', handleScroll);

        return () => {
            scrollContainer.removeEventListener('scroll', handleScroll);
            window.removeEventListener('resize', handleScroll);
        };
    }, [pages, editors, currentPageIndex, onEditorReady]);

    // Use a ref to track what's currently loaded to prevent infinite loops but allow switching lectures
    const loadedLectureIdRef = useRef<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Auto-zoom to fit width
    useEffect(() => {
        if (!containerRef.current) return;

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const width = entry.contentRect.width;
                setContainerWidth(width);
                // 816 is page width, 40 is total padding (20px * 2)
                // We add a tiny buffer (-10) to avoid scrollbar flickering
                const paddingAllowance = width < 900 ? 28 : width < 1180 ? 36 : 50;
                const targetZoom = Math.max(0.55, Math.min(1.0, (width - paddingAllowance) / 816));
                // Only update if significantly different to avoid loops
                setZoom(prev => Math.abs(prev - targetZoom) > 0.01 ? targetZoom : prev);
            }
        });

        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
    }, []);

    // Initialize pages from initial content and annotations
    useEffect(() => {
        // Only re-initialize if we haven't loaded this lecture yet, or if it's a new lecture (null id)
        // and we have content to show (or it's explicitly resetting to empty)
        const currentId = lectureId || 'new';
        if (currentId !== loadedLectureIdRef.current || (lectureId === null && pages.length === 0)) {
            const result = splitContentIntoPages(initialContent || '');

            let initialStrokes: Stroke[] = [];
            if (initialAnnotations) {
                try {
                    initialStrokes = JSON.parse(initialAnnotations);
                } catch (e) {
                    console.error("Failed to parse initial annotations", e);
                }
            }

            const newPages = result.pages.map((content, index) => ({
                id: `page-${index + 1}`,
                pageNumber: index + 1,
                content,
                // TODO: In the future, annotations should be per-page. For now, flat list on first page.
                inkData: index === 0 ? initialStrokes : [],
            }));

            if (newPages.length === 0) {
                newPages.push({
                    id: 'page-1',
                    pageNumber: 1,
                    content: '',
                    inkData: [],
                });
            }

            setPages(newPages);
            loadedLectureIdRef.current = lectureId || 'new';
        }
    }, [initialContent, initialAnnotations, lectureId]);

    // Automatically paginate when content changes
    const handlePageContentChange = useCallback(
        (pageId: string, newContent: string) => {
            setPages((prevPages) => {
                // Update the specific page
                const updatedPages = prevPages.map((page) =>
                    page.id === pageId ? { ...page, content: newContent } : page
                );

                // Merge all page content
                const combinedContent = mergePages(updatedPages.map((p) => p.content));

                // Re-paginate the combined content
                const result = splitContentIntoPages(combinedContent);

                // Create new pages array
                const newPages = result.pages.map((content, index) => {
                    // Find if we have existing page data for this index
                    const existingPage = updatedPages[index];
                    return {
                        id: `page-${index + 1}`,
                        pageNumber: index + 1,
                        content,
                        inkData: existingPage?.inkData || [],
                    };
                });

                // Ensure at least one page
                if (newPages.length === 0) {
                    newPages.push({
                        id: 'page-1',
                        pageNumber: 1,
                        content: '',
                        inkData: [],
                    });
                }

                // Notify parent of combined content
                if (onContentChange) {
                    onContentChange(combinedContent);
                }

                // Trigger debounced save for any page that changed
                if (lectureId) {
                    newPages.forEach(p => {
                        const originalPage = prevPages.find(op => op.pageNumber === p.pageNumber);
                        if (!originalPage || originalPage.content !== p.content) {
                            debouncedSavePage(lectureId, p);
                        }
                    });
                }

                return newPages;
            });
        },
        [onContentChange, lectureId, debouncedSavePage]
    );

    const handlePageStrokesChange = useCallback((pageId: string, strokes: Stroke[]) => {
        setPages(prevPages => {
            // Push current state to history before updating
            setHistory(prev => [...prev.slice(-19), prevPages]); // Keep last 20 states
            setRedoStack([]); // Clear redo stack on new action

            const newPages = prevPages.map(page =>
                page.id === pageId ? { ...page, inkData: strokes } : page
            );

            // Notify parent of combined annotations
            if (onAnnotationsChange) {
                const allStrokes = newPages.flatMap(p => p.inkData);
                onAnnotationsChange(JSON.stringify(allStrokes));
            }

            // Trigger debounced save for the specific page
            const updatedPage = newPages.find(p => p.id === pageId);
            if (updatedPage && lectureId) {
                debouncedSavePage(lectureId, updatedPage);
            }

            return newPages;
        });
    }, [onAnnotationsChange, lectureId, debouncedSavePage]);

    const undo = useCallback(() => {
        setHistory(prev => {
            if (prev.length === 0) return prev;
            const lastState = prev[prev.length - 1];
            const newHistory = prev.slice(0, -1);

            setPages(currentPages => {
                setRedoStack(redo => [...redo, currentPages]);

                // Trigger save for changed pages in the undone state
                if (lectureId) {
                    lastState.forEach(p => {
                        const current = currentPages.find(cp => cp.pageNumber === p.pageNumber);
                        if (!current || JSON.stringify(current.inkData) !== JSON.stringify(p.inkData)) {
                            debouncedSavePage(lectureId, p);
                        }
                    });
                }

                return lastState;
            });

            return newHistory;
        });
    }, [lectureId, debouncedSavePage]);

    const redo = useCallback(() => {
        setRedoStack(prev => {
            if (prev.length === 0) return prev;
            const nextState = prev[prev.length - 1];
            const newRedo = prev.slice(0, -1);

            setPages(currentPages => {
                setHistory(history => [...history, currentPages]);

                // Trigger save for changed pages in the redone state
                if (lectureId) {
                    nextState.forEach(p => {
                        const current = currentPages.find(cp => cp.pageNumber === p.pageNumber);
                        if (!current || JSON.stringify(current.inkData) !== JSON.stringify(p.inkData)) {
                            debouncedSavePage(lectureId, p);
                        }
                    });
                }

                return nextState;
            });

            return newRedo;
        });
    }, [lectureId, debouncedSavePage]);

    React.useImperativeHandle(ref, () => ({
        undo,
        redo,
    }));

    const handleEditorReady = useCallback((pageId: string, editor: any) => {
        setEditors((prev) => {
            const newMap = new Map(prev);
            newMap.set(pageId, editor);
            // If this is the first editor ready, or if we don't have an active one yet, expose it
            if (newMap.size === 1 && onEditorReady) {
                onEditorReady(editor);
            }
            return newMap;
        });
    }, [onEditorReady]);

    const addNewPage = useCallback(() => {
        setPages((prevPages) => [
            ...prevPages,
            {
                id: `page-${prevPages.length + 1}`,
                pageNumber: prevPages.length + 1,
                content: '',
                inkData: [],
            },
        ]);
    }, []);

    const PAGE_SPACING = 20; // Space between pages in pixels
    const isTabletOptimizedViewport = containerWidth > 0 && containerWidth < 1180;
    const isCompactViewport = containerWidth > 0 && containerWidth < 900;
    const controlsBottomInset = isTabletOptimizedViewport
        ? 'calc(env(safe-area-inset-bottom, 0px) + 74px)'
        : 'calc(env(safe-area-inset-bottom, 0px) + 20px)';
    const navBottomInset = 'calc(env(safe-area-inset-bottom, 0px) + 12px)';

    return (
        <div
            ref={containerRef}
            style={{
                width: '100%',
                height: '100%',
                position: 'relative',
                background: '#e8e8e8',
                overflow: 'hidden', // Prevent outer scroll
            }}
        >
            {/* Zoom controls - Moved to Bottom Left to valid overlapping Chat */}
            <div
                style={{
                    position: 'absolute',
                    bottom: controlsBottomInset,
                    left: isTabletOptimizedViewport ? '12px' : '20px',
                    display: 'flex',
                    flexDirection: isTabletOptimizedViewport ? 'row' : 'column',
                    alignItems: 'center',
                    gap: isTabletOptimizedViewport ? '6px' : '8px',
                    zIndex: 1000,
                    background: 'rgba(255, 255, 255, 0.95)',
                    backdropFilter: 'blur(10px)',
                    borderRadius: '12px',
                    padding: isTabletOptimizedViewport ? '6px 8px' : '8px',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                    border: '1px solid rgba(0,0,0,0.05)',
                }}
            >
                <button
                    onClick={() => setZoom((prev) => Math.min(prev + 0.1, 2.0))}
                    style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '8px',
                        border: 'none',
                        background: '#fff',
                        color: '#333',
                        fontSize: '18px',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
                    }}
                    title="Zoom in"
                >
                    +
                </button>
                <div
                    style={{
                        padding: isTabletOptimizedViewport ? '0 6px' : '4px 8px',
                        fontSize: '11px',
                        textAlign: 'center',
                        fontWeight: 'bold',
                        color: '#666',
                    }}
                >
                    {Math.round(zoom * 100)}%
                </div>
                <button
                    onClick={() => setZoom((prev) => Math.max(prev - 0.1, 0.5))}
                    style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '8px',
                        border: 'none',
                        background: '#fff',
                        color: '#333',
                        fontSize: '18px',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
                    }}
                    title="Zoom out"
                >
                    −
                </button>
            </div>

            {/* Navigation and Status Bar - Centered Absolute */}
            <div
                style={{
                    position: 'absolute',
                    bottom: navBottomInset,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: 'rgba(255, 255, 255, 0.95)',
                    backdropFilter: 'blur(10px)',
                    borderRadius: '30px',
                    padding: isTabletOptimizedViewport ? '8px 12px' : '8px 20px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: isTabletOptimizedViewport ? '10px' : '16px',
                    width: isTabletOptimizedViewport ? 'calc(100% - 24px)' : 'auto',
                    maxWidth: isTabletOptimizedViewport ? 'min(760px, calc(100% - 24px))' : 'none',
                    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.12)',
                    zIndex: 1000,
                    border: '1px solid rgba(0,0,0,0.05)',
                }}
            >
                <div style={{ display: 'flex', gap: '6px', maxWidth: isTabletOptimizedViewport ? (isCompactViewport ? '42%' : '48%') : 'none', overflowX: 'auto' }}>
                    {pages.map((_, i) => (
                        <button
                            key={i}
                            onClick={() => {
                                const el = document.getElementById(`page-container-${pages[i].id}`);
                                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }}
                            style={{
                                width: '10px',
                                height: '10px',
                                borderRadius: '50%',
                                border: 'none',
                                padding: 0,
                                background: i === currentPageIndex ? '#2563eb' : '#e2e8f0',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                            }}
                            title={`Go to Page ${i + 1}`}
                        />
                    ))}
                </div>

                <div style={{ width: '1px', height: '20px', background: 'rgba(0,0,0,0.05)' }} />

                <div style={{ display: 'flex', alignItems: 'center', gap: isTabletOptimizedViewport ? '6px' : '8px', minWidth: 0 }}>
                    <div style={{ fontSize: '12px', fontWeight: '700', color: '#1a1a1e', letterSpacing: '-0.01em' }}>
                        PAGE {currentPageIndex + 1} OF {pages.length}
                    </div>

                    <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#eee' }} />

                    <div style={{
                        fontSize: '11px',
                        color: saveStatus === 'error' ? '#ef4444' : '#666',
                        fontWeight: '600',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        minWidth: isTabletOptimizedViewport ? '48px' : '60px'
                    }}>
                        {saveStatus === 'saving' ? (
                            'Saving...'
                        ) : saveStatus === 'saved' ? (
                            <><span style={{ color: '#10b981' }}>✓</span> Saved</>
                        ) : saveStatus === 'error' ? (
                            'Error'
                        ) : null}
                    </div>
                </div>
            </div>

            {/* Scrollable Pages Container */}
            <div
                ref={scrollContainerRef}
                style={{
                    width: '100%',
                    height: '100%',
                    overflowY: 'auto',
                    overflowX: 'auto',
                    paddingTop: isTabletOptimizedViewport ? '12px' : '20px',
                    paddingRight: isTabletOptimizedViewport ? '12px' : '20px',
                    paddingLeft: isTabletOptimizedViewport ? '12px' : '20px',
                    paddingBottom: isTabletOptimizedViewport
                        ? 'calc(env(safe-area-inset-bottom, 0px) + 130px)'
                        : 'calc(env(safe-area-inset-bottom, 0px) + 120px)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    overscrollBehavior: 'contain',
                }}
            >
                <div
                    style={{
                        transform: `scale(${zoom})`,
                        transformOrigin: 'top center',
                        transition: 'transform 0.2s ease',
                        paddingBottom: isTabletOptimizedViewport ? '40px' : '60px', // Extra space for scroll
                    }}
                >
                    {pages.map((page, index) => (
                        <div
                            key={page.id}
                            id={`page-container-${page.id}`}
                            style={{
                                marginBottom: index < pages.length - 1 ? `${PAGE_SPACING}px` : '0',
                            }}
                        >
                            <NotebookPage
                                pageNumber={page.pageNumber}
                                paperType={paperType}
                                strokes={page.inkData}
                                onStrokesChange={(strokes) => handlePageStrokesChange(page.id, strokes)}
                                tool={tool}
                                color={color}
                                width={width}
                                readOnly={readOnly || !isPencilMode}
                            >
                                <LineAlignedEditor
                                    content={page.content}
                                    onUpdate={(content) => handlePageContentChange(page.id, content)}
                                    onEditorReady={(editor) => handleEditorReady(page.id, editor)}
                                    onFocus={(editor) => onEditorReady?.(editor)}
                                    paperType={paperType}
                                    autoFocus={index === 0}
                                    placeholder={
                                        page.pageNumber === 1
                                            ? 'Start typing on the first line...'
                                            : 'Continue on this page...'
                                    }
                                />
                            </NotebookPage>
                        </div>
                    ))}

                    {/* Add page button */}
                    <div
                        style={{
                            marginTop: `${PAGE_SPACING}px`,
                            textAlign: 'center',
                        }}
                    >
                        <button
                            onClick={addNewPage}
                            style={{
                                padding: '12px 24px',
                                borderRadius: '8px',
                                border: '2px dashed #ccc',
                                background: 'transparent',
                                color: '#666',
                                fontSize: '14px',
                                fontWeight: '600',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.borderColor = '#2563eb';
                                e.currentTarget.style.color = '#2563eb';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.borderColor = '#ccc';
                                e.currentTarget.style.color = '#666';
                            }}
                        >
                            + Add New Page
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
});

NotebookCanvas.displayName = 'NotebookCanvas';
