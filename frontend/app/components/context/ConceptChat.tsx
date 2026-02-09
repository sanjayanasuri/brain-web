'use client';

import React, { useRef, useEffect } from 'react';
import { useChatState } from '../graph/hooks/useChatState';
import { Concept } from '../../api-client';
import { useGraph } from '../graph/GraphContext';
import { normalizeEvidence } from '../../types/evidence';

interface ConceptChatProps {
    concept: Concept;
    onClose?: () => void;
}

export default function ConceptChat({ concept, onClose }: ConceptChatProps) {
    // specialized local chat state for this concept
    const { state, actions } = useChatState();
    const graph = useGraph();
    const chatStreamRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Auto-scroll
    useEffect(() => {
        if (chatStreamRef.current) {
            chatStreamRef.current.scrollTop = chatStreamRef.current.scrollHeight;
        }
    }, [state.chatHistory, state.isChatLoading]);

    // Initialize/Welcome
    useEffect(() => {
        if (state.chatHistory.length === 0 && !state.isChatLoading) {
            // Add initial greeting from system/assistant
            actions.addChatMessage({
                id: `init-${Date.now()}`,
                question: '',
                answer: `I'm here to help you clarify "${concept.name}". What would you like to know?`,
                answerId: null,
                eventId: null,
                answerSections: null,
                timestamp: Date.now(),
                suggestedQuestions: [
                    `Explain ${concept.name} in simple terms`,
                    `How does ${concept.name} relate to...?`,
                    `Give me an example of ${concept.name}`
                ],
                usedNodes: [],
                suggestedActions: [],
                retrievalMeta: null,
                evidenceUsed: []
            });
        }
    }, [concept.name, actions, state.chatHistory.length, state.isChatLoading]);

    const handleAsk = async (question: string) => {
        if (!question.trim()) return;

        // Add user message immediately
        const userMsgId = `concept-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const pendingMessage = {
            id: userMsgId,
            question: question,
            answer: '',
            answerId: null,
            eventId: null,
            answerSections: null,
            timestamp: Date.now(),
            suggestedQuestions: [],
            usedNodes: [],
            suggestedActions: [],
            retrievalMeta: null,
            evidenceUsed: [],
            anchorCitations: [],
        };
        actions.addChatMessage(pendingMessage);

        actions.setChatLoading(true);
        actions.setLoadingStage('Thinking...');

        try {
            // Include the pending message to avoid stale state when the reducer hasn't applied yet.
            const chatHistoryForAPI = [...state.chatHistory, pendingMessage].map(msg => ({
                id: msg.id,
                question: msg.question,
                answer: msg.answer,
                timestamp: msg.timestamp,
            }));

            const response = await fetch('/api/brain-web/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: question,
                    mode: 'graphrag',
                    graph_id: graph.activeGraphId,
                    branch_id: graph.activeBranchId,
                    chatHistory: chatHistoryForAPI,
                    focus_concept_id: concept.node_id,
                })
            });

            if (!response.ok) {
                const errorText = await response.text().catch(() => '');
                throw new Error(errorText || 'Failed to fetch response');
            }

            const data = await response.json();
            if (data?.error) throw new Error(data.error);

            const normalizedEvidence = data.evidence ? normalizeEvidence(data.evidence) : (data.evidenceUsed || []);

            actions.updateChatMessage(userMsgId, {
                answer: data.answer || '',
                answerId: data.answerId || null,
                answerSections: data.answer_sections || data.sections || null,
                suggestedQuestions: data.suggestedQuestions || [],
                usedNodes: data.usedNodes || [],
                suggestedActions: data.suggestedActions || [],
                retrievalMeta: data.retrievalMeta || null,
                evidenceUsed: normalizedEvidence,
                anchorCitations: data.anchorCitations || data.citations || [],
                extractedGraphData: data.graph_data,
                webSearchResults: data.webSearchResults,
            });
        } catch (error) {
            console.error(error);
            const errMsg = error instanceof Error ? error.message : 'Failed to fetch response';
            actions.updateChatMessage(userMsgId, { answer: `❌ Error: ${errMsg}` });
        } finally {
            actions.setChatLoading(false);
            actions.setLoadingStage('');
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Messages */}
            <div ref={chatStreamRef} style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {state.chatHistory.map(msg => (
                    <div key={msg.id}>
                        {msg.question && (
                            <div style={{ marginLeft: 'auto', background: 'var(--accent)', color: 'white', padding: '8px 12px', borderRadius: '12px', maxWidth: '80%', marginBottom: '8px' }}>
                                {msg.question}
                            </div>
                        )}
                        {msg.answer && (
                            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: '12px', borderRadius: '12px', maxWidth: '90%' }}>
                                {msg.answer}
                            </div>
                        )}
                    </div>
                ))}
                {state.isChatLoading && (
                    <div style={{
                        padding: '12px',
                        background: 'var(--panel)',
                        borderRadius: '12px',
                        fontSize: '14px',
                        color: 'var(--muted)',
                        border: '1px solid var(--border)',
                        alignSelf: 'flex-start'
                    }}>
                        Thinking...
                    </div>
                )}
            </div>

            {/* Input */}
            <div style={{ padding: '16px', borderTop: '1px solid var(--border)' }}>
                <form onSubmit={(e) => { e.preventDefault(); handleAsk(inputRef.current?.value || ''); if (inputRef.current) inputRef.current.value = ''; }}>
                    <textarea
                        ref={inputRef as any}
                        placeholder="Clarify this concept..."
                        onInput={(e) => {
                            const target = e.target as HTMLTextAreaElement;
                            target.style.height = 'auto';
                            target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
                        }}
                        style={{
                            width: '100%',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            border: '1px solid var(--border)',
                            background: 'var(--surface)',
                            color: 'var(--ink)',
                            resize: 'none',
                            fontFamily: 'inherit',
                            fontSize: '14px',
                            lineHeight: '1.5',
                            minHeight: '40px',
                            maxHeight: '200px',
                            outline: 'none'
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                e.currentTarget.closest('form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                            }
                        }}
                    />
                </form>
            </div>
        </div>
    );
}
