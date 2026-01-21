'use client';

import { useState, useCallback, useEffect } from 'react';
import { useVoiceRecognition } from '../../hooks/useVoiceRecognition';
import { sendVoiceCommand, getTask, type VoiceCommandRequest, type BackgroundTask } from '../../api-client';

export interface VoiceCommandProps {
  /** Current block ID (optional) */
  blockId?: string;
  /** Current concept ID (optional) */
  conceptId?: string;
  /** Current document ID (optional) */
  documentId?: string;
  /** Callback when command is sent */
  onCommandSent?: (taskId: string) => void;
  /** Callback when task completes */
  onTaskComplete?: (task: BackgroundTask) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
  /** Auto-detect intent from transcript */
  autoDetectIntent?: boolean;
}

/**
 * VoiceCommand component for Mode B: Active control.
 * 
 * Used to direct the system while the user works.
 * Examples:
 * - "Hey, work on generating answers to the next few problems while I take notes"
 * - "Summarize what I just highlighted"
 * - "What do I need to know to solve the next homework question?"
 * - "Explain this using only what I've already written"
 * 
 * Behavior:
 * - Parse intent
 * - Queue background tasks (retrieval, draft answers, gap analysis)
 * - Respect mode switching (do not interrupt note-taking)
 * - Return results when explicitly requested or when the user pauses
 */
export default function VoiceCommand({
  blockId,
  conceptId,
  documentId,
  onCommandSent,
  onTaskComplete,
  onError,
  autoDetectIntent = true,
}: VoiceCommandProps) {
  const [intent, setIntent] = useState<VoiceCommandRequest['intent'] | ''>('');
  const [isSending, setIsSending] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<string | null>(null);

  // Poll task status
  useEffect(() => {
    if (!activeTaskId) return;

    const pollInterval = setInterval(async () => {
      try {
        const task = await getTask(activeTaskId);
        setTaskStatus(task.status);

        if (task.status === 'READY') {
          clearInterval(pollInterval);
          setActiveTaskId(null);
          onTaskComplete?.(task);
        } else if (task.status === 'FAILED') {
          clearInterval(pollInterval);
          setActiveTaskId(null);
          onError?.(new Error(task.error || 'Task failed'));
        }
      } catch (error) {
        console.error('Failed to poll task status:', error);
      }
    }, 1000); // Poll every second

    return () => clearInterval(pollInterval);
  }, [activeTaskId, onTaskComplete, onError]);

  const detectIntent = useCallback((transcript: string): VoiceCommandRequest['intent'] | null => {
    const lower = transcript.toLowerCase();
    
    if (lower.includes('generate') || lower.includes('answer') || lower.includes('solve')) {
      return 'generate_answers';
    } else if (lower.includes('summarize') || lower.includes('summary')) {
      return 'summarize';
    } else if (lower.includes('explain') || lower.includes('what is') || lower.includes('how does')) {
      return 'explain';
    } else if (lower.includes('gap') || lower.includes('missing') || lower.includes('need to know')) {
      return 'gap_analysis';
    } else if (lower.includes('retrieve') || lower.includes('context') || lower.includes('find')) {
      return 'retrieve_context';
    } else if (lower.includes('extract') || lower.includes('concept')) {
      return 'extract_concepts';
    }
    
    return null;
  }, []);

  const handleResult = useCallback(
    async (transcript: string, isFinal: boolean) => {
      // Only send when final transcript is available
      if (!isFinal || !transcript.trim()) {
        return;
      }

      // Auto-detect intent if enabled
      let finalIntent = intent as VoiceCommandRequest['intent'];
      if (autoDetectIntent && !finalIntent) {
        const detected = detectIntent(transcript);
        if (detected) {
          finalIntent = detected;
        } else {
          onError?.(new Error('Could not detect intent from transcript. Please specify intent manually.'));
          return;
        }
      }

      if (!finalIntent) {
        onError?.(new Error('Please specify an intent'));
        return;
      }

      setIsSending(true);
      try {
        const payload: VoiceCommandRequest = {
          transcript: transcript.trim(),
          intent: finalIntent,
          block_id: blockId,
          concept_id: conceptId,
          document_id: documentId,
        };

        const response = await sendVoiceCommand(payload);
        setActiveTaskId(response.task_id);
        setTaskStatus('QUEUED');
        onCommandSent?.(response.task_id);
        setIntent('');
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        onError?.(err);
      } finally {
        setIsSending(false);
      }
    },
    [blockId, conceptId, documentId, intent, autoDetectIntent, detectIntent, onCommandSent, onError]
  );

  const { isListening, transcript, isSupported, error, start, stop, reset } = useVoiceRecognition({
    continuous: true,
    interimResults: true,
    onResult: handleResult,
    onError: (err) => {
      onError?.(err);
    },
  });

  if (!isSupported) {
    return (
      <div style={{ padding: '12px', background: '#fee', borderRadius: '4px', color: '#c33' }}>
        Voice recognition is not supported in this browser. Please use Chrome, Edge, or Safari.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={isListening ? stop : start}
          disabled={isSending}
          style={{
            padding: '8px 16px',
            borderRadius: '4px',
            border: 'none',
            background: isListening ? '#f33' : '#3f3',
            color: 'white',
            cursor: isSending ? 'not-allowed' : 'pointer',
            fontWeight: 'bold',
          }}
        >
          {isListening ? '⏹ Stop' : '🎤 Start'}
        </button>

        {!autoDetectIntent && (
          <select
            value={intent}
            onChange={(e) => setIntent(e.target.value as any || '')}
            disabled={isListening || isSending}
            style={{
              padding: '6px 12px',
              borderRadius: '4px',
              border: '1px solid #ccc',
            }}
          >
            <option value="">Select intent...</option>
            <option value="generate_answers">Generate Answers</option>
            <option value="summarize">Summarize</option>
            <option value="explain">Explain</option>
            <option value="gap_analysis">Gap Analysis</option>
            <option value="retrieve_context">Retrieve Context</option>
            <option value="extract_concepts">Extract Concepts</option>
          </select>
        )}

        {transcript && (
          <button
            onClick={reset}
            disabled={isListening || isSending}
            style={{
              padding: '6px 12px',
              borderRadius: '4px',
              border: '1px solid #ccc',
              background: 'white',
              cursor: isListening || isSending ? 'not-allowed' : 'pointer',
            }}
          >
            Clear
          </button>
        )}
      </div>

      {transcript && (
        <div
          style={{
            padding: '12px',
            background: '#f5f5f5',
            borderRadius: '4px',
            minHeight: '60px',
            fontSize: '14px',
            lineHeight: '1.5',
          }}
        >
          {transcript}
        </div>
      )}

      {taskStatus && (
        <div style={{ padding: '8px', fontSize: '12px', color: '#666' }}>
          Task status: <strong>{taskStatus}</strong>
        </div>
      )}

      {error && (
        <div style={{ padding: '8px', background: '#fee', borderRadius: '4px', color: '#c33', fontSize: '12px' }}>
          {error}
        </div>
      )}

      {isSending && (
        <div style={{ padding: '8px', fontSize: '12px', color: '#666' }}>
          Sending command...
        </div>
      )}

      {isListening && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#666' }}>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#f33', animation: 'pulse 1s infinite' }} />
          Listening...
        </div>
      )}
    </div>
  );
}
