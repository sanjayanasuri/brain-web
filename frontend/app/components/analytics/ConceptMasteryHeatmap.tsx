// frontend/app/components/analytics/ConceptMasteryHeatmap.tsx
/**
 * Heatmap showing concept mastery levels.
 */

'use client';

import React from 'react';
import { ConceptMastery } from '../../state/analyticsStore';

interface ConceptMasteryHeatmapProps {
    concepts: ConceptMastery[];
}

export default function ConceptMasteryHeatmap({ concepts }: ConceptMasteryHeatmapProps) {
    const [selectedConcept, setSelectedConcept] = React.useState<ConceptMastery | null>(null);

    if (!concepts || concepts.length === 0) {
        return (
            <div style={{
                padding: '40px',
                textAlign: 'center',
                color: '#95a5a6',
                background: 'white',
                borderRadius: '12px',
                border: '1px solid rgba(0, 0, 0, 0.1)',
            }}>
                No concept mastery data yet. Complete study tasks to track your progress!
            </div>
        );
    }

    const getMasteryColor = (score: number): string => {
        if (score >= 0.8) return '#27ae60'; // Green
        if (score >= 0.6) return '#f39c12'; // Orange
        if (score >= 0.4) return '#e67e22'; // Dark orange
        return '#e74c3c'; // Red
    };

    const getMasteryLabel = (score: number): string => {
        if (score >= 0.8) return 'Expert';
        if (score >= 0.6) return 'Proficient';
        if (score >= 0.4) return 'Learning';
        return 'Novice';
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
                🎯 Concept Mastery
            </h3>

            {/* Heatmap Grid */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: '12px',
                marginBottom: '16px',
            }}>
                {concepts.map((concept) => (
                    <div
                        key={concept.concept_name}
                        onClick={() => setSelectedConcept(concept)}
                        style={{
                            padding: '16px',
                            borderRadius: '8px',
                            background: getMasteryColor(concept.mastery_score),
                            color: 'white',
                            cursor: 'pointer',
                            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                            boxShadow: selectedConcept?.concept_name === concept.concept_name
                                ? '0 4px 12px rgba(0, 0, 0, 0.2)'
                                : '0 2px 6px rgba(0, 0, 0, 0.1)',
                            transform: selectedConcept?.concept_name === concept.concept_name
                                ? 'scale(1.05)'
                                : 'scale(1)',
                        }}
                        onMouseEnter={(e) => {
                            if (selectedConcept?.concept_name !== concept.concept_name) {
                                e.currentTarget.style.transform = 'scale(1.03)';
                            }
                        }}
                        onMouseLeave={(e) => {
                            if (selectedConcept?.concept_name !== concept.concept_name) {
                                e.currentTarget.style.transform = 'scale(1)';
                            }
                        }}
                    >
                        <div style={{
                            fontSize: '13px',
                            fontWeight: 600,
                            marginBottom: '8px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}>
                            {concept.concept_name}
                        </div>
                        <div style={{
                            fontSize: '20px',
                            fontWeight: 700,
                            marginBottom: '4px',
                        }}>
                            {(concept.mastery_score * 100).toFixed(0)}%
                        </div>
                        <div style={{
                            fontSize: '11px',
                            opacity: 0.9,
                        }}>
                            {getMasteryLabel(concept.mastery_score)}
                        </div>
                    </div>
                ))}
            </div>

            {/* Selected Concept Details */}
            {selectedConcept && (
                <div style={{
                    padding: '16px',
                    background: 'rgba(52, 152, 219, 0.05)',
                    borderRadius: '8px',
                    border: '1px solid rgba(52, 152, 219, 0.2)',
                }}>
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        marginBottom: '12px',
                    }}>
                        <h4 style={{
                            margin: 0,
                            fontSize: '15px',
                            fontWeight: 600,
                            color: '#2c3e50',
                        }}>
                            {selectedConcept.concept_name}
                        </h4>
                        <button
                            onClick={() => setSelectedConcept(null)}
                            style={{
                                padding: '4px 8px',
                                borderRadius: '4px',
                                border: 'none',
                                background: 'transparent',
                                cursor: 'pointer',
                                fontSize: '16px',
                            }}
                        >
                            ✕
                        </button>
                    </div>

                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '12px',
                        fontSize: '13px',
                        color: '#34495e',
                    }}>
                        <div>
                            <div style={{ color: '#7f8c8d', marginBottom: '4px' }}>Mastery Score</div>
                            <div style={{ fontWeight: 600, fontSize: '16px' }}>
                                {(selectedConcept.mastery_score * 100).toFixed(0)}%
                            </div>
                        </div>
                        <div>
                            <div style={{ color: '#7f8c8d', marginBottom: '4px' }}>Success Rate</div>
                            <div style={{ fontWeight: 600, fontSize: '16px' }}>
                                {(selectedConcept.success_rate * 100).toFixed(0)}%
                            </div>
                        </div>
                        <div>
                            <div style={{ color: '#7f8c8d', marginBottom: '4px' }}>Times Seen</div>
                            <div style={{ fontWeight: 600, fontSize: '16px' }}>
                                {selectedConcept.exposure_count}
                            </div>
                        </div>
                        <div>
                            <div style={{ color: '#7f8c8d', marginBottom: '4px' }}>Successes</div>
                            <div style={{ fontWeight: 600, fontSize: '16px' }}>
                                {selectedConcept.success_count}
                            </div>
                        </div>
                    </div>

                    {selectedConcept.last_seen && (
                        <div style={{
                            marginTop: '12px',
                            fontSize: '12px',
                            color: '#7f8c8d',
                        }}>
                            Last seen: {new Date(selectedConcept.last_seen).toLocaleDateString()}
                        </div>
                    )}
                </div>
            )}

            {/* Legend */}
            <div style={{
                marginTop: '16px',
                display: 'flex',
                gap: '16px',
                flexWrap: 'wrap',
                fontSize: '12px',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: '#e74c3c' }} />
                    <span style={{ color: '#7f8c8d' }}>Novice (&lt;40%)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: '#e67e22' }} />
                    <span style={{ color: '#7f8c8d' }}>Learning (40-60%)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: '#f39c12' }} />
                    <span style={{ color: '#7f8c8d' }}>Proficient (60-80%)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: '#27ae60' }} />
                    <span style={{ color: '#7f8c8d' }}>Expert (80%+)</span>
                </div>
            </div>
        </div>
    );
}
