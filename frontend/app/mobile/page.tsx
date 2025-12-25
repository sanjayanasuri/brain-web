'use client';

import { useState, useEffect } from 'react';
import GraphVisualization from '../components/graph/GraphVisualization';

export default function MobilePage() {
  const [isMounted, setIsMounted] = useState(false);

  // Set mounted flag to prevent hydration mismatch
  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#f9fafb',
      }}>
        <div style={{ color: '#6b7280' }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      height: '100vh',
      height: '100dvh',
      width: '100vw',
      overflow: 'hidden',
      touchAction: 'none', // Prevent default touch behaviors for better graph interaction
    }}>
      <GraphVisualization />
    </div>
  );
}

