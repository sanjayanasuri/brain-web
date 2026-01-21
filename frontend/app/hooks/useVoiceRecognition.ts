'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

export interface VoiceRecognitionOptions {
  continuous?: boolean;
  interimResults?: boolean;
  lang?: string;
  onResult?: (transcript: string, isFinal: boolean) => void;
  onError?: (error: Error) => void;
  onStart?: () => void;
  onStop?: () => void;
}

export interface VoiceRecognitionState {
  isListening: boolean;
  transcript: string;
  isSupported: boolean;
  error: string | null;
}

/**
 * Hook for Web Speech API voice recognition.
 * 
 * Provides a simple interface for voice transcription using the browser's
 * built-in SpeechRecognition API (or webkitSpeechRecognition).
 */
export function useVoiceRecognition(options: VoiceRecognitionOptions = {}) {
  const {
    continuous = true,
    interimResults = true,
    lang = 'en-US',
    onResult,
    onError,
    onStart,
    onStop,
  } = options;

  const [state, setState] = useState<VoiceRecognitionState>({
    isListening: false,
    transcript: '',
    isSupported: false,
    error: null,
  });

  const recognitionRef = useRef<any>(null);
  const finalTranscriptRef = useRef<string>('');

  // Initialize recognition
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setState((prev) => ({
        ...prev,
        isSupported: false,
        error: 'Speech recognition is not supported in this browser',
      }));
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = continuous;
    recognition.interimResults = interimResults;
    recognition.lang = lang;

    recognition.onstart = () => {
      setState((prev) => ({
        ...prev,
        isListening: true,
        error: null,
      }));
      onStart?.();
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimTranscript = '';
      let finalTranscript = finalTranscriptRef.current;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        } else {
          interimTranscript += transcript;
        }
      }

      finalTranscriptRef.current = finalTranscript;
      const fullTranscript = finalTranscript + interimTranscript;

      setState((prev) => ({
        ...prev,
        transcript: fullTranscript.trim(),
      }));

      onResult?.(fullTranscript.trim(), interimTranscript === '');
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const error = new Error(`Speech recognition error: ${event.error}`);
      setState((prev) => ({
        ...prev,
        error: error.message,
        isListening: false,
      }));
      onError?.(error);
    };

    recognition.onend = () => {
      setState((prev) => ({
        ...prev,
        isListening: false,
      }));
      onStop?.();
    };

    recognitionRef.current = recognition;
    setState((prev) => ({
      ...prev,
      isSupported: true,
    }));

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [continuous, interimResults, lang, onResult, onError, onStart, onStop]);

  const start = useCallback(() => {
    if (!recognitionRef.current) {
      setState((prev) => ({
        ...prev,
        error: 'Speech recognition not initialized',
      }));
      return;
    }

    if (state.isListening) {
      return;
    }

    finalTranscriptRef.current = '';
    setState((prev) => ({
      ...prev,
      transcript: '',
      error: null,
    }));

    try {
      recognitionRef.current.start();
    } catch (error: any) {
      setState((prev) => ({
        ...prev,
        error: error.message || 'Failed to start recognition',
      }));
    }
  }, [state.isListening]);

  const stop = useCallback(() => {
    if (!recognitionRef.current || !state.isListening) {
      return;
    }

    try {
      recognitionRef.current.stop();
    } catch (error: any) {
      setState((prev) => ({
        ...prev,
        error: error.message || 'Failed to stop recognition',
      }));
    }
  }, [state.isListening]);

  const reset = useCallback(() => {
    finalTranscriptRef.current = '';
    setState((prev) => ({
      ...prev,
      transcript: '',
      error: null,
    }));
  }, []);

  return {
    ...state,
    start,
    stop,
    reset,
  };
}
