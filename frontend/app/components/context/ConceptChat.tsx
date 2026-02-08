'use client';

import React, { useRef, useEffect } from 'react';
import { useChatState } from '../graph/hooks/useChatState';
import { Concept } from '../../api-client';

interface ConceptChatProps {
    concept: Concept;
    onClose?: () => void;
}

export default function ConceptChat({ concept, onClose }: ConceptChatProps) {
    // specialized local chat state for this concept
    const { state, actions } = useChatState();
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
        const userMsgId = Date.now().toString();
        actions.addChatMessage({
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
            evidenceUsed: []
        });

        actions.setChatLoading(true);
        actions.setLoadingStage('Thinking...');

        try {
            // We need to call the chat API here. 
            // Since useChatState is just state management, we must implement the fetch.
            // We'll use a new endpoint or the standard chat endpoint with context.

            // TODO: Implement actual API call. For now, we simulate or reuse fetch logic.
            // Ideally we should move the fetch logic to a hook or utility we can reuse.
            // But for now let's construct a simple request.

            const response = await fetch('/api/brain-web/chat', { // using generic endpoint
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: question,
                    context: {
                        concept_id: concept.node_id,
                        concept_name: concept.name,
                        mode: 'concept_clarification'
                    }
                })
            });

            if (!response.ok) throw new Error('Failed to fetch response');

            const data = await response.json();

            // Update the last message with the answer
            // Actually addChatMessage adds a NEW paired message (User+AI).
            // But here we added User message first (empty answer).
            // We should replace it or update it. 
            // useChatState structure assumes { question, answer } pair per 'ChatMessage'.
            // So we update the existing one.

            // Wait, useChatState doesn't have "updateMessage". 
            // It has "addChatMessage". 
            // So standard flow is: 
            // 1. Don't add user message yet? Or add it and then update.
            // 2. ChatMessage defines "question" and "answer". 

            // Let's remove the optimistic one and add the full one?
            // Or better: useChatInteraction hook if it exists?

            // Let's look at useChatInteraction.ts first before commiting this file.
        } catch (error) {
            console.error(error);
            actions.setChatLoading(false);
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
