'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  computeContinuationCandidates, 
  dismissContinuation, 
  clearContinuation,
  type ContinuationCandidate 
} from '../../lib/continuation';

interface ContinueBlockProps {
  graphId?: string;
  onPathResume?: (pathId: string) => void;
}

export default function ContinueBlock({ graphId, onPathResume }: ContinueBlockProps) {
  const router = useRouter();
  const [candidates, setCandidates] = useState<ContinuationCandidate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadCandidates = async () => {
      try {
        setLoading(true);
        const computed = await computeContinuationCandidates(graphId);
        setCandidates(computed);
      } catch (error) {
        console.warn('[ContinueBlock] Error loading candidates:', error);
        setCandidates([]);
      } finally {
        setLoading(false);
      }
    };

    loadCandidates();
  }, [graphId]);

  const handleDismiss = (candidate: ContinuationCandidate) => {
    dismissContinuation(candidate.id);
    setCandidates(prev => prev.filter(c => c.id !== candidate.id));
  };

  const handleAction = (candidate: ContinuationCandidate) => {
    // Clear the continuation when action is executed
    clearContinuation(candidate.id);
    
    // Handle different action types
    if (candidate.kind === 'RESUME_PATH' && candidate.metadata?.path_id) {
      // Special handling for path resume - use callback if provided
      if (onPathResume) {
        onPathResume(candidate.metadata.path_id);
      } else if (candidate.action.target.startsWith('path:')) {
        // Fallback: navigate to home with path_id
        const pathId = candidate.action.target.replace('path:', '');
        router.push(`/home?path_id=${pathId}`);
      } else {
        router.push(candidate.action.target);
      }
    } else {
      router.push(candidate.action.target);
    }
    
    // Remove from candidates
    setCandidates(prev => prev.filter(c => c.id !== candidate.id));
  };

  const getIcon = (kind: ContinuationCandidate['kind']): string => {
    switch (kind) {
      case 'RESUME_PATH':
        return '↩';
      case 'IMPROVE_CONCEPT':
        return '✨';
      case 'REVIEW':
        return '✓';
      case 'OPEN_SAVED':
        return '📌';
      case 'START_PATH':
        return '→';
      default:
        return '•';
    }
  };

  if (loading) {
    return null; // Don't show loading state, just hide the block
  }

  if (candidates.length === 0) {
    return null; // Don't show the block if there are no candidates
  }

  return (
    <div style={{
      background: 'var(--panel)',
      borderRadius: '12px',
      padding: '24px',
      boxShadow: 'var(--shadow)',
      marginBottom: '24px',
    }}>
      <h2 style={{ 
        fontSize: '20px', 
        fontWeight: '600', 
        margin: '0 0 16px 0',
        color: 'var(--ink)',
      }}>
        Continue
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {candidates.map((candidate) => (
          <div
            key={candidate.id}
            style={{
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              background: 'var(--background)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
            }}
          >
            <div style={{
              fontSize: '20px',
              lineHeight: 1,
              flexShrink: 0,
              marginTop: '2px',
            }}>
              {getIcon(candidate.kind)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ 
                fontSize: '14px', 
                fontWeight: '600', 
                marginBottom: '4px',
                color: 'var(--ink)',
              }}>
                {candidate.title}
              </div>
              <div style={{ 
                fontSize: '12px', 
                color: 'var(--muted)',
                marginBottom: '8px',
              }}>
                {candidate.explanation}
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  onClick={() => handleAction(candidate)}
                  style={{
                    padding: '6px 12px',
                    background: 'var(--accent)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: 'pointer',
                  }}
                >
                  {candidate.action.label}
                </button>
                <button
                  onClick={() => handleDismiss(candidate)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--muted)',
                    cursor: 'pointer',
                    fontSize: '18px',
                    lineHeight: 1,
                    padding: '4px 8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  title="Dismiss"
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

