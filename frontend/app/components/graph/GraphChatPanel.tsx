'use client';

import React, { useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGraph } from './GraphContext';
import { useChat, ChatMessage } from './hooks/useChatState';
import { ReaderView } from '../reader/ReaderView';
import { BookOpen, Maximize2, Minimize2, Send, RotateCcw } from 'lucide-react';
import { useStudyStore } from '../../state/studyStore';
import TaskCard from '../study/TaskCard';
import AttemptInput from '../study/AttemptInput';
import Feedback from '../study/Feedback';
import Citations from '../study/Citations';
import { startStudySession, getNextTask } from '../../api-client-study';
import { submitFeedback } from '../../api/feedback';
import StyleFeedbackForm from '../ui/StyleFeedbackForm';

const MinimizeIcon = Minimize2 as any;
const MaximizeIcon = Maximize2 as any;

interface GraphChatPanelProps {
    chatStreamRef: React.RefObject<HTMLDivElement>;
    onAsk: (question: string) => void;
    onSelectAction?: (action: any) => void;
    onRead: (reader: { content: string, title: string, url: string } | null) => void;
}

export default function GraphChatPanel({ chatStreamRef, onAsk, onSelectAction, onRead }: GraphChatPanelProps) {
    const { state, actions } = useChat();
    const { activeGraphId } = useGraph();
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const [feedbackByMessageId, setFeedbackByMessageId] = useState<Record<string, 1 | -1>>({});
    const [submittingFeedbackByMessageId, setSubmittingFeedbackByMessageId] = useState<Record<string, boolean>>({});
    const [feedbackToastByMessageId, setFeedbackToastByMessageId] = useState<Record<string, string>>({});

    const {
        session,
        currentTask,
        lastEvaluation,
        isLoading: isStudyLoading,
        setLoading: setStudyLoading,
        setSession,
        setCurrentTask,
        clearSession,
        interactionHistory,
        setLastEvaluation,
        isStudyPanelOpen: isTutorMode,
        toggleStudyPanel
    } = useStudyStore();

    // Auto-start session when entering Tutor Mode if none exists
    useEffect(() => {
        if (isTutorMode && !session && !isStudyLoading) {
            handleStartTutorSession();
        }
    }, [isTutorMode, session]);

    const handleStartTutorSession = async () => {
        try {
            setStudyLoading(true);
            const result = await startStudySession(
                'practice',
                undefined,
                undefined, // Context can be added later via selection
                'explain'
            );
            setSession({
                id: result.session_id,
                user_id: '',
                tenant_id: '',
                intent: 'practice',
                current_mode: 'explain',
                mode_inertia: 0.5,
                started_at: new Date().toISOString(),
            });
            setCurrentTask(result.initial_task);
        } catch (err) {
            console.error('Failed to start tutor session:', err);
        } finally {
            setStudyLoading(false);
        }
    };

    const handleNextTask = async () => {
        if (!session) return;
        try {
            setStudyLoading(true);
            const result = await getNextTask(session.id);
            setCurrentTask(result.task_spec);
        } catch (err) {
            console.error('Failed to get next task:', err);
        } finally {
            setStudyLoading(false);
        }
    };

    const handleSubmitMessageFeedback = async (messageId: string, answerId: string, question: string, rating: 1 | -1) => {
        if (!answerId || submittingFeedbackByMessageId[messageId]) return;
        setSubmittingFeedbackByMessageId((prev) => ({ ...prev, [messageId]: true }));
        try {
            await submitFeedback(
                answerId,
                rating,
                rating > 0 ? 'Helpful answer' : 'Unhelpful answer',
                question || undefined,
            );
            setFeedbackByMessageId((prev) => ({ ...prev, [messageId]: rating }));
            setFeedbackToastByMessageId((prev) => ({ ...prev, [messageId]: 'Thanks for feedback' }));
            setTimeout(() => {
                setFeedbackToastByMessageId((prev) => {
                    if (!prev[messageId]) return prev;
                    const next = { ...prev };
                    delete next[messageId];
                    return next;
                });
            }, 1800);
        } catch (err) {
            console.error('Failed to submit message feedback:', err);
        } finally {
            setSubmittingFeedbackByMessageId((prev) => ({ ...prev, [messageId]: false }));
        }
    };

    // Auto-scroll to bottom of chat
    useEffect(() => {
        if (chatStreamRef.current) {
            chatStreamRef.current.scrollTop = chatStreamRef.current.scrollHeight;
        }
    }, [state.chatHistory, state.isChatLoading, chatStreamRef]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const val = inputRef.current?.value || '';
        if (val.trim()) {
            onAsk(val);
            if (inputRef.current) inputRef.current.value = '';
        }
    };

    if (state.isChatCollapsed) {
        return (
            <button
                onClick={() => actions.setChatCollapsed(false)}
                style={{
                    width: '32px',
                    height: '180px',
                    background: 'var(--panel)',
                    backdropFilter: 'blur(20px)',
                    border: '1px solid var(--border)',
                    borderRight: 'none',
                    borderRadius: '16px 0 0 16px',
                    color: 'var(--muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: 'var(--shadow)',
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    position: 'relative',
                    padding: '12px 0',
                    gap: '12px'
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--surface)';
                    e.currentTarget.style.width = '40px';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--panel)';
                    e.currentTarget.style.width = '32px';
                }}
                title="Open chat"
            >
                <div className="home-orb">
                    <div className="home-orb-core" />
                </div>
                <div style={{ fontSize: '14px', marginTop: 'auto' }}>←</div>
            </button>
        );
    }

    return (
        <div className="responsive-panel" style={{
            maxWidth: isTutorMode ? '980px' : (state.isChatExpanded ? '700px' : '380px'),
            background: 'var(--panel)',
            borderRadius: '20px',
            border: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 20px 50px rgba(0,0,0,0.1)',
            overflow: 'hidden',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            backdropFilter: 'blur(20px)',
            position: 'relative'
        }}>
            {/* Header */}
            <div style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: 'var(--panel)',
                position: 'relative'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {/* Expand/Collapse Chat Button */}
                    <button
                        onClick={() => actions.setChatExpanded(!state.isChatExpanded)}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--muted)',
                            padding: '4px',
                            borderRadius: '6px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.2s'
                        }}
                        title={state.isChatExpanded ? 'Collapse chat' : 'Expand chat'}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.05)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                        {state.isChatExpanded ? <MinimizeIcon size={16} /> : <MaximizeIcon size={16} />}
                    </button>
                </div>

                <div className="chat-orb-center">
                    <button
                        onClick={toggleStudyPanel}
                        className={`voice-orb-button ${isTutorMode ? 'is-active' : ''}`}
                        title={isTutorMode ? 'Close tutor mode' : 'Open tutor mode'}
                    >
                        <span className="home-orb">
                            <span className="home-orb-core" />
                        </span>
                    </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                        onClick={() => actions.setChatCollapsed(true)}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '18px',
                            color: 'var(--muted)',
                            padding: '4px',
                            borderRadius: '6px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                        title="Minimize to side"
                    >
                        →
                    </button>
                </div>
            </div>

            <div
                className="chat-body"
                style={{
                    display: 'flex',
                    flex: 1,
                    minHeight: 0
                }}
            >
                <div
                    className="chat-left"
                    style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        minWidth: 0
                    }}
                >
                    {/* Messages Stream */}
                    <div
                        ref={chatStreamRef}
                        style={{
                            flex: 1,
                            overflowY: 'auto',
                            padding: '20px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '24px',
                            scrollbarWidth: 'none'
                        }}
                    >
                        {state.chatHistory.length === 0 && !state.isChatLoading && (
                            <div style={{
                                height: '100%',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'var(--muted)',
                                textAlign: 'center',
                                padding: '40px'
                            }}>
                                <div style={{ fontSize: '32px', marginBottom: '16px' }}></div>
                                <div style={{ fontSize: '15px', fontWeight: 500, color: 'var(--ink)', marginBottom: '8px' }}>Explore your knowledge graph</div>
                                <div style={{ fontSize: '13px', lineHeight: '1.5' }}>Ask about connections, summarize clusters, or find gaps in your research.</div>
                            </div>
                        )}

                        {state.chatHistory.map((msg: ChatMessage, idx: number) => (
                            <div key={`${msg.id}-${idx}`} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {/* User Question */}
                                <div style={{
                                    alignSelf: 'flex-end',
                                    background: 'var(--accent)',
                                    color: 'white',
                                    padding: '12px 16px',
                                    borderRadius: '18px 18px 2px 18px',
                                    fontSize: '14px',
                                    lineHeight: '1.5',
                                    maxWidth: '85%',
                                    boxShadow: '0 4px 12px rgba(37, 99, 235, 0.15)'
                                }}>
                                    {msg.question}
                                </div>

                                {/* Assistant Answer */}
                                <div style={{
                                    alignSelf: 'flex-start',
                                    background: 'var(--surface)',
                                    border: '1px solid var(--border)',
                                    padding: '16px',
                                    borderRadius: '2px 18px 18px 18px',
                                    fontSize: '14px',
                                    lineHeight: '1.6',
                                    maxWidth: '90%',
                                    color: 'var(--ink)',
                                    position: 'relative'
                                }}>
                                    <div style={{ whiteSpace: 'pre-wrap' }}>{msg.answer}</div>

                                    {msg.answerId && (
                                        <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <button
                                                    onClick={() => handleSubmitMessageFeedback(msg.id, msg.answerId as string, msg.question, 1)}
                                                    disabled={!!submittingFeedbackByMessageId[msg.id]}
                                                    style={{
                                                        padding: '6px 10px',
                                                        fontSize: '12px',
                                                        borderRadius: '6px',
                                                        border: '1px solid var(--border)',
                                                        background: feedbackByMessageId[msg.id] === 1 ? 'rgba(34,197,94,0.12)' : 'var(--surface)',
                                                        color: 'var(--ink)',
                                                        cursor: submittingFeedbackByMessageId[msg.id] ? 'not-allowed' : 'pointer',
                                                        opacity: submittingFeedbackByMessageId[msg.id] ? 0.7 : 1,
                                                    }}
                                                >
                                                    Helpful
                                                </button>
                                                <button
                                                    onClick={() => handleSubmitMessageFeedback(msg.id, msg.answerId as string, msg.question, -1)}
                                                    disabled={!!submittingFeedbackByMessageId[msg.id]}
                                                    style={{
                                                        padding: '6px 10px',
                                                        fontSize: '12px',
                                                        borderRadius: '6px',
                                                        border: '1px solid var(--border)',
                                                        background: feedbackByMessageId[msg.id] === -1 ? 'rgba(239,68,68,0.12)' : 'var(--surface)',
                                                        color: 'var(--ink)',
                                                        cursor: submittingFeedbackByMessageId[msg.id] ? 'not-allowed' : 'pointer',
                                                        opacity: submittingFeedbackByMessageId[msg.id] ? 0.7 : 1,
                                                    }}
                                                >
                                                    Not helpful
                                                </button>
                                            </div>

                                            {feedbackToastByMessageId[msg.id] && (
                                                <div
                                                    style={{
                                                        alignSelf: 'flex-start',
                                                        marginTop: '-2px',
                                                        padding: '4px 8px',
                                                        borderRadius: '999px',
                                                        border: '1px solid var(--border)',
                                                        background: 'rgba(34,197,94,0.10)',
                                                        fontSize: '11px',
                                                        color: 'var(--ink)',
                                                    }}
                                                >
                                                    {feedbackToastByMessageId[msg.id]}
                                                </div>
                                            )}

                                            <div style={{ maxWidth: '100%' }}>
                                                <StyleFeedbackForm
                                                    answerId={msg.answerId}
                                                    question={msg.question || ''}
                                                    originalResponse={msg.answer || ''}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Actions & Meta */}
                                    {(msg.suggestedActions.length > 0 || msg.retrievalMeta || msg.extractedGraphData || (msg.anchorCitations && msg.anchorCitations.length > 0)) && (
                                        <div style={{
                                            marginTop: '12px',
                                            paddingTop: '12px',
                                            borderTop: '1px dashed var(--border)',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '8px'
                                        }}>
                                            {msg.retrievalMeta && (
                                                <div style={{ fontSize: '11px', color: 'var(--muted)', display: 'flex', gap: '8px' }}>
                                                    <span>{msg.retrievalMeta.concepts} concepts</span>
                                                    <span>•</span>
                                                    <span>{msg.retrievalMeta.claims} claims</span>
                                                </div>
                                            )}

                                            {msg.anchorCitations && msg.anchorCitations.length > 0 && (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                    <div style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 600 }}>Sources</div>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                        {msg.anchorCitations.slice(0, 3).map((c: any, i: number) => {
                                                            const title = c?.title || c?.url || c?.doc_id || `Source ${i + 1}`;
                                                            const preview = c?.anchor?.preview || '';
                                                            const url = c?.url || '';
                                                            const key = c?.anchor?.anchor_id || `${i}`;
                                                            return (
                                                                <button
                                                                    key={key}
                                                                    onClick={() => onRead({ content: preview, title, url })}
                                                                    style={{
                                                                        textAlign: 'left',
                                                                        background: 'transparent',
                                                                        border: '1px solid var(--border)',
                                                                        borderRadius: '10px',
                                                                        padding: '8px 10px',
                                                                        cursor: 'pointer',
                                                                        color: 'var(--ink)',
                                                                    }}
                                                                    title={url || title}
                                                                >
                                                                    <div style={{ fontSize: '12px', fontWeight: 600, lineHeight: 1.3, marginBottom: preview ? '4px' : 0 }}>
                                                                        {title}
                                                                    </div>
                                                                    {preview && (
                                                                        <div style={{ fontSize: '11px', color: 'var(--muted)', lineHeight: 1.4 }}>
                                                                            {preview.length > 220 ? preview.slice(0, 219) + '…' : preview}
                                                                        </div>
                                                                    )}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Action Buttons */}
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                                {msg.extractedGraphData && !msg.extractedGraphData._saved && (
                                                    <button
                                                        onClick={async () => {
                                                            if (msg.extractedGraphData._saving) return;
                                                            msg.extractedGraphData._saving = true; // Simple local lock

                                                            try {
                                                                const api = await import('../../api-client');
                                                                const nodes = msg.extractedGraphData.nodes || [];
                                                                const edges = msg.extractedGraphData.edges || [];

                                                                // Optimistic UI update
                                                                const btn = document.getElementById(`save-btn-${msg.id}`);
                                                                if (btn) btn.innerText = "Saving...";

                                                                // Persist Nodes
                                                                const nodePromises = nodes.map((n: any) =>
                                                                    api.createConcept({
                                                                        name: n.label || n.name || n.id,
                                                                        domain: 'generated',
                                                                        type: 'concept',
                                                                        description: n.description || "Extracted from search",
                                                                        graph_id: activeGraphId
                                                                    })
                                                                );

                                                                // Persist Edges (after nodes to ensure existence, though backend might handle it)
                                                                // Better to map promises.
                                                                await Promise.all(nodePromises);

                                                                const edgePromises = edges.map((e: any) =>
                                                                    api.createRelationshipByIds(
                                                                        e.from || e.source,
                                                                        e.to || e.target,
                                                                        e.label || 'related_to'
                                                                    )
                                                                );
                                                                await Promise.all(edgePromises);

                                                                msg.extractedGraphData._saved = true;
                                                                if (btn) {
                                                                    btn.innerText = "Saved ✅";
                                                                    btn.style.background = "#dcfce7";
                                                                    btn.style.borderColor = "#10b981";
                                                                    btn.style.color = "#166534";
                                                                }

                                                                // Trigger a reload? 
                                                                // We need to notify the graph to remove "new" status or just refresh.
                                                                // For now, simple persistence is the goal.
                                                            } catch (err) {
                                                                console.error("Failed to save graph:", err);
                                                                const btn = document.getElementById(`save-btn-${msg.id}`);
                                                                if (btn) btn.innerText = "Error ❌";
                                                            } finally {
                                                                msg.extractedGraphData._saving = false;
                                                            }
                                                        }}
                                                        id={`save-btn-${msg.id}`}
                                                        style={{
                                                            background: 'rgba(16, 185, 129, 0.1)',
                                                            border: '1px solid rgba(16, 185, 129, 0.2)',
                                                            color: '#059669',
                                                            padding: '4px 8px',
                                                            borderRadius: '6px',
                                                            fontSize: '11px',
                                                            fontWeight: 600,
                                                            cursor: 'pointer',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '4px'
                                                        }}
                                                    >
                                                        <span>Save Results</span>
                                                    </button>
                                                )}

                                                {msg.suggestedActions.map((action, i) => (
                                                    <button
                                                        key={i}
                                                        onClick={() => onSelectAction?.(action)}
                                                        style={{
                                                            background: 'rgba(37, 99, 235, 0.05)',
                                                            border: '1px solid rgba(37, 99, 235, 0.1)',
                                                            color: 'var(--accent)',
                                                            padding: '4px 8px',
                                                            borderRadius: '6px',
                                                            fontSize: '11px',
                                                            fontWeight: 600,
                                                            cursor: 'pointer'
                                                        }}
                                                    >
                                                        {action.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* SOURCES LIST */}
                                    {msg.webSearchResults && msg.webSearchResults.length > 0 && (
                                        <div style={{
                                            marginTop: '12px',
                                            paddingTop: '12px',
                                            borderTop: '1px dashed var(--border)',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '8px'
                                        }}>
                                            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.05em' }}>
                                                SOURCES
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                {msg.webSearchResults.map((source, idx) => (
                                                    <div key={idx} style={{
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        alignItems: 'center',
                                                        padding: '6px 10px',
                                                        background: 'var(--surface)',
                                                        borderRadius: '8px',
                                                        border: '1px solid var(--border)'
                                                    }}>
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
                                                            <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                                {idx + 1}. {source.title}
                                                            </span>
                                                            <a href={source.link} target="_blank" rel="noopener noreferrer"
                                                                style={{ fontSize: '10px', color: 'var(--muted)', textDecoration: 'none' }}>
                                                                {new URL(source.link).hostname}
                                                            </a>
                                                        </div>

                                                        {source.fullContent && (
                                                            <button
                                                                onClick={() => onRead({
                                                                    content: source.fullContent!,
                                                                    title: source.title,
                                                                    url: source.link
                                                                })}
                                                                style={{
                                                                    padding: '4px 8px',
                                                                    borderRadius: '6px',
                                                                    background: 'rgba(37, 99, 235, 0.1)',
                                                                    color: 'var(--accent)',
                                                                    border: 'none',
                                                                    cursor: 'pointer',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '4px',
                                                                    fontSize: '11px',
                                                                    fontWeight: 600,
                                                                    marginLeft: '8px'
                                                                }}
                                                            >
                                                                <BookOpen size={14} />
                                                                Read
                                                            </button>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}

                        {state.isChatLoading && (state.chatHistory.length === 0 || !state.chatHistory[state.chatHistory.length - 1].answer) && (
                            <div style={{ alignSelf: 'flex-start', display: 'flex', gap: '8px', alignItems: 'center', padding: '12px' }}>
                                <div className="typing-indicator">
                                    <span></span>
                                    <span></span>
                                    <span></span>
                                </div>
                                <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 500 }}>{state.loadingStage || 'Thinking...'}</span>
                            </div>
                        )}
                    </div>

                    {/* Suggested Questions */}
                    {state.suggestedQuestions.length > 0 && !state.isChatLoading && (
                        <div style={{
                            padding: '0 20px 12px',
                            display: 'flex',
                            gap: '8px',
                            overflowX: 'auto',
                            scrollbarWidth: 'none'
                        }}>
                            {state.suggestedQuestions.map((q, i) => (
                                <button
                                    key={i}
                                    onClick={() => onAsk(q)}
                                    style={{
                                        whiteSpace: 'nowrap',
                                        padding: '6px 12px',
                                        borderRadius: '99px',
                                        border: '1px solid var(--border)',
                                        background: 'var(--surface)',
                                        color: 'var(--ink)',
                                        fontSize: '12px',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.borderColor = 'var(--accent)';
                                        e.currentTarget.style.color = 'var(--accent)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.borderColor = 'var(--border)';
                                        e.currentTarget.style.color = 'var(--ink)';
                                    }}
                                >
                                    {q}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Input Area */}
                    <div style={{ padding: '16px 20px 20px', background: 'var(--panel)', borderTop: '1px solid var(--border)' }}>
                        <form onSubmit={handleSubmit} style={{ position: 'relative' }}>
                            <textarea
                                ref={inputRef}
                                placeholder="Ask about the graph..."
                                onInput={(e) => {
                                    const target = e.target as HTMLTextAreaElement;
                                    target.style.height = 'auto';
                                    target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
                                }}
                                style={{
                                    width: '100%',
                                    padding: '12px 48px 12px 16px',
                                    borderRadius: '12px',
                                    border: '1px solid var(--border)',
                                    background: 'var(--surface)',
                                    fontSize: '14px',
                                    outline: 'none',
                                    boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
                                    transition: 'all 0.2s',
                                    resize: 'none',
                                    minHeight: '44px',
                                    maxHeight: '200px',
                                    fontFamily: 'inherit',
                                    lineHeight: '1.5'
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSubmit(e);
                                    }
                                }}
                                onFocus={(e) => (e.target as any).style.borderColor = 'var(--accent)'}
                                onBlur={(e) => (e.target as any).style.borderColor = 'var(--border)'}
                            />
                            <button
                                type="submit"
                                style={{
                                    position: 'absolute',
                                    right: '8px',
                                    bottom: '12px',
                                    background: 'var(--accent)',
                                    color: 'white',
                                    border: 'none',
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '8px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer',
                                    fontSize: '16px'
                                }}
                            >
                                ↑
                            </button>
                        </form>
                    </div>
                </div>

                {isTutorMode && (
                    <div
                        className="chat-tutor"
                        style={{
                            flex: 1,
                            minWidth: 0,
                            borderLeft: '1px solid var(--border)',
                            background: 'var(--surface)',
                            display: 'flex',
                            flexDirection: 'column'
                        }}
                    >
                        <div style={{
                            padding: '16px 20px',
                            borderBottom: '1px solid var(--border)',
                            fontSize: '14px',
                            fontWeight: 600,
                            color: 'var(--ink)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                        }}>
                            <span>Tutor Mode</span>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                {session && (
                                    <button
                                        onClick={() => {
                                            if (confirm('Clear current session?')) clearSession();
                                        }}
                                        style={{
                                            background: 'transparent',
                                            border: 'none',
                                            cursor: 'pointer',
                                            color: 'var(--muted)',
                                            display: 'flex',
                                            alignItems: 'center'
                                        }}
                                        title="Reset Session"
                                    >
                                        <RotateCcw size={14} />
                                    </button>
                                )}
                            </div>
                        </div>
                        <div style={{
                            flex: 1,
                            overflowY: 'auto',
                            padding: '20px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '20px',
                            scrollbarWidth: 'none'
                        }}>
                            {isStudyLoading && !currentTask && (
                                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>
                                    Initializing Tutor...
                                </div>
                            )}

                            {currentTask ? (
                                <>
                                    <TaskCard
                                        taskType={currentTask.task_type}
                                        prompt={currentTask.prompt}
                                        excerpts={currentTask.context_pack.excerpts}
                                        rubric={currentTask.rubric_json}
                                    />

                                    {lastEvaluation ? (
                                        <>
                                            <Feedback
                                                scores={lastEvaluation.score_json}
                                                compositeScore={lastEvaluation.composite_score}
                                                feedbackText={lastEvaluation.feedback_text}
                                                gapConcepts={lastEvaluation.gap_concepts}
                                                onNextTask={handleNextTask}
                                                onFocusConcept={(concept) => {
                                                    // Logic to focus node if it exists in graph
                                                    console.log('Focus concept:', concept);
                                                }}
                                            />
                                            {lastEvaluation.gap_concepts.length > 0 && (
                                                <Citations excerpts={currentTask.context_pack.excerpts} />
                                            )}
                                        </>
                                    ) : (
                                        <AttemptInput
                                            onSubmit={async (responseText) => {
                                                try {
                                                    setStudyLoading(true);
                                                    const { submitAttempt: apiSubmitAttempt } = await import('../../api-client-study');
                                                    const result = await apiSubmitAttempt(currentTask.task_id, responseText);
                                                    setLastEvaluation(result.evaluation);
                                                } catch (err) {
                                                    console.error('Failed to submit attempt:', err);
                                                } finally {
                                                    setStudyLoading(false);
                                                }
                                            }}
                                            isLoading={isStudyLoading}
                                            options={currentTask.task_type === 'multiple_choice' ? currentTask.rubric_json?.options : undefined}
                                        />
                                    )}
                                </>
                            ) : (
                                !isStudyLoading && (
                                    <div style={{
                                        height: '100%',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: 'var(--muted)',
                                        textAlign: 'center',
                                        padding: '40px'
                                    }}>
                                        <div style={{ fontSize: '13px', lineHeight: '1.5' }}>
                                            Select text on the graph and click "Dive Deeper" to start a focused learning session, or wait for the tutor to suggest a topic.
                                        </div>
                                    </div>
                                )
                            )}
                        </div>
                    </div>
                )}
            </div>

            <style jsx>{`
        .typing-indicator {
          display: flex;
          gap: 4px;
        }
        .typing-indicator span {
          width: 4px;
          height: 4px;
          background: var(--muted);
          borderRadius: 50%;
          animation: bounce 1.4s infinite ease-in-out both;
        }
        .typing-indicator span:nth-child(1) { animation-delay: -0.32s; }
        .typing-indicator span:nth-child(2) { animation-delay: -0.16s; }
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0); }
          40% { transform: scale(1.0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .chat-orb-center {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .voice-orb-button {
          width: 28px;
          height: 28px;
          borderRadius: 999px;
          border: 1px solid var(--border);
          background: transparent;
          cursor: pointer;
          display: flex;
          alignItems: center;
          justifyContent: center;
          padding: 0;
          transition: all 0.2s ease;
        }
        .voice-orb-button:hover {
          borderColor: var(--accent);
          boxShadow: 0 0 10px rgba(37, 99, 235, 0.25);
        }
        .voice-orb-button.is-active {
          borderColor: var(--accent);
          boxShadow: 0 0 16px rgba(37, 99, 235, 0.35);
        }
        .home-orb {
          width: 22px;
          height: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .home-orb-core {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--accent-gradient);
          animation: pulse 3s infinite ease-in-out;
          box-shadow: 0 0 18px rgba(37, 99, 235, 0.35);
        }
        .voice-orb-button.is-active .home-orb-core {
          box-shadow: 0 0 26px rgba(37, 99, 235, 0.55);
        }
        @keyframes pulse {
          0%, 100% { transform: scale(0.92); opacity: 0.85; }
          50% { transform: scale(1.05); opacity: 1; }
        }
      `}</style>

        </div>
    );
}
