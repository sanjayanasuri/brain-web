'use client';

import React from 'react';
import { useUIState } from './hooks/useUIState';

type Props = {
    onClose: () => void;
    graphRef: React.RefObject<any>;
};

export default function SimulationControlsPanel({ onClose, graphRef }: Props) {
    // We'll use local state for simulation params or connect to a hook if available
    // For now, let's allow basic adjustments to the force graph

    const adjustSimulation = (param: string, value: number) => {
        if (!graphRef.current) return;

        const fg = graphRef.current;
        if (param === 'charge') {
            fg.d3Force?.('charge')?.strength?.(value);
        } else if (param === 'linkDistance') {
            fg.d3Force?.('link')?.distance?.(value);
        } else if (param === 'alphaDecay') {
            fg.alphaDecay?.(value);
        } else if (param === 'velocityDecay') {
            fg.velocityDecay?.(value);
        }

        // Reheat simulation
        fg.alpha?.(0.3)?.restart?.();
    };

    return (
        <div className="glass-panel" style={{
            position: 'absolute',
            top: '80px',
            right: '250px',
            width: '280px',
            padding: '20px',
            zIndex: 1000,
            borderRadius: '16px',
            background: 'rgba(23, 23, 23, 0.85)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
            color: '#fff',
            animation: 'slideInRight 0.3s ease-out'
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, letterSpacing: '-0.02em' }}>Simulation</h3>
                <button
                    onClick={onClose}
                    style={{
                        background: 'none',
                        border: 'none',
                        color: 'rgba(255,255,255,0.5)',
                        cursor: 'pointer',
                        fontSize: '18px'
                    }}
                >
                    ✕
                </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {/* Gravity / Charge */}
                <section>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', margin: 0, fontWeight: 700 }}>Node Repulsion</h4>
                    </div>
                    <input
                        type="range"
                        min="-1000"
                        max="0"
                        step="50"
                        defaultValue="-300"
                        onChange={(e) => adjustSimulation('charge', parseFloat(e.target.value))}
                        style={{ width: '100%', cursor: 'pointer', accentColor: '#3b82f6' }}
                    />
                </section>

                {/* Link Distance */}
                <section>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', margin: 0, fontWeight: 700 }}>Link Distance</h4>
                    </div>
                    <input
                        type="range"
                        min="10"
                        max="300"
                        step="10"
                        defaultValue="100"
                        onChange={(e) => adjustSimulation('linkDistance', parseFloat(e.target.value))}
                        style={{ width: '100%', cursor: 'pointer', accentColor: '#3b82f6' }}
                    />
                </section>

                {/* Friction / Velocity Decay */}
                <section>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', margin: 0, fontWeight: 700 }}>Inertia</h4>
                    </div>
                    <input
                        type="range"
                        min="0.1"
                        max="0.9"
                        step="0.05"
                        defaultValue="0.4"
                        onChange={(e) => adjustSimulation('velocityDecay', parseFloat(e.target.value))}
                        style={{ width: '100%', cursor: 'pointer', accentColor: '#3b82f6' }}
                    />
                </section>

                {/* Stabilization */}
                <section>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', margin: 0, fontWeight: 700 }}>Decay Rate</h4>
                    </div>
                    <input
                        type="range"
                        min="0.001"
                        max="0.1"
                        step="0.005"
                        defaultValue="0.02"
                        onChange={(e) => adjustSimulation('alphaDecay', parseFloat(e.target.value))}
                        style={{ width: '100%', cursor: 'pointer', accentColor: '#3b82f6' }}
                    />
                </section>
            </div>

            <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                <button
                    onClick={() => {
                        if (graphRef.current) graphRef.current.zoomToFit?.(600);
                    }}
                    style={{
                        width: '100%',
                        padding: '12px',
                        borderRadius: '10px',
                        border: 'none',
                        background: '#3b82f6',
                        color: '#fff',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)',
                        transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-1px)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                >
                    Reset Viewport
                </button>
            </div>
        </div>
    );
}
