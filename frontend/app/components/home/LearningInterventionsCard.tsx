'use client';

import { useEffect, useState } from 'react';
import { getLearningInterventions, resolveLearningIntervention, type LearningIntervention } from '../../api/learning';

export default function LearningInterventionsCard() {
  const [items, setItems] = useState<LearningIntervention[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const data = await getLearningInterventions('open', 5);
      setItems(data || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, background: 'var(--panel)' }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Learning Interventions</div>
      {loading ? (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>No open interventions. Nice momentum.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((it) => (
            <div key={it.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: 'var(--surface)' }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Confusion trigger</div>
              <div style={{ fontSize: 13, marginTop: 2 }}>{it.trigger_text}</div>
              {it.practice_question && <div style={{ fontSize: 12, marginTop: 6 }}><strong>Practice:</strong> {it.practice_question}</div>}
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <button
                  onClick={async () => {
                    await resolveLearningIntervention(it.id);
                    setItems(prev => prev.filter(x => x.id !== it.id));
                  }}
                  style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', fontSize: 12, cursor: 'pointer' }}
                >
                  Mark resolved
                </button>
                <button
                  onClick={() => window.location.assign('/learn')}
                  style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', fontSize: 12, cursor: 'pointer' }}
                >
                  Practice now
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
