'use client';

import React, { useState, useEffect } from 'react';
import {
  listSuggestions,
  generateSuggestions,
  acceptSuggestion,
  rejectSuggestion,
  completeSuggestion,
  type SuggestionsResponse,
  type PlanSuggestion,
} from '../../api-client';

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
      
      // Try to load existing suggestions first
      let data = await listSuggestions(startISO, endISO);
      
      // If no suggestions exist, generate them
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
      await loadSuggestions(); // Reload to update UI
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
      await loadSuggestions(); // Reload to update UI
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
      await loadSuggestions(); // Reload to update UI
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

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'accepted':
        return '#10b981'; // green
      case 'rejected':
        return '#ef4444'; // red
      case 'completed':
        return '#3b82f6'; // blue
      default:
        return '#6b7280'; // gray
    }
  };

  if (loading && !suggestions) {
    return (
      <div style={{
        padding: '24px',
        background: 'var(--card-bg, #ffffff)',
        borderRadius: '8px',
        border: '1px solid var(--border-color, #e5e7eb)',
      }}>
        <h2 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: 600 }}>Suggested Plan</h2>
        <div style={{ color: '#6b7280' }}>Loading suggestions...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        padding: '24px',
        background: 'var(--card-bg, #ffffff)',
        borderRadius: '8px',
        border: '1px solid var(--border-color, #e5e7eb)',
      }}>
        <h2 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: 600 }}>Suggested Plan</h2>
        <div style={{ color: '#ef4444', marginBottom: '12px' }}>{error}</div>
        <button
          onClick={loadSuggestions}
          style={{
            padding: '8px 16px',
            background: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!suggestions || suggestions.total === 0) {
    return (
      <div style={{
        padding: '24px',
        background: 'var(--card-bg, #ffffff)',
        borderRadius: '8px',
        border: '1px solid var(--border-color, #e5e7eb)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Suggested Plan</h2>
          <button
            onClick={loadSuggestions}
            style={{
              padding: '6px 12px',
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Generate
          </button>
        </div>
        <div style={{ color: '#6b7280', textAlign: 'center', padding: '24px' }}>
          No suggestions yet. Click &quot;Generate&quot; to create a plan.
        </div>
      </div>
    );
  }

  return (
    <div style={{
      padding: '24px',
      background: 'var(--card-bg, #ffffff)',
      borderRadius: '8px',
      border: '1px solid var(--border-color, #e5e7eb)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Suggested Plan</h2>
        <button
          onClick={loadSuggestions}
          disabled={loading}
          style={{
            padding: '6px 12px',
            background: loading ? '#9ca3af' : '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '14px',
          }}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {suggestions.suggestions_by_day.map((dayGroup) => (
          <div key={dayGroup.date} style={{ borderBottom: '1px solid var(--border-color, #e5e7eb)', paddingBottom: '16px' }}>
            <h3 style={{
              margin: '0 0 12px 0',
              fontSize: '16px',
              fontWeight: 600,
              color: '#374151',
            }}>
              {formatDate(dayGroup.date)}
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {dayGroup.suggestions.map((suggestion) => {
                const isUpdating = updatingIds.has(suggestion.id);
                const statusColor = getStatusColor(suggestion.status);
                
                return (
                  <div
                    key={suggestion.id}
                    style={{
                      padding: '12px',
                      background: suggestion.status === 'suggested' ? '#f9fafb' : '#f3f4f6',
                      borderRadius: '6px',
                      border: `1px solid ${statusColor}40`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, marginBottom: '4px', color: '#111827' }}>
                          {suggestion.task_title}
                        </div>
                        <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '8px' }}>
                          {formatTime(suggestion.start)} - {formatTime(suggestion.end)}
                        </div>
                        {suggestion.reasons.length > 0 && (
                          <ul style={{ margin: '8px 0', paddingLeft: '20px', fontSize: '13px', color: '#4b5563' }}>
                            {suggestion.reasons.map((reason, idx) => (
                              <li key={idx} style={{ marginBottom: '4px' }}>{reason}</li>
                            ))}
                          </ul>
                        )}
                        {suggestion.status !== 'suggested' && (
                          <div style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            background: `${statusColor}20`,
                            color: statusColor,
                            fontSize: '12px',
                            fontWeight: 500,
                            marginTop: '8px',
                          }}>
                            {suggestion.status.charAt(0).toUpperCase() + suggestion.status.slice(1)}
                          </div>
                        )}
                      </div>
                      
                      {suggestion.status === 'suggested' && (
                        <div style={{ display: 'flex', gap: '8px', marginLeft: '12px' }}>
                          <button
                            onClick={() => handleAccept(suggestion.id)}
                            disabled={isUpdating}
                            style={{
                              padding: '6px 12px',
                              background: '#10b981',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: isUpdating ? 'not-allowed' : 'pointer',
                              fontSize: '13px',
                              opacity: isUpdating ? 0.6 : 1,
                            }}
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => handleReject(suggestion.id)}
                            disabled={isUpdating}
                            style={{
                              padding: '6px 12px',
                              background: '#ef4444',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: isUpdating ? 'not-allowed' : 'pointer',
                              fontSize: '13px',
                              opacity: isUpdating ? 0.6 : 1,
                            }}
                          >
                            Reject
                          </button>
                        </div>
                      )}
                      
                      {suggestion.status === 'accepted' && (
                        <button
                          onClick={() => handleComplete(suggestion.id)}
                          disabled={isUpdating}
                          style={{
                            padding: '6px 12px',
                            background: '#3b82f6',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: isUpdating ? 'not-allowed' : 'pointer',
                            fontSize: '13px',
                            opacity: isUpdating ? 0.6 : 1,
                          }}
                        >
                          {isUpdating ? '...' : 'Mark Complete'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
