import React, { useCallback } from 'react';
import { useBranchContext } from './BranchContext';
import ChatMessageWithBranches from './ChatMessageWithBranches';
import { createBranch } from '../../lib/branchUtils';
import type { ChatMessage } from '../../types/chat';

interface ChatMessagesListProps {
    messages: ChatMessage[];
    chatSessionId: string | null;
    loading: boolean;
}

export default function ChatMessagesList({
    messages,
    chatSessionId,
    loading,
}: ChatMessagesListProps) {
    const branchContext = useBranchContext();

    const handleExplain = useCallback(async (
        messageId: string,
        startOffset: number,
        endOffset: number,
        selectedText: string,
        parentContent: string
    ) => {
        try {
            const branchResponse = await createBranch({
                parent_message_id: messageId,
                parent_message_content: parentContent,
                start_offset: startOffset,
                end_offset: endOffset,
                selected_text: selectedText,
                chat_id: chatSessionId || localStorage.getItem('brainweb:currentChatSession'),
            });

            branchContext.openBranch(
                branchResponse.branch.id,
                messageId,
                startOffset,
                endOffset
            );
        } catch (err) {
            console.error('[handleExplain] Failed to create branch:', err);
            alert(`Failed to create branch: ${err instanceof Error ? err.message : String(err)}`);
        }
    }, [branchContext, chatSessionId]);

    const handleOpenBranch = useCallback((branchId: string, messageId: string) => {
        branchContext.openBranch(branchId, messageId, 0, 0);
    }, [branchContext]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-lg)', flex: 1 }}>
            {messages.map((msg) => (
                <div
                    key={msg.id}
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--spacing-sm)',
                        alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    }}
                >
                    {msg.role === 'assistant' ? (
                        <ChatMessageWithBranches
                            messageId={msg.id}
                            content={msg.content}
                            role={msg.role}
                            timestamp={msg.timestamp}
                            onExplain={handleExplain}
                            onOpenBranch={handleOpenBranch}
                            highlightStart={branchContext.getHighlightSpan(msg.id)?.start}
                            highlightEnd={branchContext.getHighlightSpan(msg.id)?.end}
                        />
                    ) : (
                        <>
                            <div style={{
                                maxWidth: 'min(80%, 600px)',
                                padding: 'var(--spacing-md) var(--spacing-md)',
                                borderRadius: '16px',
                                background: 'var(--accent)',
                                color: 'white',
                                fontSize: 'clamp(15px, 2.1vw, 17px)',
                                lineHeight: '1.6',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                            }}>
                                {msg.content}
                            </div>
                            <div style={{
                                fontSize: 'clamp(11px, 1.6vw, 12px)',
                                color: 'var(--muted)',
                                padding: '0 var(--spacing-xs)',
                            }}>
                                {new Date(msg.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
                            </div>
                        </>
                    )}
                </div>
            ))}
            {loading && (
                <div style={{
                    padding: '16px 20px',
                    borderRadius: '16px',
                    background: 'var(--panel)',
                    border: '1px solid var(--border)',
                    color: 'var(--muted)',
                    fontSize: 'clamp(15px, 2.1vw, 17px)',
                }}>
                    Thinking...
                </div>
            )}
        </div>
    );
}
