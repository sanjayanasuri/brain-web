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
  getTeachingStyle,
  recomputeTeachingStyle,
  getUIPreferences,
  updateUIPreferences,
  getGraphOverview,
  ResponseStyleProfileWrapper,
  FocusArea,
  UserProfile,
  TeachingStyleProfile,
  type UIPreferences,
  type ReminderPreferences,
} from '../api-client';
import { getLastSession } from '../lib/sessionState';

const GRAPH_PREFETCH_LIMITS = { nodes: 200, edges: 400 };
const GRAPH_PREFETCH_STALE_MS = 60 * 1000;

export default function ControlPanelPage() {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [styleWrapper, setStyleWrapper] =
    useState<ResponseStyleProfileWrapper | null>(null);
  const [teachingStyle, setTeachingStyle] = useState<TeachingStyleProfile | null>(null);
  const [focusAreas, setFocusAreas] = useState<FocusArea[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  const [savingStyle, setSavingStyle] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [addingFocus, setAddingFocus] = useState(false);
  const [recomputingStyle, setRecomputingStyle] = useState(false);
  const [uiPreferences, setUIPreferences] = useState<UIPreferences | null>(null);
  const [savingReminders, setSavingReminders] = useState(false);

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
          teachingStyleRes,
          focusRes,
          profileRes,
          uiPrefsRes,
        ] = await Promise.allSettled([
          getResponseStyle(),
          getTeachingStyle(),
          getFocusAreas(),
          getUserProfile(),
          getUIPreferences(),
        ]);

        if (styleRes.status === 'fulfilled') {
          setStyleWrapper(styleRes.value);
        }
        if (teachingStyleRes.status === 'fulfilled') {
          setTeachingStyle(teachingStyleRes.value);
        }
        if (focusRes.status === 'fulfilled') {
          setFocusAreas(focusRes.value);
        }
        if (profileRes.status === 'fulfilled') {
          setUserProfile(profileRes.value);
        }
        if (uiPrefsRes.status === 'fulfilled') {
          setUIPreferences(uiPrefsRes.value);
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
          <h1 className="title">Customize Your Brain Web</h1>
          <p className="subtitle">
            Tune how Brain Web talks, what it focuses on, and personalize your learning experience.
          </p>
        </div>
        <div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link
              href="/"
              className="pill pill--ghost pill--small"
              style={{ cursor: 'pointer', textDecoration: 'none' }}
            >
              ← Back to Graph
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
          {/* Your Voice */}
          <section className="control-card">
            <div className="control-header" style={{ marginBottom: 8 }}>
              <div>
                <span>Your Voice</span>
                <p className="subtitle" style={{ marginTop: 4 }}>
                  Shape how Brain Web explains things.
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
                  {savingStyle ? 'Saving…' : 'Save voice'}
                </button>
              </div>
            )}
          </section>

          {/* Teaching Style Profile */}
          <section className="control-card">
            <div className="control-header" style={{ marginBottom: 8 }}>
              <div>
                <span>Teaching Style Profile</span>
                <p className="subtitle" style={{ marginTop: 4 }}>
                  Automatically learned from your lectures. Used to shape chat and drafts.
                </p>
              </div>
            </div>

            {teachingStyle && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{
                  padding: '12px',
                  background: 'rgba(17, 138, 178, 0.05)',
                  borderRadius: '8px',
                  border: '1px solid rgba(17, 138, 178, 0.2)',
                }}>
                  <div style={{ marginBottom: '8px' }}>
                    <strong style={{ fontSize: '12px', color: 'var(--muted)' }}>Tone:</strong>
                    <div style={{ fontSize: '14px', marginTop: '4px' }}>{teachingStyle.tone}</div>
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <strong style={{ fontSize: '12px', color: 'var(--muted)' }}>Teaching style:</strong>
                    <div style={{ fontSize: '14px', marginTop: '4px' }}>{teachingStyle.teaching_style}</div>
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <strong style={{ fontSize: '12px', color: 'var(--muted)' }}>Sentence structure:</strong>
                    <div style={{ fontSize: '14px', marginTop: '4px' }}>{teachingStyle.sentence_structure}</div>
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <strong style={{ fontSize: '12px', color: 'var(--muted)' }}>Explanation order:</strong>
                    <div style={{ fontSize: '14px', marginTop: '4px' }}>
                      {teachingStyle.explanation_order.join(' → ')}
                    </div>
                  </div>
                  <div>
                    <strong style={{ fontSize: '12px', color: 'var(--muted)' }}>Forbidden styles:</strong>
                    <div style={{ fontSize: '14px', marginTop: '4px' }}>
                      {teachingStyle.forbidden_styles.join(', ')}
                    </div>
                  </div>
                </div>

                <button
                  className="send-btn"
                  style={{ alignSelf: 'flex-start' }}
                  onClick={async () => {
                    try {
                      setRecomputingStyle(true);
                      setError(null);
                      const updated = await recomputeTeachingStyle(5);
                      setTeachingStyle(updated);
                    } catch (err) {
                      setError(
                        err instanceof Error ? err.message : 'Failed to recompute teaching style',
                      );
                    } finally {
                      setRecomputingStyle(false);
                    }
                  }}
                  disabled={recomputingStyle}
                >
                  {recomputingStyle ? 'Recomputing…' : 'Recompute from recent lectures'}
                </button>
                <p style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '-8px' }}>
                  Analyzes your 5 most recent lectures to update your teaching style profile.
                </p>
              </div>
            )}
          </section>

          {/* You as a learner */}
          <section className="control-card">
            <div className="control-header" style={{ marginBottom: 8 }}>
              <div>
                <span>You as a learner</span>
                <p className="subtitle" style={{ marginTop: 4 }}>
                  Background, interests, and weak spots.
                </p>
              </div>
            </div>

            {userProfile && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label className="field-label">
                  Name
                  <input
                    className="chat-input"
                    value={userProfile.name}
                    onChange={e =>
                      setUserProfile(prev =>
                        prev ? { ...prev, name: e.target.value } : prev,
                      )
                    }
                  />
                </label>
                <label className="field-label">
                  Background (comma-separated)
                  <input
                    className="chat-input"
                    value={listToString(userProfile.background)}
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
                    value={listToString(userProfile.weak_spots)}
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
                  {savingProfile ? 'Saving…' : 'Save learner profile'}
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
                <span>Current focus</span>
                <p className="subtitle" style={{ marginTop: 4 }}>
                  What you want Brain Web to lean toward right now.
                </p>
              </div>
            </div>

            <div className="legend">
              {focusAreas.map(area => (
                <div key={area.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button
                    className={`pill ${
                      area.active ? 'pill--active' : ''
                    }`}
                    onClick={() => handleToggleFocus(area)}
                  >
                    {area.name}
                  </button>
                  <button
                    className="pill pill--ghost pill--small"
                    onClick={() => handleRemoveFocus(area)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <div
              style={{
                marginTop: 12,
                borderTop: '1px solid var(--border)',
                paddingTop: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <p
                className="eyebrow"
                style={{ fontSize: 11, textTransform: 'none' }}
              >
                Add a new focus area
              </p>
              <input
                className="chat-input"
                placeholder="e.g. Distributed Systems"
                value={newFocusName}
                onChange={e => setNewFocusName(e.target.value)}
              />
              <input
                className="chat-input"
                placeholder="Optional description"
                value={newFocusDescription}
                onChange={e => setNewFocusDescription(e.target.value)}
              />
              <button
                className="pill"
                style={{ alignSelf: 'flex-start' }}
                onClick={handleAddFocusArea}
                disabled={addingFocus}
              >
                {addingFocus ? 'Adding…' : 'Add focus area'}
              </button>
            </div>
          </section>

          {/* Reminder Preferences */}
          <section className="control-card control-card--legend">
            <div className="control-header" style={{ marginBottom: 8 }}>
              <div>
                <span>Reminders</span>
                <p className="subtitle" style={{ marginTop: 4 }}>
                  Optional in-app reminders for digest, review queue, and finance snapshots.
                </p>
              </div>
            </div>

            {uiPreferences && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Weekly Digest */}
                <div style={{
                  padding: '12px',
                  background: 'var(--background)',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={uiPreferences.reminders?.weekly_digest?.enabled || false}
                      onChange={(e) => {
                        setUIPreferences(prev => prev ? {
                          ...prev,
                          reminders: {
                            ...(prev.reminders || {
                              weekly_digest: { enabled: false, day_of_week: 1, hour: 9 },
                              review_queue: { enabled: false, cadence_days: 3 },
                              finance_stale: { enabled: false, cadence_days: 7 },
                            }),
                            weekly_digest: {
                              ...(prev.reminders?.weekly_digest || { enabled: false, day_of_week: 1, hour: 9 }),
                              enabled: e.target.checked,
                            },
                          },
                        } : null);
                      }}
                      style={{ cursor: 'pointer' }}
                    />
                    <span style={{ fontWeight: '600', fontSize: '14px' }}>Weekly digest reminder</span>
                  </label>
                  {uiPreferences.reminders?.weekly_digest?.enabled && (
                    <div style={{ marginLeft: '24px', marginTop: '8px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        Day:
                        <select
                          value={uiPreferences.reminders.weekly_digest.day_of_week || 1}
                          onChange={(e) => {
                            setUIPreferences(prev => prev ? {
                              ...prev,
                              reminders: {
                                ...(prev.reminders || {
                                  weekly_digest: { enabled: false, day_of_week: 1, hour: 9 },
                                  review_queue: { enabled: false, cadence_days: 3 },
                                  finance_stale: { enabled: false, cadence_days: 7 },
                                }),
                                weekly_digest: {
                                  ...(prev.reminders?.weekly_digest || { enabled: true, day_of_week: 1, hour: 9 }),
                                  day_of_week: parseInt(e.target.value),
                                },
                              },
                            } : null);
                          }}
                          style={{ padding: '2px 4px', fontSize: '12px' }}
                        >
                          <option value={1}>Monday</option>
                          <option value={2}>Tuesday</option>
                          <option value={3}>Wednesday</option>
                          <option value={4}>Thursday</option>
                          <option value={5}>Friday</option>
                          <option value={6}>Saturday</option>
                          <option value={7}>Sunday</option>
                        </select>
                      </label>
                      <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        Hour:
                        <input
                          type="number"
                          min="0"
                          max="23"
                          value={uiPreferences.reminders.weekly_digest.hour || 9}
                          onChange={(e) => {
                            setUIPreferences(prev => prev ? {
                              ...prev,
                              reminders: {
                                ...(prev.reminders || {
                                  weekly_digest: { enabled: false, day_of_week: 1, hour: 9 },
                                  review_queue: { enabled: false, cadence_days: 3 },
                                  finance_stale: { enabled: false, cadence_days: 7 },
                                }),
                                weekly_digest: {
                                  ...(prev.reminders?.weekly_digest || { enabled: true, day_of_week: 1, hour: 9 }),
                                  hour: parseInt(e.target.value) || 9,
                                },
                              },
                            } : null);
                          }}
                          style={{ width: '50px', padding: '2px 4px', fontSize: '12px' }}
                        />
                      </label>
                    </div>
                  )}
                </div>

                {/* Review Queue */}
                <div style={{
                  padding: '12px',
                  background: 'var(--background)',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={uiPreferences.reminders?.review_queue?.enabled || false}
                      onChange={(e) => {
                        setUIPreferences(prev => prev ? {
                          ...prev,
                          reminders: {
                            ...(prev.reminders || {
                              weekly_digest: { enabled: false, day_of_week: 1, hour: 9 },
                              review_queue: { enabled: false, cadence_days: 3 },
                              finance_stale: { enabled: false, cadence_days: 7 },
                            }),
                            review_queue: {
                              ...(prev.reminders?.review_queue || { enabled: false, cadence_days: 3 }),
                              enabled: e.target.checked,
                            },
                          },
                        } : null);
                      }}
                      style={{ cursor: 'pointer' }}
                    />
                    <span style={{ fontWeight: '600', fontSize: '14px' }}>Review queue reminder</span>
                  </label>
                  {uiPreferences.reminders?.review_queue?.enabled && (
                    <div style={{ marginLeft: '24px', marginTop: '8px' }}>
                      <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        Remind every:
                        <input
                          type="number"
                          min="1"
                          value={uiPreferences.reminders.review_queue.cadence_days || 3}
                          onChange={(e) => {
                            setUIPreferences(prev => prev ? {
                              ...prev,
                              reminders: {
                                ...(prev.reminders || {
                                  weekly_digest: { enabled: false, day_of_week: 1, hour: 9 },
                                  review_queue: { enabled: false, cadence_days: 3 },
                                  finance_stale: { enabled: false, cadence_days: 7 },
                                }),
                                review_queue: {
                                  ...(prev.reminders?.review_queue || { enabled: true, cadence_days: 3 }),
                                  cadence_days: parseInt(e.target.value) || 3,
                                },
                              },
                            } : null);
                          }}
                          style={{ width: '50px', padding: '2px 4px', fontSize: '12px' }}
                        />
                        days
                      </label>
                    </div>
                  )}
                </div>

                {/* Finance Stale */}
                <div style={{
                  padding: '12px',
                  background: 'var(--background)',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={uiPreferences.reminders?.finance_stale?.enabled || false}
                      onChange={(e) => {
                        setUIPreferences(prev => prev ? {
                          ...prev,
                          reminders: {
                            ...(prev.reminders || {
                              weekly_digest: { enabled: false, day_of_week: 1, hour: 9 },
                              review_queue: { enabled: false, cadence_days: 3 },
                              finance_stale: { enabled: false, cadence_days: 7 },
                            }),
                            finance_stale: {
                              ...(prev.reminders?.finance_stale || { enabled: false, cadence_days: 7 }),
                              enabled: e.target.checked,
                            },
                          },
                        } : null);
                      }}
                      style={{ cursor: 'pointer' }}
                    />
                    <span style={{ fontWeight: '600', fontSize: '14px' }}>Finance stale snapshot reminder</span>
                  </label>
                  {uiPreferences.reminders?.finance_stale?.enabled && (
                    <div style={{ marginLeft: '24px', marginTop: '8px' }}>
                      <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        Remind every:
                        <input
                          type="number"
                          min="1"
                          value={uiPreferences.reminders.finance_stale.cadence_days || 7}
                          onChange={(e) => {
                            setUIPreferences(prev => prev ? {
                              ...prev,
                              reminders: {
                                ...(prev.reminders || {
                                  weekly_digest: { enabled: false, day_of_week: 1, hour: 9 },
                                  review_queue: { enabled: false, cadence_days: 3 },
                                  finance_stale: { enabled: false, cadence_days: 7 },
                                }),
                                finance_stale: {
                                  ...(prev.reminders?.finance_stale || { enabled: true, cadence_days: 7 }),
                                  cadence_days: parseInt(e.target.value) || 7,
                                },
                              },
                            } : null);
                          }}
                          style={{ width: '50px', padding: '2px 4px', fontSize: '12px' }}
                        />
                        days
                      </label>
                    </div>
                  )}
                </div>

                <button
                  className="pill"
                  style={{ alignSelf: 'flex-start', marginTop: '8px' }}
                  onClick={async () => {
                    if (!uiPreferences) return;
                    try {
                      setSavingReminders(true);
                      setError(null);
                      await updateUIPreferences(uiPreferences);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Failed to save reminders');
                    } finally {
                      setSavingReminders(false);
                    }
                  }}
                  disabled={savingReminders}
                >
                  {savingReminders ? 'Saving…' : 'Save reminder preferences'}
                </button>
              </div>
            )}
          </section>

        </div>
      </div>
    </div>
  );
}
