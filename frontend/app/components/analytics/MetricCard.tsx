// frontend/app/components/analytics/MetricCard.tsx
/**
 * Metric card component for displaying key performance indicators.
 */

'use client';

import React from 'react';

interface MetricCardProps {
    title: string;
    value: string | number;
    trend?: string;
    icon: string;
    color?: string;
}

export default function MetricCard({
    title,
    value,
    trend,
    icon,
    color = '#3498db'
}: MetricCardProps) {
    const trendIsPositive = trend && trend.startsWith('+');
    const trendColor = trendIsPositive ? '#27ae60' : trend && trend.startsWith('-') ? '#e74c3c' : '#95a5a6';

    return (
        <div style={{
            padding: '20px',
            background: 'white',
            borderRadius: '12px',
            border: '1px solid rgba(0, 0, 0, 0.1)',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
        }}
            onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.05)';
            }}
        >
            {/* Icon */}
            <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                background: `${color}15`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '24px',
                marginBottom: '12px',
            }}>
                {icon}
            </div>

            {/* Title */}
            <div style={{
                fontSize: '13px',
                color: '#7f8c8d',
                marginBottom: '4px',
                fontWeight: 500,
            }}>
                {title}
            </div>

            {/* Value */}
            <div style={{
                fontSize: '28px',
                fontWeight: 700,
                color: '#2c3e50',
                marginBottom: '4px',
            }}>
                {value}
            </div>

            {/* Trend */}
            {trend && (
                <div style={{
                    fontSize: '12px',
                    color: trendColor,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                }}>
                    <span>{trendIsPositive ? '↗' : trend.startsWith('-') ? '↘' : '→'}</span>
                    <span>{trend}</span>
                </div>
            )}
        </div>
    );
}
