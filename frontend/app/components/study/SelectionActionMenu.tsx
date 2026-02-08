// frontend/app/components/study/SelectionActionMenu.tsx
'use client';

import React, { useState } from 'react';
import { useStudyStore } from '../../state/studyStore';
import { startStudySession, clarifySelection } from '../../api-client-study';

interface SelectionActionMenuProps {
    selectionId: string;
    position: { x: number; y: number };
    onClose: () => void;
}

export default function SelectionActionMenu({
    selectionId,
    position,
    onClose,
}: SelectionActionMenuProps) {
    const { setClarifyResponse, setLoading, setSession, setCurrentTask } = useStudyStore();
    const [error, setError] = useState<string | null>(null);

    const handleClarify = async () => {
        try {
            setLoading(true);
            setError(null);

            const data = await clarifySelection({
                selection_id: selectionId,
                radius: 2,
                include_related: true,
            });
            setClarifyResponse(data);
            onClose();
        } catch (err) {
            console.error('Clarify error:', err);
            setError(err instanceof Error ? err.message : 'Failed to clarify selection');
        } finally {
            setLoading(false);
        }
    };

    const handleStartSession = async () => {
        try {
            setLoading(true);
            setError(null);

            const result = await startStudySession(
                'practice',
                undefined,
                selectionId,
                'explain'
            );

            setSession({
                id: result.session_id,
                user_id: '',
                tenant_id: '',
                intent: 'practice',
                current_mode: 'explain',
                mode_inertia: 0.5,
                started_at: new Date().toISOString(),
            });
            setCurrentTask(result.initial_task);
            onClose();
        } catch (err) {
            console.error('Start session error:', err);
            setError(err instanceof Error ? err.message : 'Failed to start session');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            className="selection-action-menu"
            style={{
                position: 'fixed',
                top: `${position.y}px`,
                left: `${position.x}px`,
                zIndex: 2000,
                background: 'rgba(255, 255, 255, 0.9)',
                backdropFilter: 'blur(20px)',
                borderRadius: '16px',
                boxShadow: '0 20px 40px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.05)',
                border: 'none',
                padding: '8px',
                minWidth: '200px',
                animation: 'scaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                transform: 'translateX(-50%)',
                transformOrigin: 'top center',
                pointerEvents: 'auto',
            }}
        >
            <button
                onClick={handleClarify}
                style={{
                    width: '100%',
                    padding: '12px 16px',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '600',
                    color: 'var(--ink-strong)',
                    textAlign: 'left',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(59, 130, 246, 0.08)';
                    e.currentTarget.style.color = '#2563eb';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--ink-strong)';
                }}
            >
                <span style={{ fontSize: '18px' }}>💡</span>
                <span>Clarify Selection</span>
            </button>

            <button
                onClick={handleStartSession}
                style={{
                    width: '100%',
                    padding: '12px 16px',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '600',
                    color: 'var(--ink-strong)',
                    textAlign: 'left',
                    transition: 'all 0.2s ease',
                    marginTop: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(139, 92, 246, 0.08)';
                    e.currentTarget.style.color = '#7c3aed';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--ink-strong)';
                }}
            >
                <span style={{ fontSize: '18px' }}>🎓</span>
                <span>Dive Deeper (Study)</span>
            </button>

            {error && (
                <div style={{
                    padding: '8px 12px',
                    fontSize: '12px',
                    color: '#dc2626',
                    background: 'rgba(220, 38, 38, 0.1)',
                    borderRadius: '6px',
                    marginTop: '4px',
                }}>
                    {error}
                </div>
            )}
        </div>
    );
}
