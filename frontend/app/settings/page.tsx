'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getUserProfile, updateUserProfile, type UserProfile } from '../api-client';

export default function SettingsPage() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        async function loadProfile() {
            try {
                setLoading(true);
                const profile = await getUserProfile();
                setUserProfile(profile);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to load profile');
            } finally {
                setLoading(false);
            }
        }
        loadProfile();
    }, []);

    const handleSave = async () => {
        if (!userProfile) return;
        try {
            setSaving(true);
            const updated = await updateUserProfile(userProfile);
            setUserProfile(updated);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save profile');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="app-shell">
                <div className="loader">
                    <div className="loader__ring" />
                    <p className="loader__text">Loading Settings…</p>
                </div>
            </div>
        );
    }

    return (
        <div className="app-shell" style={{ padding: 24, overflow: 'auto' }}>
            <header className="graph-header" style={{ marginBottom: '24px' }}>
                <div>
                    <p className="eyebrow">User Settings</p>
                    <h1 className="title">Personal Information</h1>
                    <p className="subtitle">Manage your account and basic profile details.</p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <Link href="/" className="pill pill--ghost pill--small" style={{ textDecoration: 'none' }}>
                        ← Back to Graph
                    </Link>
                    <Link href="/profile-customization" className="pill pill--ghost pill--small" style={{ textDecoration: 'none' }}>
                        Profile Customization
                    </Link>
                </div>
            </header>

            {error && <div className="chat-error" style={{ marginBottom: 16 }}>{error}</div>}

            <div style={{ maxWidth: '600px' }}>
                <section className="control-card">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        <label className="field-label">
                            Full Name
                            <input
                                className="chat-input"
                                value={userProfile?.name || ''}
                                onChange={(e) => setUserProfile(prev => prev ? { ...prev, name: e.target.value } : null)}
                            />
                        </label>

                        <label className="field-label">
                            Email Address
                            <input
                                className="chat-input"
                                type="email"
                                value={(userProfile as any)?.email || ''}
                                onChange={(e) => setUserProfile(prev => prev ? { ...prev, email: e.target.value } as any : null)}
                                placeholder="Not set"
                            />
                        </label>

                        <div className="field-label">
                            Account Created
                            <div style={{ padding: '10px 12px', background: 'var(--surface)', borderRadius: '8px', color: 'var(--muted)', fontSize: '14px' }}>
                                {(userProfile as any)?.signup_date ? new Date((userProfile as any).signup_date).toLocaleDateString() : 'Unknown'}
                            </div>
                        </div>

                        <button
                            className="send-btn"
                            style={{ alignSelf: 'flex-start', marginTop: '8px' }}
                            onClick={handleSave}
                            disabled={saving}
                        >
                            {saving ? 'Saving…' : 'Save Changes'}
                        </button>
                    </div>
                </section>
            </div>
        </div>
    );
}
