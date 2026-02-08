// frontend/app/components/study/Timeline.tsx
/**
 * Timeline component - shows last 5 tasks in session with compact view.
 * Phase 2: Displays task history with scores and expandable details.
 */

'use client';

import { useState } from 'react';

interface TimelineTask {
    taskId: string;
    taskType: string;
    compositeScore?: number;
    createdAt: string;
}

interface TimelineProps {
    tasks: TimelineTask[];
}

const TASK_TYPE_EMOJI: Record<string, string> = {
    clarify: '💡',
    define_example: '📖',
    explain_back: '🎓',
};

export default function Timeline({ tasks }: TimelineProps) {
    const [expanded, setExpanded] = useState(false);

    if (tasks.length === 0) {
        return null;
    }

    const getScoreColor = (score: number): string => {
        if (score >= 0.75) return '#27ae60';
        if (score >= 0.5) return '#f39c12';
        return '#e74c3c';
    };

    return (
        <div style={{
            background: 'white',
            border: '1px solid #e0e0e0',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '16px',
        }}>
            <button
                onClick={() => setExpanded(!expanded)}
                style={{
                    width: '100%',
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                }}
            >
                <div style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#2c3e50',
                }}>
                    Task History ({tasks.length})
                </div>
                <span style={{
                    transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s',
                    color: '#7f8c8d',
                }}>
                    ▶
                </span>
            </button>

            {expanded && (
                <div style={{
                    marginTop: '12px',
                    paddingTop: '12px',
                    borderTop: '1px solid #e0e0e0',
                }}>
                    {tasks.map((task, idx) => (
                        <div
                            key={task.taskId}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                padding: '8px',
                                background: idx % 2 === 0 ? '#f8f9fa' : 'transparent',
                                borderRadius: '4px',
                                marginBottom: '4px',
                            }}
                        >
                            {/* Task Number */}
                            <div style={{
                                width: '24px',
                                height: '24px',
                                borderRadius: '50%',
                                background: '#3498db',
                                color: 'white',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '11px',
                                fontWeight: 600,
                                flexShrink: 0,
                            }}>
                                {idx + 1}
                            </div>

                            {/* Task Type */}
                            <div style={{
                                flex: 1,
                                fontSize: '12px',
                                color: '#34495e',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                            }}>
                                <span>{TASK_TYPE_EMOJI[task.taskType] || '📝'}</span>
                                <span>{task.taskType.replace('_', ' ')}</span>
                            </div>

                            {/* Score */}
                            {task.compositeScore !== undefined && (
                                <div style={{
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    color: getScoreColor(task.compositeScore),
                                    flexShrink: 0,
                                }}>
                                    {(task.compositeScore * 100).toFixed(0)}%
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
