'use client';

import React, { useState, useEffect } from 'react';
import { getFocusAreas, setFocusAreaActive, upsertFocusArea, FocusArea } from '../api-client';

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
    setIsTransitioning(true);
    // Small delay for fade effect
    setTimeout(() => {
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
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      }}>
        <div style={{ color: 'white', fontSize: '18px' }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
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
          color: '#1a1a1a',
        }}>
          Welcome, {userName}
        </h1>
        
        <p style={{
          fontSize: '20px',
          color: '#666',
          marginBottom: '8px',
        }}>
          What would you like to focus on today?
        </p>
        <p style={{
          fontSize: '13px',
          color: '#999',
          marginBottom: '24px',
          fontStyle: 'italic',
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
                border: '2px solid #e0e0e0',
                borderRadius: '8px',
                fontSize: '16px',
                fontFamily: 'inherit',
                color: '#1a1a1a',
                background: 'white',
                resize: 'vertical',
                transition: 'border-color 0.2s',
                lineHeight: '1.6',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = '#667eea';
                e.currentTarget.style.outline = 'none';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = '#e0e0e0';
              }}
            />
            {lastSaved && (
              <div style={{
                position: 'absolute',
                bottom: '8px',
                right: '12px',
                fontSize: '12px',
                color: '#667eea',
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
                background: saving ? '#ccc' : '#667eea',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: saving ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                if (!saving) {
                  e.currentTarget.style.background = '#5568d3';
                }
              }}
              onMouseLeave={(e) => {
                if (!saving) {
                  e.currentTarget.style.background = '#667eea';
                }
              }}
            >
              {saving ? 'Saving...' : 'Save Focus'}
            </button>
            <span style={{
              fontSize: '12px',
              color: '#999',
            }}>
              This syncs with Profile Customization
            </span>
          </div>
          
          {focusAreas.length > 0 && (
            <div style={{
              marginTop: '20px',
              paddingTop: '20px',
              borderTop: '1px solid #e0e0e0',
            }}>
              <p style={{
                fontSize: '13px',
                color: '#666',
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
                        ? '2px solid #667eea' 
                        : '2px solid #e0e0e0',
                      borderRadius: '6px',
                      background: area.active
                        ? '#f0f4ff'
                        : 'white',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      fontSize: '13px',
                      fontWeight: '500',
                      color: '#1a1a1a',
                    }}
                    onMouseEnter={(e) => {
                      if (!area.active) {
                        e.currentTarget.style.borderColor = '#667eea';
                        e.currentTarget.style.background = '#f9faff';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!area.active) {
                        e.currentTarget.style.borderColor = '#e0e0e0';
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
              background: '#667eea',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#5568d3';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#667eea';
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
