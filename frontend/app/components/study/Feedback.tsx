// frontend/app/components/study/Feedback.tsx
/**
 * Feedback component - displays natural language feedback.
 * Phase 2+: Focuses on conversational feedback ("coach") rather than raw scores.
 */

'use client';

import { useState } from 'react';

interface FeedbackProps {
    scores: Record<string, number>;
    compositeScore: number;
    feedbackText: string;
    gapConcepts?: string[];
    suggestedNext?: {
        task_type: string;
        reason: string;
    } | null;
    onNextTask?: () => void;
    onFocusConcept?: (conceptName: string) => void;
}

export default function Feedback({
    scores,
    compositeScore,
    feedbackText,
    gapConcepts = [],
    suggestedNext,
    onNextTask,
    onFocusConcept,
}: FeedbackProps) {
    const [showStats, setShowStats] = useState(false);

    return (
        <div style={{
            background: 'white',
            border: '1px solid #e0e0e0',
            borderRadius: '16px',
            padding: '20px',
            marginBottom: '16px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
        }}>
            {/* Main Feedback Text */}
            <div style={{
                fontSize: '15px',
                lineHeight: '1.6',
                color: '#2c3e50',
                marginBottom: '20px',
            }}>
                {(() => {
                    const parts = feedbackText.split(/(\[\[.*?\]\])/g);
                    return parts.map((part, i) => {
                        const match = part.match(/\[\[(.*?)\]\]/);
                        if (match) {
                            const conceptName = match[1];
                            return (
                                <span
                                    key={i}
                                    style={{
                                        color: 'var(--accent)',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        textDecoration: 'underline',
                                        textDecorationStyle: 'dotted',
                                    }}
                                    onClick={() => onFocusConcept?.(conceptName)}
                                >
                                    {conceptName}
                                </span>
                            );
                        }
                        return <span key={i}>{part}</span>;
                    });
                })()}
            </div>

            {/* Concepts to Review (Quizlet Style Chips) */}
            {gapConcepts.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                    <div style={{
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#7f8c8d',
                        marginBottom: '8px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                    }}>
                        Concepts to Review
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {gapConcepts.map((concept, idx) => (
                            <button
                                key={idx}
                                style={{
                                    padding: '6px 12px',
                                    background: '#f8f9fa',
                                    border: '1px solid var(--border)',
                                    borderRadius: '20px',
                                    fontSize: '13px',
                                    color: 'var(--ink)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    transition: 'all 0.2s',
                                }}
                                onClick={() => {
                                    if (onFocusConcept) {
                                        onFocusConcept(concept);
                                    }
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.borderColor = 'var(--accent)';
                                    e.currentTarget.style.background = '#f1f3f5';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.borderColor = 'var(--border)';
                                    e.currentTarget.style.background = '#f8f9fa';
                                }}
                            >
                                <span>📚</span>
                                {concept}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Hidden Stats Toggle */}
            <div style={{ marginBottom: '20px' }}>
                <button
                    onClick={() => setShowStats(!showStats)}
                    style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#95a5a6',
                        fontSize: '12px',
                        cursor: 'pointer',
                        padding: 0,
                        textDecoration: 'underline',
                    }}
                >
                    {showStats ? 'Hide detailed statistics' : 'View performance stats'}
                </button>

                {showStats && (
                    <div style={{ marginTop: '12px', padding: '12px', background: '#f8f9fa', borderRadius: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                            <span>Overall Score:</span>
                            <strong>{(compositeScore * 100).toFixed(0)}%</strong>
                        </div>
                        {/* Simple breakdown */}
                        {Object.entries(scores).map(([k, v]) => (
                            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#7f8c8d', marginBottom: '4px' }}>
                                <span style={{ textTransform: 'capitalize' }}>{k}</span>
                                <span>{(v * 100).toFixed(0)}%</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Action Area */}
            {onNextTask && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '12px', borderTop: '1px solid #eee' }}>
                    <button
                        onClick={onNextTask}
                        style={{
                            padding: '10px 20px',
                            background: 'var(--accent)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            fontSize: '14px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            boxShadow: '0 2px 8px rgba(59, 130, 246, 0.3)',
                        }}
                    >
                        <span>Continue to Next Task</span>
                        <span>→</span>
                    </button>
                </div>
            )}
        </div>
    );
}
