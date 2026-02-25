'use client';

import StudyPanel from '../components/dashboard/StudyPanel';
import LearningInterventionsCard from '../components/home/LearningInterventionsCard';

export default function LearnPage() {
  return (
    <div className="app-shell">
      <div className="app-container">
        <div className="page-header-row">
          <div>
            <div className="page-title">Quiz Me</div>
            <div className="page-subtitle">Adaptive study and confidence-building from your actual memory graph.</div>
          </div>
          <button className="ui-button" onClick={() => window.location.assign('/home')}>
            Back Home
          </button>
        </div>

        <LearningInterventionsCard />

        <div className="ui-card">
          <StudyPanel />
        </div>
      </div>
    </div>
  );
}
