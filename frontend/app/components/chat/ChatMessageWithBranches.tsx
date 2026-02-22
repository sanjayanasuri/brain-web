'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import SelectableText from './SelectableText';
import BranchChip from './BranchChip';
import BridgingHints from './BridgingHints';
import { resolveLectureLinks } from '../../api-client';
import { getChatSession, getCurrentSessionId } from '../../lib/chatSessions';
import { storeLectureLinkReturn } from '../../lib/lectureLinkNavigation';
import { getAuthHeaders } from '../../lib/authToken';
import { useBranchContext } from './BranchContext';
import TaskCard from '../study/TaskCard';
import Feedback from '../study/Feedback';
import { ActionButtons } from './ActionButtons';
import { submitFeedback } from '../../api/feedback';
import StyleFeedbackForm from '../ui/StyleFeedbackForm';

interface Branch {
  id: string;
  anchor: {
    start_offset: number;
    end_offset: number;
    selected_text: string;
    parent_message_id: string;
  };
  bridging_hints?: {
    hints: Array<{
      id: string;
      hint_text: string;
      target_offset: number;
    }>;
  };
}

interface ChatMessageWithBranchesProps {
  messageId: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: number;
  answerId?: string | null;
  feedbackQuestion?: string;
  actions?: Array<{
    type: 'view_graph' | 'add_to_profile' | 'open_url';
    label: string;
    graph_id?: string;
    url?: string;
    interest?: string;
  }>;
  onExplain: (messageId: string, startOffset: number, endOffset: number, selectedText: string, parentContent: string) => void;
  onOpenBranch: (branchId: string, messageId: string) => void;
  highlightStart?: number;
  highlightEnd?: number;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

export default function ChatMessageWithBranches({
  messageId,
  content,
  role,
  timestamp,
  answerId,
  feedbackQuestion,
  actions,
  onExplain,
  onOpenBranch,
  highlightStart,
  highlightEnd,
}: ChatMessageWithBranchesProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [highlightedBranch, setHighlightedBranch] = useState<string | null>(null);
  const [feedbackRating, setFeedbackRating] = useState<1 | -1 | null>(null);
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [feedbackToast, setFeedbackToast] = useState('');
  const chatSessionId = useMemo(() => {
    const chatParam = searchParams?.get('chat') || null;
    if (chatParam) {
      const session = getChatSession(chatParam);
      if (session) return session.id;
    }
    return getCurrentSessionId();
  }, [searchParams]);

  // Load branches for this message
  const { lastBranchUpdate } = useBranchContext();

  useEffect(() => {
    if (role !== 'assistant') return;

    async function loadBranches() {
      try {
        setLoadingBranches(true);
        const response = await fetch(`${API_BASE_URL}/contextual-branches/messages/${messageId}/branches`, {
          headers: {
            'Content-Type': 'application/json',
            ...(await getAuthHeaders()),
          },
        });

        if (response.ok) {
          const data = await response.json();
          setBranches(data.branches || []);
        }
      } catch (err) {
        console.error('Failed to load branches:', err);
      } finally {
        setLoadingBranches(false);
      }
    }

    loadBranches();
  }, [messageId, role, lastBranchUpdate]);

  const handleExplain = useCallback((startOffset: number, endOffset: number, selectedText: string) => {
    onExplain(messageId, startOffset, endOffset, selectedText, content);
  }, [messageId, content, onExplain]);

  const handleBranchClick = useCallback((branchId: string) => {
    setHighlightedBranch(branchId);
    onOpenBranch(branchId, messageId);
  }, [messageId, onOpenBranch]);

  const handleHintClick = useCallback((offset: number) => {
    // Scroll to the offset in the message
    // This is a simplified version - in production, you'd implement proper scrolling
    const element = document.getElementById(`message-${messageId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Highlight the target area
      setHighlightedBranch(null);
      // You could add visual highlighting at the offset
    }
  }, [messageId]);

  const handleThumbFeedback = useCallback(
    async (rating: 1 | -1) => {
      if (!answerId || submittingFeedback) return;
      setSubmittingFeedback(true);
      try {
        await submitFeedback(
          answerId,
          rating,
          rating > 0 ? 'Helpful answer' : 'Unhelpful answer',
          feedbackQuestion || undefined,
        );
        setFeedbackRating(rating);
        setFeedbackToast('Thanks for feedback');
        setTimeout(() => setFeedbackToast(''), 1800);
      } catch (err) {
        console.error('Failed to submit feedback:', err);
      } finally {
        setSubmittingFeedback(false);
      }
    },
    [answerId, feedbackQuestion, submittingFeedback]
  );

  const handleFindInLecture = useCallback(async () => {
    if (!chatSessionId) {
      alert('Start a chat session to link to lectures.');
      return;
    }

    try {
      const result = await resolveLectureLinks({
        chat_id: chatSessionId,
        source_type: 'main_chat_event',
        source_id: messageId,
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
  }, [chatSessionId, messageId, router]);

  // Find bridging hints for this message
  const allHints = branches.flatMap(branch =>
    branch.bridging_hints?.hints || []
  );

  // Parse Study Task
  const studyTaskMatch = role === 'assistant' ? content.match(/\[STUDY_TASK:\s*(\w+)\]([\s\S]*)/) : null;
  const taskType = studyTaskMatch ? studyTaskMatch[1] : null;
  const taskPrompt = studyTaskMatch ? studyTaskMatch[2].trim() : null;
  const displayContent = studyTaskMatch ? content.split('[STUDY_TASK:')[0].trim() : content;

  return (
    <div id={`message-${messageId}`} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{
        maxWidth: '85%',
        padding: '12px 18px',
        borderRadius: '18px',
        borderBottomLeftRadius: role === 'assistant' ? '4px' : '18px',
        borderBottomRightRadius: role === 'user' ? '4px' : '18px',
        background: role === 'user'
          ? 'var(--accent)'
          : 'var(--panel)',
        color: role === 'user' ? 'white' : 'var(--ink)',
        border: role === 'assistant' ? '1px solid var(--border)' : 'none',
        fontSize: '15px',
        lineHeight: '1.5',
        wordBreak: 'break-word',
        boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
      }}>
        {role === 'assistant' ? (
          <>
            {displayContent && (
              <SelectableText
                text={displayContent}
                messageId={messageId}
                onExplain={handleExplain}
                highlightStart={highlightStart}
                highlightEnd={highlightEnd}
              />
            )}
            {taskType && taskPrompt && (
              <div style={{ marginTop: displayContent ? '16px' : '0' }}>
                <TaskCard
                  taskType={taskType}
                  prompt={taskPrompt}
                  excerpts={[]}
                  compact={true}
                />
              </div>
            )}
          </>
        ) : (
          <div style={{ whiteSpace: 'pre-wrap' }}>{content}</div>
        )}
      </div>

      {/* Action Buttons */}
      {actions && actions.length > 0 && (
        <div style={{ alignSelf: 'flex-start', marginTop: '8px' }}>
          <ActionButtons actions={actions} />
        </div>
      )}

      {role === 'assistant' && (
        <button
          onClick={handleFindInLecture}
          style={{
            alignSelf: 'flex-start',
            padding: '6px 10px',
            fontSize: '12px',
            borderRadius: '6px',
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--ink)',
            cursor: 'pointer',
          }}
        >
          Find in lecture
        </button>
      )}

      {role === 'assistant' && answerId && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
          <button
            onClick={() => handleThumbFeedback(1)}
            disabled={submittingFeedback}
            style={{
              alignSelf: 'flex-start',
              padding: '6px 10px',
              fontSize: '12px',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              background: feedbackRating === 1 ? 'rgba(34,197,94,0.12)' : 'var(--surface)',
              color: 'var(--ink)',
              cursor: submittingFeedback ? 'not-allowed' : 'pointer',
              opacity: submittingFeedback ? 0.7 : 1,
            }}
          >
            Helpful
          </button>
          <button
            onClick={() => handleThumbFeedback(-1)}
            disabled={submittingFeedback}
            style={{
              alignSelf: 'flex-start',
              padding: '6px 10px',
              fontSize: '12px',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              background: feedbackRating === -1 ? 'rgba(239,68,68,0.12)' : 'var(--surface)',
              color: 'var(--ink)',
              cursor: submittingFeedback ? 'not-allowed' : 'pointer',
              opacity: submittingFeedback ? 0.7 : 1,
            }}
          >
            Not helpful
          </button>
        </div>
      )}

      {role === 'assistant' && answerId && feedbackToast && (
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
          {feedbackToast}
        </div>
      )}

      {role === 'assistant' && answerId && (
        <div style={{ alignSelf: 'flex-start', maxWidth: '85%' }}>
          <StyleFeedbackForm
            answerId={answerId}
            question={feedbackQuestion || ''}
            originalResponse={displayContent || content}
          />
        </div>
      )}

      {/* Branch chips */}
      {role === 'assistant' && branches.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
          {branches.map((branch) => (
            <BranchChip
              key={branch.id}
              branchId={branch.id}
              selectedText={branch.anchor.selected_text}
              onClick={() => handleBranchClick(branch.id)}
            />
          ))}
        </div>
      )}

      {/* Bridging hints */}
      {role === 'assistant' && allHints.length > 0 && (
        <BridgingHints
          hints={allHints}
          parentMessageContent={content}
          onHintClick={handleHintClick}
        />
      )}

      {/* Timestamp */}
      <div style={{
        fontSize: 'clamp(11px, 1.6vw, 12px)',
        color: 'var(--muted)',
        padding: '0 var(--spacing-xs)',
      }}>
        {new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
      </div>
    </div>
  );
}
