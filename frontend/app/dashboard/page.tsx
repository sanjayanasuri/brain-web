'use client';

import React from 'react';
import StudyDashboard from '../components/dashboard/StudyDashboard';
import ExamManager from '../components/dashboard/ExamManager';
import SignalsView from '../components/dashboard/SignalsView';
import WorkflowStatusView from '../components/dashboard/WorkflowStatusView';
import SuggestedPlan from '../components/dashboard/SuggestedPlan';
import InterestSuggestionsView from '../components/dashboard/InterestSuggestionsView';
import TaskQuickAdd from '../components/dashboard/TaskQuickAdd';
import { useState, useEffect } from 'react';

export default function DashboardPage() {
  /* Landing page logic removed to fix Study link routing issues */
  const [refreshKey, setRefreshKey] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 1100);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

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
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        gap: '24px',
        padding: '24px',
        maxWidth: '1600px',
        margin: '0 auto',
      }}>
        {/* Main Dashboard */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
          minWidth: 0,
        }}>
          <div>
            <TaskQuickAdd onTaskCreated={handleTaskCreated} />
          </div>
          <StudyDashboard />
          <InterestSuggestionsView />
          <SignalsView />
          <SuggestedPlan key={refreshKey} daysAhead={7} />
        </div>

        {/* Sidebar with Exam Manager and Workflow Status */}
        <div style={{
          flex: isMobile ? '1' : '0 0 400px',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
          minWidth: 0,
        }}>
          <ExamManager />
          <WorkflowStatusView />
        </div>
      </div>
    </div>
  );
}
