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

  // Stabilize callbacks using refs so useEffect doesn't need to re-run
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);
  const onStartRef = useRef(onStart);
  const onStopRef = useRef(onStop);

  useEffect(() => {
    onResultRef.current = onResult;
    onErrorRef.current = onError;
    onStartRef.current = onStart;
    onStopRef.current = onStop;
  }, [onResult, onError, onStart, onStop]);

  // Initialize recognition only when configuration changes
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setState((prev) => prev.isSupported ? prev : ({
        ...prev,
        isSupported: false,
        error: 'Speech recognition is not supported in this browser',
      }));
      return;
    }

    // If recognitionRef.current already exists and is configured with the same settings,
    // we might not need to re-initialize it. However, the current dependencies
    // (continuous, interimResults, lang) already ensure re-initialization if these change.
    // The main goal here is to ensure `isSupported` is set correctly once.
    if (!state.isSupported) {
      setState(prev => ({ ...prev, isSupported: true }));
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
      onStartRef.current?.();
    };

    recognition.onresult = (event: any) => {
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

      onResultRef.current?.(fullTranscript.trim(), interimTranscript === '');
    };

    recognition.onerror = (event: any) => {
      const error = new Error(`Speech recognition error: ${event.error}`);
      setState((prev) => ({
        ...prev,
        error: error.message,
        isListening: false,
      }));
      onErrorRef.current?.(error);
    };

    recognition.onend = () => {
      setState((prev) => ({
        ...prev,
        isListening: false,
      }));
      onStopRef.current?.();
    };

    recognitionRef.current = recognition;

    // Set isSupported only if it wasn't set to avoid redundant renders
    setState(prev => prev.isSupported ? prev : ({ ...prev, isSupported: true }));

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [continuous, interimResults, lang]); // Dependencies simplified

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
