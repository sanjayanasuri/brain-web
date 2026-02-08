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
  getUIPreferences,
  updateUIPreferences,
  getGraphOverview,
  ResponseStyleProfileWrapper,
  FocusArea,
  UserProfile,
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
  const [focusAreas, setFocusAreas] = useState<FocusArea[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  const [savingStyle, setSavingStyle] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [addingFocus, setAddingFocus] = useState(false);
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
          focusRes,
          profileRes,
          uiPrefsRes,
        ] = await Promise.allSettled([
          getResponseStyle(),
          getFocusAreas(),
          getUserProfile(),
          getUIPreferences(),
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
