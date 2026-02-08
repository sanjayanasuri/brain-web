'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useVoiceRecognition } from '../../hooks/useVoiceRecognition';
import GlassCard from '../ui/GlassCard';
import Button from '../ui/Button';
import { VoiceSession, VoiceUsage } from '../../types/voice';
import { startVoiceSession, stopVoiceSession, getInteractionContext } from '../../api-client';

interface VoiceAgentPanelProps {
  graphId: string;
  branchId: string;
}

const VoiceAgentPanel: React.FC<VoiceAgentPanelProps> = ({ graphId, branchId }) => {
  const [session, setSession] = useState<VoiceSession | null>(null);
  const [usage, setUsage] = useState<VoiceUsage | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [agentResponse, setAgentResponse] = useState<string>('');
  const [visualizerLevels, setVisualizerLevels] = useState<number[]>(new Array(15).fill(4));
  const [isScribeMode, setIsScribeMode] = useState(false);
  const [mappedEntities, setMappedEntities] = useState<any[]>([]);
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'agent' | 'system', text: string }[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const processTranscript = useCallback(async (transcript: string) => {
    if (!session) return;

    console.log("VoiceAgent: Processing transcript:", transcript);
    setIsProcessing(true);
    setError(null);

    // Append user message AND a placeholder for the agent to the history
    setChatHistory(prev => [...prev, { role: 'user', text: transcript }]);
    // We'll use the 'isProcessing' state to show the thinking indicator at the bottom instead of a history item

    try {
      // Clear interim transcript in the hook
      voice.reset();

      const data = await getInteractionContext(graphId, branchId, transcript, isScribeMode, session.session_id);
      console.log("VoiceAgent: API Response:", data);

      let finalReply = data.agent_response || `I've noted that.`;

      if (data.is_fog_clearing) {
        finalReply = `Insight: ${finalReply}`;
        const insightAction = { type: 'CREATE_NODE', name: 'New Insight', node_type: 'understanding' };
        setMappedEntities(prev => [insightAction, ...prev].slice(0, 15));
      } else if (data.is_eureka) {
        finalReply = `Breakthrough: ${finalReply}`;
      }

      setAgentResponse(finalReply);
      setChatHistory(prev => [...prev.filter(m => m.text !== "Thinking..."), { role: 'agent', text: finalReply }]);

      if (data.actions && data.actions.length > 0) {
        setMappedEntities(prev => [...data.actions, ...prev].slice(0, 15));
      }
    } catch (err: any) {
      console.error("VoiceAgent: Process failed:", err);
      setError("Communication failed. Please try again.");
      setChatHistory(prev => {
        const historyCopy = prev.filter(m => m.text !== "Thinking...");
        return [...historyCopy, { role: 'system', text: "Error: Could not reach the agent." }];
      });
      // Safety restart if error happens
      if (session) voice.start();
    } finally {
      setIsProcessing(false);
    }
  }, [session, graphId, branchId, isScribeMode]);

  const handleVoiceResult = useCallback((transcript: string, isFinal: boolean) => {
    console.log(`VoiceAgent: Result [final=${isFinal}]: "${transcript}"`);

    // Only reset retry count if we actually hear something meaningful
    if (transcript.trim().length > 2) {
      setRetryCount(0);
      setError(null);
    }

    // Interruption logic: If the agent is speaking and the user starts talking, shut the agent up
    if (isSpeaking && transcript.trim().length > 3) {
      console.log("VoiceAgent: Interrupted by user! Stopping speech.");
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      setIsSpeaking(false);
      return;
    }

    if (isFinal && transcript.trim() && !isProcessing && !isSpeaking) {
      processTranscript(transcript);
    }
  }, [processTranscript, isProcessing, isSpeaking]);

  const voiceOptions = useMemo(() => ({
    continuous: true,
    interimResults: true,
    onResult: handleVoiceResult,
    onStart: () => {
      // Don't reset retryCount here, wait for actual results
    },
    onError: (err: any) => {
      console.error("VoiceAgent: Recognition error:", err);
      // If we hit a network error, increment the backoff counter
      if (err.message.includes('network')) {
        setRetryCount(prev => prev + 1);
      }
      setError(err.message);
    }
  }), [handleVoiceResult]);

  const voice = useVoiceRecognition(voiceOptions);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory, voice.transcript, isProcessing]);

  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    console.log("VoiceAgent: Speaking:", text);
    // Keep mic on - do not call voice.stop() here

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.05;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => {
      setIsSpeaking(false);
    };
    utterance.onerror = (t) => {
      console.error("VoiceAgent: Speech synthesis error:", t);
      setIsSpeaking(false);
    };

    window.speechSynthesis.speak(utterance);
  }, []);

  useEffect(() => {
    if (agentResponse) {
      speak(agentResponse);
      // Reset after starting to speak so we don't repeat
      setAgentResponse('');
    }
  }, [agentResponse, speak]);

  // Visualizer Animation - Simulation based on state
  useEffect(() => {
    let interval: NodeJS.Timeout;
    const isListening = voice.isListening;
    const transcriptLength = voice.transcript.length;

    if (isListening || isSpeaking || isProcessing) {
      interval = setInterval(() => {
        setVisualizerLevels(new Array(15).fill(0).map(() => {
          if (isSpeaking) return Math.random() * 40 + 20;
          if (isProcessing) return Math.random() * 15 + 10;
          // Listening: animate based on whether there is any transcript activity
          if (transcriptLength > 0) return Math.random() * 30 + 10;
          return Math.random() * 5 + 5; // Flatline-ish but idle pulse
        }));
      }, 100);
    } else {
      setVisualizerLevels(new Array(15).fill(4));
    }
    return () => clearInterval(interval);
  }, [voice.isListening, isSpeaking, isProcessing, voice.transcript.length]);

  useEffect(() => {
    const isListening = voice.isListening;
    // Don't auto-retry if we've failed too many times OR if we aren't in a session
    // We cap it at 6 for "auto" and let the user click "Try Again" after that
    if (session && !isListening && !isSpeaking && !isProcessing && retryCount < 6) {
      // Exponential backoff: starts at 3s, then 6s, 12s, 24s...
      const delay = Math.min(3000 * Math.pow(2, retryCount), 45000);
      const timer = setTimeout(() => {
        if (!voice.isListening && !isSpeaking && !isProcessing) {
          console.log(`VoiceAgent: Auto-restarting listening (attempt ${retryCount + 1})...`);
          voice.start();
        }
      }, delay);
      return () => clearTimeout(timer);
    }
  }, [session, voice.isListening, isSpeaking, isProcessing, voice.start, retryCount]);

  const startSession = async () => {
    try {
      setError(null);
      const data = await startVoiceSession(graphId, branchId);
      setSession(data);
      voice.start();
      const initialGreeting = isScribeMode
        ? "Scribe Mode active. Tell me what you're learning and I'll map it to the graph."
        : "I'm here. What should we explore together?";
      setAgentResponse(initialGreeting);
      setChatHistory([{ role: 'system', text: "Session started. I'm listening." }]);
    } catch (err: any) {
      console.error(err);
      setError(`Failed to start session: ${err.message}`);
    }
  };

  const stopSession = async () => {
    if (!session) return;
    voice.stop();
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    try {
      await stopVoiceSession(session.session_id, 0, 0);
      setSession(null);
      setAgentResponse('');
      setChatHistory(prev => [...prev, { role: 'system', text: "Session ended." }]);
    } catch (err) {
      console.error(err);
    }
  };

  const currentStatus = isProcessing ? 'THINKING' : (isSpeaking ? 'SPEAKING' : (voice.isListening ? 'LISTENING' : (retryCount >= 6 ? 'OFFLINE' : (retryCount > 0 ? 'RECONNECTING' : 'IDLE'))));

  return (
    <GlassCard className={`voice-agent-panel ${session ? 'session-active' : ''} status-${currentStatus.toLowerCase()}`}>
      {retryCount >= 6 && (
        <div className="network-fail-overlay">
          <div className="fail-icon" style={{ fontSize: '14px', fontWeight: 700 }}>Offline</div>
          <p>Connectivity Issue</p>
          <span style={{ fontSize: '11px', color: '#666', marginBottom: '12px' }}>Speech service is unresponsive.</span>
          <Button variant="secondary" onClick={() => { setRetryCount(0); voice.start(); }} style={{ borderRadius: '12px', fontSize: '12px', padding: '8px 20px' }}>
            Reconnect Mic
          </Button>
        </div>
      )}
      <div className="voice-agent-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="status-indicator" />
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{session ? session.agent_name : 'Voice Companion'}</h3>
        </div>
        {session && (
          <span className="live-tag">
            {isScribeMode ? 'SCRIBING' : currentStatus}
          </span>
        )}
      </div>

      <div className="activity-stage">
        <div className={`pulse-orb ${voice.transcript.length > 0 ? 'is-hearing' : ''}`}>
          <div className="orb-core"></div>
          {(isSpeaking || voice.transcript.length > 0) && <div className="orb-ripple"></div>}
        </div>

        <div className="visualizer-overlay">
          {visualizerLevels.map((level, i) => (
            <div
              key={i}
              className="visualizer-bar"
              style={{
                height: `${level}px`,
                transform: `rotate(${i * (360 / 15)}deg) translateY(-42px)`,
                background: isSpeaking ? '#3b82f6' : (isProcessing ? '#fbbf24' : (voice.transcript.length > 0 ? '#10b981' : '#ccc')),
                opacity: 0.7,
                transition: 'height 80ms ease-out, background 0.3s ease'
              }}
            />
          ))}
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <span>Error: {error}</span>
        </div>
      )}

      <div className="transcript-area" ref={scrollRef}>
        {chatHistory.length === 0 && !voice.transcript && !isProcessing && (
          <div className="empty-history">
            <p>Ready when you are...</p>
          </div>
        )}

        {chatHistory.map((msg, i) => (
          <div key={i} className={`transcript-box ${msg.role}-box`}>
            <span className="label">
              {msg.role === 'user' ? 'YOU' : (msg.role === 'agent' ? 'AGENT' : 'SYSTEM')}
            </span>
            <p className="message-text">{msg.text}</p>
          </div>
        ))}

        {voice.transcript && (
          <div className="transcript-box user-box interim">
            <span className="label">YOU (SPEAKING)</span>
            <p className="message-text">{voice.transcript}</p>
          </div>
        )}

        {isProcessing && (
          <div className="transcript-box agent-box thinking">
            <span className="label">AGENT</span>
            <div className="typing-indicator">
              <span></span><span></span><span></span>
            </div>
          </div>
        )}
      </div>

      <div className="voice-controls">
        {!session ? (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="mode-toggle-container">
              <label className="mode-switch">
                <input
                  type="checkbox"
                  checked={isScribeMode}
                  onChange={(e) => setIsScribeMode(e.target.checked)}
                />
                <span className="mode-slider"></span>
              </label>
              <span className="mode-label">Scribe Mode (Auto-mapping)</span>
            </div>
            <Button variant="primary" onClick={startSession} style={{ width: '100%', borderRadius: '12px' }}>
              Wake Up Agent
            </Button>
          </div>
        ) : (
          <Button variant="secondary" onClick={stopSession} style={{ width: '100%', borderRadius: '12px' }}>
            Go to Sleep
          </Button>
        )}
      </div>

      <style jsx>{`
        .voice-agent-panel {
          width: 300px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 20px;
          background: rgba(255, 255, 255, 0.85);
          backdrop-filter: blur(24px);
          border: 1px solid rgba(255, 255, 255, 0.4);
          box-shadow: 0 12px 40px rgba(0,0,0,0.12);
        }
        
        .live-tag {
          font-size: 10px;
          font-weight: 800;
          padding: 2px 8px;
          border-radius: 6px;
          letter-spacing: 0.05em;
          transition: all 0.3s ease;
        }
        
        .status-listening .live-tag { background: rgba(16, 185, 129, 0.1); color: #10b981; }
        .status-speaking .live-tag { background: rgba(59, 130, 246, 0.1); color: #3b82f6; }
        .status-thinking .live-tag { background: rgba(251, 191, 36, 0.1); color: #fbbf24; }
        .status-reconnecting .live-tag { background: rgba(239, 68, 68, 0.1); color: #ef4444; }
        .status-idle .live-tag { background: rgba(0,0,0,0.05); color: #999; }

        .status-indicator {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #ccc;
          transition: all 0.4s ease;
        }
        .session-active .status-indicator { background: #10b981; }
        .status-speaking .status-indicator { background: #3b82f6; box-shadow: 0 0 10px rgba(59, 130, 246, 0.5); }
        .status-thinking .status-indicator { background: #fbbf24; }
        .status-reconnecting .status-indicator { background: #ef4444; animation: blink 1s infinite; }

        .activity-stage {
          height: 120px;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          background: rgba(0,0,0,0.02);
          border-radius: 24px;
        }

        .pulse-orb {
          width: 54px;
          height: 54px;
          position: relative;
          z-index: 5;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .orb-core {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: #ccc;
          transition: all 0.8s cubic-bezier(0.4, 0, 0.2, 1);
          filter: blur(0.5px);
        }
        .status-listening .orb-core { 
          background: #10b981; 
          transform: scale(1.0); 
          box-shadow: 0 0 20px rgba(16, 185, 129, 0.4); 
        }
        .status-speaking .orb-core { 
          background: #3b82f6; 
          animation: natural-pulse 4s infinite ease-in-out;
          box-shadow: 0 0 40px rgba(59, 130, 246, 0.4); 
        }
        .pulse-orb.is-hearing .orb-core {
          background: #10b981;
          transform: scale(1.1) translateY(-2px);
          filter: blur(1.5px);
          box-shadow: 0 0 40px rgba(16, 185, 129, 0.6);
        }
        .status-thinking .orb-core { 
          background: #fbbf24; 
          animation: breath 1.5s infinite ease-in-out; 
        }
        .status-reconnecting .orb-core {
          background: #ef4444;
          opacity: 0.6;
        }

        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        @keyframes natural-pulse {
          0%, 100% { transform: scale(1.08); opacity: 0.85; filter: blur(1px); }
          50% { transform: scale(1.12); opacity: 1; filter: blur(2.5px); }
        }

        .orb-ripple {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          border: 2px solid currentColor;
          opacity: 0;
          animation: ripple 2.5s infinite cubic-bezier(0, 0, 0.2, 1);
        }
        .status-speaking .orb-ripple { color: #3b82f6; }
        .is-hearing .orb-ripple { color: #10b981; }
        
        @keyframes ripple {
          0% { transform: scale(0.8); opacity: 0.6; }
          100% { transform: scale(2.2); opacity: 0; }
        }

        .visualizer-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .visualizer-bar {
          width: 3px;
          position: absolute;
          border-radius: 4px;
        }

        .error-banner {
          background: rgba(239, 68, 68, 0.1);
          color: #ef4444;
          padding: 8px 12px;
          border-radius: 10px;
          font-size: 0.75rem;
          font-weight: 500;
          margin-top: 8px;
        }

        .network-fail-overlay {
          position: absolute;
          inset: 0;
          background: rgba(255,255,255,0.95);
          backdrop-filter: blur(16px);
          z-index: 200;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          border-radius: inherit;
          text-align: center;
          padding: 24px;
        }
        .fail-icon { font-size: 24px; margin-bottom: 8px; filter: grayscale(1); opacity: 0.6; }
        .network-fail-overlay p { margin: 0; font-size: 15px; font-weight: 700; color: #333; }

        .transcript-area {
          flex: 1;
          min-height: 200px;
          max-height: 350px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 10px;
          background: rgba(0,0,0,0.02);
          border-radius: 16px;
        }
        
        .transcript-box {
          position: relative;
          padding: 12px;
          border-radius: 12px;
          font-size: 0.85rem;
          line-height: 1.5;
          animation: slideIn 0.3s ease-out;
        }
        .user-box { background: white; border: 1px solid rgba(0,0,0,0.05); }
        .agent-box { background: rgba(59, 130, 246, 0.05); border: 1px solid rgba(59, 130, 246, 0.1); }
        .system-box { background: transparent; color: #999; font-style: italic; text-align: center; }
        
        .interim { border: 1px dashed #10b981; opacity: 0.8; }
        
        .label {
          position: absolute;
          top: -8px;
          left: 10px;
          font-size: 8px;
          font-weight: 800;
          background: white;
          padding: 0 4px;
          color: #aaa;
        }
        .message-text { margin: 0; }

        @keyframes breath {
          0%, 100% { transform: scale(1); opacity: 0.8; }
          50% { transform: scale(1.1); opacity: 1; }
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .typing-indicator { display: flex; gap: 4px; }
        .typing-indicator span {
          width: 4px; height: 4px; background: #3b82f6; border-radius: 50%;
          animation: bounce 1.4s infinite ease-in-out both;
        }
        .typing-indicator span:nth-child(1) { animation-delay: -0.32s; }
        .typing-indicator span:nth-child(2) { animation-delay: -0.16s; }
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0); }
          40% { transform: scale(1); }
        }

        .mode-toggle-container {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 8px 12px;
          background: white;
          border: 1px solid rgba(0,0,0,0.05);
          border-radius: 12px;
        }
        .mode-switch { position: relative; width: 32px; height: 18px; }
        .mode-switch input { opacity: 0; width: 0; height: 0; }
        .mode-slider {
          position: absolute; cursor: pointer; inset: 0;
          background-color: #eee; transition: .4s; border-radius: 20px;
        }
        .mode-slider:before {
          position: absolute; content: ""; height: 12px; width: 12px;
          left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%;
        }
        input:checked + .mode-slider { background-color: #3b82f6; }
        input:checked + .mode-slider:before { transform: translateX(14px); }
      `}</style>
    </GlassCard>
  );
};

export default VoiceAgentPanel;
