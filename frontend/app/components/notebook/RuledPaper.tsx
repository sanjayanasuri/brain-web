'use client';

import React from 'react';

interface RuledPaperProps {
    type?: 'ruled' | 'grid' | 'blank' | 'dotted';
    showMargin?: boolean;
    lineSpacing?: number; // pixels between lines
    width?: number;
    height?: number;
}

export function RuledPaper({
    type = 'ruled',
    showMargin = true,
    lineSpacing = 28, // College-ruled standard
    width = 816, // 8.5" at 96 DPI
    height = 1056, // 11" at 96 DPI
}: RuledPaperProps) {
    const marginLeft = 80; // Red margin line position
    const headerSpace = 60; // Space at top before first line

    return (
        <svg
            width={width}
            height={height}
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                pointerEvents: 'none',
                zIndex: 0,
            }}
        >
            {/* Paper background */}
            <rect
                width={width}
                height={height}
                fill="#fefdfb"
                style={{
                    filter: 'url(#paper-texture)',
                }}
            />

            {/* Paper texture filter */}
            <defs>
                <filter id="paper-texture">
                    <feTurbulence
                        type="fractalNoise"
                        baseFrequency="0.9"
                        numOctaves="4"
                        result="noise"
                    />
                    <feDiffuseLighting
                        in="noise"
                        lightingColor="#ffffff"
                        surfaceScale="0.5"
                        result="diffLight"
                    >
                        <feDistantLight azimuth="45" elevation="35" />
                    </feDiffuseLighting>
                    <feComposite
                        in="SourceGraphic"
                        in2="diffLight"
                        operator="arithmetic"
                        k1="0"
                        k2="1"
                        k3="0.3"
                        k4="0"
                    />
                </filter>
            </defs>

            {/* Ruled lines */}
            {type === 'ruled' && (
                <>
                    {Array.from({ length: Math.floor((height - headerSpace) / lineSpacing) }).map(
                        (_, i) => {
                            const y = headerSpace + i * lineSpacing;
                            return (
                                <line
                                    key={i}
                                    x1={0}
                                    y1={y}
                                    x2={width}
                                    y2={y}
                                    stroke="#d4e5f7"
                                    strokeWidth="1"
                                    opacity="0.6"
                                />
                            );
                        }
                    )}
                </>
            )}

            {/* Grid lines */}
            {type === 'grid' && (
                <>
                    {/* Horizontal lines */}
                    {Array.from({ length: Math.floor(height / lineSpacing) }).map((_, i) => {
                        const y = i * lineSpacing;
                        return (
                            <line
                                key={`h-${i}`}
                                x1={0}
                                y1={y}
                                x2={width}
                                y2={y}
                                stroke="#e0e0e0"
                                strokeWidth="1"
                                opacity="0.4"
                            />
                        );
                    })}
                    {/* Vertical lines */}
                    {Array.from({ length: Math.floor(width / lineSpacing) }).map((_, i) => {
                        const x = i * lineSpacing;
                        return (
                            <line
                                key={`v-${i}`}
                                x1={x}
                                y1={0}
                                x2={x}
                                y2={height}
                                stroke="#e0e0e0"
                                strokeWidth="1"
                                opacity="0.4"
                            />
                        );
                    })}
                </>
            )}

            {/* Dotted pattern */}
            {type === 'dotted' && (
                <>
                    {Array.from({ length: Math.floor(height / lineSpacing) }).map((_, row) =>
                        Array.from({ length: Math.floor(width / lineSpacing) }).map((_, col) => {
                            const x = col * lineSpacing;
                            const y = row * lineSpacing;
                            return (
                                <circle
                                    key={`${row}-${col}`}
                                    cx={x}
                                    cy={y}
                                    r="1.5"
                                    fill="#d0d0d0"
                                    opacity="0.5"
                                />
                            );
                        })
                    )}
                </>
            )}

            {/* Margin line (red vertical line on left) */}
            {showMargin && type === 'ruled' && (
                <line
                    x1={marginLeft}
                    y1={0}
                    x2={marginLeft}
                    y2={height}
                    stroke="#ef4444"
                    strokeWidth="2"
                    opacity="0.4"
                />
            )}

            {/* Top header line */}
            {type === 'ruled' && (
                <line
                    x1={0}
                    y1={headerSpace}
                    x2={width}
                    y2={headerSpace}
                    stroke="#d4e5f7"
                    strokeWidth="1.5"
                    opacity="0.8"
                />
            )}
        </svg>
    );
}
