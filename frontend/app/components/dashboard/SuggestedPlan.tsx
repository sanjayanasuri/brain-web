'use client';

import React, { useState, useEffect } from 'react';
import {
  listSuggestions,
  generateSuggestions,
  acceptSuggestion,
  rejectSuggestion,
  completeSuggestion,
  type SuggestionsResponse,
} from '../../api-client';
import GlassCard from '../ui/GlassCard';
import Button from '../ui/Button';
import Badge from '../ui/Badge';

interface SuggestedPlanProps {
  daysAhead?: number;
}

export default function SuggestedPlan({ daysAhead = 7 }: SuggestedPlanProps) {
  const [suggestions, setSuggestions] = useState<SuggestionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());

  const loadSuggestions = async () => {
    setLoading(true);
    setError(null);
    try {
      const start = new Date();
      const end = new Date();
      end.setDate(end.getDate() + daysAhead);

      const startISO = start.toISOString();
      const endISO = end.toISOString();

      let data = await listSuggestions(startISO, endISO);

      if (data.total === 0) {
        data = await generateSuggestions(startISO, endISO);
      }

      setSuggestions(data);
    } catch (err) {
      console.error('Failed to load suggestions:', err);
      setError(err instanceof Error ? err.message : 'Failed to load suggestions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSuggestions();
  }, [daysAhead]);

  const handleAccept = async (suggestionId: string) => {
    setUpdatingIds(prev => new Set(prev).add(suggestionId));
    try {
      await acceptSuggestion(suggestionId);
      await loadSuggestions();
    } catch (err) {
      console.error('Failed to accept suggestion:', err);
      alert('Failed to accept suggestion. Please try again.');
    } finally {
      setUpdatingIds(prev => {
        const next = new Set(prev);
        next.delete(suggestionId);
        return next;
      });
    }
  };

  const handleReject = async (suggestionId: string) => {
    setUpdatingIds(prev => new Set(prev).add(suggestionId));
    try {
      await rejectSuggestion(suggestionId);
      await loadSuggestions();
    } catch (err) {
      console.error('Failed to reject suggestion:', err);
      alert('Failed to reject suggestion. Please try again.');
    } finally {
      setUpdatingIds(prev => {
        const next = new Set(prev);
        next.delete(suggestionId);
        return next;
      });
    }
  };

  const handleComplete = async (suggestionId: string) => {
    setUpdatingIds(prev => new Set(prev).add(suggestionId));
    try {
      await completeSuggestion(suggestionId);
      await loadSuggestions();
    } catch (err) {
      console.error('Failed to complete suggestion:', err);
      alert('Failed to mark suggestion as completed. Please try again.');
    } finally {
      setUpdatingIds(prev => {
        const next = new Set(prev);
        next.delete(suggestionId);
        return next;
      });
    }
  };

  const formatTime = (isoString: string): string => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === tomorrow.toDateString()) {
      return 'Tomorrow';
    } else {
      return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'accepted': return 'success';
      case 'rejected': return 'error';
      case 'completed': return 'primary';
      default: return 'secondary';
    }
  };

  if (loading && !suggestions) {
    return (
      <GlassCard style={{ padding: '24px' }}>
        <h2 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: 600, color: 'var(--ink)' }}>Suggested Plan</h2>
        <div style={{ color: 'var(--muted)', fontSize: '14px' }}>Loading suggestions...</div>
      </GlassCard>
    );
  }

  if (error) {
    return (
      <GlassCard style={{ padding: '24px' }}>
        <h2 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: 600, color: 'var(--ink)' }}>Suggested Plan</h2>
        <div style={{ color: '#ef4444', marginBottom: '16px', fontSize: '14px' }}>{error}</div>
        <Button variant="primary" onClick={loadSuggestions}>Retry</Button>
      </GlassCard>
    );
  }

  if (!suggestions || suggestions.total === 0) {
    return (
      <GlassCard style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--ink)' }}>Suggested Plan</h2>
          <Button variant="primary" size="sm" onClick={loadSuggestions}>Generate</Button>
        </div>
        <div style={{ color: 'var(--muted)', textAlign: 'center', padding: '24px', fontSize: '14px' }}>
          No suggestions yet. Click &quot;Generate&quot; to create a plan.
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard style={{ padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--font-display)' }}>
          Suggested Plan
        </h2>
        <Button variant="secondary" size="sm" onClick={loadSuggestions} isLoading={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        {suggestions.suggestions_by_day.map((dayGroup) => (
          <div key={dayGroup.date}>
            <h3 style={{
              margin: '0 0 16px 0',
              fontSize: '15px',
              fontWeight: 700,
              color: 'var(--ink)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent)' }} />
              {formatDate(dayGroup.date)}
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginLeft: '12px', borderLeft: '1px solid var(--border)', paddingLeft: '20px' }}>
              {dayGroup.suggestions.map((suggestion) => {
                const isUpdating = updatingIds.has(suggestion.id);

                return (
                  <div
                    key={suggestion.id}
                    style={{
                      padding: '16px',
                      background: 'var(--surface)',
                      borderRadius: '12px',
                      border: '1px solid var(--border)',
                      transition: 'transform 0.2s ease, border-color 0.2s ease',
                      position: 'relative'
                    }}
                    className="hover:border-accent/30"
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--ink)', fontSize: '15px' }}>
                          {suggestion.task_title}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ fontSize: '12px', fontWeight: 700 }}>Time:</span>
                          {formatTime(suggestion.start)} - {formatTime(suggestion.end)}
                        </div>
                        {suggestion.reasons.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                            {suggestion.reasons.map((reason, idx) => (
                              <div key={idx} style={{
                                fontSize: '12px',
                                color: 'var(--muted)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px'
                              }}>
                                <span style={{ color: 'var(--accent)' }}>•</span>
                                {reason}
                              </div>
                            ))}
                          </div>
                        )}
                        {suggestion.status !== 'suggested' && (
                          <Badge variant={suggestion.status === 'accepted' ? 'success' : suggestion.status === 'completed' ? 'accent' : 'error'}>
                            {suggestion.status}
                          </Badge>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: '8px' }}>
                        {suggestion.status === 'suggested' && (
                          <>
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => handleAccept(suggestion.id)}
                              disabled={isUpdating}
                              isLoading={isUpdating}
                            >
                              Accept
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleReject(suggestion.id)}
                              disabled={isUpdating}
                            >
                              Reject
                            </Button>
                          </>
                        )}

                        {suggestion.status === 'accepted' && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => handleComplete(suggestion.id)}
                            disabled={isUpdating}
                            isLoading={isUpdating}
                          >
                            Mark Complete
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

