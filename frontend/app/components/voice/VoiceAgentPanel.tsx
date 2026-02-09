'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useVoiceStream } from '../../hooks/useVoiceStream';
import GlassCard from '../ui/GlassCard';
import Button from '../ui/Button';
import { VoiceSession } from '../../types/voice';
import { startVoiceSession, stopVoiceSession, getTutorProfile, setTutorProfile, type TutorProfile } from '../../api-client';
import { AUDIENCE_MODES, VOICE_IDS } from '../study/TutorProfileSettings';
import { Settings, X } from 'lucide-react';

interface VoiceAgentPanelProps {
  graphId: string;
  branchId: string;
  sessionId?: string;
}

const VoiceAgentPanel: React.FC<VoiceAgentPanelProps> = ({ graphId, branchId, sessionId }) => {
  const [session, setSession] = useState<VoiceSession | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [visualizerLevels, setVisualizerLevels] = useState<number[]>(new Array(15).fill(4));
  const [isScribeMode, setIsScribeMode] = useState(false);
  const [, setMappedEntities] = useState<any[]>([]);
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'agent' | 'system', text: string }[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isStudyMode, setIsStudyMode] = useState(false);
  const [currentTaskType, setCurrentTaskType] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsQueueRef = useRef<string[]>([]);
  const ttsIsPlayingRef = useRef(false);

  const [showSettings, setShowSettings] = useState(false);
  const [profile, setProfile] = useState<TutorProfile | null>(null);

  useEffect(() => {
    getTutorProfile().then(p => setProfile(p)).catch(console.error);
  }, []);

  const handleUpdateProfile = async (updates: Partial<TutorProfile>) => {
    if (!profile) return;
    const newProfile = { ...profile, ...updates };
    setProfile(newProfile);
    try {
      await setTutorProfile(newProfile);
    } catch (e) {
      console.error("Failed to update profile", e);
    }
  };

  const stopStreamedAudio = useCallback(() => {
    try {
      ttsAudioRef.current?.pause();
    } catch { }
    ttsAudioRef.current = null;
    ttsIsPlayingRef.current = false;
    try {
      for (const url of ttsQueueRef.current) URL.revokeObjectURL(url);
    } catch { }
    ttsQueueRef.current = [];
    setIsSpeaking(false);
  }, []);

  const playNextStreamedAudio = useCallback(() => {
    if (ttsIsPlayingRef.current) return;
    const url = ttsQueueRef.current.shift();
    if (!url) return;

    const audio = new Audio(url);
    ttsAudioRef.current = audio;
    ttsIsPlayingRef.current = true;
    setIsSpeaking(true);

    audio.onended = () => {
      try { URL.revokeObjectURL(url); } catch { }
      ttsAudioRef.current = null;
      ttsIsPlayingRef.current = false;
      if (ttsQueueRef.current.length === 0) {
        setIsSpeaking(false);
      }
      playNextStreamedAudio();
    };
    audio.onerror = () => {
      try { URL.revokeObjectURL(url); } catch { }
      ttsAudioRef.current = null;
      ttsIsPlayingRef.current = false;
      setIsSpeaking(false);
      playNextStreamedAudio();
    };

    audio.play().catch(() => {
      try { URL.revokeObjectURL(url); } catch { }
      ttsAudioRef.current = null;
      ttsIsPlayingRef.current = false;
      setIsSpeaking(false);
      playNextStreamedAudio();
    });
  }, []);

  const voiceStream = useVoiceStream({
    onProcessingStart: () => {
      setIsProcessing(true);
      if (isSpeaking) {
        stopStreamedAudio();
        voiceStream.interrupt();
      }
    },
    onTranscript: (text) => {
      const t = (text || '').trim();
      if (!t) return;
      setChatHistory(prev => [...prev, { role: 'user', text: t }]);
    },
    onAgentReply: (payload) => {
      setIsProcessing(false);
      const shouldSpeak = payload?.should_speak !== false;
      let reply = shouldSpeak ? String(payload?.agent_response || '') : '';
      if (payload?.is_fog_clearing && reply) {
        reply = `Insight: ${reply}`;
        const insightAction = { type: 'CREATE_NODE', name: 'New Insight', node_type: 'understanding' };
        setMappedEntities(prev => [insightAction, ...prev].slice(0, 15));
      } else if (payload?.is_eureka && reply) {
        reply = `Breakthrough: ${reply}`;
      }

      // Study Task Detection
      if (reply.includes('[STUDY_TASK:')) {
        const match = reply.match(/\[STUDY_TASK:\s*(\w+)\]/);
        if (match) {
          setIsStudyMode(true);
          setCurrentTaskType(match[1]);
          // Clean up the bracket from spoken text if necessary, 
          // though usually handled by TTS being smart or filtered earlier.
        }
      } else if (reply && isStudyMode) {
        // If agent replies without a new task and we were in study mode, 
        // it might be evaluation. We keep it active for now or reset on yield.
      }

      if (reply) setChatHistory(prev => [...prev, { role: 'agent', text: reply }]);
      if (Array.isArray(payload?.actions) && payload.actions.length > 0) {
        setMappedEntities(prev => [...payload.actions, ...prev].slice(0, 15));
      }
    },
    onTtsAudio: (audioBuf, meta) => {
      try {
        const mime = meta?.format === 'mp3' ? 'audio/mpeg' : 'audio/mpeg';
        const url = URL.createObjectURL(new Blob([audioBuf], { type: mime }));
        ttsQueueRef.current.push(url);
        playNextStreamedAudio();
      } catch { }
    },
    onError: (err) => {
      setIsProcessing(false);
      setError(err.message);
    }
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory, isProcessing, voiceStream.isRecording]);

  // Visualizer Animation - Simulation based on state
  useEffect(() => {
    let interval: NodeJS.Timeout;
    const isListening = voiceStream.isRecording;

    if (isListening || isSpeaking || isProcessing) {
      interval = setInterval(() => {
        setVisualizerLevels(new Array(15).fill(0).map(() => {
          if (isSpeaking) return Math.random() * 40 + 20;
          if (isProcessing) return Math.random() * 15 + 10;
          if (isListening) return Math.random() * 30 + 10;
          return Math.random() * 5 + 5; // Flatline-ish but idle pulse
        }));
      }, 100);
    } else {
      setVisualizerLevels(new Array(15).fill(4));
    }
    return () => clearInterval(interval);
  }, [voiceStream.isRecording, isSpeaking, isProcessing]);

  const startSession = async () => {
    try {
      setError(null);
      setIsProcessing(false);
      stopStreamedAudio();
      const data = await startVoiceSession(graphId, branchId, undefined, sessionId);
      setSession(data);
      setChatHistory([{ role: 'system', text: "Session started. I'm listening." }]);

      await voiceStream.connect({
        graphId,
        branchId,
        sessionId: data.session_id,
        isScribeMode,
        pipeline: 'agent',
      });
      // Hands-free: start recording immediately (server-side VAD will segment utterances).
      await voiceStream.start();
    } catch (err: any) {
      console.error(err);
      setError(`Failed to start session: ${err.message}`);
    }
  };

  const stopSession = async () => {
    if (!session) return;
    voiceStream.disconnect();
    stopStreamedAudio();
    try {
      await stopVoiceSession(session.session_id, 0, 0);
      setSession(null);
      setIsProcessing(false);
      setChatHistory(prev => [...prev, { role: 'system', text: "Session ended." }]);
    } catch (err) {
      console.error(err);
    }
  };

  const currentStatus = isProcessing ? 'THINKING' : (isSpeaking ? 'SPEAKING' : (voiceStream.isRecording ? 'LISTENING' : 'IDLE'));
  const hasLiveInput = voiceStream.isRecording;

  const ensureVoiceStreamConnected = useCallback(async () => {
    if (!session) return false;
    if (voiceStream.isConnected) return true;
    await voiceStream.connect({ graphId, branchId, sessionId: session.session_id, isScribeMode, pipeline: 'agent' });
    return true;
  }, [session, voiceStream.isConnected, voiceStream.connect, graphId, branchId, isScribeMode]);

  const handleListenStart = useCallback(async () => {
    if (!session) return;
    setError(null);
    setIsProcessing(false);
    const ok = await ensureVoiceStreamConnected();
    if (!ok) return;
    if (isSpeaking) {
      stopStreamedAudio();
      voiceStream.interrupt();
    }
    await voiceStream.start();
  }, [session, ensureVoiceStreamConnected, isSpeaking, stopStreamedAudio, voiceStream.interrupt, voiceStream.start]);

  const handleListenStop = useCallback(async () => {
    if (!session) return;
    if (!voiceStream.isRecording) return;
    await voiceStream.stop();
  }, [session, voiceStream.isRecording, voiceStream.stop]);

  return (
    <GlassCard className={`voice-agent-panel ${session ? 'session-active' : ''} ${isStudyMode ? 'study-mode' : ''} status-${currentStatus.toLowerCase()}`}>
      <div className="voice-agent-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="status-indicator" />
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{session ? session.agent_name : 'Voice Companion'}</h3>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {session && (
            <div style={{ display: 'flex', gap: '4px' }}>
              {isStudyMode && (
                <span className="live-tag study-tag">
                  STUDY MODE: {currentTaskType?.toUpperCase()}
                </span>
              )}
              <span className="live-tag">
                {isScribeMode ? 'SCRIBING' : currentStatus}
              </span>
            </div>
          )}
          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: '#666', display: 'flex', alignItems: 'center' }}
            title="Settings"
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      {showSettings && profile && (
        <div className="settings-overlay">
          <div className="settings-header">
            <h4>Voice Settings</h4>
            <button onClick={() => setShowSettings(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={14} /></button>
          </div>

          <div className="setting-row">
            <label>Audience</label>
            <select
              value={profile.audience_mode}
              onChange={(e) => handleUpdateProfile({ audience_mode: e.target.value as any })}
            >
              {AUDIENCE_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className="setting-row">
            <label>Tone</label>
            <select
              value={profile.voice_id}
              onChange={(e) => handleUpdateProfile({ voice_id: e.target.value as any })}
            >
              {VOICE_IDS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </div>
        </div>
      )}

      <div className="activity-stage">
        <div className={`pulse-orb ${hasLiveInput ? 'is-hearing' : ''}`}>
          <div className="orb-core"></div>
          {(isSpeaking || hasLiveInput) && <div className="orb-ripple"></div>}
        </div>

        <div className="visualizer-overlay">
          {visualizerLevels.map((level, i) => (
            <div
              key={i}
              className="visualizer-bar"
              style={{
                height: `${level}px`,
                transform: `rotate(${i * (360 / 15)}deg) translateY(-42px)`,
                background: isSpeaking ? '#3b82f6' : (isProcessing ? '#fbbf24' : (hasLiveInput ? '#10b981' : '#ccc')),
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
        {chatHistory.length === 0 && !hasLiveInput && !isProcessing && (
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

        {voiceStream.isRecording && (
          <div className="transcript-box user-box interim">
            <span className="label">YOU (RECORDING)</span>
            <p className="message-text">…</p>
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
          <div style={{ width: '100%', display: 'flex', gap: '10px' }}>
            <Button
              variant="primary"
              onClick={(e) => {
                e.preventDefault();
                if (voiceStream.isRecording) {
                  void handleListenStop();
                } else {
                  void handleListenStart();
                }
              }}
              style={{ flex: 1, borderRadius: '12px' }}
            >
              {voiceStream.isRecording ? 'Stop Listening' : 'Start Listening'}
            </Button>
            <Button variant="secondary" onClick={stopSession} style={{ borderRadius: '12px' }}>
              Sleep
            </Button>
          </div>
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
        .study-tag { background: rgba(155, 89, 182, 0.1) !important; color: #9b59b6 !important; border: 1px solid rgba(155, 89, 182, 0.2); }
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
        .session-active.study-mode .orb-core {
          background: #9b59b6;
          box-shadow: 0 0 30px rgba(155, 89, 182, 0.4);
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

        .settings-overlay {
            background: rgba(255, 255, 255, 0.95);
            padding: 12px;
            border-radius: 12px;
            margin-bottom: 12px;
            border: 1px solid rgba(0,0,0,0.05);
            animation: slideDown 0.2s ease-out;
            box-shadow: 0 4px 12px rgba(0,0,0,0.05);
        }
        .settings-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
            padding-bottom: 4px;
            border-bottom: 1px solid #eee;
        }
        .settings-header h4 {
            margin: 0;
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #666;
            font-weight: 700;
        }
        .setting-row {
            margin-bottom: 8px;
        }
        .setting-row:last-child { margin-bottom: 0; }
        .setting-row label {
            display: block;
            font-size: 10px;
            font-weight: 600;
            margin-bottom: 3px;
            color: #555;
            text-transform: uppercase;
        }
        .setting-row select {
            width: 100%;
            padding: 4px 6px;
            border-radius: 6px;
            border: 1px solid #ddd;
            font-size: 11px;
            background: white;
            color: #333;
        }
        @keyframes slideDown {
            from { opacity: 0; transform: translateY(-5px); }
            to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </GlassCard>
  );
};

export default VoiceAgentPanel;
