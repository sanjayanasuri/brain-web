
import React, { useState, useEffect } from 'react';
import { getUserProfile, updateUserProfile, type UserProfile } from '../../api-client';

export function UserProfileSettings() {
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadProfile();
    }, []);

    const loadProfile = async () => {
        try {
            setLoading(true);
            const data = await getUserProfile();
            setProfile(data);
            setError(null);
        } catch (err) {
            console.error('Failed to load user profile:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!profile) return;
        try {
            setSaving(true);
            await updateUserProfile(profile);
            setError(null);
        } catch (err) {
            console.error('Failed to save profile:', err);
            setError('Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    const removeTag = (tag: string) => {
        if (!profile) return;
        const newTags = { ...profile.inferred_knowledge_tags };
        delete newTags[tag];
        setProfile({ ...profile, inferred_knowledge_tags: newTags });
    };

    const removeWeakArea = (area: string) => {
        if (!profile) return;
        setProfile({
            ...profile,
            weak_areas: profile.weak_areas.filter((a: string) => a !== area)
        });
    };

    if (loading) return <div className="p-8 text-center text-gray-400">Loading your profile...</div>;
    if (!profile) return null;

    return (
        <div className="space-y-8 max-w-2xl">
            {/* Header */}
            <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                    <span className="text-3xl">👤</span> User Profile
                </h2>
                <p className="text-gray-500 dark:text-gray-400 mt-1">
                    Manage what the AI knows about your goals and background.
                </p>
            </div>

            {/* Explicit Info */}
            <div className="space-y-6">
                <div className="bg-white dark:bg-gray-900/50 p-6 rounded-xl border border-gray-200 dark:border-white/10">
                    <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">
                        Learning Goals
                    </label>
                    <textarea
                        value={profile.learning_goals || ''}
                        onChange={(e) => setProfile({ ...profile, learning_goals: e.target.value })}
                        placeholder="e.g. Master React and Next.js to build a SaaS startup."
                        rows={3}
                        className="w-full rounded-xl border-gray-200 dark:border-white/10 bg-white dark:bg-black py-3 px-4 text-sm focus:ring-2 focus:ring-indigo-500"
                    />
                </div>

                <div className="bg-white dark:bg-gray-900/50 p-6 rounded-xl border border-gray-200 dark:border-white/10">
                    <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">
                        Domain Background
                    </label>
                    <textarea
                        value={profile.domain_background || ''}
                        onChange={(e) => setProfile({ ...profile, domain_background: e.target.value })}
                        placeholder="e.g. Professional Python developer with 5 years experience, but new to frontend."
                        rows={3}
                        className="w-full rounded-xl border-gray-200 dark:border-white/10 bg-white dark:bg-black py-3 px-4 text-sm focus:ring-2 focus:ring-indigo-500"
                    />
                </div>
            </div>

            {/* Inferred Data Section (The Transparency Panel) */}
            <div className="bg-white dark:bg-gray-900/50 p-6 rounded-xl border border-gray-200 dark:border-white/10">
                <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400 mb-4 flex items-center gap-2">
                    <span>🧠</span> What I've Learned About You
                </h3>

                {/* Knowledge Tags */}
                <div className="mb-6">
                    <label className="block text-xs font-semibold text-gray-500 mb-2">Mastered Concepts</label>
                    <div className="flex flex-wrap gap-2">
                        {Object.entries(profile.inferred_knowledge_tags || {}).length === 0 && (
                            <p className="text-xs text-gray-500 italic">No concepts mapped yet.</p>
                        )}
                        {Object.entries(profile.inferred_knowledge_tags || {}).map(([tag, status]) => (
                            <div key={tag} className="flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 px-3 py-1 rounded-full text-xs font-medium group">
                                <span>{tag}</span>
                                <span className="text-[10px] opacity-60">({status})</span>
                                <button onClick={() => removeTag(tag)} className="hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Weak Areas */}
                <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-2">Areas for Improvement</label>
                    <div className="flex flex-wrap gap-2">
                        {profile.weak_areas?.length === 0 && (
                            <p className="text-xs text-gray-500 italic">No specific weak areas detected.</p>
                        )}
                        {profile.weak_areas?.map((area) => (
                            <div key={area} className="flex items-center gap-1.5 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 px-3 py-1 rounded-full text-xs font-medium group">
                                <span>{area}</span>
                                <button onClick={() => removeWeakArea(area)} className="hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                            </div>
                        ))}
                    </div>
                </div>
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
                    {saving ? 'Saving...' : 'Save Profile'}
                </button>
            </div>
        </div >
    );
}
