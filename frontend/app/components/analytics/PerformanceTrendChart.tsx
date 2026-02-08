// frontend/app/components/analytics/PerformanceTrendChart.tsx
/**
 * Line chart showing performance trends over time.
 */

'use client';

import React from 'react';
import { PerformanceTrend } from '../../state/analyticsStore';

interface PerformanceTrendChartProps {
    data: PerformanceTrend[];
}

export default function PerformanceTrendChart({ data }: PerformanceTrendChartProps) {
    if (!data || data.length === 0) {
        return (
            <div style={{
                padding: '40px',
                textAlign: 'center',
                color: '#95a5a6',
                background: 'white',
                borderRadius: '12px',
                border: '1px solid rgba(0, 0, 0, 0.1)',
            }}>
                No performance data available yet. Complete some study sessions to see trends!
            </div>
        );
    }

    // Calculate chart dimensions
    const width = 600;
    const height = 300;
    const padding = { top: 20, right: 20, bottom: 40, left: 50 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Find min/max scores
    const maxScore = Math.max(...data.map(d => Math.max(d.avg_score, d.moving_avg)));
    const minScore = Math.min(...data.map(d => Math.min(d.avg_score, d.moving_avg)));

    // Create points for line
    const points = data.map((d, i) => {
        const x = padding.left + (i / (data.length - 1)) * chartWidth;
        const y = padding.top + chartHeight - ((d.avg_score - minScore) / (maxScore - minScore)) * chartHeight;
        return { x, y, data: d };
    });

    const movingAvgPoints = data.map((d, i) => {
        const x = padding.left + (i / (data.length - 1)) * chartWidth;
        const y = padding.top + chartHeight - ((d.moving_avg - minScore) / (maxScore - minScore)) * chartHeight;
        return { x, y };
    });

    // Create path strings
    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const movingAvgPath = movingAvgPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

    const [hoveredPoint, setHoveredPoint] = React.useState<number | null>(null);

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
                📈 Performance Trends
            </h3>

            <svg width={width} height={height} style={{ overflow: 'visible' }}>
                {/* Grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
                    const y = padding.top + chartHeight - tick * chartHeight;
                    return (
                        <g key={tick}>
                            <line
                                x1={padding.left}
                                y1={y}
                                x2={width - padding.right}
                                y2={y}
                                stroke="#ecf0f1"
                                strokeWidth="1"
                            />
                            <text
                                x={padding.left - 10}
                                y={y + 4}
                                textAnchor="end"
                                fontSize="11"
                                fill="#95a5a6"
                            >
                                {(tick * 100).toFixed(0)}%
                            </text>
                        </g>
                    );
                })}

                {/* Moving average line (dashed) */}
                <path
                    d={movingAvgPath}
                    fill="none"
                    stroke="#e74c3c"
                    strokeWidth="2"
                    strokeDasharray="5,5"
                    opacity="0.6"
                />

                {/* Main line */}
                <path
                    d={linePath}
                    fill="none"
                    stroke="#3498db"
                    strokeWidth="3"
                />

                {/* Data points */}
                {points.map((point, i) => (
                    <circle
                        key={i}
                        cx={point.x}
                        cy={point.y}
                        r={hoveredPoint === i ? 6 : 4}
                        fill="#3498db"
                        stroke="white"
                        strokeWidth="2"
                        style={{ cursor: 'pointer', transition: 'r 0.2s ease' }}
                        onMouseEnter={() => setHoveredPoint(i)}
                        onMouseLeave={() => setHoveredPoint(null)}
                    />
                ))}

                {/* X-axis labels */}
                {points.filter((_, i) => i % Math.ceil(points.length / 6) === 0).map((point, i) => (
                    <text
                        key={i}
                        x={point.x}
                        y={height - padding.bottom + 20}
                        textAnchor="middle"
                        fontSize="11"
                        fill="#95a5a6"
                    >
                        {new Date(point.data.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </text>
                ))}
            </svg>

            {/* Tooltip */}
            {hoveredPoint !== null && (
                <div style={{
                    marginTop: '12px',
                    padding: '12px',
                    background: 'rgba(52, 152, 219, 0.1)',
                    borderRadius: '8px',
                    fontSize: '13px',
                }}>
                    <div><strong>Date:</strong> {new Date(points[hoveredPoint].data.date).toLocaleDateString()}</div>
                    <div><strong>Score:</strong> {(points[hoveredPoint].data.avg_score * 100).toFixed(0)}%</div>
                    <div><strong>Tasks:</strong> {points[hoveredPoint].data.task_count}</div>
                    <div><strong>Sessions:</strong> {points[hoveredPoint].data.session_count}</div>
                </div>
            )}

            {/* Legend */}
            <div style={{
                marginTop: '16px',
                display: 'flex',
                gap: '20px',
                fontSize: '12px',
                color: '#7f8c8d',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '20px', height: '3px', background: '#3498db' }} />
                    <span>Daily Avg</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '20px', height: '3px', background: '#e74c3c', opacity: 0.6 }} />
                    <span>7-Day Avg</span>
                </div>
            </div>
        </div>
    );
}
