'use client';

import { useCallback, useRef, useMemo } from 'react';
import { useChat, ChatMessage } from './useChatState';
import { useUI } from './useUIState';
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
    const chat = useChat();
    const ui = useUI();
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
            // Manually include the pending message to avoid stale state issues
            const chatHistoryForAPI = [...chat.state.chatHistory, pendingMessage].map(msg => ({
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

            // Handle extracted graph data from Perplexica
            if (data.graph_data) {
                console.log('[Chat] Received graph data from search:', data.graph_data);
                setGraphData(prev => {
                    const newNodes = [...prev.nodes];
                    const newLinks = [...prev.links];
                    let nodesAdded = 0;
                    let linksAdded = 0;

                    if (Array.isArray(data.graph_data.nodes)) {
                        data.graph_data.nodes.forEach((n: any) => {
                            // Map Perplexica format (id, label) to VisualNode (node_id, name)
                            const nodeId = n.id || n.node_id;
                            if (nodeId && !newNodes.some(existing => existing.node_id === nodeId)) {
                                newNodes.push({
                                    node_id: nodeId,
                                    name: n.label || n.name || nodeId,
                                    type: n.type || 'concept',
                                    domain: 'general',
                                    ...n, // Include other props
                                    val: 2, // Default size
                                    color: n.color || '#4285F4',
                                    __isNew: true,
                                    __createdAt: Date.now()
                                });
                                nodesAdded++;
                            }
                        });
                    }

                    if (Array.isArray(data.graph_data.edges)) {
                        data.graph_data.edges.forEach((e: any) => {
                            const source = e.from || e.source;
                            const target = e.to || e.target;
                            // We don't store ID on VisualLink, so just check source/target uniqueness

                            if (source && target) {
                                const exists = newLinks.some(l => {
                                    const s = typeof l.source === 'object' ? (l.source as any).node_id : l.source;
                                    const t = typeof l.target === 'object' ? (l.target as any).node_id : l.target;
                                    return s === source && t === target;
                                });

                                if (!exists) {
                                    newLinks.push({
                                        source, // ID string, D3 will resolve
                                        target, // ID string, D3 will resolve
                                        predicate: e.label || e.type || e.predicate || 'related_to',
                                        ...e,
                                        __isNew: true,
                                        __createdAt: Date.now()
                                    } as any); // Cast as any to bypass strict VisualLink type temporarily during merge
                                    linksAdded++;
                                }
                            }
                        });
                    }

                    if (nodesAdded > 0 || linksAdded > 0) {
                        console.log(`[Chat] Merged ${nodesAdded} nodes and ${linksAdded} links from search.`);
                        return { ...prev, nodes: newNodes, links: newLinks };
                    }
                    return prev;
                });
            }

            // ... (Auto-action logic remains same)
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
                            const fg = graphRef.current;
                            const updatedGraphData = fg ? (typeof fg.graphData === 'function' ? fg.graphData() : (fg.graphData || graph.graphData)) : graph.graphData;
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

            const messageIdToUpdate = currentMessageIdRef.current || userMessageId;

            // Use updateChatMessage to ensure we don't rely on stale state for the full history
            chat.actions.updateChatMessage(messageIdToUpdate, {
                answer: data.answer,
                answerId: data.answerId || null,
                answerSections: data.answer_sections || data.sections || null,
                suggestedQuestions: data.suggestedQuestions || [],
                usedNodes: data.usedNodes || [],
                suggestedActions: data.suggestedActions || [],
                retrievalMeta: data.retrievalMeta || null,
                evidenceUsed: normalizedEvidence,
                extractedGraphData: data.graph_data, // Store for "Save" button
                webSearchResults: data.webSearchResults
            });

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
                    message_id: messageIdToUpdate,
                });
                const emittedEventId = eventResult?.event_id || null;

                addMessageToSession(sessionId, message, data.answer, data.answerId || null, data.suggestedQuestions || [], normalizedEvidence, emittedEventId);

                if (emittedEventId) {
                    chat.actions.updateChatMessage(messageIdToUpdate, { eventId: emittedEventId });
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

    return useMemo(() => ({
        handleChatSubmit,
        isSubmittingChat: isSubmittingChatRef.current
    }), [handleChatSubmit]);
}
