'use client';

import React, { useState, useEffect } from 'react';
import GlassCard from '../ui/GlassCard';
import Button from '../ui/Button';
import { Input } from '../ui/Input';
import { MemorySyncEvent, VoiceUsage } from '../../types/voice';

const SupermemorySettings: React.FC = () => {
    const [apiKey, setApiKey] = useState('');
    const [history, setHistory] = useState<MemorySyncEvent[]>([]);
    const [usage, setUsage] = useState<VoiceUsage | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        fetchHistory();
        fetchUsage();
    }, []);

    const fetchHistory = async () => {
        try {
            const response = await fetch('/api/voice-agent/memories');
            const data = await response.json();
            setHistory(data.history || []);
        } catch (err) {
            console.error('Failed to fetch memory history', err);
        }
    };

    const fetchUsage = async () => {
        try {
            const response = await fetch('/api/voice-agent/usage');
            const data = await response.json();
            setUsage(data);
        } catch (err) {
            console.error('Failed to fetch usage', err);
        }
    };

    const saveApiKey = () => {
        // In a real app, this would save to a secure preferences store
        alert('API Key saved to session (simulated)');
    };

    return (
        <div className="supermemory-settings-container">
            <GlassCard className="settings-card">
                <h3>Supermemory AI Integration</h3>
                <p className="description">
                    Connect your Brain Web to Supermemory AI to keep track of your personal insights and "Aha!" moments across sessions.
                </p>

                <div className="form-group">
                    <label htmlFor="sm-api-key">Supermemory API Key</label>
                    <div className="input-with-button">
                        <Input
                            id="sm-api-key"
                            type="password"
                            placeholder="Paste your API key here..."
                            value={apiKey}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApiKey(e.target.value)}
                        />
                        <Button onClick={saveApiKey}>Save</Button>
                    </div>
                </div>

                {usage && (
                    <div className="usage-stats">
                        <h4>Daily Voice Usage</h4>
                        <div className="progress-container">
                            <div
                                className="progress-bar"
                                style={{ width: `${Math.min(100, (usage.daily_usage_minutes / usage.daily_limit_minutes) * 100)}%` }}
                            />
                        </div>
                        <span className="usage-text">
                            {usage.daily_usage_minutes.toFixed(1)} / {usage.daily_limit_minutes} minutes used
                        </span>
                    </div>
                )}
            </GlassCard>

            <GlassCard className="history-card">
                <h4>Recent Memory Syncs</h4>
                {history.length === 0 ? (
                    <p className="no-history">No memories synced yet.</p>
                ) : (
                    <ul className="history-list">
                        {history.map((event) => (
                            <li key={event.id} className="history-item">
                                <div className="item-header">
                                    <span className={`source-badge ${event.source}`}>{event.source}</span>
                                    <span className="timestamp">{new Date(event.timestamp).toLocaleString()}</span>
                                </div>
                                <p className="content-preview">{event.content_preview}</p>
                                <div className="status-indicator">
                                    <span className={`dots ${event.status}`} />
                                    {event.status}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </GlassCard>

            <style jsx>{`
        .supermemory-settings-container {
          display: flex;
          flex-direction: column;
          gap: 24px;
          max-width: 600px;
        }
        .description {
          font-size: 0.9rem;
          color: var(--ink-faint);
          margin-bottom: 20px;
        }
        .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .input-with-button {
          display: flex;
          gap: 8px;
        }
        .usage-stats {
          margin-top: 24px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .progress-container {
          height: 8px;
          background: var(--surface-vibrant);
          border-radius: 4px;
          overflow: hidden;
        }
        .progress-bar {
          height: 100%;
          background: var(--accent);
          transition: width 0.3s ease;
        }
        .usage-text {
          font-size: 0.75rem;
          color: var(--ink-faint);
          align-self: flex-end;
        }
        .history-card {
          margin-top: 12px;
        }
        .no-history {
          font-size: 0.9rem;
          color: var(--ink-faint);
          text-align: center;
          padding: 20px;
        }
        .history-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .history-item {
          padding-bottom: 12px;
          border-bottom: 1px solid var(--border-soft);
        }
        .item-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 4px;
        }
        .source-badge {
          font-size: 0.7rem;
          padding: 2px 6px;
          border-radius: 4px;
          background: var(--surface-vibrant);
          text-transform: uppercase;
        }
        .timestamp {
          font-size: 0.7rem;
          color: var(--ink-faint);
        }
        .content-preview {
          font-size: 0.85rem;
          margin: 4px 0;
        }
        .status-indicator {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.7rem;
          text-transform: capitalize;
        }
        .dots {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }
        .dots.synced { background: #10b981; }
        .dots.failed { background: #ef4444; }
        .dots.pending { background: #f59e0b; }
      `}</style>
        </div>
    );
};

export default SupermemorySettings;
