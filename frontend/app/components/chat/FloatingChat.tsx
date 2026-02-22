'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { MessageCircle, X, Maximize2, Minimize2, Send, Paperclip } from 'lucide-react';
import { focusOnPenPointerDown, getScribbleInputStyle, scribbleInputProps, useIPadLikeDevice } from '../../lib/ipadScribble';
// We re-use logic from AIChatSidebar but adapted for floating
// Ideally we should extract hooks, but for speed we duplicate logic or inline it.
// Given time constraints, inlining is safer to avoid breaking other chats.

interface FloatingChatProps {
    lectureId?: string | null;
    lectureTitle?: string;
    triggerMessage?: { text: string; image?: string; context?: { blockId?: string; blockText?: string } } | null;
    onTriggerProcessed?: () => void;
    isSidebar?: boolean; // New prop for sidebar mode
}

export function FloatingChat({ lectureId, lectureTitle, triggerMessage, onTriggerProcessed, isSidebar = true }: FloatingChatProps) {
    const [isOpen, setIsOpen] = useState(isSidebar); // Default open if sidebar
    const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string, image?: string }>>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const isIPadLike = useIPadLikeDevice();

    const searchParams = useSearchParams();
    const graphId = searchParams?.get('graph_id');
    const branchId = searchParams?.get('branch_id');

    // Trigger handling
    useEffect(() => {
        if (triggerMessage) {
            if (!isOpen && !isSidebar) setIsOpen(true);

            const { text, image, context } = triggerMessage;
            // Add user message immediately
            setMessages(prev => [...prev, { role: 'user', content: text, image }]);
            setIsLoading(true);

            // API Call
            fetch('/api/brain-web/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    image,
                    context_text: context?.blockText,
                    mode: 'graphrag',
                    graph_id: graphId,
                    branch_id: branchId,
                    lecture_id: lectureId,
                    response_prefs: { mode: 'compact' }
                }),
            })
                .then(async res => {
                    const data = await res.json();
                    setMessages(prev => [...prev, { role: 'assistant', content: data.answer || "I couldn't generate a response." }]);
                })
                .catch(err => {
                    console.error(err);
                    setMessages(prev => [...prev, { role: 'assistant', content: "Error connecting to AI." }]);
                })
                .finally(() => {
                    setIsLoading(false);
                    onTriggerProcessed?.();
                });
        }
    }, [triggerMessage, isOpen, isSidebar]);

    const sendMessage = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!input.trim() || isLoading) return;

        const text = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: text }]);
        setIsLoading(true);

        try {
            const res = await fetch('/api/brain-web/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    mode: 'graphrag',
                    graph_id: graphId,
                    branch_id: branchId,
                    lecture_id: lectureId,
                    response_prefs: { mode: 'compact' }
                }),
            });
            const data = await res.json();
            setMessages(prev => [...prev, { role: 'assistant', content: data.answer || '...' }]);
        } catch (err) {
            setMessages(prev => [...prev, { role: 'assistant', content: "Error: " + String(err) }]);
        } finally {
            setIsLoading(false);
            textareaRef.current?.focus();
        }
    };

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isOpen]);

    // If closed, show FAB (only if not sidebar)
    if (!isOpen && !isSidebar) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                style={{
                    position: 'fixed',
                    bottom: '32px',
                    right: '32px',
                    width: '56px',
                    height: '56px',
                    borderRadius: '28px',
                    background: 'var(--accent)',
                    color: 'white',
                    border: 'none',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                    zIndex: 1000,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    transition: 'transform 0.2s',
                }}
                onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.1)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
            >
                <MessageCircle size={24} />
            </button>
        );
    }

    // Floating Window
    return (
        <div
            style={isSidebar ? {
                height: '100%',
                background: 'var(--surface)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
            } : {
                position: 'fixed',
                bottom: '32px',
                right: '32px',
                width: '380px',
                height: '600px',
                maxHeight: '80vh',
                background: 'var(--surface)',
                borderRadius: '16px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
                zIndex: 1000,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                border: '1px solid var(--border)',
            }}
        >
            {/* Header */}
            <div style={{
                padding: '16px',
                background: 'var(--panel)',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                cursor: isSidebar ? 'default' : 'move'
            }}>
                <div style={{ fontWeight: 600, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent)' }} />
                    Study Assistant
                </div>
                {!isSidebar && (
                    <button
                        onClick={() => setIsOpen(false)}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}
                    >
                        <X size={18} />
                    </button>
                )}
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {messages.length === 0 && (
                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
                        Ask me anything about this lecture!
                    </div>
                )}
                {messages.map((msg, idx) => (
                    <div key={idx} style={{
                        alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                        maxWidth: '85%',
                        background: msg.role === 'user' ? 'var(--accent)' : 'var(--panel)',
                        color: msg.role === 'user' ? '#fff' : 'var(--ink)',
                        padding: '10px 14px',
                        borderRadius: '12px',
                        fontSize: '14px',
                        lineHeight: '1.5',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                    }}>
                        {msg.image && <img src={msg.image} style={{ maxWidth: '100%', borderRadius: '4px', marginBottom: '4px' }} />}
                        {msg.content}
                    </div>
                ))}
                {isLoading && (
                    <div style={{ alignSelf: 'flex-start', background: 'var(--panel)', padding: '10px 14px', borderRadius: '12px', fontSize: '12px', color: 'var(--muted)' }}>
                        Thinking...
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form
                onSubmit={sendMessage}
                style={{
                    paddingTop: '12px',
                    paddingRight: '12px',
                    paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))',
                    paddingLeft: '12px',
                    borderTop: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                }}
            >
                {isIPadLike && (
                    <div style={{ fontSize: '11px', color: 'var(--muted)', padding: '0 2px' }}>
                        Apple Pencil Scribble supported: handwrite your question in the box below.
                    </div>
                )}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onPointerDown={focusOnPenPointerDown}
                    onInput={(e) => {
                        const target = e.target as HTMLTextAreaElement;
                        target.style.height = 'auto';
                        target.style.height = `${Math.min(target.scrollHeight, isIPadLike ? 180 : 140)}px`;
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            sendMessage();
                        }
                    }}
                    placeholder={isIPadLike ? 'Handwrite or type your question…' : 'Type a message...'}
                    rows={1}
                    disabled={isLoading}
                    enterKeyHint="send"
                    {...scribbleInputProps}
                    style={{
                        flex: 1,
                        padding: isIPadLike ? '12px 14px' : '10px 14px',
                        borderRadius: isIPadLike ? '14px' : '20px',
                        border: '1px solid var(--border)',
                        background: 'var(--background)',
                        color: 'var(--ink)',
                        fontSize: isIPadLike ? '16px' : '14px',
                        outline: 'none',
                        resize: 'none',
                        minHeight: isIPadLike ? '52px' : '36px',
                        maxHeight: isIPadLike ? '180px' : '140px',
                        fontFamily: 'inherit',
                        lineHeight: '1.45',
                        ...getScribbleInputStyle(isIPadLike, 'multiline'),
                    }}
                />
                <button type="submit" disabled={isLoading} style={{
                    background: 'var(--accent)', color: 'white', border: 'none', width: isIPadLike ? '44px' : '36px', height: isIPadLike ? '44px' : '36px', borderRadius: isIPadLike ? '12px' : '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                    opacity: isLoading ? 0.7 : 1
                }}>
                    <Send size={16} />
                </button>
                </div>
            </form>
        </div>
    );
}
