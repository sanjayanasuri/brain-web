'use client';

import { useEffect, useState } from 'react';
import { getInterestSuggestions, refreshInterestSuggestions, type InterestSuggestion } from '../../api/interest';

export default function InterestSuggestionsView() {
  const [items, setItems] = useState<InterestSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const data = await getInterestSuggestions(3);
      setItems(data.slice(0, 3));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load recommendations');
    } finally {
      setLoading(false);
    }
  }

  async function refreshNow() {
    try {
      setLoading(true);
      setError(null);
      const data = await refreshInterestSuggestions(3);
      setItems(data.slice(0, 3));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh recommendations');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div style={{
      background: 'var(--panel)',
      border: '1px solid var(--border)',
      borderRadius: '12px',
      padding: '20px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Top 3 recommended reads</h2>
        <button
          onClick={refreshNow}
          style={{
            padding: '6px 12px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--muted)' }}>Loading recommendations...</div>
      ) : error ? (
        <div style={{ color: '#b91c1c' }}>{error}</div>
      ) : items.length === 0 ? (
        <div style={{ color: 'var(--muted)' }}>No recommendations yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((item, idx) => (
            <div key={`${item.title}-${idx}`} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' }}>
              <div style={{ fontWeight: 600 }}>{idx + 1}. {item.title}</div>
              {item.reason && <div style={{ marginTop: 4, color: 'var(--muted)', fontSize: 13 }}>{item.reason}</div>}
              {item.query && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--accent)' }}>Query: {item.query}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
