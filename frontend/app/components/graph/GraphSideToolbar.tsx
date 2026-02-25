'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    MousePointer2,
    Lasso,
    Pencil,
    PlusCircle,
    Info,
    Maximize2
} from 'lucide-react';

const MousePointer2Icon = MousePointer2 as any;
const LassoIcon = Lasso as any;
const PencilIcon = Pencil as any;
const PlusCircleIcon = PlusCircle as any;
const InfoIcon = Info as any;
const Maximize2Icon = Maximize2 as any;

export type InteractionMode = 'select' | 'lasso' | 'handwriting';

const INK_COLORS = ['#2980b9', '#c0392b', '#27ae60', '#1c1c1e'];

interface GraphSideToolbarProps {
    mode: InteractionMode;
    onModeChange: (mode: InteractionMode) => void;
    onAddNode: () => void;
    onResetView: () => void;
    showLegend: boolean;
    onToggleLegend: () => void;
    color: string;
    onColorChange: (color: string) => void;
}

export default function GraphSideToolbar({
    mode,
    onModeChange,
    onAddNode,
    onResetView,
    showLegend,
    onToggleLegend,
    color,
    onColorChange
}: GraphSideToolbarProps) {
    const [position, setPosition] = useState({ x: 20, y: 150 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const toolbarRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const saved = localStorage.getItem('graph-sidebar-position');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (typeof window !== 'undefined') {
                    const x = Math.min(Math.max(parsed.x, 0), window.innerWidth - 60);
                    const y = Math.min(Math.max(parsed.y, 0), window.innerHeight - 300);
                    setPosition({ x, y });
                }
            } catch (e) {
                console.warn('Failed to load sidebar position:', e);
            }
        }
    }, []);

    const savePosition = useCallback((pos: { x: number, y: number }) => {
        setPosition(pos);
        localStorage.setItem('graph-sidebar-position', JSON.stringify(pos));
    }, []);

    const handleMouseDown = (e: React.MouseEvent) => {
        const handle = (e.target as HTMLElement).closest('.drag-handle');
        if (handle) {
            setIsDragging(true);
            setDragOffset({
                x: e.clientX - position.x,
                y: e.clientY - position.y
            });
            e.preventDefault();
        }
    };

    useEffect(() => {
        if (!isDragging) return;

        const handleMouseMove = (e: MouseEvent) => {
            const nx = e.clientX - dragOffset.x;
            const ny = e.clientY - dragOffset.y;
            setPosition({ x: nx, y: ny });
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            savePosition(position);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, dragOffset, position, savePosition]);

    return (
        <div
            ref={toolbarRef}
            onMouseDown={handleMouseDown}
            style={{
                position: 'fixed',
                top: `${position.y}px`,
                left: `${position.x}px`,
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                padding: '8px',
                background: 'var(--panel)',
                backdropFilter: 'blur(24px)',
                borderRadius: '26px',
                border: '1px solid var(--border)',
                boxShadow: isDragging
                    ? '0 24px 80px rgba(0,0,0,0.4), 0 0 0 1px var(--primary-border)'
                    : 'var(--shadow)',
                pointerEvents: 'auto',
                width: 'fit-content',
                zIndex: 1000,
                transition: isDragging ? 'none' : 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                userSelect: 'none',
                transform: isDragging ? 'scale(1.05)' : 'scale(1)'
            }}
        >
            {/* Drag Handle */}
            <div className="drag-handle" style={{
                width: '100%',
                height: '20px',
                cursor: 'grab',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '4px',
                color: 'var(--ink-subtle)',
                opacity: 0.5
            }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '2px' }}>
                    {[...Array(6)].map((_, i) => (
                        <div key={i} style={{ width: '3px', height: '3px', background: 'currentColor', borderRadius: '50%' }} />
                    ))}
                </div>
            </div>

            <ToolbarButton
                active={mode === 'select'}
                onClick={() => onModeChange('select')}
                icon={<MousePointer2Icon size={18} />}
                label="Select & Navigate"
            />

            <div style={{ position: 'relative' }}>
                <ToolbarButton
                    active={mode === 'handwriting'}
                    onClick={() => onModeChange(mode === 'handwriting' ? 'select' : 'handwriting')}
                    icon={<PencilIcon size={18} />}
                    label="Sketch & Annotate"
                />

                {/* Color Palette Sub-menu */}
                {mode === 'handwriting' && (
                    <div style={{
                        position: 'absolute',
                        left: '100%',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        marginLeft: '12px',
                        background: 'var(--panel)',
                        backdropFilter: 'blur(16px)',
                        padding: '6px',
                        borderRadius: '16px',
                        border: '1px solid var(--border)',
                        display: 'flex',
                        gap: '6px',
                        animation: 'popIn 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                        boxShadow: 'var(--shadow)'
                    }}>
                        {INK_COLORS.map(c => (
                            <button
                                key={c}
                                onClick={() => onColorChange(c)}
                                style={{
                                    width: '24px',
                                    height: '24px',
                                    borderRadius: '50%',
                                    background: c,
                                    border: color === c ? '2px solid #fff' : 'none',
                                    boxShadow: color === c ? `0 0 0 2px ${c}` : 'none',
                                    cursor: 'pointer',
                                    transition: 'transform 0.1s'
                                }}
                                className="hover:scale-110 active:scale-95"
                            />
                        ))}
                    </div>
                )}
            </div>

            <ToolbarButton
                active={mode === 'lasso'}
                onClick={() => onModeChange(mode === 'lasso' ? 'select' : 'lasso')}
                icon={<LassoIcon size={18} />}
                label="Lasso Selection"
            />

            <div style={{ height: '1px', background: 'var(--border)', margin: '4px 8px' }} />

            <ToolbarButton
                active={false}
                onClick={onAddNode}
                icon={<PlusCircleIcon size={18} />}
                label="Add Node"
            />
            <ToolbarButton
                active={showLegend}
                onClick={onToggleLegend}
                icon={<InfoIcon size={18} />}
                label="View Legend"
                testId="explorer-side-toolbar-legend"
            />
            <ToolbarButton
                active={false}
                onClick={onResetView}
                icon={<Maximize2Icon size={18} />}
                label="Fit to View"
            />

            <style jsx>{`
                @keyframes popIn {
                    from { opacity: 0; transform: translateY(-50%) scale(0.8) translateX(-10px); }
                    to { opacity: 1; transform: translateY(-50%) scale(1) translateX(0); }
                }
            `}</style>
        </div>
    );
}

function ToolbarButton({ active, onClick, icon, label, testId }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string; testId?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={label}
      data-testid={testId}
            style={{
                width: '44px',
                height: '44px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '14px',
                border: active ? '2px solid rgba(255,255,255,0.4)' : '1px solid transparent',
                background: active ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.05)',
                fontSize: '18px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                color: active ? 'var(--ink-strong)' : 'var(--ink)',
                boxShadow: active ? '0 2px 8px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.3)' : 'none'
            }}
            onMouseEnter={(e) => {
                if (!active) {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.15)';
                }
            }}
            onMouseLeave={(e) => {
                if (!active) {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                }
            }}
            onMouseDown={(e) => {
                e.currentTarget.style.transform = 'scale(0.92)';
            }}
            onMouseUp={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
            }}
        >
            {icon}
        </button>
    );
}
