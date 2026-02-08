// frontend/app/components/study/TaskCard.tsx
/**
 * TaskCard component - displays current task prompt and context.
 * Phase 2: Shows task type, prompt, and collapsible context excerpts.
 */

'use client';

import { useState } from 'react';
import { Excerpt } from '../../state/studyStore';

interface TaskCardProps {
    taskType: string;
    prompt: string;
    excerpts: Excerpt[];
    rubric?: any;
    compact?: boolean;
}

const TASK_TYPE_LABELS: Record<string, { label: string; emoji: string; color: string }> = {
    clarify: { label: 'Clarify', emoji: '💡', color: '#3498db' },
    define_example: { label: 'Define + Example', emoji: '📖', color: '#9b59b6' },
    explain_back: { label: 'Teach Back', emoji: '🎓', color: '#e74c3c' },
    multiple_choice: { label: 'Quiz', emoji: '❓', color: '#f39c12' },
};

export default function TaskCard({ taskType, prompt, excerpts, rubric, compact = false }: TaskCardProps) {
    const [showContext, setShowContext] = useState(false);

    const typeInfo = TASK_TYPE_LABELS[taskType] || {
        label: taskType,
        emoji: '📝',
        color: '#95a5a6'
    };

    const isMCQ = taskType === 'multiple_choice';
    const options = rubric?.options || [];

    return (
        <div style={{
            background: compact ? '#f8f9fa' : 'white',
            border: '1px solid #e0e0e0',
            borderRadius: compact ? '4px 16px 16px 16px' : '16px',
            padding: compact ? '12px 16px' : '20px',
            marginBottom: '12px',
            boxShadow: compact ? 'none' : '0 4px 12px rgba(0,0,0,0.05)',
        }}>
            {/* Task Type Badge */}
            <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 12px',
                background: typeInfo.color,
                color: 'white',
                borderRadius: '16px',
                fontSize: '13px',
                fontWeight: 600,
                marginBottom: '12px',
            }}>
                <span>{typeInfo.emoji}</span>
                <span>{typeInfo.label}</span>
            </div>

            {/* Prompt */}
            <div style={{
                fontSize: isMCQ ? '16px' : '15px',
                fontWeight: isMCQ ? 600 : 400,
                lineHeight: '1.6',
                color: '#2c3e50',
                whiteSpace: 'pre-wrap',
                marginBottom: '16px',
            }}>
                {prompt}
            </div>

            {/* MCQ Options (View Only) */}
            {isMCQ && options.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
                    {options.map((option: string, idx: number) => (
                        <div key={idx} style={{
                            padding: '10px 14px',
                            background: '#f1f2f6',
                            border: '1px solid #dfe4ea',
                            borderRadius: '8px',
                            fontSize: '14px',
                            color: '#2f3542',
                            display: 'flex',
                            gap: '10px'
                        }}>
                            <span style={{ fontWeight: 700, opacity: 0.5 }}>{String.fromCharCode(65 + idx)}</span>
                            {option}
                        </div>
                    ))}
                </div>
            )}

            {/* Context Toggle */}
            {excerpts.length > 0 && (
                <div>
                    <button
                        onClick={() => setShowContext(!showContext)}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#3498db',
                            fontSize: '13px',
                            cursor: 'pointer',
                            padding: '4px 0',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                        }}
                    >
                        <span style={{
                            transform: showContext ? 'rotate(90deg)' : 'rotate(0deg)',
                            transition: 'transform 0.2s',
                            display: 'inline-block',
                        }}>▶</span>
                        <span>{showContext ? 'Hide' : 'Show'} Context ({excerpts.length})</span>
                    </button>

                    {/* Context Excerpts */}
                    {showContext && (
                        <div style={{
                            marginTop: '12px',
                            padding: '12px',
                            background: '#f8f9fa',
                            borderRadius: '6px',
                            maxHeight: '200px',
                            overflowY: 'auto',
                        }}>
                            {excerpts.map((excerpt, idx) => (
                                <div
                                    key={excerpt.excerpt_id}
                                    style={{
                                        marginBottom: idx < excerpts.length - 1 ? '12px' : '0',
                                        paddingBottom: idx < excerpts.length - 1 ? '12px' : '0',
                                        borderBottom: idx < excerpts.length - 1 ? '1px solid #e0e0e0' : 'none',
                                    }}
                                >
                                    <div style={{
                                        fontSize: '11px',
                                        color: '#7f8c8d',
                                        marginBottom: '4px',
                                        textTransform: 'uppercase',
                                        fontWeight: 600,
                                    }}>
                                        {excerpt.source_type} • {(excerpt.relevance_score * 100).toFixed(0)}% relevant
                                    </div>
                                    <div style={{
                                        fontSize: '13px',
                                        color: '#34495e',
                                        lineHeight: '1.5',
                                    }}>
                                        {excerpt.content.substring(0, 150)}
                                        {excerpt.content.length > 150 && '...'}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
