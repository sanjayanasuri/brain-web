'use client';

import { useState, useEffect, useRef } from 'react';
import { getTrail, type Trail, type TrailStep } from '../../api-client';
import { formatRelativeTime } from '../../lib/sessionState';

interface TrailSidebarProps {
  trailId: string | null;
  onClose: () => void;
  onStepClick: (step: TrailStep) => void;
}

const STEP_ICONS: Record<string, string> = {
  page: '📄',
  quote: '💬',
  concept: '🔗',
  claim: '✓',
  search: '🔍',
};

export default function TrailSidebar({ trailId, onClose, onStepClick }: TrailSidebarProps) {
  const [trail, setTrail] = useState<Trail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!trailId) {
      setTrail(null);
      return;
    }

    async function loadTrail() {
      try {
        setLoading(true);
        setError(null);
        if (!trailId) return;
        const data = await getTrail(trailId);
        setTrail(data);
        
        // Auto-scroll to newest step
        setTimeout(() => {
          if (sidebarRef.current) {
            const stepsContainer = sidebarRef.current.querySelector('[data-steps-container]');
            if (stepsContainer) {
              stepsContainer.scrollTop = stepsContainer.scrollHeight;
            }
          }
        }, 100);
      } catch (err) {
        console.error('[TrailSidebar] Failed to load trail:', err);
        setError(err instanceof Error ? err.message : 'Failed to load trail');
      } finally {
        setLoading(false);
      }
    }

    loadTrail();
  }, [trailId]);

  if (!trailId) {
    return null;
  }

  const handleStepClick = (step: TrailStep) => {
    onStepClick(step);
  };

  const getStepTitle = (step: TrailStep): string => {
    if (step.title) return step.title;
    if (step.kind === 'quote' && step.ref_id) {
      return `Quote: ${step.ref_id.substring(0, 30)}...`;
    }
    if (step.kind === 'page' && step.ref_id) {
      try {
        const url = new URL(step.ref_id);
        return url.hostname || step.ref_id.substring(0, 40);
      } catch {
        return step.ref_id.substring(0, 40);
      }
    }
    return `${step.kind}: ${step.ref_id.substring(0, 30)}...`;
  };

  return (
    <div
      ref={sidebarRef}
      className={`fixed right-0 top-0 h-full bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 shadow-lg transition-transform duration-300 z-40 ${
        collapsed ? 'translate-x-full' : 'translate-x-0'
      }`}
      style={{ width: '320px' }}
    >
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Trail
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              title={collapsed ? 'Expand' : 'Collapse'}
            >
              {collapsed ? '▶' : '◀'}
            </button>
            <button
              onClick={onClose}
              className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              title="Close"
            >
              ✕
            </button>
          </div>
        </div>

        {!collapsed && (
          <>
            {/* Trail Info */}
            {trail && (
              <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                <div className="font-medium text-gray-900 dark:text-white mb-1">
                  {trail.title}
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {trail.steps.length} step{trail.steps.length !== 1 ? 's' : ''}
                </div>
              </div>
            )}

            {/* Steps List */}
            <div
              data-steps-container
              className="flex-1 overflow-y-auto p-2"
            >
              {loading && (
                <div className="p-4 text-center text-gray-500 dark:text-gray-400">
                  Loading...
                </div>
              )}

              {error && (
                <div className="p-4 text-center text-red-500">
                  {error}
                </div>
              )}

              {trail && trail.steps.length === 0 && (
                <div className="p-4 text-center text-gray-500 dark:text-gray-400">
                  No steps yet
                </div>
              )}

              {trail && trail.steps.map((step) => (
                <div
                  key={step.step_id}
                  onClick={() => handleStepClick(step)}
                  className="p-3 mb-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-lg flex-shrink-0">
                      {STEP_ICONS[step.kind] || '•'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {getStepTitle(step)}
                      </div>
                      {step.note && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                          {step.note}
                        </div>
                      )}
                      {step.created_at && (
                        <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                          {formatRelativeTime(step.created_at)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

