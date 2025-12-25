'use client';

import { useState, useEffect } from 'react';
import { listTrails, resumeTrail, archiveTrail, type TrailSummary } from '../../api-client';
import { formatRelativeTime } from '../../lib/sessionState';

interface ResumeThinkingPromptProps {
  onResume: (trailId: string) => void;
  onDismiss: () => void;
}

export default function ResumeThinkingPrompt({ onResume, onDismiss }: ResumeThinkingPromptProps) {
  const [activeTrail, setActiveTrail] = useState<TrailSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [resuming, setResuming] = useState(false);
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    async function checkActiveTrail() {
      try {
        setLoading(true);
        const response = await listTrails('active', 1);
        if (response.trails && response.trails.length > 0) {
          setActiveTrail(response.trails[0]);
        }
      } catch (error) {
        console.warn('[ResumeThinking] Failed to check for active trail:', error);
      } finally {
        setLoading(false);
      }
    }

    checkActiveTrail();
  }, []);

  const handleResume = async () => {
    if (!activeTrail) return;
    
    try {
      setResuming(true);
      await resumeTrail(activeTrail.trail_id);
      onResume(activeTrail.trail_id);
    } catch (error) {
      console.error('[ResumeThinking] Failed to resume trail:', error);
      alert('Failed to resume trail. Please try again.');
    } finally {
      setResuming(false);
    }
  };

  const handleArchive = async () => {
    if (!activeTrail) return;
    
    try {
      setArchiving(true);
      await archiveTrail(activeTrail.trail_id);
      setActiveTrail(null);
      onDismiss();
    } catch (error) {
      console.error('[ResumeThinking] Failed to archive trail:', error);
      alert('Failed to archive trail. Please try again.');
    } finally {
      setArchiving(false);
    }
  };

  if (loading) {
    return null;
  }

  if (!activeTrail) {
    return null;
  }

  const lastTouched = activeTrail.updated_at ? formatRelativeTime(activeTrail.updated_at) : 'Unknown';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onDismiss}>
      <div 
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
          Resume thinking?
        </h2>
        
        <div className="mb-4">
          <div className="font-medium text-gray-900 dark:text-white mb-1">
            {activeTrail.title}
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Last touched {lastTouched}
          </div>
          {activeTrail.step_count > 0 && (
            <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {activeTrail.step_count} step{activeTrail.step_count !== 1 ? 's' : ''}
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleResume}
            disabled={resuming || archiving}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {resuming ? 'Resuming...' : 'Resume'}
          </button>
          <button
            onClick={handleArchive}
            disabled={resuming || archiving}
            className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {archiving ? 'Archiving...' : 'Archive'}
          </button>
        </div>
      </div>
    </div>
  );
}

