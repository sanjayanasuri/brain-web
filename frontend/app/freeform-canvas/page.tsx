'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import CanvasToolbar from '../components/canvas/CanvasToolbar';
import CaptureModal, { FreeformCaptureResult } from '../components/canvas/CaptureModal';
import InfiniteCanvas from '../components/canvas/InfiniteCanvas';
import PhasePanel from '../components/canvas/PhasePanel';
import { createLecture, getLecture } from '../api/lectures';
import { useFreeformCanvasStore, type InternalStore } from '../state/freeformCanvasStore';
import type { CanvasStroke, FPoint, TextBlock, ToolType } from '../types/freeform-canvas';
import { useIPadLikeDevice } from '../lib/ipadScribble';

const WORLD_W = 8000;
const WORLD_H = 6000;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isClosedLoop(points: FPoint[]): boolean {
  if (points.length < 10) return false;
  const first = points[0];
  const last = points[points.length - 1];
  return Math.hypot(first.x - last.x, first.y - last.y) < 100;
}

function bboxOf(points: FPoint[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: Math.max(0, maxX - minX), h: Math.max(0, maxY - minY) };
}

function sampleEllipseStroke(stroke: CanvasStroke): CanvasStroke {
  const b = bboxOf(stroke.points);
  const pad = 10;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const rx = Math.max(12, b.w / 2 + pad);
  const ry = Math.max(12, b.h / 2 + pad);
  const count = 48;
  const points: FPoint[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i / (count - 1)) * Math.PI * 2;
    points.push({
      x: cx + rx * Math.cos(t),
      y: cy + ry * Math.sin(t),
      pressure: 0.65,
    });
  }
  const nb = bboxOf(points);
  return {
    ...stroke,
    points,
    canvasX: nb.x,
    canvasY: nb.y,
    canvasW: nb.w,
    canvasH: nb.h,
  };
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  pad = 8,
) {
  return !(
    a.x + a.w + pad < b.x ||
    b.x + b.w + pad < a.x ||
    a.y + a.h + pad < b.y ||
    b.y + b.h + pad < a.y
  );
}

function estimateLabelWidth(text: string, fontSize: number, min = 110, max = 320) {
  const approx = Math.max(min, Math.min(max, Math.round(text.length * (fontSize * 0.55) + 26)));
  return approx;
}

export default function FreeformCanvasPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const canvasIdFromUrl = searchParams?.get('canvasId') ?? null;
  const isIPadLike = useIPadLikeDevice();
  const appliedIPadDefaultRef = useRef(false);

  const [canvasId, setCanvasId] = useState<string | null>(canvasIdFromUrl);
  const [canvasTitle, setCanvasTitle] = useState('Untitled Canvas');
  const [activeTool, setActiveTool] = useState<ToolType>('pen');
  const [color, setColor] = useState('#111827');
  const [brushSize, setBrushSize] = useState(5);
  const [captureStatus, setCaptureStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [captureResult, setCaptureResult] = useState<FreeformCaptureResult | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [isBootstrapped, setIsBootstrapped] = useState(false);
  const [dirtyTick, setDirtyTick] = useState(0);
  const bootstrappingRef = useRef(false);

  useEffect(() => {
    if (isIPadLike && !appliedIPadDefaultRef.current) {
      appliedIPadDefaultRef.current = true;
      setActiveTool('pen');
    }
  }, [isIPadLike]);

  const strokes = useFreeformCanvasStore((s: InternalStore) => s.strokes);
  const textBlocks = useFreeformCanvasStore((s: InternalStore) => s.textBlocks);
  const drawingBlocks = useFreeformCanvasStore((s: InternalStore) => s.drawingBlocks);
  const phases = useFreeformCanvasStore((s: InternalStore) => s.phases);
  const viewX = useFreeformCanvasStore((s: InternalStore) => s.viewX);
  const viewY = useFreeformCanvasStore((s: InternalStore) => s.viewY);
  const zoom = useFreeformCanvasStore((s: InternalStore) => s.zoom);
  const addPhase = useFreeformCanvasStore((s: InternalStore) => s.addPhase);
  const deletePhase = useFreeformCanvasStore((s: InternalStore) => s.deletePhase);
  const reorderPhase = useFreeformCanvasStore((s: InternalStore) => s.reorderPhase);
  const setView = useFreeformCanvasStore((s: InternalStore) => s.setView);
  const undo = useFreeformCanvasStore((s: InternalStore) => s.undo);
  const loadState = useFreeformCanvasStore((s: InternalStore) => s.loadState);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key.toLowerCase() === 'z') {
          e.preventDefault();
          undo();
          return;
        }
      }
      if ((e.target as HTMLElement)?.closest?.('[contenteditable="true"], input, textarea')) return;
      const k = e.key.toLowerCase();
      if (k === 'p') setActiveTool('pen');
      if (k === 'h') setActiveTool('highlighter');
      if (k === 'e') setActiveTool('eraser');
      if (k === 't') setActiveTool('text');
      if (k === 'b') setActiveTool('drawingBox');
      if (k === 'v') setActiveTool('select');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo]);

  useEffect(() => {
    setCanvasId(canvasIdFromUrl);
  }, [canvasIdFromUrl]);

  useEffect(() => {
    if (bootstrappingRef.current) return;
    bootstrappingRef.current = true;

    let cancelled = false;

    async function bootstrap() {
      try {
        if (!canvasIdFromUrl) {
          const lecture = await createLecture({ title: 'Untitled Canvas', raw_text: '' });
          if (cancelled) return;
          setCanvasId(lecture.lecture_id);
          setCanvasTitle(lecture.title || 'Untitled Canvas');
          router.replace(`/freeform-canvas?canvasId=${encodeURIComponent(lecture.lecture_id)}`);
          return;
        }

        const lecture = await getLecture(canvasIdFromUrl);
        if (cancelled) return;
        setCanvasTitle(lecture.title || 'Untitled Canvas');

        if (lecture.metadata_json) {
          try {
            const meta = JSON.parse(lecture.metadata_json);
            let savedState: any = null;
            if (meta?.freeformCanvas?.state) {
              savedState = meta.freeformCanvas.state;
            } else if (meta?.freeformCanvas?.strokes || meta?.freeformCanvas?.textBlocks) {
              savedState = meta.freeformCanvas;
            } else if (meta?.strokes || meta?.textBlocks) {
              savedState = meta;
            }
            if (savedState) {
              loadState({
                strokes: Array.isArray(savedState.strokes) ? savedState.strokes : [],
                textBlocks: Array.isArray(savedState.textBlocks) ? savedState.textBlocks : [],
                drawingBlocks: Array.isArray(savedState.drawingBlocks) ? savedState.drawingBlocks : [],
                phases: Array.isArray(savedState.phases) ? savedState.phases : [],
                viewX: typeof savedState.viewX === 'number' ? savedState.viewX : 0,
                viewY: typeof savedState.viewY === 'number' ? savedState.viewY : 0,
                zoom: typeof savedState.zoom === 'number' ? savedState.zoom : 1,
              });
            }
          } catch {
            // Ignore malformed metadata_json and start fresh.
          }
        }
      } catch (error) {
        console.error('[FreeformCanvas] bootstrap failed', error);
      } finally {
        if (!cancelled) {
          setIsBootstrapped(true);
          bootstrappingRef.current = false;
        }
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [canvasIdFromUrl, loadState, router]);

  useEffect(() => {
    if (!canvasId || !isBootstrapped) return;
    const timeout = window.setTimeout(async () => {
      try {
        await fetch('/api/canvas/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            canvas_id: canvasId,
            title: canvasTitle,
            state: {
              strokes,
              textBlocks,
              drawingBlocks,
              phases,
              viewX,
              viewY,
              zoom,
            },
          }),
        });
      } catch (error) {
        console.warn('[FreeformCanvas] autosave failed', error);
      }
    }, 2000);
    return () => window.clearTimeout(timeout);
  }, [canvasId, canvasTitle, isBootstrapped, strokes, textBlocks, drawingBlocks, phases, viewX, viewY, zoom, dirtyTick]);

  function animateToPhase(targetPhase: { viewX: number; viewY: number; zoom: number }) {
    const start = performance.now();
    const startViewX = useFreeformCanvasStore.getState().viewX;
    const startViewY = useFreeformCanvasStore.getState().viewY;
    const startZoom = useFreeformCanvasStore.getState().zoom;
    const duration = 600;

    function ease(t: number) {
      return 1 - Math.pow(1 - t, 3);
    }

    function tick(now: number) {
      const t = clamp((now - start) / duration, 0, 1);
      const k = ease(t);
      setView(
        startViewX + (targetPhase.viewX - startViewX) * k,
        startViewY + (targetPhase.viewY - startViewY) * k,
        startZoom + (targetPhase.zoom - startZoom) * k,
      );
      if (t < 1) {
        requestAnimationFrame(tick);
      }
    }

    requestAnimationFrame(tick);
  }

  async function maybeRunOcrHint(): Promise<string | undefined> {
    try {
      const viewport = document.querySelector('#freeform-canvas-root') as HTMLElement | null;
      if (!viewport) return undefined;
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(viewport, {
        backgroundColor: '#ffffff',
        scale: 1,
        useCORS: true,
      });
      const dataUrl = canvas.toDataURL('image/png');
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng');
      const ret = await worker.recognize(dataUrl);
      await worker.terminate();
      const text = ret?.data?.text?.trim?.();
      return text || undefined;
    } catch (error) {
      console.warn('[FreeformCanvas] OCR hint failed, proceeding without OCR', error);
      return undefined;
    }
  }

  async function handleCapture() {
    if (!canvasId) return;
    setCaptureError(null);
    setCaptureResult(null);
    setCaptureStatus('loading');
    try {
      const ocrHint = await maybeRunOcrHint();
      const body = {
        canvas_id: canvasId,
        canvas_title: canvasTitle || 'Untitled Canvas',
        strokes_json: JSON.stringify(useFreeformCanvasStore.getState().strokes),
        text_blocks_json: JSON.stringify(useFreeformCanvasStore.getState().textBlocks),
        drawing_blocks_json: JSON.stringify(useFreeformCanvasStore.getState().drawingBlocks),
        phases_json: JSON.stringify(useFreeformCanvasStore.getState().phases),
        ocr_hint: ocrHint,
      };

      const response = await fetch('/api/canvas/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.detail || data?.error || `Capture failed (${response.status})`);
      }
      setCaptureResult(data as FreeformCaptureResult);
      setCaptureStatus('success');
    } catch (error: any) {
      setCaptureError(error?.message || 'Capture failed');
      setCaptureStatus('error');
    }
  }

  function handlePolish() {
    const current = useFreeformCanvasStore.getState();
    const loopStrokes = current.strokes.filter((s: CanvasStroke) => isClosedLoop(s.points));
    if (!loopStrokes.length) return;

    const polishedStrokes = current.strokes.map((stroke: CanvasStroke) =>
      isClosedLoop(stroke.points) ? sampleEllipseStroke(stroke) : stroke,
    );
    const polishedLoops = polishedStrokes.filter((s: CanvasStroke) => isClosedLoop(s.points));

    const anchoredByStroke = new Map<string, TextBlock[]>();
    const unanchoredBlocks: TextBlock[] = [];

    for (const block of current.textBlocks) {
      const nearest = polishedLoops
        .map((s: CanvasStroke) => {
          const dx = Math.max(s.canvasX - block.x, 0, block.x - (s.canvasX + s.canvasW));
          const dy = Math.max(s.canvasY - block.y, 0, block.y - (s.canvasY + s.canvasH));
          return { stroke: s, dist: Math.hypot(dx, dy) };
        })
        .sort((a: { dist: number }, b: { dist: number }) => a.dist - b.dist)[0];

      if (!nearest || nearest.dist > 80) {
        unanchoredBlocks.push(block);
        continue;
      }
      const arr = anchoredByStroke.get(nearest.stroke.id) || [];
      arr.push(block);
      anchoredByStroke.set(nearest.stroke.id, arr);
    }

    const occupiedRects: Array<{ x: number; y: number; w: number; h: number }> = [];
    const mergedLabelBlocks: TextBlock[] = [];

    for (const stroke of polishedLoops.sort((a: CanvasStroke, b: CanvasStroke) => a.timestamp - b.timestamp)) {
      const blocks = (anchoredByStroke.get(stroke.id) || [])
        .filter((b: TextBlock) => (b.text || '').trim())
        .sort((a: TextBlock, b: TextBlock) => a.timestamp - b.timestamp);
      if (!blocks.length) continue;

      const combinedText = blocks.map((b) => b.text.trim()).filter(Boolean).join('  •  ');
      const first = blocks[0];
      const fontSize = Math.max(14, Math.min(20, first.fontSize || 16));
      const desiredW = Math.max(
        Math.min(360, Math.max(120, Math.round(stroke.canvasW + 26))),
        estimateLabelWidth(combinedText, fontSize, 120, 420),
      );

      let x = stroke.canvasX + stroke.canvasW / 2 - desiredW / 2;
      x = clamp(x, 12, WORLD_W - desiredW - 12);
      let y = clamp(stroke.canvasY + stroke.canvasH + 14, 12, WORLD_H - 36);
      const h = Math.max(28, fontSize * 1.8);

      let candidate = { x, y, w: desiredW, h };
      let guard = 0;
      while (occupiedRects.some((r) => rectsOverlap(candidate, r, 6)) && guard < 30) {
        y += h + 8;
        if (y > WORLD_H - h - 12) {
          y = clamp(stroke.canvasY - h - 14, 12, WORLD_H - h - 12);
        }
        candidate = { x, y, w: desiredW, h };
        guard += 1;
      }
      occupiedRects.push(candidate);

      mergedLabelBlocks.push({
        ...first,
        text: combinedText,
        x: candidate.x,
        y: candidate.y,
        w: candidate.w,
        fontSize,
        timestamp: first.timestamp,
        isEditing: false,
      });
    }

    const polishedTextBlocks = [...unanchoredBlocks, ...mergedLabelBlocks].sort((a, b) => a.timestamp - b.timestamp);

    useFreeformCanvasStore.getState().loadState({
      strokes: polishedStrokes,
      textBlocks: polishedTextBlocks,
      drawingBlocks: current.drawingBlocks,
      phases: current.phases,
      viewX: current.viewX,
      viewY: current.viewY,
      zoom: current.zoom,
    });
    setDirtyTick(Date.now());
  }

  const [showIpadHint, setShowIpadHint] = useState(false);
  useEffect(() => {
    if (!isIPadLike) return;
    try {
      if (localStorage.getItem('freeform-ipad-hint-dismissed') === '1') return;
      setShowIpadHint(true);
    } catch {
      // ignore localStorage
    }
  }, [isIPadLike]);

  return (
    <div
      id="freeform-canvas-root"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--background)',
        overflow: 'hidden',
      }}
    >
      {showIpadHint && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 60,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 16px',
            borderRadius: 12,
            background: 'color-mix(in srgb, var(--panel) 95%, black)',
            border: '1px solid var(--border)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
            fontSize: 13,
            color: 'var(--ink)',
          }}
        >
          <span>Use Pencil to draw; finger to pan.</span>
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.setItem('freeform-ipad-hint-dismissed', '1');
              } catch {
                // ignore
              }
              setShowIpadHint(false);
            }}
            style={{
              padding: '4px 8px',
              border: 'none',
              background: 'transparent',
              color: 'var(--muted)',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      <InfiniteCanvas
        activeTool={activeTool}
        activeColor={color}
        brushSize={brushSize}
        onDirtyChange={setDirtyTick}
        onDrawingBlockCreated={() => setActiveTool('pen')}
      />

      <CanvasToolbar
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        color={color}
        setColor={setColor}
        brushSize={brushSize}
        setBrushSize={setBrushSize}
        onUndo={() => {
          undo();
          setDirtyTick(Date.now());
        }}
        onAddPhase={(label) => {
          addPhase(label, useFreeformCanvasStore.getState().viewX, useFreeformCanvasStore.getState().viewY, useFreeformCanvasStore.getState().zoom);
          setDirtyTick(Date.now());
        }}
        onCapture={handleCapture}
        canvasTitle={canvasTitle}
        setCanvasTitle={setCanvasTitle}
        isCapturing={captureStatus === 'loading'}
      />

      <PhasePanel
        phases={phases}
        onGoToPhase={(phase) => animateToPhase(phase)}
        onDeletePhase={(id) => {
          deletePhase(id);
          setDirtyTick(Date.now());
        }}
        onReorderPhase={(id, newOrder) => {
          reorderPhase(id, newOrder);
          setDirtyTick(Date.now());
        }}
      />

      <CaptureModal
        status={captureStatus}
        result={captureResult}
        errorMessage={captureError}
        onClose={() => setCaptureStatus('idle')}
        onOpenGraph={() => router.push('/graphs')}
        onOpenLecture={() => {
          const lectureId = captureResult?.lecture_id || canvasId;
          if (lectureId) {
            router.push(`/lecture-editor?lectureId=${encodeURIComponent(lectureId)}`);
          }
        }}
        onPolish={captureStatus === 'success' ? handlePolish : undefined}
      />
    </div>
  );
}
