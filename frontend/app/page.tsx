'use client';

import { useState, useEffect } from 'react';
import GraphVisualization from './components/graph/GraphVisualization';
import LandingPage from './components/landing/LandingPage';

export default function Home() {
  const [showLanding, setShowLanding] = useState(true);
  const [hasVisited, setHasVisited] = useState(false);

  useEffect(() => {
    // Check if user has visited before (stored in sessionStorage)
    const visited = sessionStorage.getItem('brain-web-visited');
    if (visited === 'true') {
      setShowLanding(false);
      setHasVisited(true);
    }
  }, []);

  const handleEnter = () => {
    sessionStorage.setItem('brain-web-visited', 'true');
    setShowLanding(false);
  };

  if (showLanding) {
    return <LandingPage onEnter={handleEnter} />;
  }

  return (
    <main style={{ 
      opacity: hasVisited ? 1 : 0,
      animation: hasVisited ? 'none' : 'fadeIn 0.5s ease-in forwards',
    }}>
      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
      `}</style>
      <GraphVisualization />
    </main>
  );
}

