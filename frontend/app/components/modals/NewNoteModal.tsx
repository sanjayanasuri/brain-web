'use client';

import React, { useState } from 'react';
import { createConcept } from '../../api-client';

type Props = {
    isOpen: boolean;
    onClose: () => void;
    onCreated: (concept: any) => void;
    graphId: string;
};

export default function NewNoteModal({ isOpen, onClose, onCreated, graphId }: Props) {
    const [name, setName] = useState('');
    const [domain, setDomain] = useState('');
    const [description, setDescription] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name) return;

        setIsLoading(true);
        try {
            const concept = await createConcept({
                name,
                domain: domain || 'General',
                type: 'concept',
                description,
                graph_id: graphId
            });
            onCreated(concept);
            onClose();
            // Reset form
            setName('');
            setDomain('');
            setDescription('');
        } catch (err) {
            console.error('Failed to create concept:', err);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 2000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(8px)',
        }} onClick={onClose}>
            <div
                style={{
                    width: '100%',
                    maxWidth: '450px',
                    background: '#171717',
                    borderRadius: '24px',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    padding: '32px',
                    boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5)',
                    animation: 'modalSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div style={{ marginBottom: '24px' }}>
                    <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: '#fff', letterSpacing: '-0.03em' }}>Create New Note</h2>
                    <p style={{ margin: '8px 0 0', fontSize: '14px', color: 'rgba(255,255,255,0.5)' }}>Add a new concept to your knowledge graph.</p>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.05em' }}>Concept Name</label>
                        <input
                            autoFocus
                            required
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Quantum Computing"
                            style={{
                                width: '100%',
                                padding: '12px 16px',
                                borderRadius: '12px',
                                background: 'rgba(255,255,255,0.05)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                color: '#fff',
                                fontSize: '16px',
                                outline: 'none',
                                transition: 'border-color 0.2s',
                            }}
                            onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                            onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.05em' }}>Domain / Category</label>
                        <input
                            value={domain}
                            onChange={(e) => setDomain(e.target.value)}
                            placeholder="e.g. Physics"
                            style={{
                                width: '100%',
                                padding: '12px 16px',
                                borderRadius: '12px',
                                background: 'rgba(255,255,255,0.05)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                color: '#fff',
                                fontSize: '16px',
                                outline: 'none',
                            }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.05em' }}>Quick Description</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="What is this concept about?"
                            rows={3}
                            style={{
                                width: '100%',
                                padding: '12px 16px',
                                borderRadius: '12px',
                                background: 'rgba(255,255,255,0.05)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                color: '#fff',
                                fontSize: '16px',
                                outline: 'none',
                                resize: 'none',
                            }}
                        />
                    </div>

                    <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                        <button
                            type="button"
                            onClick={onClose}
                            style={{
                                flex: 1,
                                padding: '14px',
                                borderRadius: '14px',
                                border: '1px solid rgba(255,255,255,0.1)',
                                background: 'transparent',
                                color: '#fff',
                                fontWeight: 600,
                                cursor: 'pointer',
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isLoading || !name}
                            style={{
                                flex: 2,
                                padding: '14px',
                                borderRadius: '14px',
                                border: 'none',
                                background: '#3b82f6',
                                color: '#fff',
                                fontWeight: 600,
                                cursor: 'pointer',
                                opacity: (isLoading || !name) ? 0.5 : 1,
                                boxShadow: '0 8px 20px rgba(59, 130, 246, 0.4)',
                            }}
                        >
                            {isLoading ? 'Creating...' : 'Create Concept'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
