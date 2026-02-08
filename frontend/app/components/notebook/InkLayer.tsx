'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { getCursorForTool } from '../../lib/cursorUtils';

export type ToolType = 'pen' | 'highlighter' | 'eraser' | 'lasso';

export interface Point {
    x: number;
    y: number;
    pressure: number;
    t: number;
}

export interface Stroke {
    tool: ToolType;
    color: string;
    width: number;
    points: Point[];
    timestamp: number;
}

export interface InkLayerProps {
    strokes: Stroke[];
    onStrokesChange: (strokes: Stroke[]) => void;
    tool: ToolType;
    color: string;
    width: number;
    readOnly?: boolean;
    onPencilActive?: () => void;
    forceActive?: boolean;
    onFinishedDrawing?: () => void;
}

export function InkLayer({
    strokes,
    onStrokesChange,
    tool,
    color,
    width,
    readOnly = false,
    onPencilActive,
    forceActive = false,
    onFinishedDrawing
}: InkLayerProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const contextRef = useRef<CanvasRenderingContext2D | null>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const currentStrokeRef = useRef<Point[]>([]);
    const lastPoint = useRef<Point | null>(null);

    const cursorStyle = React.useMemo(() => {
        if (readOnly) return 'auto';
        if (tool === 'eraser') return getCursorForTool('eraser', color, width);
        if (!forceActive && tool === 'lasso') return 'text';
        if (forceActive || tool !== 'lasso') {
            return getCursorForTool(tool, color, width);
        }
        return 'text';
    }, [tool, color, width, readOnly, forceActive]);

    // Set up canvas context
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d', { desynchronized: true, alpha: true });
        if (!ctx) return;

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        contextRef.current = ctx;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        redraw();
    }, []);

    const redraw = useCallback(() => {
        const canvas = canvasRef.current;
        const ctx = contextRef.current;
        if (!canvas || !ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        strokes.forEach(stroke => drawStroke(ctx, stroke));
    }, [strokes]);

    useEffect(() => {
        redraw();
    }, [strokes, redraw]);

    const drawLine = (ctx: CanvasRenderingContext2D, p1: Point, p2: Point, strokeTool: ToolType, strokeColor: string, strokeWidth: number) => {
        ctx.beginPath();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth * p2.pressure;

        if (strokeTool === 'highlighter') {
            ctx.globalAlpha = 0.3;
            ctx.lineWidth = strokeWidth;
        } else if (strokeTool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = strokeWidth;
        } else {
            ctx.globalAlpha = 1.0;
            ctx.globalCompositeOperation = 'source-over';
        }

        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();

        // Reset composite for next ops
        ctx.globalCompositeOperation = 'source-over';
    };

    const drawStroke = (ctx: CanvasRenderingContext2D, stroke: Stroke) => {
        if (stroke.points.length < 2) return;
        for (let i = 1; i < stroke.points.length; i++) {
            drawLine(ctx, stroke.points[i - 1], stroke.points[i], stroke.tool, stroke.color, stroke.width);
        }
    };

    const getPos = (e: React.PointerEvent): Point => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0, pressure: 0.5, t: Date.now() };
        const rect = canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            pressure: e.pressure || 0.5,
            t: Date.now()
        };
    };

    const handlePointerDown = (e: React.PointerEvent) => {
        if (readOnly) return;

        // Auto-detect pencil
        const isPen = e.pointerType === 'pen';
        const isExplicitTool = tool !== 'lasso'; // Lasso might need selection

        // If it's not a pen and not an explicit drawing tool, don't start drawing
        // This allows mouse/touch to interact with text underneath
        if (!isPen && tool === 'lasso') {
            return;
        }

        if (isPen && tool === 'lasso' && onPencilActive) {
            // Auto-switch to pen if lasso is active but a pen is used
            onPencilActive();
        }

        setIsDrawing(true);
        const pos = getPos(e);
        lastPoint.current = pos;
        currentStrokeRef.current = [pos];

        // Prevent default only if we are actually drawing to stop text selection
        e.stopPropagation();
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDrawing || !contextRef.current || readOnly) return;

        const pos = getPos(e);
        const ctx = contextRef.current;

        if (lastPoint.current) {
            if (tool === 'eraser') {
                // For eraser, we actually want to find and remove strokes or parts of strokes
                // Simple implementation: just draw "destination-out" for now
                drawLine(ctx, lastPoint.current, pos, tool, color, width);
            } else {
                drawLine(ctx, lastPoint.current, pos, tool, color, width);
            }
        }

        lastPoint.current = pos;
        currentStrokeRef.current.push(pos);
    };

    const handlePointerUp = () => {
        if (!isDrawing) return;
        setIsDrawing(false);

        if (tool === 'eraser') {
            // In a real app, we'd filter out strokes that were hit by the eraser
            // For now, we'll just commit the "erase stroke" which works with destination-out
            const newStroke: Stroke = {
                tool,
                color: 'rgba(0,0,0,1)', // doesn't matter for eraser
                width,
                points: currentStrokeRef.current,
                timestamp: Date.now()
            };
            onStrokesChange([...strokes, newStroke]);
        } else {
            const newStroke: Stroke = {
                tool,
                color,
                width,
                points: currentStrokeRef.current,
                timestamp: Date.now()
            };
            onStrokesChange([...strokes, newStroke]);
        }

        currentStrokeRef.current = [];
        lastPoint.current = null;

        if (onFinishedDrawing) {
            onFinishedDrawing();
        }
    };

    return (
        <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                touchAction: 'none',
                pointerEvents: (readOnly || (!forceActive && tool === 'lasso')) ? 'none' : 'auto',
                zIndex: 10,
                cursor: cursorStyle,
            }}
        />
    );
}
