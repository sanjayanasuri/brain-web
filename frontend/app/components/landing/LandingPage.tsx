'use client';

import React, { useState, useEffect } from 'react';
import { getFocusAreas, setFocusAreaActive, upsertFocusArea, FocusArea } from '../../api-client';

interface LandingPageProps {
  onEnter: () => void;
  userName?: string;
}

export default function LandingPage({ onEnter, userName = 'User' }: LandingPageProps) {
  const [focusAreas, setFocusAreas] = useState<FocusArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFocusAreas, setSelectedFocusAreas] = useState<Set<string>>(new Set());
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [focusText, setFocusText] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  useEffect(() => {
    async function loadFocusAreas() {
      try {
        const areas = await getFocusAreas();
        setFocusAreas(areas);
        // Pre-select active focus areas
        const activeIds = new Set(areas.filter(a => a.active).map(a => a.id));
        setSelectedFocusAreas(activeIds);
        
        // Populate textarea with active focus areas
        const activeAreas = areas.filter(a => a.active);
        if (activeAreas.length > 0) {
          setFocusText(activeAreas.map(a => a.name).join('\n'));
        }
      } catch (err) {
        console.error('Failed to load focus areas:', err);
      } finally {
        setLoading(false);
      }
    }
    loadFocusAreas();
  }, []);

  const handleToggleFocus = async (focusId: string, currentActive: boolean) => {
    try {
      await setFocusAreaActive(focusId, !currentActive);
      setSelectedFocusAreas(prev => {
        const next = new Set(prev);
        if (!currentActive) {
          next.add(focusId);
        } else {
          next.delete(focusId);
        }
        return next;
      });
      // Update local state
      setFocusAreas(prev => prev.map(fa => 
        fa.id === focusId ? { ...fa, active: !currentActive } : fa
      ));
      
      // Update textarea to reflect active focus areas
      const updatedAreas = focusAreas.map(fa => 
        fa.id === focusId ? { ...fa, active: !currentActive } : fa
      );
      const activeNames = updatedAreas.filter(a => a.active).map(a => a.name);
      setFocusText(activeNames.join('\n'));
    } catch (err) {
      console.error('Failed to toggle focus area:', err);
    }
  };

  const handleSaveFocus = async () => {
    if (!focusText.trim()) {
      // If empty, deactivate all focus areas
      const activeAreas = focusAreas.filter(a => a.active);
      for (const area of activeAreas) {
        try {
          await setFocusAreaActive(area.id, false);
        } catch (err) {
          console.error(`Failed to deactivate ${area.id}:`, err);
        }
      }
      setFocusAreas(prev => prev.map(fa => ({ ...fa, active: false })));
      setSelectedFocusAreas(new Set());
      setLastSaved('All focus areas cleared');
      return;
    }

    try {
      setSaving(true);
      
      // Parse focus areas from text (one per line, or comma-separated)
      const lines = focusText
        .split(/[\n,]/)
        .map(line => line.trim())
        .filter(line => line.length > 0);
      
      // Get existing focus areas by name (case-insensitive)
      const existingByName = new Map(
        focusAreas.map(fa => [fa.name.toLowerCase(), fa])
      );
      
      const newFocusAreas: FocusArea[] = [];
      const toDeactivate: string[] = [];
      
      // Process each line as a focus area
      for (const line of lines) {
        const lowerName = line.toLowerCase();
        if (existingByName.has(lowerName)) {
          // Existing focus area - activate it
          const existing = existingByName.get(lowerName)!;
          if (!existing.active) {
            await setFocusAreaActive(existing.id, true);
          }
          newFocusAreas.push({ ...existing, active: true });
        } else {
          // New focus area - create it
          const newArea = await upsertFocusArea({
            id: line.toLowerCase().replace(/\s+/g, '-'),
            name: line,
            description: undefined,
            active: true,
          });
          newFocusAreas.push(newArea);
        }
      }
      
      // Deactivate focus areas that are no longer in the text
      for (const area of focusAreas) {
        const isInText = lines.some(
          line => line.toLowerCase() === area.name.toLowerCase()
        );
        if (!isInText && area.active) {
          toDeactivate.push(area.id);
          await setFocusAreaActive(area.id, false);
        }
      }
      
      // Reload focus areas to get updated list
      const updatedAreas = await getFocusAreas();
      setFocusAreas(updatedAreas);
      
      // Update selected set
      const activeIds = new Set(updatedAreas.filter(a => a.active).map(a => a.id));
      setSelectedFocusAreas(activeIds);
      
      // Update textarea to reflect saved state (in case names were normalized)
      const activeNames = updatedAreas.filter(a => a.active).map(a => a.name);
      setFocusText(activeNames.join('\n'));
      
      setLastSaved(`Saved ${newFocusAreas.length} focus area${newFocusAreas.length !== 1 ? 's' : ''}`);
      setTimeout(() => setLastSaved(null), 3000);
    } catch (err) {
      console.error('Failed to save focus areas:', err);
      setLastSaved('Error saving focus areas');
      setTimeout(() => setLastSaved(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleEnter = async () => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/a01a33f1-d489-4279-a9af-9a81bd1c1f3e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'LandingPage.tsx:161',message:'LandingPage handleEnter: called',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    setIsTransitioning(true);
    // Small delay for fade effect
    setTimeout(() => {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/a01a33f1-d489-4279-a9af-9a81bd1c1f3e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'LandingPage.tsx:165',message:'LandingPage handleEnter: calling onEnter',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      onEnter();
    }, 300);
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #118ab2 0%, #ef476f 50%, #f4a261 100%)',
      }}>
        <div style={{ color: 'white', fontSize: '18px' }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #118ab2 0%, #ef476f 50%, #f4a261 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px',
      opacity: isTransitioning ? 0 : 1,
      transition: 'opacity 0.3s ease-out',
    }}>
      <div style={{
        maxWidth: '600px',
        width: '100%',
        background: 'rgba(255, 255, 255, 0.95)',
        borderRadius: '16px',
        padding: '48px',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
      }}>
        <h1 style={{
          fontSize: '36px',
          fontWeight: '700',
          marginBottom: '8px',
          color: '#0f172a',
        }}>
          Welcome, {userName}
        </h1>
        
        <p style={{
          fontSize: '20px',
          color: '#6b7280',
          marginBottom: '8px',
        }}>
          What would you like to focus on today?
        </p>
        <p style={{
          fontSize: '13px',
          color: '#6b7280',
          marginBottom: '24px',
          fontStyle: 'italic',
          opacity: 0.8,
        }}>
          Your focus areas help Brain Web connect your questions and learning back to these themes
        </p>

        <div style={{ marginBottom: '24px' }}>
          <div style={{
            position: 'relative',
            marginBottom: '12px',
          }}>
            <textarea
              value={focusText}
              onChange={(e) => setFocusText(e.target.value)}
              placeholder="Type your focus areas here, one per line or separated by commas...&#10;&#10;Examples:&#10;Distributed Systems&#10;Machine Learning&#10;Web Development"
              style={{
                width: '100%',
                minHeight: '120px',
                padding: '16px',
                border: '2px solid #d8e2f1',
                borderRadius: '8px',
                fontSize: '16px',
                fontFamily: 'inherit',
                color: '#0f172a',
                background: 'white',
                resize: 'vertical',
                transition: 'border-color 0.2s',
                lineHeight: '1.6',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = '#118ab2';
                e.currentTarget.style.outline = 'none';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = '#d8e2f1';
              }}
            />
            {lastSaved && (
              <div style={{
                position: 'absolute',
                bottom: '8px',
                right: '12px',
                fontSize: '12px',
                color: '#118ab2',
                background: 'rgba(255, 255, 255, 0.9)',
                padding: '4px 8px',
                borderRadius: '4px',
              }}>
                {lastSaved}
              </div>
            )}
          </div>
          
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              onClick={handleSaveFocus}
              disabled={saving}
              style={{
                padding: '10px 20px',
                fontSize: '14px',
                fontWeight: '600',
                background: saving ? '#ccc' : 'linear-gradient(120deg, #118ab2, #00b4d8)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: saving ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                boxShadow: saving ? 'none' : '0 10px 20px rgba(17, 138, 178, 0.22)',
              }}
              onMouseEnter={(e) => {
                if (!saving) {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }
              }}
              onMouseLeave={(e) => {
                if (!saving) {
                  e.currentTarget.style.transform = 'translateY(0)';
                }
              }}
            >
              {saving ? 'Saving...' : 'Save Focus'}
            </button>
            <span style={{
              fontSize: '12px',
              color: '#6b7280',
            }}>
              This syncs with Profile Customization
            </span>
          </div>
          
          {focusAreas.length > 0 && (
            <div style={{
              marginTop: '20px',
              paddingTop: '20px',
              borderTop: '1px solid #d8e2f1',
            }}>
              <p style={{
                fontSize: '13px',
                color: '#6b7280',
                marginBottom: '12px',
                fontWeight: '500',
              }}>
                Existing focus areas (click to toggle):
              </p>
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
              }}>
                {focusAreas.map(area => (
                  <button
                    key={area.id}
                    onClick={() => handleToggleFocus(area.id, area.active)}
                    style={{
                      padding: '8px 14px',
                      border: area.active 
                        ? '2px solid #118ab2' 
                        : '2px solid #d8e2f1',
                      borderRadius: '6px',
                      background: area.active
                        ? 'rgba(17, 138, 178, 0.08)'
                        : 'white',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      fontSize: '13px',
                      fontWeight: '500',
                      color: '#0f172a',
                    }}
                    onMouseEnter={(e) => {
                      if (!area.active) {
                        e.currentTarget.style.borderColor = '#118ab2';
                        e.currentTarget.style.background = 'rgba(17, 138, 178, 0.04)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!area.active) {
                        e.currentTarget.style.borderColor = '#d8e2f1';
                        e.currentTarget.style.background = 'white';
                      }
                    }}
                  >
                    {area.active && '✓ '}
                    {area.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button
            onClick={handleEnter}
            style={{
              padding: '14px 32px',
              fontSize: '16px',
              fontWeight: '600',
              background: 'linear-gradient(120deg, #118ab2, #00b4d8)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: '0 10px 20px rgba(17, 138, 178, 0.22)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            Enter Brain Web →
          </button>
        </div>
      </div>
    </div>
  );
}
