'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL, getApiHeaders } from '../api/base';

export interface VoiceStreamStartParams {
  graphId: string;
  branchId: string;
  sessionId?: string | null;
  isScribeMode?: boolean;
  metadata?: Record<string, any> | null;
  pipeline?: 'agent' | 'stt';
}

export interface VoiceStreamEventHandlers {
  onTranscript?: (text: string) => void;
  onAgentReply?: (payload: any) => void;
  onProcessingStart?: (payload: any) => void;
  onTtsAudio?: (audio: ArrayBuffer, meta: any) => void;
  onError?: (error: Error) => void;
}

export interface VoiceStreamState {
  isSupported: boolean;
  isConnected: boolean;
  isRecording: boolean;
  error: string | null;
}

function buildWsUrl(ticket: string): string {
  const base = API_BASE_URL.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:').replace(/\/+$/, '');
  return `${base}/voice-stream/ws?ticket=${encodeURIComponent(ticket)}`;
}

async function fetchWsTicket(): Promise<string> {
  const headers = await getApiHeaders();
  const res = await fetch(`${API_BASE_URL.replace(/\/+$/, '')}/voice-stream/ticket`, {
    method: 'POST',
    headers,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to issue WS ticket: ${res.status} ${res.statusText} ${text}`);
  }
  const data = await res.json().catch(() => null);
  const ticket = data?.ticket;
  if (typeof ticket !== 'string' || ticket.length < 10) {
    throw new Error('Invalid WS ticket response');
  }
  return ticket;
}

export function useVoiceStream(handlers: VoiceStreamEventHandlers = {}) {
  const [state, setState] = useState<VoiceStreamState>({
    isSupported: false,
    isConnected: false,
    isRecording: false,
    error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const pendingTtsMetaRef = useRef<any>(null);
  const recordingStartMsRef = useRef<number | null>(null);
  const recordingEndMsRef = useRef<number | null>(null);
  const startParamsRef = useRef<VoiceStreamStartParams | null>(null);

  // Keep handler refs stable
  const onTranscriptRef = useRef(handlers.onTranscript);
  const onAgentReplyRef = useRef(handlers.onAgentReply);
  const onProcessingStartRef = useRef(handlers.onProcessingStart);
  const onTtsAudioRef = useRef(handlers.onTtsAudio);
  const onErrorRef = useRef(handlers.onError);

  useEffect(() => {
    onTranscriptRef.current = handlers.onTranscript;
    onAgentReplyRef.current = handlers.onAgentReply;
    onProcessingStartRef.current = handlers.onProcessingStart;
    onTtsAudioRef.current = handlers.onTtsAudio;
    onErrorRef.current = handlers.onError;
  }, [handlers.onTranscript, handlers.onAgentReply, handlers.onProcessingStart, handlers.onTtsAudio, handlers.onError]);

  useEffect(() => {
    const supported = typeof window !== 'undefined'
      && !!navigator.mediaDevices?.getUserMedia
      && typeof (window as any).MediaRecorder !== 'undefined';
    setState(prev => ({ ...prev, isSupported: supported }));
  }, []);

  const disconnect = useCallback(() => {
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    } catch { }
    wsRef.current = null;
    pendingTtsMetaRef.current = null;

    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    } catch { }
    mediaRecorderRef.current = null;

    try {
      mediaStreamRef.current?.getTracks()?.forEach(t => t.stop());
    } catch { }
    mediaStreamRef.current = null;

    recordingStartMsRef.current = null;
    recordingEndMsRef.current = null;

    setState(prev => ({ ...prev, isConnected: false, isRecording: false }));
  }, []);

  const connect = useCallback(async (params: VoiceStreamStartParams) => {
    if (!state.isSupported) {
      const err = new Error('Voice streaming not supported in this browser');
      setState(prev => ({ ...prev, error: err.message }));
      onErrorRef.current?.(err);
      return;
    }

    // Reconnect if params changed.
    if (wsRef.current) {
      disconnect();
    }

    startParamsRef.current = params;

    try {
      const ticket = await fetchWsTicket();
      const ws = new WebSocket(buildWsUrl(ticket));
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      let startedResolver: (() => void) | null = null;
      let startedRejecter: ((e: Error) => void) | null = null;
      const startedPromise = new Promise<void>((resolve, reject) => {
        startedResolver = resolve;
        startedRejecter = reject;
        setTimeout(() => reject(new Error('Voice stream start timed out')), 8000);
      });

      ws.onopen = () => {
        setState(prev => ({ ...prev, isConnected: true, error: null }));
        const msg = {
          type: 'start',
          graph_id: params.graphId,
          branch_id: params.branchId,
          session_id: params.sessionId || null,
          is_scribe_mode: !!params.isScribeMode,
          metadata: params.metadata || null,
          pipeline: params.pipeline || 'agent',
          // Hands-free (server VAD) by default for the backend streaming pipeline.
          vad_mode: 'server',
          vad_config: {
            engine: 'energy',
            end_silence_ms: 700,
            min_speech_ms: 200,
            pre_roll_ms: 240,
            max_utterance_ms: 20000,
          },
        };
        try {
          ws.send(JSON.stringify(msg));
        } catch { }
      };

      ws.onclose = () => {
        setState(prev => ({ ...prev, isConnected: false, isRecording: false }));
        if (startedRejecter) {
          startedRejecter(new Error('Voice stream closed before start'));
          startedRejecter = null;
          startedResolver = null;
        }
      };

      ws.onerror = () => {
        const err = new Error('WebSocket error');
        setState(prev => ({ ...prev, error: err.message, isConnected: false, isRecording: false }));
        onErrorRef.current?.(err);
        if (startedRejecter) {
          startedRejecter(err);
          startedRejecter = null;
          startedResolver = null;
        }
      };

      ws.onmessage = (event: MessageEvent) => {
        const data = event.data;
        if (typeof data === 'string') {
          let obj: any = null;
          try { obj = JSON.parse(data); } catch { }
          const type = obj?.type;
          if (type === 'started') {
            if (startedResolver) {
              startedResolver();
              startedResolver = null;
              startedRejecter = null;
            }
            return;
          }
          if (type === 'processing_start' || type === 'vad_utterance_end') {
            onProcessingStartRef.current?.(obj);
            return;
          }
          if (type === 'transcript') {
            const text = typeof obj.text === 'string' ? obj.text : '';
            onTranscriptRef.current?.(text);
            return;
          }
          if (type === 'agent_reply') {
            onAgentReplyRef.current?.(obj);
            return;
          }
          if (type === 'tts_start') {
            pendingTtsMetaRef.current = obj;
            return;
          }
          if (type === 'tts_done' || type === 'interrupted') {
            pendingTtsMetaRef.current = null;
            return;
          }
          if (type === 'error' || type === 'stt_error' || type === 'agent_error' || type === 'tts_error') {
            const msg = typeof obj?.message === 'string' ? obj.message : 'Voice stream error';
            setState(prev => ({ ...prev, error: msg }));
            onErrorRef.current?.(new Error(msg));
            if (startedRejecter) {
              startedRejecter(new Error(msg));
              startedRejecter = null;
              startedResolver = null;
            }
            return;
          }
          return;
        }

        if (data instanceof ArrayBuffer) {
          const meta = pendingTtsMetaRef.current;
          onTtsAudioRef.current?.(data, meta);
          pendingTtsMetaRef.current = null;
          return;
        }
      };

      // Wait until server acknowledges session start so callers can safely start recording.
      await startedPromise;
    } catch (error: any) {
      const err = error instanceof Error ? error : new Error(String(error));
      setState(prev => ({ ...prev, error: err.message, isConnected: false, isRecording: false }));
      onErrorRef.current?.(err);
    }
  }, [disconnect, state.isSupported]);

  const interrupt = useCallback(() => {
    try {
      wsRef.current?.send(JSON.stringify({ type: 'interrupt' }));
    } catch { }
  }, []);

  const start = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      const err = new Error('Voice stream is not connected');
      setState(prev => ({ ...prev, error: err.message }));
      onErrorRef.current?.(err);
      return;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      return;
    }

    try {
      let stream = mediaStreamRef.current;
      const ended = !stream || stream.getTracks().every(t => t.readyState === 'ended');
      if (ended) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
      }
      if (!stream) {
        throw new Error('Microphone stream unavailable');
      }

      const preferred = 'audio/webm;codecs=opus';
      const mimeType = (window as any).MediaRecorder?.isTypeSupported?.(preferred) ? preferred : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = async (e: BlobEvent) => {
        try {
          if (!e.data || e.data.size === 0) return;
          const buf = await e.data.arrayBuffer();
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(buf);
          }
        } catch { }
      };

      recorder.onstop = () => {
        try {
          const startMs = recordingStartMsRef.current;
          const endMs = recordingEndMsRef.current;
          recordingStartMsRef.current = null;
          recordingEndMsRef.current = null;
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'end_utterance',
              client_start_ms: startMs,
              client_end_ms: endMs,
            }));
          }
        } catch { }
      };

      recordingStartMsRef.current = Date.now();
      recordingEndMsRef.current = null;
      setState(prev => ({ ...prev, isRecording: true, error: null }));
      recorder.start(100); // 100ms chunks — lower VAD detection latency
    } catch (error: any) {
      const err = error instanceof Error ? error : new Error(String(error));
      setState(prev => ({ ...prev, error: err.message, isRecording: false }));
      onErrorRef.current?.(err);
    }
  }, []);

  const stop = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      return;
    }
    try {
      recordingEndMsRef.current = Date.now();
      recorder.stop();
    } catch { }
    setState(prev => ({ ...prev, isRecording: false }));
    // Keep microphone stream alive for faster next utterance; caller can `disconnect()` to release.
  }, []);

  return {
    ...state,
    connect,
    disconnect,
    start,
    stop,
    interrupt,
  };
}
