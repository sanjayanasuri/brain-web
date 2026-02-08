'use client';

import { useState, useEffect } from 'react';

interface SearchResult {
    node_id: string;
    name: string;
    description?: string;
    domain?: string;
    type?: string;
    score?: number;
    related_lectures?: Array<{ lecture_id: string; title: string }>;
}

interface FloatingSearchBubbleProps {
    results: SearchResult[];
    position: { x: number; y: number };
    onClose: () => void;
    onViewInGraph?: (nodeId: string) => void;
    isLoading?: boolean;
}

export default function FloatingSearchBubble({
    results,
    position,
    onClose,
    onViewInGraph,
    isLoading = false,
}: FloatingSearchBubbleProps) {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        // Fade in animation
        setTimeout(() => setIsVisible(true), 10);
    }, []);

    const handleClose = () => {
        setIsVisible(false);
        setTimeout(onClose, 200); // Wait for fade out
    };

    const topResult = results[0];

    return (
        <div
            style={{
                position: 'absolute',
                top: `${position.y}px`,
                left: `${position.x}px`,
                transform: 'translate(-50%, -120%)',
                zIndex: 3000,
                opacity: isVisible ? 1 : 0,
                transition: 'opacity 0.2s ease-in-out',
                pointerEvents: 'auto',
            }}
        >
            {/* Arrow pointing down to lassoed area */}
            <div
                style={{
                    position: 'absolute',
                    bottom: '-8px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 0,
                    height: 0,
                    borderLeft: '8px solid transparent',
                    borderRight: '8px solid transparent',
                    borderTop: '8px solid rgba(255, 255, 255, 0.95)',
                    filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))',
                }}
            />

            <div
                style={{
                    minWidth: '320px',
                    maxWidth: '400px',
                    background: 'rgba(255, 255, 255, 0.95)',
                    backdropFilter: 'blur(20px) saturate(180%)',
                    borderRadius: '16px',
                    boxShadow: '0 12px 48px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)',
                    padding: '16px',
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                }}
            >
                {/* Close button */}
                <button
                    onClick={handleClose}
                    style={{
                        position: 'absolute',
                        top: '12px',
                        right: '12px',
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        border: 'none',
                        background: 'rgba(0,0,0,0.05)',
                        color: '#666',
                        cursor: 'pointer',
                        fontSize: '14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'background 0.2s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.1)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.05)')}
                >
                    ✕
                </button>

                {isLoading ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
                        <div style={{ fontSize: '13px' }}>Searching Brain Web...</div>
                    </div>
                ) : results.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
                        <div style={{ fontSize: '13px' }}>No results found</div>
                    </div>
                ) : (
                    <>
                        {/* Main result */}
                        <div style={{ marginBottom: '12px' }}>
                            <div
                                style={{
                                    fontSize: '16px',
                                    fontWeight: '600',
                                    color: '#1c1c1e',
                                    marginBottom: '6px',
                                    paddingRight: '20px',
                                }}
                            >
                                {topResult.name}
                            </div>
                            {topResult.domain && (
                                <div
                                    style={{
                                        display: 'inline-block',
                                        fontSize: '11px',
                                        fontWeight: '500',
                                        color: '#666',
                                        background: 'rgba(0,0,0,0.05)',
                                        padding: '2px 8px',
                                        borderRadius: '6px',
                                        marginBottom: '8px',
                                    }}
                                >
                                    {topResult.domain}
                                </div>
                            )}
                            {topResult.description && (
                                <div
                                    style={{
                                        fontSize: '13px',
                                        lineHeight: '1.5',
                                        color: '#444',
                                        marginTop: '8px',
                                    }}
                                >
                                    {topResult.description.length > 150
                                        ? topResult.description.substring(0, 150) + '...'
                                        : topResult.description}
                                </div>
                            )}
                        </div>

                        {/* Related lectures */}
                        {topResult.related_lectures && topResult.related_lectures.length > 0 && (
                            <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                                <div style={{ fontSize: '11px', fontWeight: '600', color: '#666', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                    Found in Lectures
                                </div>
                                {topResult.related_lectures.slice(0, 3).map((lecture, idx) => (
                                    <div
                                        key={idx}
                                        style={{
                                            fontSize: '12px',
                                            color: '#2563eb',
                                            padding: '4px 0',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        {lecture.title}
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Actions */}
                        <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
                            {onViewInGraph && (
                                <button
                                    onClick={() => onViewInGraph(topResult.node_id)}
                                    style={{
                                        flex: 1,
                                        padding: '8px 12px',
                                        borderRadius: '10px',
                                        border: 'none',
                                        background: '#1c1c1e',
                                        color: '#fff',
                                        fontSize: '13px',
                                        fontWeight: '600',
                                        cursor: 'pointer',
                                        transition: 'transform 0.1s',
                                    }}
                                    onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
                                    onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                                    onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                                >
                                    View in Graph →
                                </button>
                            )}
                        </div>

                        {/* Additional results count */}
                        {results.length > 1 && (
                            <div style={{ marginTop: '8px', fontSize: '11px', color: '#999', textAlign: 'center' }}>
                                +{results.length - 1} more result{results.length > 2 ? 's' : ''}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
