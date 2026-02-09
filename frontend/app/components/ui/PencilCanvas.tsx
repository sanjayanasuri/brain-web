'use client';

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';

interface Point {
    x: number;
    y: number;
    pressure: number;
    t: number;
}

export type ToolType = 'pen' | 'highlighter' | 'eraser' | 'lasso';


export interface Stroke {
    tool: ToolType;
    color: string;
    width: number;
    points: Point[];
    timestamp: number;
}

export default function PencilCanvas({
    onSave,
    onProcess,
    onIntent,
    onClose,
    onIngest,
    tool: externalTool,
    color: externalColor,
    onClickPassthrough,
    onHoverPassthrough,
    title = "Handwritten Notes",
    transparent = false,
    overlay = false,
    initialStrokes,
    onStrokesChange,
    paperType,
    readOnly
}: {
    onSave?: (dataUrl: string) => void;
    onProcess?: (dataUrl: string) => void;
    onIntent?: (intent: any) => void;
    onClose?: () => void;
    onIngest?: (data: { image_data: string, ocr_hint?: string }) => Promise<void>;
    onClickPassthrough?: (x: number, y: number) => void;
    onHoverPassthrough?: (x: number, y: number) => void;
    tool?: ToolType;
    color?: string;
    title?: string;
    transparent?: boolean;
    overlay?: boolean;
    initialStrokes?: Stroke[];
    onStrokesChange?: (strokes: Stroke[]) => void;
    paperType?: string;
    readOnly?: boolean;
}) {
    const isDarkPaper = paperType === 'dark';

    const getPresets = () => ({
        pen: {
            colors: isDarkPaper
                ? ['#ffffff', '#f1c40f', '#3498db', '#e74c3c', '#2ecc71']
                : ['#1c1c1e', '#2c3e50', '#2980b9', '#c0392b', '#27ae60'],
            widths: [1.5, 2.5, 4.5]
        },
        highlighter: {
            colors: ['#f1c40f', '#2ecc71', '#3498db', '#e67e22', '#e84393'],
            widths: [18, 28, 40]
        }
    });

    const PRESETS = useMemo(getPresets, [isDarkPaper]);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const contextRef = useRef<CanvasRenderingContext2D | null>(null);
    const [internalTool, setInternalTool] = useState<ToolType>('pen');
    const [internalColor, setInternalColor] = useState(PRESETS.pen.colors[0]);

    // Update internal color when presets change (theme changes)
    useEffect(() => {
        setInternalColor(PRESETS.pen.colors[0]);
    }, [PRESETS]);

    const tool = externalTool || internalTool;
    const color = externalColor || internalColor;

    const [width, setWidth] = useState(PRESETS.pen.widths[1]);
    const [isDrawing, setIsDrawing] = useState(false);
    const [currentStroke, setCurrentStroke] = useState<Point[]>([]);
    const currentStrokeRef = useRef<Point[]>([]);
    const [pendingLasso, setPendingLasso] = useState<{ bounds: any, snippetUrl: string, canvas: { width: number; height: number; dpr: number } } | null>(null);
    const [toolbarPosition, setToolbarPosition] = useState({ x: 20, y: 50 });
    const [activePointers, setActivePointers] = useState<Set<number>>(new Set());
    const [isGesturing, setIsGesturing] = useState(false);
    const [isToolbarCollapsed, setIsToolbarCollapsed] = useState(false);

    // Track active pointers for multi-touch navigation
    const updatePointers = useCallback((e: React.PointerEvent, isDown: boolean) => {
        if (e.pointerType !== 'touch') return;

        setActivePointers(prev => {
            const next = new Set(prev);
            if (isDown) next.add(e.pointerId);
            else next.delete(e.pointerId);

            // If more than 1 finger, it's a gesture (zoom/pan)
            if (next.size > 1) {
                setIsGesturing(true);
            } else if (next.size === 0) {
                setIsGesturing(false);
            }
            return next;
        });
    }, []);
    const [isDraggingToolbar, setIsDraggingToolbar] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const toolbarRef = useRef<HTMLDivElement>(null);
    const [autoPenActive, setAutoPenActive] = useState(false);
    const [isIngesting, setIsIngesting] = useState(false);

    // Stroke persistence state
    const [strokes, setStrokes] = useState<Stroke[]>([]);
    const [strokesLoaded, setStrokesLoaded] = useState(false);

    // Load initial strokes when provided
    useEffect(() => {
        if (initialStrokes && initialStrokes.length >= 0) {
            setStrokes(initialStrokes);
            if (!strokesLoaded) setStrokesLoaded(true);
        }
    }, [initialStrokes]);

    // Notify parent when strokes change
    useEffect(() => {
        if (strokesLoaded && onStrokesChange) {
            onStrokesChange(strokes);
        }
    }, [strokes, strokesLoaded]);

    const lastPoint = useRef<Point | null>(null);


    const setupContext = (ctx: CanvasRenderingContext2D) => {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
    };

    const drawPaper = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
        ctx.fillStyle = '#fdfdfc';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#e2e2e0';
        for (let x = 40; x < w; x += 30) {
            for (let y = 40; y < h; y += 30) {
                ctx.beginPath();
                ctx.arc(x, y, 0.8, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    };

    // Redraw a single stroke
    const drawStroke = useCallback((ctx: CanvasRenderingContext2D, stroke: Stroke) => {
        if (stroke.points.length < 2) return;

        ctx.save();
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (stroke.tool === 'highlighter') {
            ctx.globalAlpha = 0.3;
            ctx.globalCompositeOperation = isDarkPaper ? 'screen' : 'multiply';
        } else if (stroke.tool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
        }

        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);

        for (let i = 1; i < stroke.points.length; i++) {
            ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }

        ctx.stroke();
        ctx.restore();
    }, [isDarkPaper]);

    // Redraw all saved strokes
    const redrawAllStrokes = useCallback(() => {
        const ctx = contextRef.current;
        const canvas = canvasRef.current;
        if (!ctx || !canvas) return;

        // Clear canvas
        const w = canvas.width / (window.devicePixelRatio || 1);
        const h = canvas.height / (window.devicePixelRatio || 1);
        ctx.clearRect(0, 0, w, h);

        // Redraw paper background
        if (!transparent) drawPaper(ctx, w, h);

        // Redraw all strokes
        strokes.forEach(stroke => {
            drawStroke(ctx, stroke);
        });
    }, [strokes, transparent, drawStroke]);

    // Redraw strokes when they change or canvas is resized
    useEffect(() => {
        if (strokesLoaded) {
            redrawAllStrokes();
        }
    }, [strokes, strokesLoaded, redrawAllStrokes, readOnly]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { desynchronized: true, alpha: true });
        if (!ctx) return;
        contextRef.current = ctx;

        const resize = (w: number, h: number) => {
            const dpr = window.devicePixelRatio || 1;
            canvas.width = w * dpr;
            canvas.height = h * dpr;
            canvas.style.width = `${w}px`;
            canvas.style.height = `${h}px`;

            ctx.scale(dpr, dpr);
            setupContext(ctx);
            if (!transparent) drawPaper(ctx, w, h);

            // Re-trigger redraw after canvas reset
            redrawAllStrokes();
        };

        const parent = canvas.parentElement;
        if (!parent) return;

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                // Use offsetWidth/scrollHeight for full scroll area coverage
                const fullW = parent.offsetWidth;
                const fullH = parent.scrollHeight;
                resize(fullW, fullH);
            }
        });

        resizeObserver.observe(parent);

        // Initial resize
        resize(parent.offsetWidth, parent.scrollHeight);

        return () => resizeObserver.disconnect();
    }, [transparent, redrawAllStrokes]);

    const getPos = (e: React.PointerEvent | PointerEvent): Point => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0, pressure: 0.5, t: Date.now() };
        const rect = canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            pressure: (e as any).pressure || 0.5,
            t: Date.now()
        };
    };

    const handlePointerDown = (e: React.PointerEvent) => {
        updatePointers(e, true);
        if (e.pointerType === 'touch' && activePointers.size > 0) return; // Block drawing if already gesturing
        if (e.pointerType === 'mouse' && e.button !== 0) return;

        // Auto-activate pen tool when stylus touches screen
        if (e.pointerType === 'pen' && tool !== 'pen' && !externalTool) {
            setInternalTool('pen');
            setAutoPenActive(true);
            setTimeout(() => setAutoPenActive(false), 2000); // Flash indicator for 2s
        }

        if (pendingLasso) setPendingLasso(null);
        setIsDrawing(true);
        const pos = getPos(e);
        lastPoint.current = pos;
        currentStrokeRef.current = [pos];

        // Start drawing immediately in context
        const ctx = contextRef.current;
        if (ctx) {
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            applyStyle(ctx, tool, color, width, pos.pressure);
        }
    };

    const applyStyle = (ctx: CanvasRenderingContext2D, t: ToolType, c: string, w: number, p: number) => {
        ctx.strokeStyle = c;
        ctx.lineWidth = w * (0.4 + p * 1.2);
        ctx.globalAlpha = 1.0;
        ctx.globalCompositeOperation = 'source-over';

        if (t === 'highlighter') {
            ctx.globalAlpha = 0.3;
            ctx.globalCompositeOperation = isDarkPaper ? 'screen' : 'multiply';
            ctx.lineCap = 'square';
            ctx.lineWidth = w; // Constant width for highlighter
        } else if (t === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = 40 * (0.5 + p * 1.5);
        } else if (t === 'lasso') {
            ctx.setLineDash([6, 4]);
            ctx.strokeStyle = '#2563eb';
            ctx.lineWidth = 2;
        } else {
            ctx.setLineDash([]);
        }
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (isGesturing) return;
        if (!isDrawing || !contextRef.current || !lastPoint.current) return;
        const pos = getPos(e);
        const ctx = contextRef.current;

        const midX = (lastPoint.current.x + pos.x) / 2;
        const midY = (lastPoint.current.y + pos.y) / 2;

        ctx.quadraticCurveTo(lastPoint.current.x, lastPoint.current.y, midX, midY);
        ctx.stroke();

        lastPoint.current = pos;
        currentStrokeRef.current.push(pos);
    };

    // Helper to check if we are over a UI element that should block drawing
    const isOverUI = (x: number, y: number) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return false;
        // Search up the tree for anything that should be interactive
        return !!el.closest('button, input, [role="button"], a, .responsive-panel, .drag-handle');
    };

    const handlePointerMoveCapture = (e: React.PointerEvent) => {
        if (!isDrawing) {
            onHoverPassthrough?.(e.clientX, e.clientY);
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        updatePointers(e, false);
        setIsDrawing(false);
        const ctx = contextRef.current;
        if (ctx) ctx.setLineDash([]);

        const stroke = currentStrokeRef.current;
        setCurrentStroke(stroke); // Sync to state for post-processing

        // Save stroke for persistence (only for pen/highlighter/eraser, not lasso)
        if (stroke.length > 2 && (tool === 'pen' || tool === 'highlighter' || tool === 'eraser')) {
            const newStroke: Stroke = {
                tool,
                color,
                width: tool === 'eraser' ? 40 : width, // Eraser has larger width
                points: [...stroke],
                timestamp: Date.now()
            };
            setStrokes(prev => [...prev, newStroke]);
        }

        // Click-through logic: if practically no movement and short duration
        const startPos = stroke[0];
        const endPos = getPos(e);
        const dist = Math.sqrt(Math.pow(endPos.x - (startPos?.x || 0), 2) + Math.pow(endPos.y - (startPos?.y || 0), 2));

        if (dist < 5 && stroke.length < 10) {
            // It's a click, not a drag. Clear the tiny dot we might have drawn.
            if (ctx && canvasRef.current) {
                onClickPassthrough?.(endPos.x, endPos.y);
            }
        }

        lastPoint.current = null;

        if (stroke.length > 15) {
            const bounds = getBounds(stroke);
            const isLasso = tool === 'lasso';
            if (isLasso && bounds.w > 30 && bounds.h > 30) {
                let snippetUrl = null;
                const canvas = canvasRef.current;
                if (canvas) {
                    const tempCanvas = document.createElement('canvas');
                    const dpr = window.devicePixelRatio || 1;
                    tempCanvas.width = bounds.w * dpr;
                    tempCanvas.height = bounds.h * dpr;
                    const tempCtx = tempCanvas.getContext('2d');
                    if (tempCtx) {
                        tempCtx.drawImage(
                            canvas,
                            bounds.x * dpr, bounds.y * dpr, bounds.w * dpr, bounds.h * dpr,
                            0, 0, bounds.w * dpr, bounds.h * dpr
                        );
                        snippetUrl = tempCanvas.toDataURL('image/png');
                        setPendingLasso({
                            bounds,
                            snippetUrl,
                            canvas: {
                                width: canvas.width / dpr,
                                height: canvas.height / dpr,
                                dpr
                            }
                        });
                    }
                }
            }
        }
    };

    const getBounds = (pts: Point[]) => {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        pts.forEach(p => {
            minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
        });
        const padding = 10;
        return {
            x: minX - padding, y: minY - padding,
            w: (maxX - minX) + padding * 2, h: (maxY - minY) + padding * 2
        };
    };

    const isClosedLoop = (pts: Point[]) => {
        const start = pts[0], end = pts[pts.length - 1];
        const dist = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
        return dist < 100;
    };

    // Load toolbar position from localStorage on mount
    useEffect(() => {
        const saved = localStorage.getItem('pencil-toolbar-position');
        if (saved) {
            try {
                const pos = JSON.parse(saved);
                setToolbarPosition(pos);
            } catch (e) {
                console.warn('Failed to load toolbar position:', e);
            }
        }
    }, []);

    // Save toolbar position to localStorage
    const saveToolbarPosition = useCallback((pos: { x: number; y: number }) => {
        setToolbarPosition(pos);
        localStorage.setItem('pencil-toolbar-position', JSON.stringify(pos));
    }, []);

    // Snap to edge logic
    const snapToEdges = useCallback((pos: { x: number, y: number }) => {
        const threshold = 60;
        const padding = 20;
        const viewportW = window.innerWidth;
        const viewportH = window.innerHeight;

        let nx = pos.x;
        let ny = pos.y;

        const toolbarRect = toolbarRef.current?.getBoundingClientRect();
        const tw = toolbarRect?.width || 200;
        const th = toolbarRect?.height || 60;

        // Snap to left/right
        if (nx < threshold) nx = padding;
        else if (nx + tw > viewportW - threshold) nx = viewportW - tw - padding;

        // Snap to top/bottom
        if (ny < threshold) ny = padding;
        else if (ny + th > viewportH - threshold) ny = viewportH - th - padding;

        // Ensure within bounds anyway
        nx = Math.max(padding, Math.min(nx, viewportW - tw - padding));
        ny = Math.max(padding, Math.min(ny, viewportH - th - padding));

        return { x: nx, y: ny };
    }, []);

    useEffect(() => {
        if (!isDraggingToolbar) return;

        const handleMove = (e: MouseEvent) => {
            const nx = e.clientX - dragOffset.x;
            const ny = e.clientY - dragOffset.y;
            setToolbarPosition({ x: nx, y: ny });
        };

        const handleUp = () => {
            setIsDraggingToolbar(false);
            const snapped = snapToEdges(toolbarPosition);
            saveToolbarPosition(snapped);
        };

        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
        return () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
        };
    }, [isDraggingToolbar, dragOffset, toolbarPosition, saveToolbarPosition, snapToEdges]);

    const handleIngest = async () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        setIsIngesting(true);
        try {
            const dataUrl = canvas.toDataURL('image/png');

            // Hybrid Approach Phase 1: Local OCR with Tesseract.js
            let text = "";
            try {
                // @ts-ignore - tesseract.js is dynamic
                const { createWorker } = await import('tesseract.js');
                const worker = await createWorker('eng');
                const ret = await worker.recognize(dataUrl);
                text = ret.data.text;
                await worker.terminate();
            } catch (e) {
                console.warn("Tesseract OCR failed, proceeding with vision only:", e);
            }

            if (onIngest) {
                await onIngest({ image_data: dataUrl, ocr_hint: text });
            } else {
                // Fallback internal fetch if no handler
                await fetch('/api/lectures/ingest-ink', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        image_data: dataUrl,
                        ocr_hint: text,
                        lecture_title: title
                    })
                });
            }

            // Briefly show success?
            alert("Page ingested successfully!");
        } catch (err) {
            console.error('Ingestion failed:', err);
            alert("Ingestion failed. Please check your connection.");
        } finally {
            setIsIngesting(false);
        }
    };

    return (
        <div style={{
            position: overlay ? 'absolute' : 'relative',
            top: 0, left: 0, width: '100%', height: '100%',
            background: transparent ? 'transparent' : '#fdfdfc',
            cursor: readOnly ? 'default' : (isGesturing ? 'grab' : 'crosshair'),
            touchAction: 'none',
            pointerEvents: (isGesturing || readOnly) ? 'none' : 'auto',
            zIndex: readOnly ? 10 : 100
        }}>
            <canvas
                ref={canvasRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerMoveCapture={handlePointerMoveCapture}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                style={{ width: '100%', height: '100%', display: 'block' }}
            />

            {/* Lasso Floating Menu */}
            {pendingLasso && (
                <div style={{
                    position: 'absolute',
                    top: `${pendingLasso.bounds.y - 60}px`,
                    left: `${pendingLasso.bounds.x + pendingLasso.bounds.w / 2}px`,
                    transform: 'translateX(-50%)',
                    display: 'flex',
                    gap: '4px',
                    padding: '6px',
                    background: isDarkPaper ? 'rgba(30, 30, 30, 0.9)' : 'rgba(255, 255, 255, 0.9)',
                    backdropFilter: 'blur(20px)',
                    borderRadius: '16px',
                    boxShadow: isDarkPaper ? '0 10px 40px rgba(0,0,0,0.4)' : '0 10px 40px rgba(0,0,0,0.15)',
                    border: isDarkPaper ? '1px solid rgba(255,255,255,0.1)' : 'none',
                    zIndex: 2000,
                    animation: 'popIn 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
                }}>
                    <button
                        onClick={() => {
                            onIntent?.({ type: 'branch', bounds: pendingLasso.bounds, snippetUrl: pendingLasso.snippetUrl, canvas: pendingLasso.canvas });
                            setPendingLasso(null);
                        }}
                        style={{
                            padding: '8px 16px', borderRadius: '12px', border: 'none',
                            background: '#f59e0b', color: '#fff', fontWeight: '600',
                            cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px'
                        }}
                    >
                        Thread
                    </button>
                    <button
                        onClick={() => {
                            onIntent?.({ type: 'lasso', bounds: pendingLasso.bounds, snippetUrl: pendingLasso.snippetUrl, canvas: pendingLasso.canvas });
                            setPendingLasso(null);
                        }}
                        style={{
                            padding: '8px 16px', borderRadius: '12px', border: 'none',
                            background: '#10b981', color: '#fff', fontWeight: '600',
                            cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px'
                        }}
                    >
                        Select
                    </button>
                    <button
                        onClick={() => {
                            onIntent?.({ type: 'explain', bounds: pendingLasso.bounds, snippetUrl: pendingLasso.snippetUrl, canvas: pendingLasso.canvas });
                            setPendingLasso(null);
                        }}
                        style={{
                            padding: '8px 16px', borderRadius: '12px', border: 'none',
                            background: '#7c3aed', color: '#fff', fontWeight: '600',
                            cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px'
                        }}
                    >
                        Explain
                    </button>
                    <button
                        onClick={() => {
                            onIntent?.({ type: 'search', bounds: pendingLasso.bounds, snippetUrl: pendingLasso.snippetUrl, canvas: pendingLasso.canvas });
                            setPendingLasso(null);
                        }}
                        style={{
                            padding: '8px 16px', borderRadius: '12px', border: 'none',
                            background: '#2563eb', color: '#fff', fontWeight: '600',
                            cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px'
                        }}
                    >
                        Search
                    </button>
                    <button
                        onClick={() => setPendingLasso(null)}
                        style={{
                            padding: '8px 12px', borderRadius: '12px', border: 'none',
                            background: isDarkPaper ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                            color: isDarkPaper ? '#eee' : '#333', fontWeight: '500',
                            cursor: 'pointer', fontSize: '13px'
                        }}
                    >
                        Cancel
                    </button>
                </div>
            )}


            {/* Draggable Tool Dock */}
            {/* Draggable Tool Dock - Only show if not external and not read-only */}
            {!externalTool && !readOnly && (
                <div
                    ref={toolbarRef}
                    onMouseDown={(e) => {
                        if ((e.target as HTMLElement).closest('#drag-handle')) {
                            setIsDraggingToolbar(true);
                            setDragOffset({ x: e.clientX - toolbarPosition.x, y: e.clientY - toolbarPosition.y });
                        }
                    }}
                    style={{
                        position: 'fixed',
                        top: `${toolbarPosition.y}px`,
                        left: `${toolbarPosition.x}px`,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        background: 'rgba(255, 255, 255, 0.85)',
                        backdropFilter: 'blur(25px) saturate(180%)',
                        borderRadius: '24px',
                        boxShadow: isDraggingToolbar
                            ? '0 12px 48px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.08)'
                            : '0 8px 32px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)',
                        border: (toolbarPosition.x <= 20 || toolbarPosition.x >= window.innerWidth - 80 ||
                            toolbarPosition.y <= 20 || toolbarPosition.y >= window.innerHeight - 80) && !isDraggingToolbar
                            ? '2px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(0,0,0,0.04)',
                        padding: '6px',
                        zIndex: 1000,
                        transition: isDraggingToolbar ? 'none' : 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                        width: isToolbarCollapsed ? '56px' : (toolbarPosition.x <= 20 || toolbarPosition.x >= window.innerWidth - 80 ? '70px' : 'auto'),
                        userSelect: 'none',
                        touchAction: 'none'
                    }}
                >
                    {/* Drag Handle & Collapse Toggle */}
                    <div
                        id="drag-handle"
                        style={{
                            width: '100%',
                            height: '24px',
                            cursor: 'grab',
                            display: 'flex',
                            flexDirection: (toolbarPosition.x <= 20 || toolbarPosition.x >= window.innerWidth - 80) ? 'row' : 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '4px'
                        }}
                        onClick={() => {
                            if (!isDraggingToolbar) setIsToolbarCollapsed(!isToolbarCollapsed);
                        }}
                    >
                        <div style={{ width: '30px', height: '4px', background: 'rgba(0,0,0,0.1)', borderRadius: '2px' }} />
                    </div>

                    {!isToolbarCollapsed && (
                        <div style={{
                            display: 'flex',
                            flexDirection: (toolbarPosition.x <= 20 || toolbarPosition.x >= window.innerWidth - 80) ? 'column' : 'row',
                            alignItems: 'center'
                        }}>
                            <div style={{
                                display: 'flex',
                                flexDirection: (toolbarPosition.x <= 20 || toolbarPosition.x >= window.innerWidth - 80) ? 'column' : 'row',
                                gap: '4px', background: 'rgba(0,0,0,0.03)', borderRadius: '20px', padding: '4px'
                            }}>
                                {(['pen', 'highlighter', 'eraser', 'lasso'] as const).map(t => (
                                    <button
                                        key={t}
                                        onClick={() => { setInternalTool(t); if (t === 'pen') setInternalColor(PRESETS.pen.colors[0]); }}
                                        style={{
                                            width: '44px', height: '44px', borderRadius: '18px', border: 'none',
                                            background: tool === t ? '#fff' : 'transparent',
                                            boxShadow: tool === t ? '0 4px 12px rgba(0,0,0,0.1)' : 'none',
                                            color: tool === t ? '#111' : '#666',
                                            cursor: 'pointer', fontSize: '20px', transition: 'all 0.2s'
                                        }}
                                    >
                                        {t === 'pen' ? 'Pen' : t === 'highlighter' ? 'High' : t === 'eraser' ? 'Eraser' : 'Lasso'}
                                    </button>
                                ))}
                            </div>

                            <div style={{
                                width: (toolbarPosition.x <= 20 || toolbarPosition.x >= window.innerWidth - 80) ? '30px' : '1px',
                                height: (toolbarPosition.x <= 20 || toolbarPosition.x >= window.innerWidth - 80) ? '1px' : '30px',
                                background: 'rgba(0,0,0,0.06)', margin: '8px 12px'
                            }} />

                            <button
                                onClick={handleIngest}
                                disabled={isIngesting}
                                style={{
                                    padding: '8px 16px', borderRadius: '16px', border: 'none',
                                    background: 'linear-gradient(135deg, #10b981, #059669)',
                                    color: '#fff', fontWeight: '600',
                                    cursor: 'pointer', fontSize: '13px',
                                    display: 'flex', alignItems: 'center', gap: '6px',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                    opacity: isIngesting ? 0.7 : 1,
                                    transition: 'all 0.2s'
                                }}
                            >
                                {isIngesting ? '...' : 'Ingest Page'}
                            </button>

                            <div style={{
                                width: (toolbarPosition.x <= 20 || toolbarPosition.x >= window.innerWidth - 80) ? '30px' : '1px',
                                height: (toolbarPosition.x <= 20 || toolbarPosition.x >= window.innerWidth - 80) ? '1px' : '30px',
                                background: 'rgba(0,0,0,0.06)', margin: '8px 12px'
                            }} />

                            {tool !== 'eraser' && tool !== 'lasso' && (
                                <div style={{
                                    display: 'flex',
                                    flexDirection: (toolbarPosition.x <= 20 || toolbarPosition.x >= window.innerWidth - 80) ? 'column' : 'row',
                                    gap: '8px', padding: '4px'
                                }}>
                                    {(tool === 'pen' ? PRESETS.pen.colors : PRESETS.highlighter.colors).map(c => (
                                        <button
                                            key={c}
                                            onClick={() => setInternalColor(c)}
                                            style={{
                                                width: '28px', height: '28px', borderRadius: '50%', background: c,
                                                border: color === c ? '2px solid #fff' : 'none',
                                                boxShadow: color === c ? `0 0 0 2px ${c}` : 'none',
                                                cursor: 'pointer', transition: 'transform 0.1s'
                                            }}
                                        />
                                    ))}
                                </div>
                            )}

                            <button
                                onClick={() => {
                                    const ctx = contextRef.current;
                                    if (ctx && canvasRef.current) {
                                        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
                                        if (!transparent) drawPaper(ctx, canvasRef.current.width, canvasRef.current.height);
                                    }
                                }}
                                style={{
                                    padding: '8px 16px', borderRadius: '16px', border: 'none',
                                    background: 'transparent', color: '#dc2626', fontWeight: '600',
                                    cursor: 'pointer', fontSize: '13px'
                                }}
                            >
                                Clear
                            </button>
                        </div>
                    )}

                    {isToolbarCollapsed && (
                        <div style={{ fontSize: '20px', padding: '10px' }}>
                            {tool === 'pen' ? 'Pen' : tool === 'highlighter' ? 'High' : tool === 'eraser' ? 'Eraser' : 'Lasso'}
                        </div>
                    )}
                </div>
            )}

            {onClose && !readOnly && (
                <button
                    onClick={onClose}
                    style={{
                        position: 'absolute', top: '24px', right: '24px',
                        width: '40px', height: '40px', borderRadius: '50%',
                        background: 'rgba(0,0,0,0.05)', border: 'none', cursor: 'pointer',
                        fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                >✕</button>
            )}

            <style jsx>{`
                @keyframes popIn {
                    from { opacity: 0; transform: translateX(-50%) scale(0.9); }
                    to { opacity: 1; transform: translateX(-50%) scale(1); }
                }
                @keyframes fadeOut {
                    0% { opacity: 1; }
                    80% { opacity: 1; }
                    100% { opacity: 0; }
                }
            `}</style>
        </div>
    );
}
