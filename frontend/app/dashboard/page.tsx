'use client';

import React from 'react';
import StudyDashboard from '../components/dashboard/StudyDashboard';
import ExamManager from '../components/dashboard/ExamManager';
import SignalsView from '../components/dashboard/SignalsView';
import WorkflowStatusView from '../components/dashboard/WorkflowStatusView';
import SuggestedPlan from '../components/dashboard/SuggestedPlan';
import TaskQuickAdd from '../components/dashboard/TaskQuickAdd';
import LandingPage from '../components/landing/LandingPage';
import { useState, useEffect } from 'react';

export default function DashboardPage() {
  const [showLanding, setShowLanding] = useState(true);
  const [hasVisited, setHasVisited] = useState(false);

  useEffect(() => {
    // Check if user has visited before
    const visited = sessionStorage.getItem('brain-web-visited');
    if (visited === 'true') {
      setShowLanding(false);
      setHasVisited(true);
    }
  }, []);

  const handleEnter = () => {
    sessionStorage.setItem('brain-web-visited', 'true');
    setShowLanding(false);
  };

  if (showLanding) {
    return <LandingPage onEnter={handleEnter} />;
  }

  const [refreshKey, setRefreshKey] = useState(0);

  const handleTaskCreated = () => {
    // Trigger refresh of suggestions
    setRefreshKey(prev => prev + 1);
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--page-bg)',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 400px',
        gap: '24px',
        padding: '24px',
        maxWidth: '1600px',
        margin: '0 auto',
      }}>
        {/* Main Dashboard */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
        }}>
          <div>
            <TaskQuickAdd onTaskCreated={handleTaskCreated} />
          </div>
          <StudyDashboard />
          <SignalsView />
          <SuggestedPlan key={refreshKey} daysAhead={7} />
        </div>

        {/* Sidebar with Exam Manager and Workflow Status */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
        }}>
          <ExamManager />
          <WorkflowStatusView />
        </div>
      </div>
    </div>
  );
}
