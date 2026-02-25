'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import {
  getResponseStyle,
  updateResponseStyle,
  getFocusAreas,
  upsertFocusArea,
  setFocusAreaActive,
  getUserProfile,
  updateUserProfile,
  getTutorProfile,
  setTutorProfile,
  getUIPreferences,
  updateUIPreferences,
  getGraphOverview,
  getAssistantProfile,
  patchAssistantProfile,
  getAssistantStylePrompt,
  ResponseStyleProfileWrapper,
  FocusArea,
  UserProfile,
  type TutorProfile,
  type UIPreferences,
  type ReminderPreferences,
  type AssistantProfile,
} from '../api-client';
import { getLastSession } from '../lib/sessionState';

const GRAPH_PREFETCH_LIMITS = { nodes: 200, edges: 400 };
const GRAPH_PREFETCH_STALE_MS = 60 * 1000;

type TutorProfileCompat = TutorProfile & {
  voice_id?: string | null;
  audience_mode?: string | null;
  response_mode?: string | null;
  ask_question_policy?: string | null;
};

type UserProfileCompat = UserProfile & {
  background?: string[] | null;
  weak_spots?: string[] | null;
};

export default function ControlPanelPage() {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [styleWrapper, setStyleWrapper] =
    useState<ResponseStyleProfileWrapper | null>(null);
  const [focusAreas, setFocusAreas] = useState<FocusArea[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfileCompat | null>(null);
  const [tutorProfile, setTutorProfileState] = useState<TutorProfileCompat | null>(
    null,
  );

  const [savingStyle, setSavingStyle] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingTutorProfile, setSavingTutorProfile] = useState(false);
  const [addingFocus, setAddingFocus] = useState(false);
  const [uiPreferences, setUIPreferences] = useState<UIPreferences | null>(null);
  const [savingReminders, setSavingReminders] = useState(false);
  const [assistantProfile, setAssistantProfile] = useState<AssistantProfile | null>(null);
  const [assistantStylePreview, setAssistantStylePreview] = useState('');
  const [savingAssistantProfile, setSavingAssistantProfile] = useState(false);
  const [loadingAssistantPreview, setLoadingAssistantPreview] = useState(false);

  const [newFocusName, setNewFocusName] = useState('');
  const [newFocusDescription, setNewFocusDescription] = useState('');

  useEffect(() => {
    const lastSession = getLastSession();
    const graphId = lastSession?.graph_id || 'default';
    queryClient.prefetchQuery({
      queryKey: ['graph', graphId, 'overview', GRAPH_PREFETCH_LIMITS.nodes, GRAPH_PREFETCH_LIMITS.edges],
      queryFn: () => getGraphOverview(graphId, GRAPH_PREFETCH_LIMITS.nodes, GRAPH_PREFETCH_LIMITS.edges),
      staleTime: GRAPH_PREFETCH_STALE_MS,
    }).catch(() => undefined);
  }, [queryClient]);

  useEffect(() => {
    async function loadAll() {
      try {
        setLoading(true);
        setError(null);

        const [
          styleRes,
          focusRes,
          profileRes,
          tutorProfileRes,
          uiPrefsRes,
          assistantRes,
        ] = await Promise.allSettled([
          getResponseStyle(),
          getFocusAreas(),
          getUserProfile(),
          getTutorProfile(),
          getUIPreferences(),
          getAssistantProfile(),
        ]);

        if (styleRes.status === 'fulfilled') {
          setStyleWrapper(styleRes.value);
        }
        if (focusRes.status === 'fulfilled') {
          setFocusAreas(focusRes.value);
        }
        if (profileRes.status === 'fulfilled') {
          setUserProfile(profileRes.value);
        }
        if (tutorProfileRes.status === 'fulfilled') {
          setTutorProfileState(tutorProfileRes.value);
        }
        if (uiPrefsRes.status === 'fulfilled') {
          setUIPreferences(uiPrefsRes.value);
        }
        if (assistantRes.status === 'fulfilled') {
          setAssistantProfile(assistantRes.value.profile);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load settings',
        );
      } finally {
        setLoading(false);
      }
    }

    loadAll();
  }, []);

  function listToString(list: string[] | undefined) {
    return (list || []).join(', ');
  }
  function stringToList(value: string): string[] {
    return value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }

  async function handleSaveStyle() {
    if (!styleWrapper) return;
    try {
      setSavingStyle(true);
      setError(null);
      const updated = await updateResponseStyle(styleWrapper);
      setStyleWrapper(updated);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to save style',
      );
    } finally {
      setSavingStyle(false);
    }
  }

  async function handleAddFocusArea() {
    if (!newFocusName.trim()) return;
    try {
      setAddingFocus(true);
      setError(null);
      const created = await upsertFocusArea({
        id: newFocusName.toLowerCase().replace(/\s+/g, '-'),
        name: newFocusName.trim(),
        description: newFocusDescription.trim() || undefined,
        active: true,
      });
      setFocusAreas(prev => [...prev, created]);
      setNewFocusName('');
      setNewFocusDescription('');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to add focus area',
      );
    } finally {
      setAddingFocus(false);
    }
  }

  async function handleToggleFocus(area: FocusArea) {
    try {
      const updated = await setFocusAreaActive(area.id, !area.active);
      setFocusAreas(prev =>
        prev.map(a => (a.id === updated.id ? updated : a)),
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to toggle focus area',
      );
    }
  }

  async function handleRemoveFocus(area: FocusArea) {
    if (!area.active) {
      setFocusAreas(prev => prev.filter(a => a.id !== area.id));
      return;
    }
    try {
      const updated = await setFocusAreaActive(area.id, false);
      setFocusAreas(prev =>
        prev.map(a => (a.id === updated.id ? updated : a)),
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to remove focus area',
      );
    }
  }

  async function handleSaveProfile() {
    if (!userProfile) return;
    try {
      setSavingProfile(true);
      setError(null);
      const updated = await updateUserProfile(userProfile);
      setUserProfile(updated);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to save profile',
      );
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleSaveTutorProfile() {
    if (!tutorProfile) return;
    try {
      setSavingTutorProfile(true);
      setError(null);
      const updated = await setTutorProfile(tutorProfile);
      setTutorProfileState(updated);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to save tutor profile',
      );
    } finally {
      setSavingTutorProfile(false);
    }
  }

  async function handleSaveAssistantProfile() {
    if (!assistantProfile) return;
    try {
      setSavingAssistantProfile(true);
      setError(null);
      const updated = await patchAssistantProfile(assistantProfile);
      setAssistantProfile(updated.profile);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to save assistant profile',
      );
    } finally {
      setSavingAssistantProfile(false);
    }
  }

  async function handleLoadAssistantStylePreview() {
    try {
      setLoadingAssistantPreview(true);
      setError(null);
      const prompt = await getAssistantStylePrompt();
      setAssistantStylePreview(prompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load style preview');
    } finally {
      setLoadingAssistantPreview(false);
    }
  }

  if (loading) {
    return (
      <div className="app-shell">
        <div className="loader">
          <div className="loader__ring" />
          <p className="loader__text">Loading Brain Control Panel…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell" style={{ padding: 24, overflow: 'auto' }}>
      <header
        className="graph-header"
        style={{ marginBottom: '16px', paddingBottom: 0 }}
      >
        <div>
          <p className="eyebrow">Profile Customization</p>
          <h1 className="title">Personalize Your AI</h1>
          <p className="subtitle">
            Tune how Brain Web interacts with you and shapes your learning experience.
          </p>
        </div>
        <div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link
              href="/settings"
              className="pill pill--ghost pill--small"
              style={{ cursor: 'pointer', textDecoration: 'none' }}
            >
              Account Settings
            </Link>
            <Link
              href="/source-management"
              className="pill pill--ghost pill--small"
              style={{ cursor: 'pointer', textDecoration: 'none' }}
            >
              Source Management
            </Link>
          </div>
        </div>
      </header>

      {error && <div className="chat-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1.4fr)',
          gap: '18px',
          alignItems: 'flex-start',
        }}
      >
        {/* LEFT COLUMN: Voice + Profile */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* Assistant Persona (OpenClaw-style per-user profile) */}
          <section className="control-card">
            <div className="control-header" style={{ marginBottom: 8 }}>
              <div>
                <span>Assistant Persona</span>
                <p className="subtitle" style={{ marginTop: 4 }}>
                  This is your in-product Bujji style across text and voice.
                </p>
              </div>
            </div>

            {assistantProfile && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label className="field-label">
                  Assistant name
                  <input
                    className="chat-input"
                    value={assistantProfile.assistant_name ?? ''}
                    onChange={e => setAssistantProfile(prev => (prev ? { ...prev, assistant_name: e.target.value } : prev))}
                  />
                </label>

                <label className="field-label">
                  Tone
                  <input
                    className="chat-input"
                    value={assistantProfile.tone ?? ''}
                    onChange={e => setAssistantProfile(prev => (prev ? { ...prev, tone: e.target.value } : prev))}
                  />
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <label className="field-label">
                    Verbosity
                    <select
                      className="chat-input"
                      value={assistantProfile.verbosity ?? 'balanced'}
                      onChange={e => setAssistantProfile(prev => (prev ? { ...prev, verbosity: e.target.value } : prev))}
                    >
                      <option value="concise">Concise</option>
                      <option value="balanced">Balanced</option>
                      <option value="detailed">Detailed</option>
                    </select>
                  </label>
                  <label className="field-label">
                    Teaching mode
                    <select
                      className="chat-input"
                      value={assistantProfile.teaching_mode ?? 'practical'}
                      onChange={e => setAssistantProfile(prev => (prev ? { ...prev, teaching_mode: e.target.value } : prev))}
                    >
                      <option value="practical">Practical</option>
                      <option value="socratic">Socratic</option>
                      <option value="deep_dive">Deep dive</option>
                    </select>
                  </label>
                </div>

                <label className="field-label">
                  Voice style
                  <input
                    className="chat-input"
                    value={assistantProfile.voice_style ?? ''}
                    onChange={e => setAssistantProfile(prev => (prev ? { ...prev, voice_style: e.target.value } : prev))}
                  />
                </label>

                <label className="field-label">
                  Constraints (comma-separated)
                  <input
                    className="chat-input"
                    value={listToString(assistantProfile.constraints ?? [])}
                    onChange={e => setAssistantProfile(prev => (prev ? { ...prev, constraints: stringToList(e.target.value) } : prev))}
                  />
                </label>

                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button
                    className="send-btn"
                    onClick={handleSaveAssistantProfile}
                    disabled={savingAssistantProfile}
                  >
                    {savingAssistantProfile ? 'Saving…' : 'Save assistant persona'}
                  </button>
                  <button
                    className="pill pill--ghost"
                    onClick={handleLoadAssistantStylePreview}
                    disabled={loadingAssistantPreview}
                  >
                    {loadingAssistantPreview ? 'Loading…' : 'Preview style prompt'}
                  </button>
                </div>

                {assistantStylePreview && (
                  <div style={{ marginTop: 8 }}>
                    <div className="field-label" style={{ marginBottom: 6 }}>Style preview</div>
                    <pre style={{
                      whiteSpace: 'pre-wrap',
                      fontSize: 12,
                      lineHeight: 1.4,
                      padding: 10,
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                      maxHeight: 180,
                      overflow: 'auto',
                    }}>
                      {assistantStylePreview}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Tutor Profile (Phase F) */}
          <section className="control-card">
            <div className="control-header" style={{ marginBottom: 8 }}>
              <div>
                <span>Tutor Profile</span>
                <p className="subtitle" style={{ marginTop: 4 }}>
                  Cross-modal behavior: voice tone, audience level, pacing, and turn-taking.
                </p>
              </div>
            </div>

            {tutorProfile && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label className="field-label">
                  Voice tone
                  <select
                    className="chat-input"
                    value={tutorProfile.voice_id ?? 'neutral'}
                    onChange={e =>
                      setTutorProfileState(prev =>
                        prev ? { ...prev, voice_id: e.target.value as any } : prev,
                      )
                    }
                  >
                    <option value="neutral">Neutral</option>
                    <option value="friendly">Friendly</option>
                    <option value="direct">Direct</option>
                    <option value="playful">Playful</option>
                  </select>
                </label>

                <label className="field-label">
                  Audience mode
                  <select
                    className="chat-input"
                    value={tutorProfile.audience_mode ?? 'default'}
                    onChange={e =>
                      setTutorProfileState(prev =>
                        prev ? { ...prev, audience_mode: e.target.value as any } : prev,
                      )
                    }
                  >
                    <option value="default">Default</option>
                    <option value="eli5">ELI5</option>
                    <option value="ceo_pitch">CEO pitch</option>
                    <option value="recruiter_interview">Recruiter interview</option>
                    <option value="technical">Technical</option>
                  </select>
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <label className="field-label">
                    Response depth
                    <select
                      className="chat-input"
                      value={tutorProfile.response_mode ?? 'normal'}
                      onChange={e =>
                        setTutorProfileState(prev =>
                          prev ? { ...prev, response_mode: e.target.value as any } : prev,
                        )
                      }
                    >
                      <option value="compact">Compact</option>
                      <option value="hint">Hint</option>
                      <option value="normal">Normal</option>
                      <option value="deep">Deep</option>
                    </select>
                  </label>
                  <label className="field-label">
                    Ask-question policy
                    <select
                      className="chat-input"
                      value={tutorProfile.ask_question_policy ?? 'ok'}
                      onChange={e =>
                        setTutorProfileState(prev =>
                          prev ? { ...prev, ask_question_policy: e.target.value as any } : prev,
                        )
                      }
                    >
                      <option value="never">Never</option>
                      <option value="at_most_one">At most one</option>
                      <option value="ok">OK</option>
                    </select>
                  </label>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <label className="field-label">
                    Pacing
                    <select
                      className="chat-input"
                      value={tutorProfile.pacing}
                      onChange={e =>
                        setTutorProfileState(prev =>
                          prev ? { ...prev, pacing: e.target.value as any } : prev,
                        )
                      }
                    >
                      <option value="slow">Slow</option>
                      <option value="normal">Normal</option>
                      <option value="fast">Fast</option>
                    </select>
                  </label>
                  <label className="field-label">
                    Turn-taking
                    <select
                      className="chat-input"
                      value={tutorProfile.turn_taking}
                      onChange={e =>
                        setTutorProfileState(prev =>
                          prev ? { ...prev, turn_taking: e.target.value as any } : prev,
                        )
                      }
                    >
                      <option value="normal">Normal</option>
                      <option value="no_interrupt">Don’t interrupt</option>
                    </select>
                  </label>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <label className="field-label">
                    End with next step
                    <select
                      className="chat-input"
                      value={tutorProfile.end_with_next_step ? 'on' : 'off'}
                      onChange={e =>
                        setTutorProfileState(prev =>
                          prev
                            ? { ...prev, end_with_next_step: e.target.value === 'on' }
                            : prev,
                        )
                      }
                    >
                      <option value="on">On</option>
                      <option value="off">Off</option>
                    </select>
                  </label>
                  <label className="field-label">
                    No glazing (direct correctness)
                    <select
                      className="chat-input"
                      value={tutorProfile.no_glazing ? 'on' : 'off'}
                      onChange={e =>
                        setTutorProfileState(prev =>
                          prev ? { ...prev, no_glazing: e.target.value === 'on' } : prev,
                        )
                      }
                    >
                      <option value="on">On</option>
                      <option value="off">Off</option>
                    </select>
                  </label>
                </div>

                <button
                  className="send-btn"
                  style={{ alignSelf: 'flex-start', marginTop: 4 }}
                  onClick={handleSaveTutorProfile}
                  disabled={savingTutorProfile}
                >
                  {savingTutorProfile ? 'Saving…' : 'Save tutor profile'}
                </button>
              </div>
            )}
          </section>

          {/* System Instructions */}
          <section className="control-card">
            <div className="control-header" style={{ marginBottom: 8 }}>
              <div>
                <span>System Instructions</span>
                <p className="subtitle" style={{ marginTop: 4 }}>
                  Shape how Brain Web explains things and structures its responses.
                </p>
              </div>
            </div>

            {styleWrapper && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label className="field-label">
                  Tone
                  <textarea
                    className="chat-input"
                    rows={2}
                    value={styleWrapper.profile.tone}
                    onChange={e =>
                      setStyleWrapper(prev =>
                        prev
                          ? {
                            ...prev,
                            profile: {
                              ...prev.profile,
                              tone: e.target.value,
                            },
                          }
                          : prev,
                      )
                    }
                  />
                </label>
                <label className="field-label">
                  Teaching style
                  <textarea
                    className="chat-input"
                    rows={2}
                    value={styleWrapper.profile.teaching_style}
                    onChange={e =>
                      setStyleWrapper(prev =>
                        prev
                          ? {
                            ...prev,
                            profile: {
                              ...prev.profile,
                              teaching_style: e.target.value,
                            },
                          }
                          : prev,
                      )
                    }
                  />
                </label>
                <label className="field-label">
                  Sentence structure
                  <input
                    className="chat-input"
                    value={styleWrapper.profile.sentence_structure}
                    onChange={e =>
                      setStyleWrapper(prev =>
                        prev
                          ? {
                            ...prev,
                            profile: {
                              ...prev.profile,
                              sentence_structure: e.target.value,
                            },
                          }
                          : prev,
                      )
                    }
                  />
                </label>
                <label className="field-label">
                  Explanation order (comma-separated)
                  <input
                    className="chat-input"
                    value={listToString(
                      styleWrapper.profile.explanation_order,
                    )}
                    onChange={e =>
                      setStyleWrapper(prev =>
                        prev
                          ? {
                            ...prev,
                            profile: {
                              ...prev.profile,
                              explanation_order: stringToList(
                                e.target.value,
                              ),
                            },
                          }
                          : prev,
                      )
                    }
                  />
                </label>
                <label className="field-label">
                  Forbidden styles (comma-separated)
                  <input
                    className="chat-input"
                    value={listToString(
                      styleWrapper.profile.forbidden_styles,
                    )}
                    onChange={e =>
                      setStyleWrapper(prev =>
                        prev
                          ? {
                            ...prev,
                            profile: {
                              ...prev.profile,
                              forbidden_styles: stringToList(
                                e.target.value,
                              ),
                            },
                          }
                          : prev,
                      )
                    }
                  />
                </label>

                <button
                  className="send-btn"
                  style={{ alignSelf: 'flex-start', marginTop: 4 }}
                  onClick={handleSaveStyle}
                  disabled={savingStyle}
                >
                  {savingStyle ? 'Saving…' : 'Save instructions'}
                </button>
              </div>
            )}
          </section>


          {/* User Profile */}
          <section className="control-card">
            <div className="control-header" style={{ marginBottom: 8 }}>
              <div>
                <span>User Profile</span>
                <p className="subtitle" style={{ marginTop: 4 }}>
                  Personal details, interests, and background. Dynamically updated from your interactions.
                </p>
              </div>
            </div>

            {userProfile && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label className="field-label">
                  Background (comma-separated)
                  <input
                    className="chat-input"
                    value={listToString(userProfile.background ?? [])}
                    onChange={e =>
                      setUserProfile(prev =>
                        prev
                          ? {
                            ...prev,
                            background: stringToList(e.target.value),
                          }
                          : prev,
                      )
                    }
                  />
                </label>
                <label className="field-label">
                  Interests (comma-separated)
                  <input
                    className="chat-input"
                    value={listToString(userProfile.interests)}
                    onChange={e =>
                      setUserProfile(prev =>
                        prev
                          ? {
                            ...prev,
                            interests: stringToList(e.target.value),
                          }
                          : prev,
                      )
                    }
                  />
                </label>
                <label className="field-label">
                  Weak spots (comma-separated)
                  <input
                    className="chat-input"
                    value={listToString(userProfile.weak_spots ?? [])}
                    onChange={e =>
                      setUserProfile(prev =>
                        prev
                          ? {
                            ...prev,
                            weak_spots: stringToList(e.target.value),
                          }
                          : prev,
                      )
                    }
                  />
                </label>
                <label className="field-label">
                  Learning preferences (JSON)
                  <textarea
                    className="chat-input"
                    rows={3}
                    value={JSON.stringify(
                      userProfile.learning_preferences || {},
                      null,
                      2,
                    )}
                    onChange={e => {
                      try {
                        const parsed = JSON.parse(e.target.value || '{}');
                        setUserProfile(prev =>
                          prev
                            ? {
                              ...prev,
                              learning_preferences: parsed,
                            }
                            : prev,
                        );
                        setError(null);
                      } catch (jsonErr) {
                        setError('Learning preferences must be valid JSON');
                      }
                    }}
                  />
                </label>

                <button
                  className="send-btn"
                  style={{ alignSelf: 'flex-start', marginTop: 4 }}
                  onClick={handleSaveProfile}
                  disabled={savingProfile}
                >
                  {savingProfile ? 'Saving…' : 'Save profile'}
                </button>
              </div>
            )}
          </section>
        </div>

        {/* RIGHT COLUMN: Focus + Notion sync */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* Focus areas */}
          <section className="control-card control-card--legend">
            <div className="control-header" style={{ marginBottom: 8 }}>
              <div>
                <span>Dynamic Focus</span>
                <p className="subtitle" style={{ marginTop: 4 }}>
                  Topics Brain Web is currently leaning toward based on your recent activity.
                </p>
              </div>
            </div>

            <div className="legend">
              {focusAreas.length === 0 ? (
                <p className="subtitle" style={{ fontStyle: 'italic' }}>No active focus areas. Start a conversation to build focus.</p>
              ) : (
                focusAreas.map(area => (
                  <div key={area.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <div
                      className={`pill ${area.active ? 'pill--active' : ''
                        }`}
                    >
                      {area.name}
                    </div>
                  </div>
                ))
              )}
            </div>

          </section>


        </div>
      </div>
    </div>
  );
}
