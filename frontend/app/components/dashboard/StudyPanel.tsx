import React, { useState } from 'react';
import TaskQuickAdd from './TaskQuickAdd';
import SuggestedPlan from './SuggestedPlan';
import ExamManager from './ExamManager';

export default function StudyPanel() {
    const [refreshKey, setRefreshKey] = useState(0);

    const handleTaskCreated = () => {
        setRefreshKey(prev => prev + 1);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <TaskQuickAdd onTaskCreated={handleTaskCreated} />
            <ExamManager />
            <SuggestedPlan key={refreshKey} daysAhead={7} />
        </div>
    );
}
