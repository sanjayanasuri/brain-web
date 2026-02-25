// frontend/app/components/study/StudyPanel.tsx
'use client';

import React, { useEffect, useRef } from 'react';
import { useStudyStore, type Interaction } from '../../state/studyStore';
import Citations from './Citations';
import TaskCard from './TaskCard';
import AttemptInput from './AttemptInput';
import Feedback from './Feedback';
import Timeline from './Timeline';
import ModeIndicator from './ModeIndicator';
import { submitAttempt, getNextTask, endStudySession } from '../../api-client-study';
import { useGraph } from '../graph/GraphContext';
import { Concept } from '../../api-client'; // Ensure Concept is imported

export default function StudyPanel() {
    const {
        clarifyResponse,
        isStudyPanelOpen,
        closeStudyPanel,
        isLoading,
        // Phase 2 state
        session,
        currentTask,
        lastEvaluation,
        taskHistory,
        interactionHistory,
        modeState,
        setLoading,
        setLastEvaluation,
        updateLastInteraction,
        setCurrentTask,
        addToTaskHistory,
        clearSession,
        setModeState,
    } = useStudyStore();

    const { graphData, setFocusedNodeId, setSelectedNode } = useGraph();

    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when interaction history updates
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior: 'smooth'
            });
        }
    }, [interactionHistory, currentTask]);

    const handleSubmitAttempt = async (responseText: string) => {
        if (!currentTask) return;

        setLoading(true);
        try {
            const result = await submitAttempt(currentTask.task_id, responseText);

            updateLastInteraction({
                userResponse: responseText,
                evaluation: result.evaluation,
            });

            setLastEvaluation(result.evaluation);
            addToTaskHistory({
                taskId: currentTask.task_id,
                taskType: currentTask.task_type,
                compositeScore: result.evaluation.composite_score,
                createdAt: new Date().toISOString(),
            });

            // Update mode state if returned
            if (result.mode_state) {
                setModeState(result.mode_state);
            }
        } catch (error) {
            console.error('Failed to submit attempt:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleNextTask = async () => {
        if (!session) return;

        setLoading(true);
        try {
            const result = await getNextTask(session.id);
            setCurrentTask(result.task_spec);
            setLastEvaluation(null); // Clear previous feedback

            // Update mode state
            if (result.mode_state) {
                setModeState(result.mode_state);
            }
        } catch (error) {
            console.error('Failed to get next task:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleEndSession = async () => {
        if (!session) return;

        setLoading(true);
        try {
            await endStudySession(session.id);
            clearSession();
        } catch (error) {
            console.error('Failed to end session:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleFocusConcept = (conceptName: string) => {
        const normalizedSearch = conceptName.toLowerCase().trim();
        let node = graphData.nodes.find(n => n.name.toLowerCase().trim() === normalizedSearch);

        // Fallback: Try "includes" if exact match fails
        if (!node) {
            node = graphData.nodes.find(n => n.name.toLowerCase().includes(normalizedSearch) || normalizedSearch.includes(n.name.toLowerCase()));
            if (node) {
                console.log(`Soft matching found: "${node.name}" for search "${conceptName}"`);
            }
        }

        if (node) {
            setFocusedNodeId(node.node_id);
            setSelectedNode(node);
            console.log('Focused and selected concept:', conceptName, node.node_id);
        } else {
            console.warn(`Concept not found in graph, creating virtual node: "${conceptName}"`);
            // Create a virtual node so the user can still explore/fetch content
            const virtualNode: Concept = {
                node_id: `virtual-${Date.now()}`,
                name: conceptName,
                domain: 'general',
                type: 'concept',
                description: 'This concept was referenced in your study session but is not yet in your graph. You can fetch evidence for it.',
                tags: ['virtual', 'study-session']
            };
            setSelectedNode(virtualNode);
            // We don't set focusedNodeId because it's not in the graph visualization
        }
    };

    if (!isStudyPanelOpen) {
        return null;
    }

    // Determine mode: session or clarify
    const isSessionMode = !!session;

    return (
        <div
            style={{
                position: 'fixed',
                top: '80px', // Below TopBar (usually ~64-70px)
                right: '20px', // Floating feel
                width: 'calc(100% - 40px)',
                maxWidth: '420px',
                height: 'calc(100vh - 100px)',
                background: 'var(--panel)',
                backdropFilter: 'blur(24px)',
                borderRadius: '24px',
                border: '1px solid var(--border)',
                boxShadow: '0 20px 50px rgba(0,0,0,0.15)',
                zIndex: 1000,
                display: 'flex',
                flexDirection: 'column',
                animation: 'slideInRight 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                overflow: 'hidden',
            }}
        >
            {/* Header */}
            <div style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
            }}>
                <h3 style={{
                    margin: 0,
                    fontSize: '16px',
                    fontWeight: '600',
                    color: 'var(--ink-strong)',
                }}>
                    {isSessionMode ? '🎓 Study Session' : 'Study Assistant'}
                </h3>

                <div style={{ display: 'flex', gap: '8px' }}>
                    {isSessionMode && (
                        <button
                            onClick={handleEndSession}
                            disabled={isLoading}
                            style={{
                                padding: '6px 12px',
                                borderRadius: '6px',
                                border: 'none',
                                background: '#e74c3c',
                                color: 'white',
                                cursor: isLoading ? 'not-allowed' : 'pointer',
                                fontSize: '12px',
                                fontWeight: 600,
                            }}
                        >
                            End Session
                        </button>
                    )}
                    <button
                        onClick={closeStudyPanel}
                        style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '8px',
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            fontSize: '18px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'background 0.2s ease',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(0,0,0,0.05)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                        }}
                    >
                        ✕
                    </button>
                </div>
            </div>

            {/* Content */}
            <div
                ref={scrollRef}
                style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '20px',
                }}>
                {isLoading ? (
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '100%',
                        gap: '12px',
                    }}>
                        <div style={{
                            width: '40px',
                            height: '40px',
                            border: '3px solid rgba(0,0,0,0.1)',
                            borderTopColor: 'var(--primary)',
                            borderRadius: '50%',
                            animation: 'spin 1s linear infinite',
                        }} />
                        <p style={{
                            margin: 0,
                            fontSize: '14px',
                            color: 'var(--ink-light)',
                        }}>
                            {isSessionMode ? 'Processing...' : 'Generating explanation...'}
                        </p>
                    </div>
                ) : isSessionMode ? (
                    <>
                        {/* Chat History */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            {interactionHistory.map((interaction: Interaction, idx: number) => (
                                <React.Fragment key={interaction.taskId || idx}>
                                    {/* AI Question */}
                                    <div style={{ alignSelf: 'flex-start', maxWidth: '90%' }}>
                                        <TaskCard
                                            taskType={interaction.taskType}
                                            prompt={interaction.prompt}
                                            excerpts={[]} // Excerpts are bulky, maybe hide them in history?
                                            rubric={interaction.rubric}
                                            compact={true}
                                        />
                                    </div>

                                    {/* User Response */}
                                    {interaction.userResponse && (
                                        <div style={{
                                            alignSelf: 'flex-end',
                                            maxWidth: '85%',
                                            padding: '12px 16px',
                                            background: 'var(--accent)',
                                            color: 'white',
                                            borderRadius: '16px 16px 4px 16px',
                                            fontSize: '14px',
                                            boxShadow: '0 4px 12px rgba(59, 130, 246, 0.2)',
                                        }}>
                                            {interaction.userResponse}
                                        </div>
                                    )}

                                    {/* AI Evaluation / Feedback */}
                                    {interaction.evaluation && (
                                        <div style={{ alignSelf: 'flex-start', maxWidth: '95%', width: '100%' }}>
                                            <Feedback
                                                scores={interaction.evaluation.score_json}
                                                compositeScore={interaction.evaluation.composite_score}
                                                feedbackText={interaction.evaluation.feedback_text}
                                                gapConcepts={interaction.evaluation.gap_concepts}
                                                // Only show Next Task button on the *last* interaction
                                                onNextTask={idx === interactionHistory.length - 1 ? handleNextTask : undefined}
                                                onFocusConcept={handleFocusConcept}
                                            />
                                        </div>
                                    )}
                                </React.Fragment>
                            ))}
                        </div>

                        {/* Current Input (if no evaluation yet for the last task) */}
                        {currentTask && !lastEvaluation && (
                            <div style={{ marginTop: '20px' }}>
                                <AttemptInput
                                    onSubmit={handleSubmitAttempt}
                                    isLoading={isLoading}
                                    options={currentTask?.rubric_json?.options || []}
                                />
                            </div>
                        )}
                    </>
                ) : clarifyResponse ? (
                    <>
                        {/* Phase 1 Mode: Clarification */}
                        <div style={{
                            padding: '20px',
                            background: 'rgba(59, 130, 246, 0.08)',
                            borderLeft: '4px solid #3b82f6',
                            borderRadius: '12px',
                            marginBottom: '24px',
                            boxShadow: '0 4px 12px rgba(59, 130, 246, 0.05)',
                        }}>
                            <h4 style={{
                                margin: '0 0 10px 0',
                                fontSize: '11px',
                                fontWeight: 700,
                                color: '#3b82f6',
                                textTransform: 'uppercase',
                                letterSpacing: '0.5px'
                            }}>
                                Teacher's Explanation
                            </h4>
                            <p style={{
                                margin: 0,
                                fontSize: '15px',
                                lineHeight: '1.6',
                                color: 'var(--ink-strong)',
                                fontWeight: 400,
                            }}>
                                {clarifyResponse.explanation}
                            </p>
                        </div>

                        {clarifyResponse.context_pack?.excerpts && (
                            <Citations
                                excerpts={clarifyResponse.context_pack.excerpts}
                                onCitationClick={(excerpt) => {
                                    console.log('Citation clicked:', excerpt);
                                }}
                            />
                        )}
                    </>
                ) : (
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '100%',
                        textAlign: 'center',
                        padding: '20px',
                    }}>
                        <p style={{
                            margin: 0,
                            fontSize: '14px',
                            color: 'var(--ink-light)',
                        }}>
                            Select text and click "Clarify" or "Study" to get started
                        </p>
                    </div>
                )}
            </div>

            <style jsx>{`
        @keyframes slideInRight {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
        </div>
    );
}
