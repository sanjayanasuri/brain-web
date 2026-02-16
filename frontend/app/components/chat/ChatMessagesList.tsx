import React, { useCallback } from 'react';
import { useBranchContext } from './BranchContext';
import ChatMessageWithBranches from './ChatMessageWithBranches';
import { createBranch } from '../../lib/branchUtils';
import type { ChatMessage } from '../../types/chat';

interface ChatMessagesListProps {
    messages: ChatMessage[];
    chatSessionId: string | null;
    loading: boolean;
    statusMessages?: string[];
    isStreaming?: boolean;
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
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
            flex: 1,
            width: '100%',
            maxWidth: '1200px',
            margin: '0',
            padding: '0 24px 120px 24px',
            boxSizing: 'border-box'
        }}>
            {messages.map((msg) => (
                <div
                    key={msg.id}
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                        width: '100%'
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
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'flex-end',
                            maxWidth: '100%'
                        }}>
                            <div style={{
                                maxWidth: '85%',
                                padding: '12px 18px',
                                borderRadius: '18px',
                                borderBottomRightRadius: '4px',
                                background: 'var(--accent)',
                                color: 'white',
                                fontSize: '15px',
                                lineHeight: '1.5',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
                            }}>
                                {msg.content}
                            </div>
                            <div style={{
                                fontSize: '11px',
                                color: 'var(--muted)',
                                padding: '4px 4px 0 0',
                            }}>
                                {new Date(msg.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
                            </div>
                        </div>
                    )}
                </div>
            ))}
            {loading && (
                <div style={{
                    alignSelf: 'flex-start',
                    padding: '12px 18px',
                    borderRadius: '18px',
                    borderBottomLeftRadius: '4px',
                    background: 'var(--panel)',
                    border: '1px solid var(--border)',
                    color: 'var(--muted)',
                    fontSize: '15px',
                    maxWidth: '85%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                }}>
                    <div className="w-2 h-2 rounded-full bg-muted animate-pulse" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--muted)', opacity: 0.6 }} />
                    Thinking...
                </div>
            )}
        </div>
    );
}
