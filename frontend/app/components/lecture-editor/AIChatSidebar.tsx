'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { getCurrentSessionId } from '../../lib/chatSessions';

interface AIChatSidebarProps {
  lectureId?: string | null;
  lectureTitle?: string;
  triggerMessage?: { text: string, image?: string, context?: { blockId?: string; blockText?: string } } | null;
  onTriggerProcessed?: () => void;
}

export function AIChatSidebar({ lectureId, lectureTitle, triggerMessage, onTriggerProcessed }: AIChatSidebarProps) {
  const searchParams = useSearchParams();
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string, image?: string, blockId?: string }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const graphId = searchParams?.get('graph_id') || undefined;
  const branchId = searchParams?.get('branch_id') || undefined;

  // Use a stable, lecture-scoped chat_id so this conversation is saved to
  // Postgres and shows up in cross-surface context for voice + Explorer chat.
  // Format: lecture_{lectureId} — scoped per lecture so each lecture has its
  // own thread, but the voice agent and other surfaces can still see it.
  const chatId = useMemo(() => {
    if (lectureId) return `lecture_${lectureId}`;
    // Fallback: share the user's current main session so at least the voice
    // agent picks up what was discussed here.
    return getCurrentSessionId() || `lecture_anon_${Date.now()}`;
  }, [lectureId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (triggerMessage) {
      const { text, image, context } = triggerMessage;
      setMessage(text);

      const sendTrigger = async () => {
        setMessages((prev) => [...prev, { role: 'user', content: text, image, blockId: context?.blockId }]);
        setIsLoading(true);
        setMessage('');

        try {
          const response = await fetch('/api/brain-web/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: text,
              image: image,
              context_text: context?.blockText,
              mode: 'graphrag',
              graph_id: graphId,
              branch_id: branchId,
              lecture_id: lectureId,
              chat_id: chatId,   // ← persist to chat history
              focus_concept_id: undefined,
              response_prefs: {
                mode: 'compact',
                ask_question_policy: 'at_most_one',
                end_with_next_step: false,
              },
            }),
          });
          if (response.ok) {
            const data = await response.json();
            setMessages((prev) => [...prev, { role: 'assistant', content: data.answer || '...' }]);
          }
        } catch (e) {
          console.error(e);
        } finally {
          setIsLoading(false);
          onTriggerProcessed?.();
        }
      };
      sendTrigger();
    }
  }, [triggerMessage]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || isLoading) return;

    const userMessage = message.trim();
    setMessage('');
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      const response = await fetch('/api/brain-web/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          mode: 'graphrag',
          graph_id: graphId,
          branch_id: branchId,
          lecture_id: lectureId,
          chat_id: chatId,   // ← persist to chat history
          focus_concept_id: undefined,
          response_prefs: {
            mode: 'compact',
            ask_question_policy: 'at_most_one',
            end_with_next_step: false,
          },
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const data = await response.json();
      const answer = data.answer || 'I apologize, but I could not generate a response.';

      setMessages((prev) => [...prev, { role: 'assistant', content: answer }]);
    } catch (error) {
      console.error('Chat error:', error);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' },
      ]);
    } finally {
      setIsLoading(false);
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--surface)',
      }}
    >

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          borderTop: '1px solid var(--border)',
        }}
      >
        {messages.map((msg, idx) => (
          <div
            key={idx}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <div
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--muted)',
                textTransform: 'uppercase',
              }}
            >
              {msg.role === 'user' ? 'You' : 'Assistant'}
            </div>
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '12px',
                background: msg.role === 'user' ? 'var(--accent)' : 'var(--panel)',
                color: msg.role === 'user' ? '#fff' : 'var(--ink)',
                fontSize: '13px',
                lineHeight: '1.5',
                boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                border: msg.role === 'user' ? 'none' : '1px solid var(--border)'
              }}
            >
              {msg.image && (
                <div style={{ marginBottom: '8px', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.2)' }}>
                  <img src={msg.image} alt="Handwritten Context" style={{ width: '100%', display: 'block' }} />
                </div>
              )}
              {msg.blockId && (
                <div
                  className="block-link"
                  style={{
                    marginBottom: '8px',
                    fontSize: '10px',
                    color: msg.role === 'user' ? 'rgba(255,255,255,0.8)' : 'var(--accent)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                  onClick={() => {
                    // Scroll to block logic
                    const block = document.getElementById(`block-${msg.blockId}`);
                    if (block) {
                      block.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      block.style.backgroundColor = 'rgba(255, 230, 0, 0.3)';
                      setTimeout(() => { block.style.backgroundColor = 'transparent'; }, 2000);
                    }
                  }}
                >
                  <span>🔗 Linked to notes</span>
                </div>
              )}
              {msg.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div
            style={{
              padding: '12px',
              background: 'var(--panel)',
              borderRadius: '8px',
              fontSize: '14px',
              color: 'var(--muted)',
            }}
          >
            Thinking...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        style={{
          padding: '16px',
          borderTop: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: '8px',
            alignItems: 'flex-end',
          }}
        >
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type your message..."
            disabled={isLoading}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
            }}
            style={{
              flex: 1,
              padding: '10px 14px',
              fontSize: '14px',
              minHeight: '44px',
              maxHeight: '200px',
              resize: 'none',
              fontFamily: 'inherit',
              lineHeight: '1.5',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              background: 'var(--surface)',
              color: 'var(--ink)',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={isLoading || !message.trim()}
            style={{
              padding: '10px 20px',
              background: isLoading || !message.trim() ? 'var(--muted)' : 'var(--accent)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: isLoading || !message.trim() ? 'not-allowed' : 'pointer',
              flexShrink: 0,
            }}
          >
            {isLoading ? '...' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}
