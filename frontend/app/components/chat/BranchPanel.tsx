'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { archiveBranch, deleteBranch } from '../../lib/branchUtils';
import { resolveLectureLinks } from '../../api-client';
import { getCurrentSessionId } from '../../lib/chatSessions';
import { storeLectureLinkReturn } from '../../lib/lectureLinkNavigation';
import { getAuthHeaders } from '../../lib/authToken';

interface BranchMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface BranchThread {
  id: string;
  anchor: {
    start_offset: number;
    end_offset: number;
    selected_text: string;
    parent_message_id: string;
  };
  anchor_kind?: string;
  anchor_ref?: any;
  anchor_snippet_data_url?: string | null;
  messages: BranchMessage[];
  parent_message_id: string;
  chat_id?: string | null;
}

interface BranchPanelProps {
  branchId: string | null;
  parentMessageId: string | null;
  onClose: () => void;
  onScrollToParent: (messageId: string, startOffset: number, endOffset: number) => void;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

export default function BranchPanel({ branchId, parentMessageId, onClose, onScrollToParent }: BranchPanelProps) {
  const router = useRouter();
  const [branch, setBranch] = useState<BranchThread | null>(null);
  const [messages, setMessages] = useState<BranchMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingBranch, setLoadingBranch] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load branch data
  useEffect(() => {
    if (!branchId) return;

    async function loadBranch() {
      try {
        setLoadingBranch(true);
        const authHeaders = await getAuthHeaders();
        const response = await fetch(`${API_BASE_URL}/contextual-branches/${branchId}`, {
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to load branch');
        }

        const data = await response.json();
        setBranch(data.branch);
        setMessages(data.messages || []);
      } catch (err) {
        console.error('Failed to load branch:', err);
      } finally {
        setLoadingBranch(false);
      }
    }

    loadBranch();
  }, [branchId]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const menu = document.getElementById(`branch-menu-${branchId}`);
      if (menu && !menu.contains(event.target as Node)) {
        menu.style.display = 'none';
      }
    };

    if (branchId) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [branchId]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || !branchId || loading) return;

    const userMessage = input.trim();
    setInput('');
    setLoading(true);

    // Add user message optimistically
    const tempUserMsg: BranchMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempUserMsg]);

    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/contextual-branches/${branchId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ content: userMessage }),
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      const data = await response.json();
      
      // Replace temp message and add assistant response
      setMessages(prev => {
        const filtered = prev.filter(m => m.id !== tempUserMsg.id);
        return [...filtered, data.user_message, data.assistant_message];
      });
    } catch (err) {
      console.error('Failed to send message:', err);
      // Remove temp message on error
      setMessages(prev => prev.filter(m => m.id !== tempUserMsg.id));
      alert('Failed to send message. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [input, branchId, loading]);

  const handleGenerateHints = useCallback(async () => {
    if (!branchId) return;

    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/contextual-branches/${branchId}/hints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to generate hints');
      }

      // Hints will be shown in the main chat, not here
      // This triggers the hint generation
      alert('Bridging hints generated! Check the main response.');
    } catch (err) {
      console.error('Failed to generate hints:', err);
      alert('Failed to generate hints. Please try again.');
    }
  }, [branchId]);

  const handleBackToMain = useCallback(() => {
    if (branch && parentMessageId) {
      onScrollToParent(
        parentMessageId,
        branch.anchor.start_offset,
        branch.anchor.end_offset
      );
    }
    onClose();
  }, [branch, parentMessageId, onClose, onScrollToParent]);

  const handleFindInLecture = useCallback(async () => {
    if (!branchId) {
      return;
    }
    const chatId = branch?.chat_id || getCurrentSessionId();
    if (!chatId) {
      alert('Start a chat session to link to lectures.');
      return;
    }

    try {
      const result = await resolveLectureLinks({
        chat_id: chatId,
        source_type: 'branch',
        source_id: branchId,
      });

      if (!result.links.length) {
        alert('No lecture matches found.');
        return;
      }

      let selected = result.links[0];
      if (result.weak && result.links.length > 1) {
        const options = result.links.map((link, idx) =>
          `${idx + 1}. ${link.lecture_section_id} (${Math.round(link.confidence_score * 100)}%)`
        ).join('\n');
        const choice = window.prompt(`Low confidence. Choose a match:\n${options}`, '1');
        const index = Number(choice) - 1;
        if (!Number.isNaN(index) && result.links[index]) {
          selected = result.links[index];
        }
      }

      if (typeof window !== 'undefined') {
        storeLectureLinkReturn({
          path: `${window.location.pathname}${window.location.search}`,
          windowScrollTop: window.scrollY,
        });
      }

      const params = new URLSearchParams({
        lecture_document_id: selected.lecture_document_id,
        section_id: selected.lecture_section_id,
        start_offset: String(selected.start_offset),
        end_offset: String(selected.end_offset),
        link_id: selected.id,
      });
      router.push(`/lecture-viewer?${params.toString()}`);
    } catch (err) {
      console.error('Failed to resolve lecture link:', err);
      alert('Failed to resolve lecture link.');
    }
  }, [branch, branchId, router]);

  if (loadingBranch) {
    return (
      <div style={{
        width: '400px',
        height: '100%',
        background: 'var(--surface)',
        borderLeft: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px',
      }}>
        <div>Loading branch...</div>
      </div>
    );
  }

  if (!branch) {
    return (
      <div style={{
        width: '400px',
        height: '100%',
        background: 'var(--surface)',
        borderLeft: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px',
      }}>
        <div>Branch not found</div>
        <button onClick={onClose}>Close</button>
      </div>
    );
  }

  const isAnchorRefBranch = branch.anchor_kind === 'anchor_ref';
  const previewText =
    (isAnchorRefBranch ? (branch.anchor_ref?.preview || branch.anchor.selected_text) : branch.anchor.selected_text) ||
    '';

  return (
    <div style={{
      width: '400px',
      height: '100%',
      background: 'var(--surface)',
      borderLeft: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>
            {isAnchorRefBranch ? 'Explaining selected region' : 'Explaining selected text'}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
            {previewText.substring(0, 50)}...
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleFindInLecture}
            style={{
              padding: '6px 12px',
              background: 'var(--panel)',
              color: 'var(--ink)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            Find in lecture
          </button>
          <button
            onClick={handleBackToMain}
            style={{
              padding: '6px 12px',
              background: 'var(--accent)',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            {parentMessageId ? 'Back to main' : 'Close'}
          </button>
          <div style={{ position: 'relative' }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                const menu = document.getElementById(`branch-menu-${branchId}`);
                if (menu) {
                  menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
                }
              }}
              style={{
                padding: '6px 12px',
                background: 'transparent',
                color: 'var(--muted)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
              title="Branch options"
            >
              ⋮
            </button>
            <div
              id={`branch-menu-${branchId}`}
              style={{
                display: 'none',
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: '4px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                zIndex: 1000,
                minWidth: '120px',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  if (!branchId) return;
                  if (confirm('Archive this branch? You can restore it later.')) {
                    try {
                      await archiveBranch(branchId);
                      onClose();
                    } catch (err) {
                      alert('Failed to archive branch');
                    }
                  }
                  const menu = document.getElementById(`branch-menu-${branchId}`);
                  if (menu) menu.style.display = 'none';
                }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontSize: '12px',
                  color: 'var(--ink)',
                }}
              >
                Archive
              </button>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  if (!branchId) return;
                  if (confirm('Permanently delete this branch? This cannot be undone.')) {
                    try {
                      await deleteBranch(branchId);
                      onClose();
                    } catch (err) {
                      alert('Failed to delete branch');
                    }
                  }
                  const menu = document.getElementById(`branch-menu-${branchId}`);
                  if (menu) menu.style.display = 'none';
                }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontSize: '12px',
                  color: 'var(--danger, #ef4444)',
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Selection Preview */}
      {isAnchorRefBranch && branch.anchor_snippet_data_url && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <img
            src={branch.anchor_snippet_data_url}
            alt="Selected region"
            style={{
              width: '100%',
              height: 'auto',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              background: 'var(--background)',
            }}
          />
        </div>
      )}

      {/* Messages */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              padding: '12px',
              background: msg.role === 'user' ? 'var(--accent)' : 'var(--panel)',
              color: msg.role === 'user' ? 'white' : 'var(--ink)',
              borderRadius: '8px',
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              fontSize: '14px',
              lineHeight: '1.6',
              whiteSpace: 'pre-wrap',
            }}
          >
            {msg.content}
          </div>
        ))}
        {loading && (
          <div style={{
            padding: '12px',
            background: 'var(--panel)',
            borderRadius: '8px',
            fontSize: '14px',
            color: 'var(--muted)',
          }}>
            Thinking...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '16px',
        borderTop: '1px solid var(--border)',
      }}>
        <form onSubmit={handleSend}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isAnchorRefBranch ? 'Ask about the selected region...' : 'Ask about the selected text...'}
            style={{
              width: '100%',
              minHeight: '60px',
              padding: '8px',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              fontSize: '14px',
              resize: 'vertical',
              fontFamily: 'inherit',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button
              type="submit"
              disabled={!input.trim() || loading}
              style={{
                padding: '8px 16px',
                background: 'var(--accent)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
                opacity: input.trim() && !loading ? 1 : 0.5,
                fontSize: '14px',
              }}
            >
              Send
            </button>
            {!isAnchorRefBranch && messages.length > 0 && (
              <button
                type="button"
                onClick={handleGenerateHints}
                style={{
                  padding: '8px 16px',
                  background: 'var(--panel)',
                  color: 'var(--ink)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                Generate Hints
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
