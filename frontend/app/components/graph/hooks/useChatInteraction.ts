'use client';

import { useCallback, useRef } from 'react';
import { useChatState, ChatMessage } from './useChatState';
import { useUIState } from './useUIState';
import { useGraph } from '../GraphContext';
import { VisualNode, VisualGraph } from '../GraphTypes';
import { Concept } from '../../../api-client';
import { getCurrentSessionId, setCurrentSessionId, createChatSession, addMessageToSession } from '../../../lib/chatSessions';
import { emitChatMessageCreated } from '../../../lib/sessionEvents';
import { normalizeEvidence, EvidenceItem } from '../../../types/evidence';

export function useChatInteraction(
    chatStreamRef: React.MutableRefObject<HTMLDivElement | null>,
    graphRef: React.MutableRefObject<any>,
    loadGraph: (graphId: string) => Promise<void>,
    centerNodeInVisibleArea: (x: number, y: number, duration?: number, assumePanelOpen?: boolean) => void,
    updateSelectedPosition: (node?: any) => void,
    resolveConceptByName: (name: string) => Promise<Concept | null>,
    clearEvidenceHighlight: () => void,
    applyEvidenceHighlightWithRetry: (evidenceItems: EvidenceItem[], retrievalMeta: any) => Promise<void>
) {
    const chat = useChatState();
    const ui = useUIState();
    const graph = useGraph();
    const {
        activeGraphId,
        activeBranchId,
        setSelectedNode,
        setGraphData
    } = graph;

    const isSubmittingChatRef = useRef<boolean>(false);
    const currentMessageIdRef = useRef<string | null>(null);

    const handleChatSubmit = useCallback(async (message: string, autoHighlightEvidence: boolean) => {
        if (!message.trim() || chat.state.isChatLoading || isSubmittingChatRef.current) {
            return;
        }

        isSubmittingChatRef.current = true;
        const userMessageId = `user-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        currentMessageIdRef.current = userMessageId;

        const recentMessages = chat.state.chatHistory.slice(-3);
        const isDuplicate = recentMessages.some(msg =>
            msg.question === message && (!msg.answer || msg.answer.trim() === '')
        );
        if (isDuplicate) {
            isSubmittingChatRef.current = false;
            currentMessageIdRef.current = null;
            return;
        }

        const pendingMessage: ChatMessage = {
            id: userMessageId,
            question: message,
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
        };
        chat.actions.addChatMessage(pendingMessage);

        setTimeout(() => {
            if (chatStreamRef.current) {
                chatStreamRef.current.scrollTop = chatStreamRef.current.scrollHeight;
            }
        }, 0);

        chat.actions.setChatLoading(true);
        chat.actions.setLoadingStage('Processing your question...');
        chat.actions.setLastQuestion(message);
        chat.actions.setChatAnswer(null);
        chat.actions.setAnswerId(null);
        chat.actions.setAnswerSections(null);
        chat.actions.setEvidenceUsed([]);
        chat.actions.setUsedNodes([]);
        chat.actions.setSuggestedQuestions([]);
        chat.actions.setSuggestedActions([]);
        chat.actions.setRetrievalMeta(null);
        clearEvidenceHighlight();

        try {
            const chatHistoryForAPI = chat.state.chatHistory.map(msg => ({
                id: msg.id,
                question: msg.question,
                answer: msg.answer,
                timestamp: msg.timestamp,
            }));

            const context = typeof window !== 'undefined' && (window as any).__brainWebContext
                ? (window as any).__brainWebContext
                : null;

            const response = await fetch('/api/brain-web/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message,
                    mode: 'graphrag',
                    graph_id: activeGraphId,
                    branch_id: activeBranchId,
                    chatHistory: chatHistoryForAPI,
                    ui_context: context ? {
                        dom_path: context.domPath,
                        position: context.position,
                        react_component: context.reactComponent,
                        html_element: context.htmlElement?.substring(0, 200),
                    } : undefined,
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || 'Chat request failed');
            }

            const data = await response.json();
            if (data.error) throw new Error(data.error);

            const isActionRequest = message.toLowerCase().match(/\b(add|create|link|connect)\b.*\b(node|graph|concept)\b/i) ||
                message.toLowerCase().match(/\badd\s+\w+\s+to\s+(graph|the\s+graph)\b/i);

            if (data.suggestedActions && data.suggestedActions.length > 0 && isActionRequest) {
                const action = data.suggestedActions[0];
                try {
                    chat.actions.setLoadingStage(`Executing: ${action.label}...`);
                    const api = await import('../../../api-client');

                    if (action.type === 'add' && action.concept) {
                        await api.selectGraph(activeGraphId);
                        const newConcept = await api.createConcept({
                            name: action.concept,
                            domain: action.domain || 'general',
                            type: 'concept',
                            graph_id: activeGraphId,
                        });

                        let fullConcept: Concept;
                        try {
                            fullConcept = await api.getConcept(newConcept.node_id);
                        } catch {
                            fullConcept = newConcept;
                        }

                        const visualNode: VisualNode = {
                            ...fullConcept,
                            domain: action.domain || 'general',
                            type: 'concept',
                        };

                        setGraphData(prev => {
                            const exists = prev.nodes.some(n => n.node_id === fullConcept.node_id);
                            if (exists) return prev;
                            return { ...prev, nodes: [...prev.nodes, visualNode] };
                        });

                        await loadGraph(activeGraphId);

                        setTimeout(() => {
                            const updatedGraphData = graphRef.current?.graphData();
                            const conceptInGraph = updatedGraphData?.nodes?.find((n: any) => n.node_id === newConcept.node_id) || visualNode;
                            setSelectedNode(conceptInGraph);
                            updateSelectedPosition(conceptInGraph);

                            if (conceptInGraph.x !== undefined && conceptInGraph.y !== undefined) {
                                centerNodeInVisibleArea(conceptInGraph.x, conceptInGraph.y, 1000, true);
                            }
                        }, 600);

                        chat.actions.setChatAnswer(`✅ Added "${action.concept}" to the graph!`);
                    } else if (action.type === 'link' && action.source && action.target) {
                        const sourceConcept = await resolveConceptByName(action.source);
                        const targetConcept = await resolveConceptByName(action.target);

                        if (sourceConcept && targetConcept) {
                            await api.createRelationshipByIds(sourceConcept.node_id, targetConcept.node_id, action.label || 'related_to');
                            await loadGraph(activeGraphId);
                            chat.actions.setChatAnswer(`✅ Linked "${action.source}" to "${action.target}"!`);
                        }
                    }
                } catch (err: any) {
                    console.error('[Auto-Action] Error:', err);
                }
            }

            let normalizedEvidence = data.evidence ? normalizeEvidence(data.evidence) : (data.evidenceUsed || []);

            const messageIdToFind = currentMessageIdRef.current || userMessageId;
            const currentHistory = chat.state.chatHistory;
            let messageIndex = currentHistory.findIndex(msg => msg.id === messageIdToFind);

            if (messageIndex >= 0) {
                const updatedHistory = currentHistory.map((msg, idx) =>
                    idx === messageIndex ? {
                        ...msg,
                        answer: data.answer,
                        answerId: data.answerId || null,
                        answerSections: data.answer_sections || data.sections || null,
                        suggestedQuestions: data.suggestedQuestions || [],
                        usedNodes: data.usedNodes || [],
                        suggestedActions: data.suggestedActions || [],
                        retrievalMeta: data.retrievalMeta || null,
                        evidenceUsed: normalizedEvidence,
                    } : msg
                );
                chat.actions.setChatHistory(updatedHistory);
            }

            chat.actions.setAnswerSections(data.answer_sections || data.sections || null);
            chat.actions.setUsedNodes(data.usedNodes || []);
            chat.actions.setSuggestedQuestions(data.suggestedQuestions || []);
            chat.actions.setSuggestedActions(data.suggestedActions || []);
            chat.actions.setRetrievalMeta(data.retrievalMeta || null);
            chat.actions.setEvidenceUsed(normalizedEvidence);

            if (autoHighlightEvidence && normalizedEvidence.length > 0) {
                await applyEvidenceHighlightWithRetry(normalizedEvidence, data.retrievalMeta);
            }

            let sessionId = getCurrentSessionId();
            if (!sessionId && message.trim()) {
                const newSession = await createChatSession(message, data.answer || '', data.answerId || null, null, activeGraphId, activeBranchId);
                sessionId = newSession.id;
                setCurrentSessionId(sessionId);
            }

            if (sessionId && data.answer) {
                const eventResult = await emitChatMessageCreated(sessionId, {
                    message,
                    answer: data.answer,
                    answer_summary: data.answer.slice(0, 500),
                    message_id: messageIdToFind,
                });
                const emittedEventId = eventResult?.event_id || null;

                addMessageToSession(sessionId, message, data.answer, data.answerId || null, data.suggestedQuestions || [], normalizedEvidence, emittedEventId);

                if (emittedEventId) {
                    const updatedHistory = chat.state.chatHistory.map((msg) =>
                        msg.id === messageIdToFind ? { ...msg, eventId: emittedEventId } : msg
                    );
                    chat.actions.setChatHistory(updatedHistory);
                }
            }

            setTimeout(() => {
                if (chatStreamRef.current) {
                    chatStreamRef.current.scrollTop = chatStreamRef.current.scrollHeight;
                }
            }, 100);
        } catch (err) {
            console.error('[Chat] Error:', err);
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            chat.actions.setChatAnswer(`❌ Error: ${errorMessage}. Please try again.`);
        } finally {
            chat.actions.setChatLoading(false);
            chat.actions.setLoadingStage('');
            isSubmittingChatRef.current = false;
            currentMessageIdRef.current = null;
        }
    }, [chat, activeGraphId, activeBranchId, loadGraph, centerNodeInVisibleArea, updateSelectedPosition, resolveConceptByName, clearEvidenceHighlight, applyEvidenceHighlightWithRetry, setGraphData, setSelectedNode]);

    return {
        handleChatSubmit,
        isSubmittingChat: isSubmittingChatRef.current
    };
}
