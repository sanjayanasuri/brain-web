'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import type { SuggestedPath, PathStep } from '../../api-client';
import { fetchEvidenceForConcept } from '../../lib/evidenceFetch';
import { proposeRelationship, checkRelationshipExists } from '../../api-client';
import { logEvent } from '../../lib/eventsClient';

interface PathRunnerProps {
  path: SuggestedPath;
  onStepSelect: (conceptId: string) => void;
  onExit: () => void;
  graphId?: string;
  onEvidenceFetched?: () => void;
}

const PATH_STORAGE_KEY = 'brain-web-active-path';
const DONE_STORAGE_KEY_PREFIX = 'brainweb:paths:done:';

export default function PathRunner({ path, onStepSelect, onExit, graphId, onEvidenceFetched }: PathRunnerProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [doneSteps, setDoneSteps] = useState<Record<string, boolean>>({});
  const [actionStates, setActionStates] = useState<{
    addEvidence: 'idle' | 'loading' | 'success' | 'error';
    connectNext: 'idle' | 'loading' | 'success' | 'error' | 'exists';
    addedCount?: number;
    error?: string;
  }>({
    addEvidence: 'idle',
    connectNext: 'idle',
  });
  const [relationshipExists, setRelationshipExists] = useState(false);
  const searchParams = useSearchParams();

  // Load saved state from localStorage and track path started
  useEffect(() => {
    const saved = localStorage.getItem(PATH_STORAGE_KEY);
    let isResuming = false;
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.path_id === path.path_id && data.currentStepIndex < path.steps.length) {
          setCurrentStepIndex(data.currentStepIndex);
          isResuming = true;
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
    
    // Track PATH_STARTED event (only on initial mount or when path changes)
    if (!isResuming) {
      logEvent({
        type: 'PATH_STARTED',
        graph_id: graphId,
        concept_id: path.steps[0]?.concept_id,
        payload: {
          path_id: path.path_id,
          path_title: path.title,
          step_index: 0,
        },
      }).catch(() => {});
    }
    
    // Load done steps
    const doneKey = `${DONE_STORAGE_KEY_PREFIX}${path.path_id}`;
    const doneData = localStorage.getItem(doneKey);
    if (doneData) {
      try {
        setDoneSteps(JSON.parse(doneData));
      } catch (e) {
        // Ignore parse errors
      }
    }
  }, [path.path_id, path.steps.length, graphId]);

  // Save state to localStorage
  useEffect(() => {
    localStorage.setItem(PATH_STORAGE_KEY, JSON.stringify({
      path_id: path.path_id,
      currentStepIndex,
    }));
  }, [path.path_id, currentStepIndex]);

  // Save done steps to localStorage
  useEffect(() => {
    const doneKey = `${DONE_STORAGE_KEY_PREFIX}${path.path_id}`;
    localStorage.setItem(doneKey, JSON.stringify(doneSteps));
  }, [path.path_id, doneSteps]);

  // Check if relationship exists when step changes
  useEffect(() => {
    const currentStep = path.steps[currentStepIndex];
    const nextStep = currentStepIndex < path.steps.length - 1 ? path.steps[currentStepIndex + 1] : null;
    
    if (currentStep && nextStep) {
      checkRelationshipExists(currentStep.concept_id, nextStep.concept_id, 'PREREQUISITE_FOR')
        .then(exists => {
          setRelationshipExists(exists);
          if (exists) {
            setActionStates(prev => ({ ...prev, connectNext: 'exists' }));
          }
        })
        .catch(() => {
          setRelationshipExists(false);
        });
    } else {
      setRelationshipExists(false);
    }
  }, [currentStepIndex, path.steps]);

  const handlePrevious = () => {
    if (currentStepIndex > 0) {
      const newIndex = currentStepIndex - 1;
      setCurrentStepIndex(newIndex);
      onStepSelect(path.steps[newIndex].concept_id);
    }
  };

  const handleNext = () => {
    if (currentStepIndex < path.steps.length - 1) {
      const newIndex = currentStepIndex + 1;
      setCurrentStepIndex(newIndex);
      onStepSelect(path.steps[newIndex].concept_id);
      // Track path step viewed
      logEvent({
        type: 'PATH_STEP_VIEWED',
        graph_id: graphId,
        concept_id: path.steps[newIndex].concept_id,
        payload: {
          path_id: path.path_id,
          path_title: path.title,
          step_index: newIndex,
        },
      }).catch(() => {});
    }
  };

  const handleStepClick = (index: number) => {
    setCurrentStepIndex(index);
    onStepSelect(path.steps[index].concept_id);
    // Track path step viewed
    logEvent({
      type: 'PATH_STEP_VIEWED',
      graph_id: graphId,
      concept_id: path.steps[index].concept_id,
      payload: {
        path_id: path.path_id,
        path_title: path.title,
        step_index: index,
      },
    }).catch(() => {});
  };

  const handleExit = () => {
    // Track path exited
    logEvent({
      type: 'PATH_EXITED',
      graph_id: graphId,
      payload: {
        path_id: path.path_id,
        path_title: path.title,
        step_index: currentStepIndex,
      },
    }).catch(() => {});
    localStorage.removeItem(PATH_STORAGE_KEY);
    onExit();
  };

  const handleRestart = () => {
    setCurrentStepIndex(0);
    onStepSelect(path.steps[0].concept_id);
  };

  const handleAddEvidence = async () => {
    const currentStep = path.steps[currentStepIndex];
    if (!currentStep) return;
    
    setActionStates(prev => ({ ...prev, addEvidence: 'loading' }));
    try {
      const result = await fetchEvidenceForConcept(
        currentStep.concept_id,
        currentStep.name,
        graphId || searchParams?.get('graph_id') || undefined
      );
      
      if (result.error) {
        setActionStates(prev => ({
          ...prev,
          addEvidence: 'error',
          error: result.error,
        }));
      } else {
        setActionStates(prev => ({
          ...prev,
          addEvidence: 'success',
          addedCount: result.addedCount,
        }));
        onEvidenceFetched?.();
        // Reset after 3 seconds
        setTimeout(() => {
          setActionStates(prev => ({ ...prev, addEvidence: 'idle', addedCount: undefined }));
        }, 3000);
      }
    } catch (error) {
      setActionStates(prev => ({
        ...prev,
        addEvidence: 'error',
        error: error instanceof Error ? error.message : 'Failed to fetch evidence',
      }));
    }
  };

  const handleConnectNext = async () => {
    const currentStep = path.steps[currentStepIndex];
    const nextStep = currentStepIndex < path.steps.length - 1 ? path.steps[currentStepIndex + 1] : null;
    if (!currentStep || !nextStep) return;
    
    setActionStates(prev => ({ ...prev, connectNext: 'loading' }));
    try {
      await proposeRelationship(
        currentStep.concept_id,
        nextStep.concept_id,
        'PREREQUISITE_FOR',
        'Proposed from suggested path'
      );
      setActionStates(prev => ({ ...prev, connectNext: 'success' }));
      setRelationshipExists(true);
      // Reset after 3 seconds
      setTimeout(() => {
        setActionStates(prev => ({ ...prev, connectNext: 'idle' }));
      }, 3000);
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) {
        setActionStates(prev => ({ ...prev, connectNext: 'exists' }));
        setRelationshipExists(true);
      } else {
        setActionStates(prev => ({
          ...prev,
          connectNext: 'error',
          error: error instanceof Error ? error.message : 'Failed to propose relationship',
        }));
      }
    }
  };

  const handleMarkDone = () => {
    const currentStep = path.steps[currentStepIndex];
    if (!currentStep) return;
    
    setDoneSteps(prev => ({
      ...prev,
      [currentStep.concept_id]: !prev[currentStep.concept_id],
    }));
  };

  // Determine path source from title
  const getPathSource = (): string => {
    const title = path.title.toLowerCase();
    if (title.includes('prerequisite')) {
      return 'Prereqs';
    } else if (title.includes('next steps') || title.includes('dependents')) {
      return 'Next steps';
    } else if (title.includes('related')) {
      return 'Related';
    } else if (title.includes('explore')) {
      return 'Exploration';
    }
    return 'Path';
  };

  return (
    <div 
      data-path-runner
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'var(--panel)',
        borderTop: '2px solid var(--border)',
        boxShadow: '0 -4px 12px rgba(0, 0, 0, 0.1)',
        zIndex: 1000,
        padding: '16px 24px',
      }}>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
      }}>
        {/* Path title and info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: '14px',
            fontWeight: '600',
            marginBottom: '4px',
            color: 'var(--ink)',
          }}>
            {path.title}
          </div>
          <div style={{
            fontSize: '12px',
            color: 'var(--muted)',
            marginBottom: '2px',
          }}>
            Step {currentStepIndex + 1} of {path.steps.length}
          </div>
          <div style={{
            fontSize: '10px',
            color: 'var(--muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            {getPathSource()}
          </div>
        </div>

        {/* Steps */}
        <div style={{
          display: 'flex',
          gap: '8px',
          flex: 2,
          overflowX: 'auto',
          padding: '8px 0',
        }}>
          {path.steps.map((step, index) => (
            <button
              key={step.concept_id}
              onClick={() => handleStepClick(index)}
              style={{
                padding: '6px 12px',
                background: index === currentStepIndex
                  ? 'var(--accent)'
                  : index < currentStepIndex
                  ? 'rgba(var(--accent-rgb), 0.2)'
                  : 'var(--background)',
                color: index === currentStepIndex
                  ? 'white'
                  : 'var(--ink)',
                border: `1px solid ${index === currentStepIndex ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: index === currentStepIndex ? '600' : '400',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.2s',
                position: 'relative',
              }}
              title={step.name}
            >
              {doneSteps[step.concept_id] && (
                <span style={{ marginRight: '4px' }}>✓</span>
              )}
              {step.name.length > 20 ? `${step.name.substring(0, 20)}...` : step.name}
            </button>
          ))}
        </div>

        {/* Step Actions (for current step only) */}
        {path.steps[currentStepIndex] && (
          <div style={{
            display: 'flex',
            gap: '6px',
            alignItems: 'center',
            padding: '0 8px',
            borderLeft: '1px solid var(--border)',
            borderRight: '1px solid var(--border)',
          }}>
            <button
              onClick={handleAddEvidence}
              disabled={actionStates.addEvidence === 'loading'}
              style={{
                padding: '4px 8px',
                background: actionStates.addEvidence === 'success' 
                  ? 'rgba(34, 197, 94, 0.1)'
                  : 'transparent',
                color: actionStates.addEvidence === 'success'
                  ? 'rgb(34, 197, 94)'
                  : 'var(--accent)',
                border: `1px solid ${actionStates.addEvidence === 'success' ? 'rgba(34, 197, 94, 0.3)' : 'var(--border)'}`,
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: '500',
                cursor: actionStates.addEvidence === 'loading' ? 'not-allowed' : 'pointer',
                opacity: actionStates.addEvidence === 'loading' ? 0.6 : 1,
                whiteSpace: 'nowrap',
              }}
              title={actionStates.addEvidence === 'success' && actionStates.addedCount
                ? `Added ${actionStates.addedCount} sources`
                : 'Add evidence for this step'}
            >
              {actionStates.addEvidence === 'loading' ? '...' : 
               actionStates.addEvidence === 'success' ? `✓ ${actionStates.addedCount || ''}` :
               'Add evidence'}
            </button>
            
            {currentStepIndex < path.steps.length - 1 && (
              <button
                onClick={handleConnectNext}
                disabled={actionStates.connectNext === 'loading' || actionStates.connectNext === 'exists' || relationshipExists}
                style={{
                  padding: '4px 8px',
                  background: actionStates.connectNext === 'success'
                    ? 'rgba(34, 197, 94, 0.1)'
                    : actionStates.connectNext === 'exists' || relationshipExists
                    ? 'rgba(var(--muted-rgb), 0.1)'
                    : 'transparent',
                  color: actionStates.connectNext === 'success'
                    ? 'rgb(34, 197, 94)'
                    : actionStates.connectNext === 'exists' || relationshipExists
                    ? 'var(--muted)'
                    : 'var(--accent)',
                  border: `1px solid ${
                    actionStates.connectNext === 'success' ? 'rgba(34, 197, 94, 0.3)' :
                    actionStates.connectNext === 'exists' || relationshipExists ? 'var(--border)' :
                    'var(--border)'
                  }`,
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: '500',
                  cursor: actionStates.connectNext === 'loading' || actionStates.connectNext === 'exists' || relationshipExists
                    ? 'not-allowed'
                    : 'pointer',
                  opacity: actionStates.connectNext === 'loading' || actionStates.connectNext === 'exists' || relationshipExists ? 0.6 : 1,
                  whiteSpace: 'nowrap',
                }}
                title={actionStates.connectNext === 'exists' || relationshipExists
                  ? 'Already connected'
                  : actionStates.connectNext === 'success'
                  ? 'Proposed relationship'
                  : 'Connect to next step'}
              >
                {actionStates.connectNext === 'loading' ? '...' :
                 actionStates.connectNext === 'success' ? '✓ Proposed' :
                 actionStates.connectNext === 'exists' || relationshipExists ? 'Connected' :
                 'Connect to next'}
              </button>
            )}
            
            <button
              onClick={handleMarkDone}
              style={{
                padding: '4px 8px',
                background: doneSteps[path.steps[currentStepIndex].concept_id]
                  ? 'rgba(34, 197, 94, 0.1)'
                  : 'transparent',
                color: doneSteps[path.steps[currentStepIndex].concept_id]
                  ? 'rgb(34, 197, 94)'
                  : 'var(--muted)',
                border: `1px solid ${
                  doneSteps[path.steps[currentStepIndex].concept_id]
                    ? 'rgba(34, 197, 94, 0.3)'
                    : 'var(--border)'
                }`,
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: '500',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
              title="Mark step as done"
            >
              {doneSteps[path.steps[currentStepIndex].concept_id] ? '✓ Done' : 'Mark done'}
            </button>
          </div>
        )}

        {/* Controls */}
        <div style={{
          display: 'flex',
          gap: '8px',
        }}>
          <button
            onClick={handleRestart}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              color: 'var(--accent)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: '600',
              cursor: 'pointer',
            }}
            title="Restart from beginning"
          >
            Restart
          </button>
          <button
            onClick={handlePrevious}
            disabled={currentStepIndex === 0}
            style={{
              padding: '8px 16px',
              background: currentStepIndex === 0 ? 'var(--background)' : 'var(--accent)',
              color: currentStepIndex === 0 ? 'var(--muted)' : 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: '600',
              cursor: currentStepIndex === 0 ? 'not-allowed' : 'pointer',
              opacity: currentStepIndex === 0 ? 0.5 : 1,
            }}
          >
            Previous
          </button>
          <button
            onClick={handleNext}
            disabled={currentStepIndex === path.steps.length - 1}
            style={{
              padding: '8px 16px',
              background: currentStepIndex === path.steps.length - 1 ? 'var(--background)' : 'var(--accent)',
              color: currentStepIndex === path.steps.length - 1 ? 'var(--muted)' : 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: '600',
              cursor: currentStepIndex === path.steps.length - 1 ? 'not-allowed' : 'pointer',
              opacity: currentStepIndex === path.steps.length - 1 ? 0.5 : 1,
            }}
          >
            Next
          </button>
          <button
            onClick={handleExit}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              color: 'var(--muted)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            Exit
          </button>
        </div>
      </div>
    </div>
  );
}

