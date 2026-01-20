'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import GraphVisualization from './components/graph/GraphVisualization';

// Show explorer if query params exist, otherwise redirect to /home
// Middleware should handle redirect, but this is a fallback
export default function RootPage() {
  const router = useRouter();
  
  useEffect(() => {
    // Use window.location to avoid hydration issues with useSearchParams
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const hasExplorerParams = 
        params.has('select') || 
        params.has('graph_id') || 
        params.has('chat');
      
      // If no explorer params, redirect to /home (fallback if middleware didn't catch it)
      if (!hasExplorerParams) {
        router.replace('/home');
      }
    }
  }, [router]);
  
  // Always render the explorer - if we reach here, middleware should have allowed it
  // (meaning there are query params). If not, the useEffect will redirect.
  return (
    <main>
      <GraphVisualization />
    </main>
  );
}

