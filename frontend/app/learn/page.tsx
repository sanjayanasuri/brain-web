'use client';

import StudyPanel from '../components/dashboard/StudyPanel';
import LearningInterventionsCard from '../components/home/LearningInterventionsCard';

export default function LearnPage() {
  return (
    <div style={{ minHeight: '100vh', padding: '18px 16px', background: 'var(--background)' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>Quiz Me</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>Adaptive study and confidence-building from your actual memory graph.</div>
          </div>
          <button
            onClick={() => window.location.assign('/home')}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontSize: 12 }}
          >
            Back Home
          </button>
        </div>

        <LearningInterventionsCard />

        <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, background: 'var(--panel)' }}>
          <StudyPanel />
        </div>
      </div>
    </div>
  );
}
