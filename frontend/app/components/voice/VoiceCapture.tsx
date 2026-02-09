'use client';

import { useState, useCallback } from 'react';
import { useVoiceStream } from '../../hooks/useVoiceStream';
import { sendVoiceCapture, type VoiceCaptureRequest } from '../../api-client';

export interface VoiceCaptureProps {
  /** Current block ID (optional) */
  blockId?: string;
  /** Current concept ID (optional) */
  conceptId?: string;
  /** Current document ID (optional) */
  documentId?: string;
  /** Callback when capture is sent */
  onCaptureSent?: (signalId: string) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
  /** Auto-classify transcript (reflection, confusion, explanation) */
  autoClassify?: boolean;
}

/**
 * VoiceCapture component for Mode A: Passive transcription.
 * 
 * Used when the user is thinking or taking notes.
 * Examples:
 * - "This part about Bayes feels unclear"
 * - "This depends on conditional probability"
 * - "I think this assumption matters later"
 * 
 * Behavior:
 * - Transcribe audio
 * - Attach transcript to the current Block or Concept
 * - Classify as reflection / confusion / explanation
 * - Update confidence or uncertainty on linked concepts
 * - Do NOT interrupt or respond unless asked
 */
export default function VoiceCapture({
  blockId,
  conceptId,
  documentId,
  onCaptureSent,
  onError,
  autoClassify = false,
}: VoiceCaptureProps) {
  const [classification, setClassification] = useState<'reflection' | 'confusion' | 'explanation' | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [transcript, setTranscript] = useState<string>('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isProcessingStt, setIsProcessingStt] = useState(false);

  const handleTranscript = useCallback(
    async (text: string) => {
      const cleaned = (text || '').trim();
      if (!cleaned) return;

      // Auto-classify if enabled
      let finalClassification = classification;
      if (autoClassify && !finalClassification) {
        const lower = cleaned.toLowerCase();
        if (lower.includes('unclear') || lower.includes('confused') || lower.includes('don\'t understand')) {
          finalClassification = 'confusion';
        } else if (lower.includes('think') || lower.includes('feel') || lower.includes('seems')) {
          finalClassification = 'reflection';
        } else {
          finalClassification = 'explanation';
        }
      }

      setIsSending(true);
      try {
        const payload: VoiceCaptureRequest = {
          transcript: cleaned,
          block_id: blockId,
          concept_id: conceptId,
          document_id: documentId,
          classification: finalClassification || undefined,
        };

        const signal = await sendVoiceCapture(payload);
        onCaptureSent?.(signal.signal_id);
        setClassification(null);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        onError?.(err);
      } finally {
        setIsSending(false);
      }
    },
    [blockId, conceptId, documentId, classification, autoClassify, onCaptureSent, onError]
  );

  const voiceStream = useVoiceStream({
    onProcessingStart: () => {
      setIsProcessingStt(true);
    },
    onTranscript: (text) => {
      const t = (text || '').trim();
      if (!t) return;
      setIsProcessingStt(false);
      setTranscript(t);
      void handleTranscript(t);
    },
    onError: (err) => {
      setIsProcessingStt(false);
      onError?.(err);
    },
  });

  const start = useCallback(async () => {
    if (isConnecting) return;
    if (isSending) return;
    setIsProcessingStt(false);
    try {
      if (!voiceStream.isConnected) {
        setIsConnecting(true);
        await voiceStream.connect({ graphId: 'default', branchId: 'main', pipeline: 'stt' });
      }
      await voiceStream.start();
    } finally {
      setIsConnecting(false);
    }
  }, [isConnecting, isSending, voiceStream.isConnected, voiceStream.connect, voiceStream.start]);

  const stop = useCallback(async () => {
    await voiceStream.stop();
  }, [voiceStream.stop]);

  const reset = useCallback(() => {
    setTranscript('');
  }, []);

  if (!voiceStream.isSupported) {
    return (
      <div style={{ padding: '12px', background: '#fee', borderRadius: '4px', color: '#c33' }}>
        Voice streaming is not supported in this browser. Please use a recent Chrome, Edge, or Safari.
      </div>
    );
  }

  const isListening = voiceStream.isRecording;
  const error = voiceStream.error;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button
          onClick={isListening ? stop : start}
          disabled={isSending || isConnecting}
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
          {isListening ? 'Stop' : (isConnecting ? 'Connecting…' : 'Start')}
        </button>

        {!autoClassify && (
          <select
            value={classification || ''}
            onChange={(e) => setClassification(e.target.value as any || null)}
            disabled={isListening || isSending}
            style={{
              padding: '6px 12px',
              borderRadius: '4px',
              border: '1px solid #ccc',
            }}
          >
            <option value="">Auto-classify</option>
            <option value="reflection">Reflection</option>
            <option value="confusion">Confusion</option>
            <option value="explanation">Explanation</option>
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

      {error && (
        <div style={{ padding: '8px', background: '#fee', borderRadius: '4px', color: '#c33', fontSize: '12px' }}>
          {error}
        </div>
      )}

      {isProcessingStt && (
        <div style={{ padding: '8px', fontSize: '12px', color: '#666' }}>
          Transcribing…
        </div>
      )}

      {isSending && (
        <div style={{ padding: '8px', fontSize: '12px', color: '#666' }}>
          Sending capture...
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
