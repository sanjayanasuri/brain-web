'use client';

import { useState, useEffect } from 'react';

interface ContentImportFormProps {
    onIngest: (title: string, text: string, domain?: string) => void;
    isLoading: boolean;
    result: any | null;
    onClose: () => void;
}

export default function ContentImportForm({
    onIngest,
    isLoading,
    result,
    onClose,
}: ContentImportFormProps) {
    const [title, setTitle] = useState('');
    const [text, setText] = useState('');
    const [domain, setDomain] = useState('');

    // Reset form when result appears (success)
    useEffect(() => {
        if (result) {
            const timer = setTimeout(() => {
                setTitle('');
                setText('');
                setDomain('');
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [result]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (title && text) {
            onIngest(title, text, domain || undefined);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '8px' }}>
                <input
                    type="text"
                    id="content-title"
                    name="content-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Content title"
                    required
                    style={{
                        width: '100%',
                        padding: '6px 8px',
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        fontSize: '13px',
                    }}
                />
            </div>
            <div style={{ marginBottom: '8px' }}>
                <input
                    type="text"
                    id="content-domain"
                    name="content-domain"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    placeholder="Topic or domain (optional)"
                    style={{
                        width: '100%',
                        padding: '6px 8px',
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        fontSize: '13px',
                    }}
                />
            </div>
            <div style={{ marginBottom: '8px' }}>
                <textarea
                    id="content-text"
                    name="content-text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Paste or type your content here..."
                    required
                    rows={4}
                    style={{
                        width: '100%',
                        padding: '6px 8px',
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        fontSize: '13px',
                        fontFamily: 'inherit',
                        resize: 'vertical',
                    }}
                />
            </div>
            {result && (
                <div style={{
                    marginBottom: '8px',
                    padding: '6px 8px',
                    backgroundColor: '#efe',
                    border: '1px solid #cfc',
                    borderRadius: '4px',
                    fontSize: '12px',
                }}>
                    ✓ {result.nodes_created.length} nodes, {result.links_created.length} links
                </div>
            )}
            <div style={{ display: 'flex', gap: '6px' }}>
                <button
                    type="submit"
                    disabled={isLoading || !title || !text}
                    className="pill pill--small"
                    style={{
                        flex: 1,
                        backgroundColor: isLoading ? '#ccc' : 'var(--accent)',
                        color: 'white',
                        border: 'none',
                        cursor: isLoading ? 'not-allowed' : 'pointer',
                    }}
                >
                    {isLoading ? 'Processing...' : 'Import Content'}
                </button>
                <button
                    type="button"
                    onClick={onClose}
                    className="pill pill--ghost pill--small"
                    style={{ cursor: 'pointer' }}
                >
                    Close
                </button>
            </div>
        </form>
    );
}
