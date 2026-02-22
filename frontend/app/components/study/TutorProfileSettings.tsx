
import React, { useState, useEffect } from 'react';
import { getTutorProfile, setTutorProfile, type TutorProfile, type ComprehensionLevel, type Tone, type Pacing, type TurnTaking, type ResponseLength } from '../../api-client';

export const COMPREHENSION_LEVELS: { value: ComprehensionLevel; label: string; desc: string }[] = [
    { value: 'beginner', label: 'Beginner', desc: 'Simple vocabulary, no jargon, focus on analogies.' },
    { value: 'intermediate', label: 'Intermediate', desc: 'Balanced complexity for general learning.' },
    { value: 'advanced', label: 'Advanced', desc: 'Technical vocabulary, assumes core knowledge.' },
    { value: 'expert', label: 'Expert', desc: 'Peer-to-peer technical depth.' },
];

export const TONES: { value: Tone; label: string }[] = [
    { value: 'casual', label: 'Casual & Relatable' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'formal', label: 'Formal & Academic' },
    { value: 'encouraging', label: 'Encouraging & Patient' },
];

export const PACING_OPTIONS: { value: Pacing; label: string }[] = [
    { value: 'slow', label: 'Slow (Deliberate)' },
    { value: 'moderate', label: 'Moderate' },
    { value: 'fast', label: 'Fast (Rapid Fire)' },
];

export const TURN_TAKING_OPTIONS: { value: TurnTaking; label: string; desc: string }[] = [
    { value: 'socratic', label: 'Socratic', desc: 'Asks probing questions to guide you.' },
    { value: 'lecture', label: 'Lecture', desc: 'Longer, deep-dive explanations.' },
    { value: 'dialogic', label: 'Dialogic', desc: 'A natural back-and-forth.' },
    { value: 'on_demand', label: 'On Demand', desc: 'Only speaks when you ask.' },
];

export const RESPONSE_LENGTHS: { value: ResponseLength; label: string }[] = [
    { value: 'concise', label: 'Concise (Brief)' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'detailed', label: 'Detailed (Verbose)' },
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
            // Default profile if load fails
            setProfile({
                version: 'tutor_profile_v2',
                comprehension_level: 'intermediate',
                tone: 'balanced',
                pacing: 'moderate',
                turn_taking: 'dialogic',
                response_length: 'balanced',
                no_glazing: true,
                end_with_next_step: true,
                custom_instructions: ''
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
        } catch (err) {
            console.error('Failed to save profile:', err);
            setError('Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="p-8 text-center text-gray-400">Initializing persona...</div>;
    }

    if (!profile) return null;

    return (
        <div className="space-y-8 max-w-2xl">
            {/* Header */}
            <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                    <span className="text-3xl">🎓</span> AI Tutor Configuration
                </h2>
                <p className="text-gray-500 dark:text-gray-400 mt-1">
                    Fine-tune how your tutor explains, interacts, and paces the session.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Comprehension Level */}
                <div className="bg-white dark:bg-gray-900/50 p-5 rounded-xl border border-gray-200 dark:border-white/10">
                    <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-3">
                        Comprehension Level
                    </label>
                    <div className="space-y-3">
                        {COMPREHENSION_LEVELS.map((opt) => (
                            <div
                                key={opt.value}
                                onClick={() => setProfile({ ...profile, comprehension_level: opt.value })}
                                className={`cursor-pointer group p-3 rounded-lg border transition-all ${profile.comprehension_level === opt.value
                                    ? 'bg-indigo-50 border-indigo-500 ring-1 ring-indigo-500'
                                    : 'border-transparent hover:bg-gray-50 dark:hover:bg-white/5'
                                    }`}
                            >
                                <div className="flex justify-between items-center">
                                    <span className={`text-sm font-medium ${profile.comprehension_level === opt.value ? 'text-indigo-700' : 'text-gray-700 dark:text-gray-300'}`}>
                                        {opt.label}
                                    </span>
                                    {profile.comprehension_level === opt.value && <div className="w-2 h-2 rounded-full bg-indigo-500" />}
                                </div>
                                <p className="text-xs text-gray-500 mt-1">{opt.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Turn Taking Strategy */}
                <div className="bg-white dark:bg-gray-900/50 p-5 rounded-xl border border-gray-200 dark:border-white/10">
                    <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-3">
                        Turn Taking Style
                    </label>
                    <div className="space-y-3">
                        {TURN_TAKING_OPTIONS.map((opt) => (
                            <div
                                key={opt.value}
                                onClick={() => setProfile({ ...profile, turn_taking: opt.value })}
                                className={`cursor-pointer group p-3 rounded-lg border transition-all ${profile.turn_taking === opt.value
                                    ? 'bg-emerald-50 border-emerald-500 ring-1 ring-emerald-500'
                                    : 'border-transparent hover:bg-gray-50 dark:hover:bg-white/5'
                                    }`}
                            >
                                <span className={`text-sm font-medium block ${profile.turn_taking === opt.value ? 'text-emerald-700' : 'text-gray-700 dark:text-gray-300'}`}>
                                    {opt.label}
                                </span>
                                <p className="text-xs text-gray-500 mt-1">{opt.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="bg-white dark:bg-gray-900/50 p-6 rounded-xl border border-gray-200 dark:border-white/10 grid grid-cols-1 sm:grid-cols-3 gap-6">
                {/* Tone */}
                <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Tone</label>
                    <select
                        value={profile.tone ?? 'balanced'}
                        onChange={(e) => setProfile({ ...profile, tone: e.target.value as any })}
                        className="w-full rounded-lg border-gray-200 dark:border-white/10 bg-white dark:bg-black py-2.5 px-3 text-sm focus:ring-2 focus:ring-indigo-500"
                    >
                        {TONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                </div>
                {/* Pacing */}
                <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Pacing</label>
                    <select
                        value={profile.pacing ?? 'moderate'}
                        onChange={(e) => setProfile({ ...profile, pacing: e.target.value as any })}
                        className="w-full rounded-lg border-gray-200 dark:border-white/10 bg-white dark:bg-black py-2.5 px-3 text-sm focus:ring-2 focus:ring-indigo-500"
                    >
                        {PACING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </div>
                {/* Length */}
                <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Length</label>
                    <select
                        value={profile.response_length ?? 'balanced'}
                        onChange={(e) => setProfile({ ...profile, response_length: e.target.value as any })}
                        className="w-full rounded-lg border-gray-200 dark:border-white/10 bg-white dark:bg-black py-2.5 px-3 text-sm focus:ring-2 focus:ring-indigo-500"
                    >
                        {RESPONSE_LENGTHS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                    </select>
                </div>
            </div>

            {/* Custom Instructions */}
            <div className="bg-white dark:bg-gray-900/50 p-6 rounded-xl border border-gray-200 dark:border-white/10">
                <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">
                    Custom Identity Overwrite
                </label>
                <p className="text-xs text-gray-500 mb-4">
                    Provide a specific persona or rules in natural language. This will override the structured settings above.
                </p>
                <textarea
                    value={profile.custom_instructions || ''}
                    onChange={(e) => setProfile({ ...profile, custom_instructions: e.target.value })}
                    placeholder="e.g. 'Speak like a 1920s detective while teaching me quantum physics...'"
                    rows={4}
                    className="w-full rounded-xl border-gray-200 dark:border-white/10 bg-white dark:bg-black py-3 px-4 text-sm focus:ring-2 focus:ring-indigo-500 font-mono"
                />
            </div>

            {/* Behavioral Checks */}
            <div className="flex flex-wrap gap-6 items-center px-2">
                <label className="flex items-center gap-3 cursor-pointer group">
                    <div className="relative">
                        <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={profile.no_glazing}
                            onChange={(e) => setProfile({ ...profile, no_glazing: e.target.checked })}
                        />
                        <div className="w-10 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 dark:peer-focus:ring-indigo-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-indigo-600"></div>
                    </div>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">No Glazing (Direct Feedback)</span>
                </label>

                <label className="flex items-center gap-3 cursor-pointer group">
                    <div className="relative">
                        <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={profile.end_with_next_step}
                            onChange={(e) => setProfile({ ...profile, end_with_next_step: e.target.checked })}
                        />
                        <div className="w-10 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 dark:peer-focus:ring-indigo-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-indigo-600"></div>
                    </div>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Suggest Next Steps</span>
                </label>
            </div>

            {/* Save Button */}
            <div className="pt-6 border-t border-gray-100 dark:border-white/5 flex items-center justify-between">
                <div>
                    {error && <p className="text-red-500 text-sm font-medium">⚠️ {error}</p>}
                </div>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-10 rounded-xl shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-50 flex items-center gap-2"
                >
                    {saving ? 'Syncing...' : 'Apply Persona'}
                </button>
            </div>
        </div>
    );
}
