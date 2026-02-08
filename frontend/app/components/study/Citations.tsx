// frontend/app/components/study/Citations.tsx
'use client';

import React from 'react';
import { Excerpt } from '../../state/studyStore';

interface CitationsProps {
    excerpts: Excerpt[];
    onCitationClick?: (excerpt: Excerpt) => void;
}

export default function Citations({ excerpts, onCitationClick }: CitationsProps) {
    if (!excerpts || excerpts.length === 0) {
        return null;
    }

    return (
        <div style={{
            marginTop: '16px',
            padding: '12px',
            background: 'rgba(0,0,0,0.02)',
            borderRadius: '12px',
            border: '1px solid rgba(0,0,0,0.06)',
        }}>
            <h4 style={{
                margin: '0 0 12px 0',
                fontSize: '12px',
                fontWeight: '600',
                color: 'var(--ink)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
            }}>
                Citations
            </h4>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {excerpts.slice(0, 5).map((excerpt, idx) => (
                    <button
                        key={excerpt.excerpt_id}
                        onClick={() => onCitationClick?.(excerpt)}
                        style={{
                            padding: '12px 14px',
                            background: 'white',
                            border: '1px solid rgba(0,0,0,0.06)',
                            borderRadius: '12px',
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                            boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = '#3b82f6';
                            e.currentTarget.style.boxShadow = '0 8px 24px rgba(59, 130, 246, 0.12)';
                            e.currentTarget.style.transform = 'translateY(-1px)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = 'rgba(0,0,0,0.06)';
                            e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.02)';
                            e.currentTarget.style.transform = 'translateY(0)';
                        }}
                    >
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: '8px',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{
                                    fontSize: '9px',
                                    fontWeight: '700',
                                    color: 'white',
                                    background: getSourceColor(excerpt.source_type),
                                    padding: '2px 6px',
                                    borderRadius: '100px',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.4px',
                                }}>
                                    {excerpt.source_type}
                                </span>
                            </div>
                            <span style={{
                                fontSize: '11px',
                                fontWeight: '500',
                                color: 'var(--ink-subtle)',
                            }}>
                                {Math.round(excerpt.relevance_score * 100)}% Match
                            </span>
                        </div>

                        <p style={{
                            margin: 0,
                            fontSize: '13px',
                            color: 'var(--ink)',
                            lineHeight: '1.5',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical',
                            fontWeight: 450,
                        }}>
                            {excerpt.content}
                        </p>

                        {excerpt.metadata?.title && (
                            <div style={{
                                marginTop: '10px',
                                paddingTop: '8px',
                                borderTop: '1px solid rgba(0,0,0,0.03)',
                                fontSize: '11px',
                                color: 'var(--ink-light)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                            }}>
                                <span style={{ opacity: 0.6 }}>From</span>
                                <span style={{ fontWeight: 500 }}>{excerpt.metadata.title}</span>
                            </div>
                        )}
                    </button>
                ))}
            </div>
        </div>
    );
}

function getSourceColor(sourceType: string): string {
    switch (sourceType) {
        case 'quote':
            return '#3b82f6';
        case 'lecture':
            return '#8b5cf6';
        case 'artifact':
            return '#10b981';
        case 'note':
            return '#f59e0b';
        default:
            return '#6b7280';
    }
}
