'use client';

import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import getStroke from 'perfect-freehand';
import { useFreeformCanvasStore, type InternalStore } from '../../state/freeformCanvasStore';
import {
  CanvasStroke,
  DrawingBlock,
  DrawingBlockStroke,
  FPoint,
  TextBlock,
  ToolType,
} from '../../types/freeform-canvas';

interface InfiniteCanvasProps {
  activeTool: ToolType;
  activeColor: string;
  brushSize: number;
  onDirtyChange?: (dirtyAt: number) => void;
  onDrawingBlockCreated?: () => void;
}

const WORLD_W = 8000;
const WORLD_H = 6000;

type PointerMode = 'idle' | 'draw' | 'pan' | 'erase';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getBoundingBox(points: FPoint[]) {
  if (!points.length) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function distancePointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLenSq = abx * abx + aby * aby;
  if (abLenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return Math.hypot(px - cx, py - cy);
}

function strokeDistanceAtPoint(stroke: CanvasStroke, x: number, y: number, threshold: number) {
  const minX = stroke.canvasX - threshold;
  const minY = stroke.canvasY - threshold;
  const maxX = stroke.canvasX + stroke.canvasW + threshold;
  const maxY = stroke.canvasY + stroke.canvasH + threshold;
  if (x < minX || x > maxX || y < minY || y > maxY) {
    return Number.POSITIVE_INFINITY;
  }

  const pts = stroke.points;
  if (!pts.length) return Number.POSITIVE_INFINITY;
  if (pts.length === 1) return Math.hypot(x - pts[0].x, y - pts[0].y);

  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < pts.length; i++) {
    const d = distancePointToSegment(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
    if (d < best) best = d;
    if (best <= threshold * 0.5) break;
  }
  return best;
}

function strokeDistanceAtPointBlockStroke(
  stroke: DrawingBlockStroke,
  localX: number,
  localY: number,
  threshold: number,
): number {
  const pts = stroke.points;
  if (!pts.length) return Number.POSITIVE_INFINITY;
  const bbox = getBoundingBox(pts);
  const minX = bbox.x - threshold;
  const minY = bbox.y - threshold;
  const maxX = bbox.x + bbox.w + threshold;
  const maxY = bbox.y + bbox.h + threshold;
  if (localX < minX || localX > maxX || localY < minY || localY > maxY) {
    return Number.POSITIVE_INFINITY;
  }
  if (pts.length === 1) return Math.hypot(localX - pts[0].x, localY - pts[0].y);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < pts.length; i++) {
    const d = distancePointToSegment(
      localX,
      localY,
      pts[i - 1].x,
      pts[i - 1].y,
      pts[i].x,
      pts[i].y,
    );
    if (d < best) best = d;
    if (best <= threshold * 0.5) break;
  }
  return best;
}

function isClosedLoop(points: FPoint[]): boolean {
  if (points.length < 10) return false;
  const first = points[0];
  const last = points[points.length - 1];
  return Math.hypot(first.x - last.x, first.y - last.y) < 100;
}

function isArrow(points: FPoint[]): boolean {
  if (points.length < 5) return false;
  const bbox = getBoundingBox(points);
  const diagonal = Math.hypot(bbox.w, bbox.h);
  if (diagonal <= 60) return false;
  let pathLen = 0;
  for (let i = 1; i < points.length; i++) {
    pathLen += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return diagonal > 0 && pathLen / diagonal < 2.5;
}

function getSvgPathFromStroke(stroke: number[][]): string {
  if (!stroke.length) return '';
  const d: (string | number)[] = ['M', stroke[0][0], stroke[0][1], 'Q'];
  for (let i = 0; i < stroke.length; i++) {
    const [x0, y0] = stroke[i];
    const [x1, y1] = stroke[(i + 1) % stroke.length];
    d.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  return d.join(' ');
}

function hexToRgba(color: string, alpha: number) {
  if (color.startsWith('rgba(')) {
    return color.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, `rgba($1,$2,$3,${alpha})`);
  }
  if (color.startsWith('rgb(')) {
    return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
  }
  const c = color.replace('#', '');
  if (c.length !== 6) return color;
  const r = Number.parseInt(c.slice(0, 2), 16);
  const g = Number.parseInt(c.slice(2, 4), 16);
  const b = Number.parseInt(c.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function makePath(stroke: CanvasStroke) {
  const points = stroke.points.map((p) => [p.x, p.y, p.pressure || 0.5] as [number, number, number]);
  if (points.length < 2) return '';
  const pfStroke = getStroke(points, {
    size: stroke.width,
    thinning: stroke.tool === 'highlighter' ? 0 : 0.5,
    smoothing: 0.5,
    streamline: 0.35,
    simulatePressure: true,
  }) as number[][];
  return getSvgPathFromStroke(pfStroke);
}

function makePathForBlockStroke(stroke: DrawingBlockStroke): string {
  const points = stroke.points.map((p) => [p.x, p.y, p.pressure ?? 0.5] as [number, number, number]);
  if (points.length < 2) return '';
  const pfStroke = getStroke(points, {
    size: stroke.width,
    thinning: stroke.tool === 'highlighter' ? 0 : 0.5,
    smoothing: 0.5,
    streamline: 0.35,
    simulatePressure: true,
  }) as number[][];
  return getSvgPathFromStroke(pfStroke);
}

function drawingBlockToDataUrl(block: DrawingBlock): string {
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = block.w * scale;
  canvas.height = block.h * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, block.w, block.h);
  for (const s of block.strokes) {
    const pathStr = makePathForBlockStroke(s);
    if (!pathStr) continue;
    const path = new Path2D(pathStr);
    ctx.fillStyle = s.tool === 'highlighter' ? hexToRgba(s.color, 0.35) : s.color;
    ctx.fill(path);
  }
  return canvas.toDataURL('image/png');
}

function getArrowHead(points: FPoint[]) {
  if (points.length < 2) return null;
  let end = points[points.length - 1];
  let prev = points[points.length - 2];
  for (let i = points.length - 2; i >= 0; i--) {
    const candidate = points[i];
    if (Math.hypot(end.x - candidate.x, end.y - candidate.y) > 4) {
      prev = candidate;
      break;
    }
  }
  const angle = Math.atan2(end.y - prev.y, end.x - prev.x);
  const size = 12;
  const wing = Math.PI / 7;
  const p1 = [end.x, end.y];
  const p2 = [end.x - size * Math.cos(angle - wing), end.y - size * Math.sin(angle - wing)];
  const p3 = [end.x - size * Math.cos(angle + wing), end.y - size * Math.sin(angle + wing)];
  return `${p1[0]},${p1[1]} ${p2[0]},${p2[1]} ${p3[0]},${p3[1]}`;
}

export default function InfiniteCanvas({
  activeTool,
  activeColor,
  brushSize,
  onDirtyChange,
  onDrawingBlockCreated,
}: InfiniteCanvasProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const textRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const pointerPointsRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{
    startDistance: number;
    startZoom: number;
    startViewX: number;
    startViewY: number;
    centerClientX: number;
    centerClientY: number;
    centerWorldX: number;
    centerWorldY: number;
  } | null>(null);
  const gestureRef = useRef<{
    mode: PointerMode;
    pointerId: number | null;
    startClientX: number;
    startClientY: number;
    startViewX: number;
    startViewY: number;
  }>({
    mode: 'idle',
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    startViewX: 0,
    startViewY: 0,
  });
  const draftStrokeRef = useRef<FPoint[]>([]);
  const drawingBlockIdRef = useRef<string | null>(null);
  const textDragRef = useRef<{
    blockId: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const [draftPoints, setDraftPoints] = useState<FPoint[]>([]);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [pendingFocusTextId, setPendingFocusTextId] = useState<string | null>(null);
  const [dragTextPreview, setDragTextPreview] = useState<{ id: string; x: number; y: number } | null>(null);
  const [ingestingBlockId, setIngestingBlockId] = useState<string | null>(null);

  const strokes = useFreeformCanvasStore((s: InternalStore) => s.strokes);
  const textBlocks = useFreeformCanvasStore((s: InternalStore) => s.textBlocks);
  const drawingBlocks = useFreeformCanvasStore((s: InternalStore) => s.drawingBlocks);
  const viewX = useFreeformCanvasStore((s: InternalStore) => s.viewX);
  const viewY = useFreeformCanvasStore((s: InternalStore) => s.viewY);
  const zoom = useFreeformCanvasStore((s: InternalStore) => s.zoom);
  const setView = useFreeformCanvasStore((s: InternalStore) => s.setView);
  const addStroke = useFreeformCanvasStore((s: InternalStore) => s.addStroke);
  const deleteStroke = useFreeformCanvasStore((s: InternalStore) => s.deleteStroke);
  const addTextBlock = useFreeformCanvasStore((s: InternalStore) => s.addTextBlock);
  const updateTextBlock = useFreeformCanvasStore((s: InternalStore) => s.updateTextBlock);
  const patchTextBlock = useFreeformCanvasStore((s: InternalStore) => s.patchTextBlock);
  const deleteTextBlock = useFreeformCanvasStore((s: InternalStore) => s.deleteTextBlock);
  const addDrawingBlock = useFreeformCanvasStore((s: InternalStore) => s.addDrawingBlock);
  const addStrokeToDrawingBlock = useFreeformCanvasStore((s: InternalStore) => s.addStrokeToDrawingBlock);
  const removeStrokeFromDrawingBlock = useFreeformCanvasStore((s: InternalStore) => s.removeStrokeFromDrawingBlock);
  const deleteDrawingBlock = useFreeformCanvasStore((s: InternalStore) => s.deleteDrawingBlock);

  useEffect(() => {
    if (!pendingFocusTextId) return;
    const el = textRefs.current[pendingFocusTextId];
    if (!el) return;
    el.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    setEditingTextId(pendingFocusTextId);
    setPendingFocusTextId(null);
  }, [pendingFocusTextId, textBlocks]);

  function toWorld(clientX: number, clientY: number) {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
      x: sx / zoom - viewX,
      y: sy / zoom - viewY,
    };
  }

  function eraseAt(clientX: number, clientY: number) {
    const world = toWorld(clientX, clientY);
    let bestHit: { id: string; distance: number } | null = null;
    for (const stroke of useFreeformCanvasStore.getState().strokes) {
      const threshold = Math.max(10, brushSize * 1.15) + Math.max(1, stroke.width) * 0.55;
      const distance = strokeDistanceAtPoint(stroke, world.x, world.y, threshold);
      if (distance <= threshold) {
        if (!bestHit || distance < bestHit.distance) {
          bestHit = { id: stroke.id, distance };
        }
      }
    }
    if (bestHit) {
      deleteStroke(bestHit.id);
      onDirtyChange?.(Date.now());
    }
  }

  function beginTextDrag(block: TextBlock, e: ReactPointerEvent<HTMLDivElement>) {
    textDragRef.current = {
      blockId: block.id,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: block.x,
      startY: block.y,
      moved: false,
    };
    setDragTextPreview({ id: block.id, x: block.x, y: block.y });
    setEditingTextId(null);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function moveTextDrag(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = textDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const nextX = drag.startX + (e.clientX - drag.startClientX) / zoom;
    const nextY = drag.startY + (e.clientY - drag.startClientY) / zoom;
    if (!drag.moved && Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY) > 3) {
      drag.moved = true;
    }
    setDragTextPreview({ id: drag.blockId, x: nextX, y: nextY });
  }

  function endTextDrag(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = textDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const preview = dragTextPreview && dragTextPreview.id === drag.blockId ? dragTextPreview : null;
    if (preview && drag.moved) {
      patchTextBlock(drag.blockId, {
        x: preview.x,
        y: preview.y,
        isEditing: false,
      });
      onDirtyChange?.(Date.now());
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    textDragRef.current = null;
    setDragTextPreview(null);
  }

  function startPinchIfNeeded() {
    const pointers = [...pointerPointsRef.current.values()];
    if (pointers.length !== 2) return;
    const [a, b] = pointers;
    const centerClientX = (a.x + b.x) / 2;
    const centerClientY = (a.y + b.y) / 2;
    const centerWorld = toWorld(centerClientX, centerClientY);
    pinchRef.current = {
      startDistance: Math.hypot(b.x - a.x, b.y - a.y),
      startZoom: zoom,
      startViewX: viewX,
      startViewY: viewY,
      centerClientX,
      centerClientY,
      centerWorldX: centerWorld.x,
      centerWorldY: centerWorld.y,
    };
    gestureRef.current.mode = 'pan';
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('[contenteditable="true"]')) {
      return;
    }
    pointerPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.pointerType === 'touch' && pointerPointsRef.current.size >= 2) {
      startPinchIfNeeded();
      return;
    }

    if (activeTool === 'eraser') {
      const world = toWorld(e.clientX, e.clientY);
      const block = [...drawingBlocks]
        .reverse()
        .find(
          (b: DrawingBlock) =>
            world.x >= b.x &&
            world.x <= b.x + b.w &&
            world.y >= b.y &&
            world.y <= b.y + b.h,
        );
      if (block) {
        const localX = world.x - block.x;
        const localY = world.y - block.y;
        const threshold = Math.max(10, brushSize * 1.15);
        let bestIndex = -1;
        let bestDist = Number.POSITIVE_INFINITY;
        block.strokes.forEach((s: DrawingBlockStroke, idx: number) => {
          const d = strokeDistanceAtPointBlockStroke(s, localX, localY, threshold);
          if (d <= threshold && d < bestDist) {
            bestDist = d;
            bestIndex = idx;
          }
        });
        if (bestIndex >= 0) {
          removeStrokeFromDrawingBlock(block.id, bestIndex);
          onDirtyChange?.(Date.now());
          e.preventDefault();
          return;
        }
      }
      gestureRef.current = {
        mode: 'erase',
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startViewX: viewX,
        startViewY: viewY,
      };
      eraseAt(e.clientX, e.clientY);
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (activeTool === 'select') {
      gestureRef.current = {
        mode: 'pan',
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startViewX: viewX,
        startViewY: viewY,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    // Pen = draw; touch/finger with text tool = don't create text block (so finger can pan elsewhere)
    // Only mouse + text tool creates a text block on tap
    if (activeTool === 'text' && e.pointerType === 'mouse') {
      const world = toWorld(e.clientX, e.clientY);
      const id = addTextBlock({
        text: '',
        x: world.x,
        y: world.y,
        w: 220,
        fontSize: 18,
        color: activeColor,
        timestamp: Date.now(),
        isEditing: true,
      });
      setPendingFocusTextId(id);
      onDirtyChange?.(Date.now());
      e.preventDefault();
      return;
    }

    if (activeTool === 'drawingBox') {
      const world = toWorld(e.clientX, e.clientY);
      addDrawingBlock({
        x: world.x,
        y: world.y,
        w: 280,
        h: 180,
        strokes: [],
        timestamp: Date.now(),
      });
      onDirtyChange?.(Date.now());
      onDrawingBlockCreated?.();
      e.preventDefault();
      return;
    }

    const world = toWorld(e.clientX, e.clientY);
    if (activeTool === 'pen' || activeTool === 'highlighter') {
      const block = [...drawingBlocks]
        .reverse()
        .find(
          (b: DrawingBlock) =>
            world.x >= b.x &&
            world.x <= b.x + b.w &&
            world.y >= b.y &&
            world.y <= b.y + b.h,
        );
      if (block) drawingBlockIdRef.current = block.id;
    }

    const p: FPoint = {
      x: world.x,
      y: world.y,
      pressure: e.pressure && Number.isFinite(e.pressure) ? e.pressure : 0.5,
    };
    draftStrokeRef.current = [p];
    setDraftPoints([p]);
    gestureRef.current = {
      mode: 'draw',
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startViewX: viewX,
      startViewY: viewY,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (pointerPointsRef.current.has(e.pointerId)) {
      pointerPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (pointerPointsRef.current.size >= 2 && pinchRef.current) {
      const points = [...pointerPointsRef.current.values()];
      if (points.length < 2) return;
      const [a, b] = points;
      const currentDistance = Math.hypot(b.x - a.x, b.y - a.y);
      const nextZoom = clamp(
        pinchRef.current.startZoom * (currentDistance / Math.max(1, pinchRef.current.startDistance)),
        0.1,
        4,
      );
      const centerClientX = (a.x + b.x) / 2;
      const centerClientY = (a.y + b.y) / 2;
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const sx = centerClientX - rect.left;
      const sy = centerClientY - rect.top;
      const nextViewX = sx / nextZoom - pinchRef.current.centerWorldX;
      const nextViewY = sy / nextZoom - pinchRef.current.centerWorldY;
      setView(nextViewX, nextViewY, nextZoom);
      return;
    }

    const gesture = gestureRef.current;
    if (gesture.pointerId !== e.pointerId) return;

    if (gesture.mode === 'pan') {
      const dx = (e.clientX - gesture.startClientX) / zoom;
      const dy = (e.clientY - gesture.startClientY) / zoom;
      setView(gesture.startViewX + dx, gesture.startViewY + dy, zoom);
      return;
    }

    if (gesture.mode === 'erase') {
      eraseAt(e.clientX, e.clientY);
      return;
    }

    if (gesture.mode === 'draw') {
      const world = toWorld(e.clientX, e.clientY);
      const nextPoint: FPoint = {
        x: world.x,
        y: world.y,
        pressure: e.pressure && Number.isFinite(e.pressure) ? e.pressure : 0.5,
      };
      const pts = draftStrokeRef.current;
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(last.x - nextPoint.x, last.y - nextPoint.y) >= 0.75) {
        const updated = [...pts, nextPoint];
        draftStrokeRef.current = updated;
        setDraftPoints(updated);
      }
    }
  }

  function finalizeGesture(e?: ReactPointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    if (gesture.mode === 'draw' && draftStrokeRef.current.length > 1) {
      const blockId = drawingBlockIdRef.current;
      if (blockId) {
        const block = drawingBlocks.find((b: DrawingBlock) => b.id === blockId);
        if (block) {
          const localPoints: FPoint[] = draftStrokeRef.current.map((p) => ({
            x: p.x - block.x,
            y: p.y - block.y,
            pressure: p.pressure ?? 0.5,
          }));
          addStrokeToDrawingBlock(blockId, {
            tool: activeTool as 'pen' | 'highlighter',
            color: activeColor,
            width: brushSize,
            points: localPoints,
            timestamp: Date.now(),
          });
        }
        drawingBlockIdRef.current = null;
      } else {
        const bbox = getBoundingBox(draftStrokeRef.current);
        addStroke({
          tool: activeTool,
          color: activeColor,
          width: brushSize,
          points: draftStrokeRef.current,
          timestamp: Date.now(),
          canvasX: bbox.x,
          canvasY: bbox.y,
          canvasW: bbox.w,
          canvasH: bbox.h,
        });
      }
      onDirtyChange?.(Date.now());
    }
    draftStrokeRef.current = [];
    setDraftPoints([]);
    if (e && 'currentTarget' in e && gesture.pointerId !== null) {
      try {
        (e.currentTarget as Element).releasePointerCapture(gesture.pointerId);
      } catch {
        // ignore capture release errors
      }
    }
    gestureRef.current = {
      mode: 'idle',
      pointerId: null,
      startClientX: 0,
      startClientY: 0,
      startViewX: viewX,
      startViewY: viewY,
    };
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    pointerPointsRef.current.delete(e.pointerId);
    if (pointerPointsRef.current.size < 2) pinchRef.current = null;
    if (gestureRef.current.pointerId === e.pointerId) {
      finalizeGesture(e);
    }
  }

  function handleWheel(e: ReactWheelEvent<HTMLDivElement>) {
    e.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const worldX = sx / zoom - viewX;
    const worldY = sy / zoom - viewY;
    const nextZoom = clamp(zoom * (1 - e.deltaY * 0.001), 0.1, 4);
    const nextViewX = sx / nextZoom - worldX;
    const nextViewY = sy / nextZoom - worldY;
    setView(nextViewX, nextViewY, nextZoom);
  }

  function handleDoubleClick(e: ReactMouseEvent<HTMLDivElement>) {
    if (activeTool === 'text') return;
    if ((e.target as HTMLElement).closest('[contenteditable="true"]')) return;
    const world = toWorld(e.clientX, e.clientY);
    const id = addTextBlock({
      text: '',
      x: world.x,
      y: world.y,
      w: 240,
      fontSize: 18,
      color: activeColor,
      timestamp: Date.now(),
      isEditing: true,
    });
    setPendingFocusTextId(id);
    onDirtyChange?.(Date.now());
  }

  const draftStrokePath =
    draftPoints.length > 1
      ? getSvgPathFromStroke(
          (getStroke(
            draftPoints.map((p) => [p.x, p.y, p.pressure || 0.5] as [number, number, number]),
            {
              size: brushSize,
              thinning: activeTool === 'highlighter' ? 0 : 0.5,
              smoothing: 0.5,
              streamline: 0.35,
              simulatePressure: true,
            },
          ) as number[][]),
        )
      : '';

  return (
    <div
      ref={viewportRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        touchAction: 'none',
        background:
          'radial-gradient(circle at 20% 10%, rgba(37,99,235,0.06), transparent 45%), radial-gradient(circle at 85% 20%, rgba(16,185,129,0.05), transparent 45%), var(--background)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: WORLD_W,
          height: WORLD_H,
          transformOrigin: '0 0',
          transform: `scale(${zoom}) translate(${viewX}px, ${viewY}px)`,
          backgroundImage:
            'radial-gradient(circle, rgba(107,114,128,0.18) 1px, transparent 1.4px)',
          backgroundSize: '28px 28px',
          backgroundPosition: '0 0',
          border: '1px solid rgba(107,114,128,0.08)',
          borderRadius: 16,
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.2)',
        }}
      >
        <svg
          width={WORLD_W}
          height={WORLD_H}
          viewBox={`0 0 ${WORLD_W} ${WORLD_H}`}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
        >
          {strokes.map((stroke: CanvasStroke) => {
            const path = makePath(stroke);
            if (!path) return null;
            const closed = isClosedLoop(stroke.points);
            const arrow = isArrow(stroke.points) && !closed;
            const fillColor = closed ? hexToRgba(stroke.color, stroke.tool === 'highlighter' ? 0.12 : 0.08) : 'none';
            const opacity = stroke.tool === 'highlighter' ? 0.45 : 1;
            const arrowHead = arrow ? getArrowHead(stroke.points) : null;
            const bbox = getBoundingBox(stroke.points);
            const centerX = bbox.x + bbox.w / 2;
            const centerY = bbox.y + bbox.h / 2;
            return (
              <g key={stroke.id}>
                <path
                  d={path}
                  fill={fillColor}
                  stroke="none"
                  opacity={opacity}
                />
                <path
                  d={path}
                  fill={closed ? fillColor : stroke.color}
                  opacity={opacity}
                  style={{
                    mixBlendMode: stroke.tool === 'highlighter' ? ('multiply' as const) : ('normal' as const),
                    filter: stroke.tool === 'highlighter' ? 'saturate(1.1)' : undefined,
                  }}
                />
                {closed && (
                  <circle
                    cx={centerX}
                    cy={centerY}
                    r={Math.max(10, Math.min(40, Math.max(bbox.w, bbox.h) * 0.18))}
                    fill="none"
                    stroke={hexToRgba(stroke.color, 0.35)}
                    strokeWidth={2}
                    style={{ animation: 'pulse-glow 1s ease-out 1' }}
                  />
                )}
                {arrowHead && (
                  <polygon
                    points={arrowHead}
                    fill={stroke.color}
                    opacity={stroke.tool === 'highlighter' ? 0.55 : 1}
                  />
                )}
              </g>
            );
          })}

          {draftStrokePath && (
            <path
              d={draftStrokePath}
              fill={activeTool === 'highlighter' ? hexToRgba(activeColor, 0.2) : activeColor}
              opacity={activeTool === 'highlighter' ? 0.5 : 1}
            />
          )}
        </svg>

        {textBlocks.map((block: TextBlock) => {
          const previewPos = dragTextPreview?.id === block.id ? dragTextPreview : null;
          const blockX = previewPos?.x ?? block.x;
          const blockY = previewPos?.y ?? block.y;
          const isDraggingThisBlock = !!previewPos;

          return (
            <div
              key={block.id}
              style={{
                position: 'absolute',
                left: blockX,
                top: blockY,
                minWidth: block.w,
                maxWidth: 480,
                padding: '6px 8px',
                borderRadius: 8,
                background:
                  editingTextId === block.id ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.58)',
                border:
                  editingTextId === block.id ? '1px solid var(--accent)' : '1px solid rgba(107,114,128,0.18)',
                boxShadow:
                  isDraggingThisBlock
                    ? '0 12px 28px rgba(0,0,0,0.16)'
                    : editingTextId === block.id
                      ? '0 8px 24px rgba(0,0,0,0.12)'
                      : '0 2px 10px rgba(0,0,0,0.06)',
                backdropFilter: 'blur(6px)',
                cursor:
                  activeTool === 'select'
                    ? isDraggingThisBlock
                      ? 'grabbing'
                      : 'grab'
                    : 'text',
                color: block.color,
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (activeTool === 'select') {
                  e.preventDefault();
                  setEditingTextId(null);
                  beginTextDrag(block, e);
                }
              }}
              onPointerMove={(e) => {
                if (activeTool === 'select') {
                  moveTextDrag(e);
                }
              }}
              onPointerUp={(e) => {
                if (activeTool === 'select') {
                  endTextDrag(e);
                }
              }}
              onPointerCancel={(e) => {
                if (activeTool === 'select') {
                  endTextDrag(e);
                }
              }}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <div
                ref={(el) => {
                  textRefs.current[block.id] = el;
                }}
                contentEditable={activeTool !== 'select'}
                suppressContentEditableWarning
                spellCheck
                onFocus={() => {
                  setEditingTextId(block.id);
                }}
                onBlur={(e) => {
                  const nextText = e.currentTarget.textContent?.trim() || '';
                  setEditingTextId((current) => (current === block.id ? null : current));
                  if (!nextText) {
                    deleteTextBlock(block.id);
                  } else {
                    updateTextBlock(block.id, nextText);
                  }
                  onDirtyChange?.(Date.now());
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    (e.currentTarget as HTMLDivElement).blur();
                  }
                }}
                style={{
                  outline: 'none',
                  minWidth: Math.max(140, block.w - 16),
                  minHeight: block.fontSize * 1.4,
                  whiteSpace: 'pre-wrap',
                  fontSize: block.fontSize,
                  lineHeight: 1.35,
                  color: block.color,
                  caretColor: 'var(--accent)',
                }}
              >
                {block.text}
              </div>
            </div>
          );
        })}

        {drawingBlocks.map((block: DrawingBlock) => {
          const isIngesting = ingestingBlockId === block.id;
          return (
            <div
              key={block.id}
              style={{
                position: 'absolute',
                left: block.x,
                top: block.y,
                width: block.w,
                height: block.h,
                pointerEvents: 'none',
                background: 'rgba(255,255,255,0.92)',
                border: '1px solid rgba(107,114,128,0.25)',
                borderRadius: 10,
                boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
                overflow: 'hidden',
              }}
            >
              <svg
                width={block.w}
                height={block.h}
                viewBox={`0 0 ${block.w} ${block.h}`}
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              >
                {block.strokes.map((s: DrawingBlockStroke, idx: number) => {
                  const path = makePathForBlockStroke(s);
                  if (!path) return null;
                  const fillColor =
                    s.tool === 'highlighter' ? hexToRgba(s.color, 0.35) : s.color;
                  return (
                    <path
                      key={idx}
                      d={path}
                      fill={fillColor}
                      stroke="none"
                      opacity={s.tool === 'highlighter' ? 0.45 : 1}
                    />
                  );
                })}
              </svg>
              <div
                style={{
                  position: 'absolute',
                  top: 6,
                  right: 6,
                  display: 'flex',
                  gap: 6,
                  pointerEvents: 'auto',
                }}
              >
                <button
                  type="button"
                  onClick={async (ev) => {
                    ev.stopPropagation();
                    if (isIngesting || block.strokes.length === 0) return;
                    setIngestingBlockId(block.id);
                    try {
                      const dataUrl = drawingBlockToDataUrl(block);
                      await fetch('/api/lectures/ingest-ink', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          image_data: dataUrl,
                          lecture_title: 'Freeform drawing',
                        }),
                      });
                      deleteDrawingBlock(block.id);
                      onDirtyChange?.(Date.now());
                    } catch (err) {
                      console.error('Ingest drawing block failed:', err);
                    } finally {
                      setIngestingBlockId(null);
                    }
                  }}
                  disabled={isIngesting || block.strokes.length === 0}
                  title="Ingest into knowledge graph"
                  style={{
                    padding: '6px 10px',
                    fontSize: 11,
                    fontWeight: 600,
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    background: isIngesting ? 'var(--muted)' : 'var(--surface)',
                    color: 'var(--ink)',
                    cursor: isIngesting || block.strokes.length === 0 ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isIngesting ? '…' : 'Ingest'}
                </button>
                <button
                  type="button"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    deleteDrawingBlock(block.id);
                    onDirtyChange?.(Date.now());
                  }}
                  title="Remove drawing box"
                  style={{
                    padding: 6,
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    background: 'var(--surface)',
                    color: 'var(--muted)',
                    cursor: 'pointer',
                    fontSize: 14,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
