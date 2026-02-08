// frontend/app/components/analytics/SessionHistory.tsx
/**
 * Detailed list of past study sessions.
 */

'use client';

import React from 'react';

interface Session {
    id: string;
    started_at: string;
    ended_at?: string;
    topic_id?: string;
    current_mode: string;
    mode_inertia: number;
    task_count?: number;
    avg_score?: number;
}

interface SessionHistoryProps {
    sessions: Session[];
}

export default function SessionHistory({ sessions }: SessionHistoryProps) {
    if (!sessions || sessions.length === 0) {
        return (
            <div style={{
                padding: '40px',
                textAlign: 'center',
                color: '#95a5a6',
                background: 'white',
                borderRadius: '12px',
                border: '1px solid rgba(0, 0, 0, 0.1)',
            }}>
                No session history available yet. Complete some study sessions!
            </div>
        );
    }

    const getModeIcon = (mode: string): string => {
        switch (mode.toLowerCase()) {
            case 'explain': return 'Aim';
            case 'typing': return 'Type';
            case 'drawing': return 'Draw';
            case 'voice': return 'Voice';
            default: return 'Gen';
        }
    };

    const getStatusColor = (session: Session): string => {
        if (!session.ended_at) return '#f39c12'; // In progress
        if (session.avg_score && session.avg_score >= 0.8) return '#27ae60'; // Excellent
        if (session.avg_score && session.avg_score >= 0.6) return '#3498db'; // Good
        return '#e74c3c'; // Needs improvement
    };

    const getStatusLabel = (session: Session): string => {
        if (!session.ended_at) return 'In Progress';
        if (session.avg_score && session.avg_score >= 0.8) return 'Excellent';
        if (session.avg_score && session.avg_score >= 0.6) return 'Good';
        return 'Needs Work';
    };

    const formatDuration = (started: string, ended?: string): string => {
        if (!ended) return 'Ongoing';

        const start = new Date(started);
        const end = new Date(ended);
        const minutes = Math.floor((end.getTime() - start.getTime()) / 60000);

        if (minutes < 60) return `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}h ${mins}m`;
    };

    return (
        <div style={{
            padding: '20px',
            background: 'white',
            borderRadius: '12px',
            border: '1px solid rgba(0, 0, 0, 0.1)',
        }}>
            <h3 style={{
                margin: '0 0 16px 0',
                fontSize: '16px',
                fontWeight: 600,
                color: '#2c3e50',
            }}>
                Session History
            </h3>

            <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
            }}>
                {sessions.map((session) => (
                    <div
                        key={session.id}
                        style={{
                            padding: '16px',
                            borderRadius: '8px',
                            border: '1px solid rgba(0, 0, 0, 0.1)',
                            background: 'rgba(0, 0, 0, 0.01)',
                            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translateY(-2px)';
                            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = 'none';
                        }}
                    >
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            marginBottom: '12px',
                        }}>
                            {/* Left: Date & Mode */}
                            <div>
                                <div style={{
                                    fontSize: '14px',
                                    fontWeight: 600,
                                    color: '#2c3e50',
                                    marginBottom: '4px',
                                }}>
                                    {getModeIcon(session.current_mode)} {session.current_mode} Mode
                                </div>
                                <div style={{
                                    fontSize: '12px',
                                    color: '#7f8c8d',
                                }}>
                                    {new Date(session.started_at).toLocaleString()}
                                </div>
                            </div>

                            {/* Right: Status Badge */}
                            <div style={{
                                padding: '4px 12px',
                                borderRadius: '12px',
                                background: `${getStatusColor(session)}20`,
                                color: getStatusColor(session),
                                fontSize: '12px',
                                fontWeight: 600,
                            }}>
                                {getStatusLabel(session)}
                            </div>
                        </div>

                        {/* Stats Grid */}
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(4, 1fr)',
                            gap: '16px',
                            fontSize: '13px',
                        }}>
                            <div>
                                <div style={{ color: '#7f8c8d', marginBottom: '4px' }}>Duration</div>
                                <div style={{ fontWeight: 600, color: '#2c3e50' }}>
                                    {formatDuration(session.started_at, session.ended_at)}
                                </div>
                            </div>
                            <div>
                                <div style={{ color: '#7f8c8d', marginBottom: '4px' }}>Tasks</div>
                                <div style={{ fontWeight: 600, color: '#2c3e50' }}>
                                    {session.task_count ?? 0}
                                </div>
                            </div>
                            <div>
                                <div style={{ color: '#7f8c8d', marginBottom: '4px' }}>Avg Score</div>
                                <div style={{ fontWeight: 600, color: '#2c3e50' }}>
                                    {session.avg_score ? `${(session.avg_score * 100).toFixed(0)}%` : 'N/A'}
                                </div>
                            </div>
                            <div>
                                <div style={{ color: '#7f8c8d', marginBottom: '4px' }}>Inertia</div>
                                <div style={{ fontWeight: 600, color: '#2c3e50' }}>
                                    {(session.mode_inertia * 100).toFixed(0)}%
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
