'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getFocusAreas, FocusArea } from '../../api-client';
import { inputMonitor } from '../../../lib/inputMonitor';

interface LandingPageProps {
  onEnter: () => void;
  userName?: string;
}

export default function LandingPage({ onEnter, userName = 'User' }: LandingPageProps) {
  const router = useRouter();
  const [focusAreas, setFocusAreas] = useState<FocusArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [focusText, setFocusText] = useState('');
  const [apiTiming, setApiTiming] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadFocusAreas() {
      const timingId = inputMonitor.startApiTiming('getFocusAreas');
      const startTime = Date.now();
      
      try {
        const areas = await getFocusAreas();
        const duration = Date.now() - startTime;
        setApiTiming(duration);
        inputMonitor.completeApiTiming(timingId, true);
        
        if (isMounted) {
          setFocusAreas(areas);
        }
      } catch (err) {
        const duration = Date.now() - startTime;
        setApiTiming(duration);
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        inputMonitor.completeApiTiming(timingId, false, errorMsg);
        console.error('Failed to load focus areas:', err);
        // Don't block the UI - allow user to proceed even if focus areas fail to load
        if (isMounted) {
          setFocusAreas([]);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }
    // Add timeout to prevent infinite loading
    const timeout = setTimeout(() => {
      if (isMounted) {
        console.warn('Focus areas loading timeout - proceeding anyway');
        setLoading(false);
      }
    }, 5000);
    loadFocusAreas();
    return () => {
      isMounted = false;
      clearTimeout(timeout);
    };
  }, []);


  const handleEnter = useCallback(async () => {
    inputMonitor.trackInput({
      type: 'click',
      target: 'Enter Brain Web',
    });
    
    setIsTransitioning(true);
    // Small delay for fade effect
    setTimeout(() => {
      router.push('/home');
    }, 300);
  }, [router]);



  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--page-bg)',
      }}>
        <div style={{ color: 'white', fontSize: '18px' }}>Loading...</div>
      </div>
    );
  }


  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--page-bg)',
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
        background: 'var(--panel)',
        borderRadius: '16px',
        padding: '48px',
        boxShadow: 'var(--shadow)',
        border: '1px solid var(--border)',
      }}>
        {/* Welcome Section */}
        <div style={{
          marginBottom: '32px',
          textAlign: 'center',
        }}>
          <div style={{
            fontSize: '32px',
            fontWeight: '600',
            color: 'var(--ink)',
            marginBottom: '12px',
            lineHeight: '1.2',
          }}>
            Welcome User
          </div>
          <div style={{
            fontSize: '18px',
            color: 'var(--muted)',
            marginBottom: '24px',
          }}>
            What would you like to focus on today?
          </div>
        </div>

        {/* Focus Area Section */}
        <div style={{ marginBottom: '32px' }}>
          <input
            type="text"
            value={focusText}
            onChange={(e) => {
              const value = e.target.value;
              // Limit length
              if (value.length <= 1000) {
                setFocusText(value);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleEnter();
              }
            }}
            placeholder=""
            style={{
              width: '100%',
              padding: '10px 14px',
              border: '2px solid var(--border)',
              borderRadius: '6px',
              fontSize: '14px',
              fontFamily: 'inherit',
              color: 'var(--ink)',
              background: 'var(--surface)',
              transition: 'border-color 0.2s',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent)';
              e.currentTarget.style.outline = 'none';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)';
            }}
          />
        </div>
      </div>
    </div>
  );
}
