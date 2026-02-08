// frontend/app/components/analytics/AnalyticsDashboard.tsx
/**
 * Main analytics dashboard component.
 * Displays performance metrics, trends, concept mastery, and recommendations.
 */

'use client';

import React, { useEffect } from 'react';
import { useAnalyticsStore } from '../../state/analyticsStore';
import { fetchAllAnalytics } from '../../api-client-analytics';
import MetricCard from './MetricCard';
import PerformanceTrendChart from './PerformanceTrendChart';
import ConceptMasteryHeatmap from './ConceptMasteryHeatmap';
import RecommendationsPanel from './RecommendationsPanel';

export default function AnalyticsDashboard() {
    const {
        trends,
        mastery,
        velocity,
        recommendations,
        stats,
        isLoading,
        error,
        selectedDateRange,
        setTrends,
        setMastery,
        setVelocity,
        setWeakAreas,
        setRecommendations,
        setStats,
        setLoading,
        setError,
        setDateRange,
        removeRecommendation,
    } = useAnalyticsStore();

    // Fetch analytics data on mount
    useEffect(() => {
        loadAnalytics();
    }, [selectedDateRange]);

    const loadAnalytics = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchAllAnalytics(selectedDateRange);
            setTrends(data.trends);
            setMastery(data.mastery);
            setVelocity(data.velocity);
            setWeakAreas(data.weakAreas);
            setRecommendations(data.recommendations);
            setStats(data.stats);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load analytics');
            console.error('Failed to load analytics:', err);
        } finally {
            setLoading(false);
        }
    };

    if (isLoading && !stats) {
        return (
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '400px',
                gap: '16px',
            }}>
                <div style={{
                    width: '48px',
                    height: '48px',
                    border: '4px solid rgba(0, 0, 0, 0.1)',
                    borderTopColor: '#3498db',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                }} />
                <p style={{
                    margin: 0,
                    fontSize: '14px',
                    color: '#7f8c8d',
                }}>
                    Loading analytics...
                </p>
                <style jsx>{`
                    @keyframes spin {
                        to { transform: rotate(360deg); }
                    }
                `}</style>
            </div>
        );
    }

    if (error) {
        return (
            <div style={{
                padding: '40px',
                textAlign: 'center',
                color: '#e74c3c',
                background: 'white',
                borderRadius: '12px',
                border: '1px solid rgba(231, 76, 60, 0.2)',
            }}>
                <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px', color: '#e74c3c' }}>Notice</div>
                <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>
                    Failed to Load Analytics
                </div>
                <div style={{ fontSize: '14px', color: '#7f8c8d', marginBottom: '16px' }}>
                    {error}
                </div>
                <button
                    onClick={loadAnalytics}
                    style={{
                        padding: '8px 16px',
                        borderRadius: '6px',
                        border: 'none',
                        background: '#3498db',
                        color: 'white',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: 'pointer',
                    }}
                >
                    Retry
                </button>
            </div>
        );
    }

    // Calculate trend for velocity
    const velocityTrend = velocity
        ? `${velocity.weekly_improvement >= 0 ? '+' : ''}${(velocity.weekly_improvement * 100).toFixed(0)}%/week`
        : undefined;

    return (
        <div style={{
            maxWidth: '1200px',
            margin: '0 auto',
            padding: '24px',
        }}>
            {/* Header */}
            <div style={{
                marginBottom: '24px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
            }}>
                <h1 style={{
                    margin: 0,
                    fontSize: '28px',
                    fontWeight: 700,
                    color: '#2c3e50',
                }}>
                    Learning Analytics
                </h1>

                {/* Date Range Selector */}
                <select
                    value={selectedDateRange}
                    onChange={(e) => setDateRange(Number(e.target.value))}
                    style={{
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: '1px solid rgba(0, 0, 0, 0.1)',
                        background: 'white',
                        fontSize: '14px',
                        cursor: 'pointer',
                    }}
                >
                    <option value={7}>Last 7 days</option>
                    <option value={30}>Last 30 days</option>
                    <option value={90}>Last 90 days</option>
                </select>
            </div>

            {/* Key Metrics */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: '16px',
                marginBottom: '24px',
            }}>
                <MetricCard
                    title="Average Score"
                    value={stats ? `${(stats.avg_score * 100).toFixed(0)}%` : '-'}
                    trend={velocityTrend}
                    icon=""
                    color="#3498db"
                />
                <MetricCard
                    title="Sessions Completed"
                    value={stats?.completed_sessions ?? 0}
                    trend={stats ? `${(stats.completion_rate * 100).toFixed(0)}% completion` : undefined}
                    icon=""
                    color="#9b59b6"
                />
                <MetricCard
                    title="Tasks Completed"
                    value={stats?.total_tasks ?? 0}
                    trend={stats ? `${stats.avg_tasks_per_session.toFixed(1)} per session` : undefined}
                    icon=""
                    color="#27ae60"
                />
                <MetricCard
                    title="Learning Velocity"
                    value={velocity ? `${velocity.trend}` : 'N/A'}
                    trend={velocityTrend}
                    icon=""
                    color="#f39c12"
                />
            </div>

            {/* Recommendations */}
            {recommendations.length > 0 && (
                <div style={{ marginBottom: '24px' }}>
                    <RecommendationsPanel
                        recommendations={recommendations}
                        onDismiss={removeRecommendation}
                    />
                </div>
            )}

            {/* Performance Trend Chart */}
            <div style={{ marginBottom: '24px' }}>
                <PerformanceTrendChart data={trends} />
            </div>

            {/* Concept Mastery Heatmap */}
            <div style={{ marginBottom: '24px' }}>
                <ConceptMasteryHeatmap concepts={mastery} />
            </div>

            {/* Refresh Button */}
            <div style={{ textAlign: 'center', marginTop: '32px' }}>
                <button
                    onClick={loadAnalytics}
                    disabled={isLoading}
                    style={{
                        padding: '10px 20px',
                        borderRadius: '8px',
                        border: 'none',
                        background: isLoading ? '#95a5a6' : '#3498db',
                        color: 'white',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: isLoading ? 'not-allowed' : 'pointer',
                        transition: 'background 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                        if (!isLoading) {
                            e.currentTarget.style.background = '#2980b9';
                        }
                    }}
                    onMouseLeave={(e) => {
                        if (!isLoading) {
                            e.currentTarget.style.background = '#3498db';
                        }
                    }}
                >
                    {isLoading ? 'Refreshing...' : 'Refresh Data'}
                </button>
            </div>
        </div>
    );
}
