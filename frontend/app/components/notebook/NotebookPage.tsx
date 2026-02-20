'use client';

import React from 'react';
import { RuledPaper } from './RuledPaper';
import { InkLayer, type Stroke, type ToolType } from './InkLayer';

type PaperType = 'ruled' | 'grid' | 'blank' | 'dotted' | 'dark';

interface NotebookPageProps {
    pageNumber: number;
    paperType?: PaperType;
    children: React.ReactNode;
    showPageNumber?: boolean;
    strokes: Stroke[];
    onStrokesChange: (strokes: Stroke[]) => void;
    tool: ToolType;
    color: string;
    width: number;
    readOnly?: boolean;
    onPencilActive?: () => void;
}

const PAGE_BG: Record<PaperType, string> = {
    ruled: '#fefdfb',
    blank: '#ffffff',
    grid: '#ffffff',
    dotted: '#ffffff',
    dark: '#1a1a1e',
};

export function NotebookPage({
    pageNumber,
    paperType = 'ruled',
    children,
    showPageNumber = true,
    strokes,
    onStrokesChange,
    tool,
    color,
    width,
    readOnly = false,
    onPencilActive,
}: NotebookPageProps) {
    const PAGE_WIDTH = 816; // 8.5" at 96 DPI
    const PAGE_HEIGHT = 1056; // 11" at 96 DPI

    const [isPenActive, setIsPenActive] = React.useState(false);
    const isDark = paperType === 'dark';
    const pageNumColor = isDark ? '#555' : '#999';

    return (
        <div
            className="notebook-page"
            style={{
                position: 'relative',
                width: `${PAGE_WIDTH}px`,
                height: `${PAGE_HEIGHT}px`,
                margin: '0 auto',
                background: PAGE_BG[paperType] ?? '#fefdfb',
                boxShadow: isDark
                    ? '0 2px 8px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.3)'
                    : '0 2px 8px rgba(0,0,0,0.1), 0 8px 24px rgba(0,0,0,0.08)',
                borderRadius: '2px',
                overflow: 'hidden',
            }}
            onPointerDown={(e) => {
                if (e.pointerType === 'pen') {
                    setIsPenActive(true);
                    onPencilActive?.();
                } else {
                    setIsPenActive(false);
                }
            }}
        >
            {/* Paper background with lines */}
            <RuledPaper
                type={paperType}
                showMargin={paperType === 'ruled'}
                lineSpacing={28}
                width={PAGE_WIDTH}
                height={PAGE_HEIGHT}
            />

            {/* Content layer (text editor and ink) */}
            <div
                style={{
                    position: 'relative',
                    width: '100%',
                    height: '100%',
                    zIndex: 1,
                }}
            >
                {children}
                <InkLayer
                    strokes={strokes}
                    onStrokesChange={onStrokesChange}
                    tool={tool}
                    color={color}
                    width={width}
                    readOnly={readOnly}
                    onPencilActive={onPencilActive}
                />
            </div>

            {/* Page number */}
            {showPageNumber && (
                <div
                    style={{
                        position: 'absolute',
                        bottom: '20px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        fontSize: '11px',
                        color: pageNumColor,
                        fontFamily: 'Georgia, serif',
                        pointerEvents: 'none',
                        zIndex: 2,
                    }}
                >
                    {pageNumber}
                </div>
            )}

            <style jsx>{`
        .notebook-page {
          transition: box-shadow 0.2s ease;
        }

        .notebook-page:hover {
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12), 0 12px 32px rgba(0, 0, 0, 0.1);
        }
      `}</style>
        </div>
    );
}
