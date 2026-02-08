import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ReaderViewProps {
    content: string;
    title: string;
    url: string;
    onClose: () => void;
    onSaveConcept?: (text: string, context: string) => void;
    onDiscuss?: (text: string) => void;
}

export const ReaderView: React.FC<ReaderViewProps> = ({
    content,
    title,
    url,
    onClose,
    onSaveConcept,
    onDiscuss
}) => {
    const [selection, setSelection] = useState<{ text: string; rect: DOMRect } | null>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        console.log('[ReaderView] Mounted');
    }, []);

    // Handle text selection
    useEffect(() => {
        const handleSelection = () => {
            const sel = window.getSelection();
            if (sel && sel.toString().trim().length > 0 && contentRef.current?.contains(sel.anchorNode)) {
                const range = sel.getRangeAt(0);
                const rect = range.getBoundingClientRect();
                setSelection({
                    text: sel.toString(),
                    rect: rect
                });
            } else {
                setSelection(null);
            }
        };

        document.addEventListener('selectionchange', handleSelection);
        return () => document.removeEventListener('selectionchange', handleSelection);
    }, []);

    const readerContent = (
        <div
            id="reader-overlay"
            style={{
                zIndex: 99999,
                backgroundColor: 'rgba(0,0,0,0.85)',
                backdropFilter: 'blur(8px)',
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '20px'
            }}
        >
            <div style={{
                backgroundColor: 'var(--surface)',
                color: 'var(--ink)',
                width: '100%',
                maxWidth: '900px',
                height: '92vh',
                borderRadius: '24px',
                boxShadow: 'var(--shadow)',
                display: 'flex',
                flexDirection: 'column',
                border: '1px solid var(--border)',
                overflow: 'hidden',
                position: 'relative'
            }}>

                {/* Header */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '20px 24px',
                    borderBottom: '1px solid var(--border)',
                    background: 'var(--panel)',
                    position: 'sticky',
                    top: 0,
                    zIndex: 10
                }}>
                    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h2>
                        <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.875rem', color: 'var(--accent)', textDecoration: 'none', opacity: 0.8, marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {url}
                        </a>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            padding: '10px',
                            background: 'rgba(0,0,0,0.05)',
                            border: 'none',
                            borderRadius: '50%',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.2s',
                            marginLeft: '16px'
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.1)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.05)')}
                        title="Close reader"
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>

                {/* Content Container */}
                <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '40px 60px',
                    background: 'var(--surface)',
                    lineHeight: '1.8',
                    fontFamily: 'var(--font-serif)',
                    position: 'relative'
                }}>
                    <div
                        ref={contentRef}
                        style={{
                            maxWidth: '700px',
                            margin: '0 auto',
                            fontSize: '1.125rem'
                        }}
                    >
                        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
                            {content && content.trim().length > 0 ? (
                                <div
                                    style={{
                                        lineHeight: 1.6,
                                        whiteSpace: content.includes('<') && content.includes('>') ? 'normal' : 'pre-wrap'
                                    }}
                                    dangerouslySetInnerHTML={{ __html: content }}
                                />
                            ) : (
                                <div style={{ textAlign: 'center', padding: '100px 0', color: 'var(--muted)' }}>
                                    <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '20px', color: 'var(--muted)' }}>Empty</div>
                                    <p>No content available for this source.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Selection Toolbar */}
                {selection && (
                    <div
                        style={{
                            position: 'fixed',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            background: 'var(--ink)',
                            color: 'var(--surface)',
                            borderRadius: '12px',
                            boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
                            padding: '6px',
                            zIndex: 100000,
                            top: selection.rect.top - 12 + 'px',
                            left: selection.rect.left + selection.rect.width / 2 + 'px',
                            transform: 'translate(-50%, -100%)'
                        }}
                    >
                        {onSaveConcept && (
                            <button
                                onClick={() => onSaveConcept(selection.text, title)}
                                style={{
                                    padding: '6px 12px',
                                    background: 'transparent',
                                    border: 'none',
                                    borderRadius: '8px',
                                    color: '#34d399',
                                    fontWeight: '600',
                                    fontSize: '13px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                                Save
                            </button>
                        )}

                        {onDiscuss && (
                            <button
                                onClick={() => onDiscuss(selection.text)}
                                style={{
                                    padding: '6px 12px',
                                    background: 'transparent',
                                    border: 'none',
                                    borderRadius: '8px',
                                    color: '#60a5fa',
                                    fontWeight: '600',
                                    fontSize: '13px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                                Discuss
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );

    if (!mounted || typeof document === 'undefined') return null;

    return createPortal(readerContent, document.body);
};

export default ReaderView;
