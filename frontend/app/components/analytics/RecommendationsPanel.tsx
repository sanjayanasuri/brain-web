// frontend/app/components/analytics/RecommendationsPanel.tsx
/**
 * Panel displaying personalized study recommendations.
 */

'use client';

import React from 'react';
import { Recommendation } from '../../state/analyticsStore';
import { dismissRecommendation } from '../../api-client-analytics';

interface RecommendationsPanelProps {
    recommendations: Recommendation[];
    onDismiss: (id: string) => void;
}

export default function RecommendationsPanel({
    recommendations,
    onDismiss
}: RecommendationsPanelProps) {
    const [dismissing, setDismissing] = React.useState<string | null>(null);

    const handleDismiss = async (id: string) => {
        setDismissing(id);
        try {
            await dismissRecommendation(id);
            onDismiss(id);
        } catch (error) {
            console.error('Failed to dismiss recommendation:', error);
        } finally {
            setDismissing(null);
        }
    };

    const getPriorityColor = (priority: string): string => {
        switch (priority) {
            case 'high': return '#e74c3c';
            case 'medium': return '#f39c12';
            case 'low': return '#3498db';
            default: return '#95a5a6';
        }
    };

    const getPriorityIcon = (priority: string): string => {
        switch (priority) {
            case 'high': return '!';
            case 'medium': return '•';
            case 'low': return '•';
            default: return '•';
        }
    };

    const getActionLabel = (action?: string): string => {
        switch (action) {
            case 'start_session': return 'Start Session';
            case 'review_concepts': return 'Review';
            default: return 'Take Action';
        }
    };

    if (!recommendations || recommendations.length === 0) {
        return (
            <div style={{
                padding: '40px',
                textAlign: 'center',
                color: '#27ae60',
                background: 'white',
                borderRadius: '12px',
                border: '1px solid rgba(0, 0, 0, 0.1)',
            }}>
                <div style={{ fontSize: '14px', marginBottom: '12px', color: '#27ae60', fontWeight: 700 }}>Success</div>
                <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>
                    You're all caught up!
                </div>
                <div style={{ fontSize: '14px', color: '#7f8c8d' }}>
                    No recommendations at the moment. Keep up the great work!
                </div>
            </div>
        );
    }

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
                Recommendations
            </h3>

            <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
            }}>
                {recommendations.map((rec) => (
                    <div
                        key={rec.id}
                        style={{
                            padding: '16px',
                            borderRadius: '8px',
                            border: `2px solid ${getPriorityColor(rec.priority)}20`,
                            background: `${getPriorityColor(rec.priority)}05`,
                            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translateX(4px)';
                            e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateX(0)';
                            e.currentTarget.style.boxShadow = 'none';
                        }}
                    >
                        <div style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '12px',
                        }}>
                            {/* Priority Icon */}
                            <div style={{
                                fontSize: '20px',
                                flexShrink: 0,
                            }}>
                                {getPriorityIcon(rec.priority)}
                            </div>

                            {/* Content */}
                            <div style={{ flex: 1 }}>
                                <div style={{
                                    fontSize: '14px',
                                    color: '#2c3e50',
                                    lineHeight: '1.5',
                                    marginBottom: '12px',
                                }}>
                                    {rec.message}
                                </div>

                                {/* Actions */}
                                <div style={{
                                    display: 'flex',
                                    gap: '8px',
                                    alignItems: 'center',
                                }}>
                                    {rec.action && (
                                        <button
                                            style={{
                                                padding: '6px 12px',
                                                borderRadius: '6px',
                                                border: 'none',
                                                background: getPriorityColor(rec.priority),
                                                color: 'white',
                                                fontSize: '12px',
                                                fontWeight: 600,
                                                cursor: 'pointer',
                                                transition: 'opacity 0.2s ease',
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.opacity = '0.9';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.opacity = '1';
                                            }}
                                        >
                                            {getActionLabel(rec.action)}
                                        </button>
                                    )}

                                    <button
                                        onClick={() => handleDismiss(rec.id)}
                                        disabled={dismissing === rec.id}
                                        style={{
                                            padding: '6px 12px',
                                            borderRadius: '6px',
                                            border: '1px solid rgba(0, 0, 0, 0.1)',
                                            background: 'white',
                                            color: '#7f8c8d',
                                            fontSize: '12px',
                                            fontWeight: 600,
                                            cursor: dismissing === rec.id ? 'not-allowed' : 'pointer',
                                            opacity: dismissing === rec.id ? 0.5 : 1,
                                            transition: 'background 0.2s ease',
                                        }}
                                        onMouseEnter={(e) => {
                                            if (dismissing !== rec.id) {
                                                e.currentTarget.style.background = '#f8f9fa';
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.background = 'white';
                                        }}
                                    >
                                        {dismissing === rec.id ? 'Dismissing...' : 'Dismiss'}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Timestamp */}
                        <div style={{
                            marginTop: '8px',
                            fontSize: '11px',
                            color: '#95a5a6',
                            paddingLeft: '32px',
                        }}>
                            {new Date(rec.created_at).toLocaleString()}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
