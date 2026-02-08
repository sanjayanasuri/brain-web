'use client';

import React from 'react';
import { useGraphFilters } from './hooks/useGraphFilters';

type Props = {
    onClose: () => void;
};

export default function GraphFiltersPanel({ onClose }: Props) {
    const { state, actions } = useGraphFilters();

    return (
        <div className="glass-panel" style={{
            position: 'absolute',
            top: '80px',
            right: '250px', // Shifted left to avoid overlapping with sidebars
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
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, letterSpacing: '-0.02em' }}>Graph Filters</h3>
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* Status Filters */}
                <section>
                    <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: '10px', fontWeight: 700 }}>Node Status</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px' }}>
                            <input
                                type="checkbox"
                                checked={state.filterStatusAccepted}
                                onChange={(e) => actions.setStatusAccepted(e.target.checked)}
                                style={{ accentColor: '#3b82f6' }}
                            />
                            Verified Concepts
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px' }}>
                            <input
                                type="checkbox"
                                checked={state.filterStatusProposed}
                                onChange={(e) => actions.setStatusProposed(e.target.checked)}
                                style={{ accentColor: '#10b981' }}
                            />
                            Proposed by AI
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px' }}>
                            <input
                                type="checkbox"
                                checked={state.filterStatusRejected}
                                onChange={(e) => actions.setStatusRejected(e.target.checked)}
                                style={{ accentColor: '#ef4444' }}
                            />
                            Dismissed
                        </label>
                    </div>
                </section>

                {/* Confidence Threshold */}
                <section>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', margin: 0, fontWeight: 700 }}>Min Confidence</h4>
                        <span style={{ fontSize: '12px', color: '#3b82f6', fontWeight: 600 }}>{(state.filterConfidenceThreshold * 100).toFixed(0)}%</span>
                    </div>
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={state.filterConfidenceThreshold}
                        onChange={(e) => actions.setConfidenceThreshold(parseFloat(e.target.value))}
                        style={{ width: '100%', cursor: 'pointer', accentColor: '#3b82f6' }}
                    />
                </section>

                {/* Source Layer */}
                <section>
                    <h4 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: '10px', fontWeight: 700 }}>Data Perspective</h4>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '6px',
                        background: 'rgba(0,0,0,0.2)',
                        padding: '4px',
                        borderRadius: '8px'
                    }}>
                        {(['concepts', 'evidence'] as const).map(layer => (
                            <button
                                key={layer}
                                onClick={() => actions.setSourceLayer(layer)}
                                style={{
                                    padding: '6px',
                                    borderRadius: '6px',
                                    border: 'none',
                                    fontSize: '12px',
                                    textTransform: 'capitalize',
                                    cursor: 'pointer',
                                    background: state.sourceLayer === layer ? 'rgba(255,255,255,0.1)' : 'transparent',
                                    color: state.sourceLayer === layer ? '#fff' : 'rgba(255,255,255,0.5)',
                                    transition: 'all 0.2s'
                                }}
                            >
                                {layer}
                            </button>
                        ))}
                    </div>
                </section>
            </div>

            <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                <button
                    onClick={actions.resetFilters}
                    style={{
                        width: '100%',
                        padding: '10px',
                        borderRadius: '10px',
                        border: '1px solid rgba(255,255,255,0.1)',
                        background: 'transparent',
                        color: 'rgba(255,255,255,0.7)',
                        fontSize: '13px',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                    Reset Default
                </button>
            </div>
        </div>
    );
}
