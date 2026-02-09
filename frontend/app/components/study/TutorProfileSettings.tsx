
import React, { useState, useEffect } from 'react';
import { getTutorProfile, setTutorProfile, type TutorProfile } from '../../api-client';

export const AUDIENCE_MODES = [
    { value: 'default', label: 'Default (Balanced)' },
    { value: 'eli5', label: 'ELI5 (Simple & Concrete)' },
    { value: 'ceo_pitch', label: 'CEO Pitch (Executive Summary)' },
    { value: 'recruiter_interview', label: 'Recruiter Interview (STAR Method)' },
    { value: 'technical', label: 'Technical Deep Dive' },
];

export const VOICE_IDS = [
    { value: 'neutral', label: 'Neutral / Professional' },
    { value: 'friendly', label: 'Friendly / Warm' },
    { value: 'direct', label: 'Direct / Concise' },
    { value: 'playful', label: 'Playful / Energetic' },
];

export function TutorProfileSettings() {
    const [profile, setProfile] = useState<TutorProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadProfile();
    }, []);

    const loadProfile = async () => {
        try {
            setLoading(true);
            const data = await getTutorProfile();
            setProfile(data);
            setError(null);
        } catch (err) {
            console.error('Failed to load tutor profile:', err);
            // If 404/empty, set defaults
            setProfile({
                audience_mode: 'default',
                voice_id: 'neutral',
                no_glazing: false,
            } as any);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!profile) return;
        try {
            setSaving(true);
            await setTutorProfile(profile);
            setError(null);
            // Optional: show success toast
        } catch (err) {
            console.error('Failed to save profile:', err);
            setError('Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="p-4 text-gray-500">Loading preferences...</div>;
    }

    if (!profile) return null;

    return (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 max-w-md">
            <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <span>🎓</span> Tutor Persona
            </h2>

            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Audience Mode
                    </label>
                    <select
                        value={profile.audience_mode}
                        onChange={(e) => setProfile({ ...profile, audience_mode: e.target.value as any })}
                        className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-2 px-3 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    >
                        {AUDIENCE_MODES.map((mode) => (
                            <option key={mode.value} value={mode.value}>
                                {mode.label}
                            </option>
                        ))}
                    </select>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Adjusts the complexity and framing of explanations.
                    </p>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Voice & Tone
                    </label>
                    <select
                        value={profile.voice_id}
                        onChange={(e) => setProfile({ ...profile, voice_id: e.target.value as any })}
                        className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-2 px-3 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    >
                        {VOICE_IDS.map((voice) => (
                            <option key={voice.value} value={voice.value}>
                                {voice.label}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        id="no_glazing"
                        checked={profile.no_glazing || false}
                        onChange={(e) => setProfile({ ...profile, no_glazing: e.target.checked })}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <label htmlFor="no_glazing" className="text-sm text-gray-700 dark:text-gray-300">
                        "No Glazing" Mode (Be direct, correct errors immediately)
                    </label>
                </div>

                {error && (
                    <div className="text-red-500 text-xs">{error}</div>
                )}

                <div className="pt-2">
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className={`w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 ${saving ? 'opacity-70 cursor-not-allowed' : ''
                            }`}
                    >
                        {saving ? 'Saving...' : 'Save Preferences'}
                    </button>
                </div>
            </div>
        </div>
    );
}
