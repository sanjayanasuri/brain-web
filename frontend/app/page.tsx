'use client';

import { useState, useEffect } from 'react';
import GraphVisualization from './components/graph/GraphVisualization';
import LandingPage from './components/landing/LandingPage';

export default function Home() {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/a01a33f1-d489-4279-a9af-9a81bd1c1f3e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'page.tsx:7',message:'Home component render',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/a01a33f1-d489-4279-a9af-9a81bd1c1f3e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'page.tsx:20',message:'handleEnter: clicked',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    sessionStorage.setItem('brain-web-visited', 'true');
    setShowLanding(false);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/a01a33f1-d489-4279-a9af-9a81bd1c1f3e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'page.tsx:23',message:'handleEnter: setShowLanding(false)',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
  };

  if (showLanding) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/a01a33f1-d489-4279-a9af-9a81bd1c1f3e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'page.tsx:25',message:'Rendering LandingPage',data:{showLanding},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    return <LandingPage onEnter={handleEnter} />;
  }

  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/a01a33f1-d489-4279-a9af-9a81bd1c1f3e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'page.tsx:29',message:'Rendering GraphVisualization',data:{showLanding,hasVisited},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
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

