'use client';

import React, { useState } from 'react';
import { runDeepResearch, type DeepResearchResponse } from '../api-client';

export default function DeepResearchWidget() {
    const [topic, setTopic] = useState('');
    const [breadth, setBreadth] = useState(3);
    const [depth, setDepth] = useState(1);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<DeepResearchResponse | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleSearch = async () => {
        if (!topic.trim()) return;

        setLoading(true);
        setError(null);
        setResult(null);

        try {
            const response = await runDeepResearch({
                topic,
                breadth,
                depth
            });
            setResult(response);
        } catch (err) {
            console.error('Deep research failed:', err);
            setError('Failed to run research. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            background: 'var(--panel)',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid var(--border)',
            marginBottom: '24px',
            boxShadow: 'var(--shadow)',
        }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '600', color: 'var(--ink)' }}>
                Deep Research
            </h3>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
                <input
                    type="text"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="Enter a topic (e.g. 'Future of solid state batteries')"
                    style={{
                        flex: 1,
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: '1px solid var(--border)',
                        background: 'var(--surface)',
                        color: 'var(--ink)',
                        minWidth: '200px',
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />

                <select
                    value={breadth}
                    onChange={(e) => setBreadth(Number(e.target.value))}
                    style={{
                        padding: '8px',
                        borderRadius: '6px',
                        border: '1px solid var(--border)',
                        background: 'var(--surface)',
                        color: 'var(--ink)',
                    }}
                    title="Breadth (Number of sources)"
                >
                    <option value="2">2 Sources</option>
                    <option value="3">3 Sources</option>
                    <option value="5">5 Sources</option>
                    <option value="8">8 Sources</option>
                </select>

                <select
                    value={depth}
                    onChange={(e) => setDepth(Number(e.target.value))}
                    style={{
                        padding: '8px',
                        borderRadius: '6px',
                        border: '1px solid var(--border)',
                        background: 'var(--surface)',
                        color: 'var(--ink)',
                    }}
                    title="Depth (Recursion levels)"
                >
                    <option value="1">Depth 1 (Single)</option>
                    <option value="2">Depth 2 (Recursive)</option>
                    <option value="3">Depth 3 (Deep)</option>
                </select>

                <button
                    onClick={handleSearch}
                    disabled={loading || !topic.trim()}
                    style={{
                        padding: '8px 16px',
                        background: 'var(--accent)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: loading || !topic.trim() ? 'not-allowed' : 'pointer',
                        opacity: loading || !topic.trim() ? 0.7 : 1,
                        fontWeight: '500',
                    }}
                >
                    {loading ? 'Researching...' : 'Start Research'}
                </button>
            </div>

            {error && (
                <div style={{ color: 'var(--red)', fontSize: '14px', marginBottom: '12px' }}>
                    {error}
                </div>
            )}

            {result && result.data && (
                <div style={{ marginTop: '16px', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
                    <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: 'var(--ink)' }}>Findings</h4>

                    {/* Summary */}
                    {result.data.summary && (
                        <p style={{ fontSize: '14px', color: 'var(--ink)', lineHeight: '1.5', marginBottom: '16px' }}>
                            {result.data.summary}
                        </p>
                    )}

                    {/* Sources */}
                    {result.data.sources && result.data.sources.length > 0 && (
                        <div style={{ marginBottom: '16px' }}>
                            <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--muted)', marginBottom: '4px' }}>
                                SOURCES ({result.data.sources.length})
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                {result.data.sources.map((source: any, i: number) => (
                                    <a
                                        key={i}
                                        href={source.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{
                                            fontSize: '12px',
                                            color: 'var(--accent)',
                                            textDecoration: 'none',
                                            background: 'var(--surface)',
                                            padding: '4px 8px',
                                            borderRadius: '4px',
                                            border: '1px solid var(--border)',
                                            maxWidth: '200px',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                        }}
                                        title={source.title}
                                    >
                                        {source.title || source.url}
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Fresh Claims */}
                    {result.data.fresh_findings && result.data.fresh_findings.length > 0 && (
                        <div>
                            <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--muted)', marginBottom: '8px' }}>
                                KEY INSIGHTS
                            </div>
                            <ul style={{ paddingLeft: '20px', margin: '0' }}>
                                {result.data.fresh_findings.slice(0, 5).map((claim: any, i: number) => (
                                    <li key={i} style={{ fontSize: '13px', color: 'var(--ink)', marginBottom: '6px' }}>
                                        {claim.text}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Recursive results */}
                    {result.data.sub_research && (
                        <div style={{ marginTop: '16px' }}>
                            <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--muted)', marginBottom: '8px' }}>
                                FOLLOW-UP RESEARCH
                            </div>
                            {result.data.sub_research.map((sub: any, i: number) => (
                                <div key={i} style={{
                                    background: 'var(--surface)',
                                    padding: '12px',
                                    borderRadius: '8px',
                                    marginBottom: '8px',
                                    border: '1px solid var(--border)'
                                }}>
                                    <div style={{ fontWeight: '600', fontSize: '13px', marginBottom: '4px' }}>
                                        {sub.topic}
                                    </div>
                                    <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                                        {sub.fresh_findings?.length || 0} new insights found
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
