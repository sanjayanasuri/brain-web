// frontend/app/components/analytics/TaskDistributionChart.tsx
/**
 * Pie chart showing distribution of task types completed.
 */

'use client';

import React from 'react';

interface TaskDistribution {
    task_type: string;
    count: number;
    avg_score: number;
}

interface TaskDistributionChartProps {
    data: TaskDistribution[];
}

export default function TaskDistributionChart({ data }: TaskDistributionChartProps) {
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
                No task distribution data available yet.
            </div>
        );
    }

    const total = data.reduce((sum, item) => sum + item.count, 0);
    const colors = ['#3498db', '#e74c3c', '#27ae60', '#f39c12', '#9b59b6'];

    // Calculate pie chart segments
    let currentAngle = -90; // Start at top
    const segments = data.map((item, index) => {
        const percentage = item.count / total;
        const angle = percentage * 360;
        const startAngle = currentAngle;
        const endAngle = currentAngle + angle;
        currentAngle = endAngle;

        return {
            ...item,
            percentage,
            startAngle,
            endAngle,
            color: colors[index % colors.length],
        };
    });

    const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);

    // Convert polar to cartesian
    const polarToCartesian = (centerX: number, centerY: number, radius: number, angleInDegrees: number) => {
        const angleInRadians = (angleInDegrees * Math.PI) / 180.0;
        return {
            x: centerX + radius * Math.cos(angleInRadians),
            y: centerY + radius * Math.sin(angleInRadians),
        };
    };

    // Create SVG path for pie slice
    const createPieSlice = (startAngle: number, endAngle: number, radius: number) => {
        const start = polarToCartesian(150, 150, radius, endAngle);
        const end = polarToCartesian(150, 150, radius, startAngle);
        const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';

        return [
            'M', 150, 150,
            'L', start.x, start.y,
            'A', radius, radius, 0, largeArcFlag, 0, end.x, end.y,
            'Z',
        ].join(' ');
    };

    const formatTaskType = (type: string): string => {
        return type.split('_').map(word =>
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');
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
                Task Distribution
            </h3>

            <div style={{
                display: 'flex',
                gap: '32px',
                alignItems: 'center',
            }}>
                {/* Pie Chart */}
                <svg width={300} height={300} style={{ flexShrink: 0 }}>
                    {segments.map((segment, index) => (
                        <path
                            key={index}
                            d={createPieSlice(segment.startAngle, segment.endAngle, 120)}
                            fill={segment.color}
                            opacity={hoveredIndex === null || hoveredIndex === index ? 1 : 0.3}
                            style={{
                                cursor: 'pointer',
                                transition: 'opacity 0.2s ease',
                            }}
                            onMouseEnter={() => setHoveredIndex(index)}
                            onMouseLeave={() => setHoveredIndex(null)}
                        />
                    ))}
                </svg>

                {/* Legend */}
                <div style={{ flex: 1 }}>
                    {segments.map((segment, index) => (
                        <div
                            key={index}
                            onMouseEnter={() => setHoveredIndex(index)}
                            onMouseLeave={() => setHoveredIndex(null)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                padding: '12px',
                                borderRadius: '8px',
                                marginBottom: '8px',
                                background: hoveredIndex === index ? 'rgba(0, 0, 0, 0.03)' : 'transparent',
                                cursor: 'pointer',
                                transition: 'background 0.2s ease',
                            }}
                        >
                            <div style={{
                                width: '16px',
                                height: '16px',
                                borderRadius: '4px',
                                background: segment.color,
                                flexShrink: 0,
                            }} />
                            <div style={{ flex: 1 }}>
                                <div style={{
                                    fontSize: '14px',
                                    fontWeight: 600,
                                    color: '#2c3e50',
                                    marginBottom: '2px',
                                }}>
                                    {formatTaskType(segment.task_type)}
                                </div>
                                <div style={{
                                    fontSize: '12px',
                                    color: '#7f8c8d',
                                }}>
                                    {segment.count} tasks ({(segment.percentage * 100).toFixed(0)}%)
                                    • Avg: {(segment.avg_score * 100).toFixed(0)}%
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
