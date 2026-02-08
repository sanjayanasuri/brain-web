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

    const handleSearch = async (topicOverride?: string) => {
        const searchTopic = topicOverride || topic;
        if (!searchTopic.trim()) return;

        setLoading(true);
        setError(null);
        setResult(null);

        if (topicOverride) setTopic(topicOverride);

        try {
            const response = await runDeepResearch({
                topic: searchTopic,
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
                    onClick={() => handleSearch()}
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
                    {result.data.error ? (
                        <div style={{ color: 'var(--red)', fontSize: '14px', textAlign: 'center', padding: '12px' }}>
                            {result.data.error}
                        </div>
                    ) : (
                        <>
                            <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: 'var(--ink)' }}>Findings</h4>

                            {/* Summary / Memo */}
                            {result.data.summary && (
                                <div style={{ marginBottom: '24px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                        <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--muted)' }}>
                                            RESEARCH REPORT
                                        </div>
                                        <button
                                            onClick={() => {
                                                navigator.clipboard.writeText(result.data.summary);
                                                alert('Report copied to clipboard!');
                                            }}
                                            style={{
                                                fontSize: '11px',
                                                background: 'var(--surface)',
                                                border: '1px solid var(--border)',
                                                padding: '2px 8px',
                                                borderRadius: '4px',
                                                cursor: 'pointer',
                                                color: 'var(--ink)'
                                            }}
                                        >
                                            Copy Markdown
                                        </button>
                                    </div>
                                    <div
                                        className="markdown-content"
                                        style={{
                                            fontSize: '14px',
                                            color: 'var(--ink)',
                                            lineHeight: '1.6',
                                            background: 'var(--surface)',
                                            padding: '16px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--border)',
                                            maxHeight: '400px',
                                            overflowY: 'auto'
                                        }}
                                        dangerouslySetInnerHTML={{
                                            __html: require('markdown-it')({ html: true, linkify: true }).render(result.data.summary)
                                        }}
                                    />
                                </div>
                            )}

                            {/* Sources */}
                            {result.data.sources && result.data.sources.length > 0 && (
                                <div style={{ marginBottom: '20px' }}>
                                    <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--muted)', marginBottom: '8px' }}>
                                        SOURCES ({result.data.sources.length})
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '8px' }}>
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
                                                    padding: '8px 12px',
                                                    borderRadius: '6px',
                                                    border: '1px solid var(--border)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px',
                                                    transition: 'border-color 0.2s',
                                                }}
                                                onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
                                                onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
                                                title={source.title}
                                            >
                                                <span style={{
                                                    flex: 1,
                                                    whiteSpace: 'nowrap',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis'
                                                }}>
                                                    {source.title || source.url}
                                                </span>
                                                <span style={{ fontSize: '10px', color: 'var(--muted)' }}></span>
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
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
                                        {result.data.sub_research.map((sub: any, i: number) => (
                                            <div
                                                key={i}
                                                onClick={() => handleSearch(sub.topic)}
                                                style={{
                                                    background: 'var(--surface)',
                                                    padding: '12px',
                                                    borderRadius: '8px',
                                                    border: '1px solid var(--border)',
                                                    cursor: 'pointer',
                                                    transition: 'transform 0.2s, border-color 0.2s',
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.currentTarget.style.borderColor = 'var(--accent)';
                                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.currentTarget.style.borderColor = 'var(--border)';
                                                    e.currentTarget.style.transform = 'translateY(0)';
                                                }}
                                            >
                                                <div style={{ fontWeight: '600', fontSize: '13px', marginBottom: '4px', color: 'var(--ink)' }}>
                                                    {sub.topic}
                                                </div>
                                                <div style={{ fontSize: '11px', color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
                                                    <span>{sub.fresh_findings?.length || 0} insights</span>
                                                    <span>Research</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
