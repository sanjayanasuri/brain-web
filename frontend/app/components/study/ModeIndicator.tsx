// frontend/app/components/study/ModeIndicator.tsx
'use client';

import React from 'react';

interface ModeIndicatorProps {
    currentMode: string;
    inertia: number;
    threshold?: number;
}

export default function ModeIndicator({
    currentMode,
    inertia,
    threshold = 0.7,
}: ModeIndicatorProps) {
    // Determine inertia level color
    const getInertiaColor = () => {
        if (inertia >= threshold) return '#e74c3c'; // High inertia (red)
        if (inertia >= 0.5) return '#f39c12'; // Medium inertia (orange)
        return '#3498db'; // Low inertia (blue)
    };

    // Get mode emoji
    const getModeEmoji = () => {
        switch (currentMode) {
            case 'explain': return '💡';
            case 'typing': return '⌨️';
            case 'voice': return '🎤';
            default: return '📚';
        }
    };

    return (
        <div style={{
            padding: '12px 16px',
            background: 'rgba(0, 0, 0, 0.03)',
            borderRadius: '8px',
            marginBottom: '16px',
            border: '1px solid rgba(0, 0, 0, 0.08)',
        }}>
            {/* Mode Display */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '8px',
            }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                }}>
                    <span style={{ fontSize: '18px' }}>{getModeEmoji()}</span>
                    <span style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        color: 'var(--ink-strong)',
                        textTransform: 'capitalize',
                    }}>
                        {currentMode} Mode
                    </span>
                </div>

                <span style={{
                    fontSize: '12px',
                    color: 'var(--ink-light)',
                }}>
                    Inertia: {(inertia * 100).toFixed(0)}%
                </span>
            </div>

            {/* Inertia Progress Bar */}
            <div style={{
                width: '100%',
                height: '6px',
                background: 'rgba(0, 0, 0, 0.08)',
                borderRadius: '3px',
                overflow: 'hidden',
                position: 'relative',
            }}>
                <div style={{
                    width: `${inertia * 100}%`,
                    height: '100%',
                    background: getInertiaColor(),
                    transition: 'width 0.3s ease, background 0.3s ease',
                }} />

                {/* Threshold marker */}
                <div style={{
                    position: 'absolute',
                    left: `${threshold * 100}%`,
                    top: 0,
                    bottom: 0,
                    width: '2px',
                    background: 'rgba(0, 0, 0, 0.3)',
                }} />
            </div>

            {/* Inertia Status Text */}
            <div style={{
                marginTop: '6px',
                fontSize: '11px',
                color: 'var(--ink-light)',
                fontStyle: 'italic',
            }}>
                {inertia >= threshold ? (
                    '🔒 High inertia - resisting mode switches'
                ) : inertia >= 0.5 ? (
                    '⚡ Medium inertia - flexible mode switching'
                ) : (
                    '🌊 Low inertia - ready to adapt'
                )}
            </div>
        </div>
    );
}
