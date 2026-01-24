'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import TopBar from './TopBar';
import FloatingActionButton from '../navigation/FloatingActionButton';

// Routes that should NOT show the TopBar
const HIDE_TOPBAR_ROUTES = [
  '/api',
  '/mobile',
  // Landing page is handled by page.tsx logic, but we can hide TopBar when showing landing
];

export default function TopBarWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [shouldHideTopBar, setShouldHideTopBar] = useState(() => {
    // Check immediately on client side to avoid flash
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      return HIDE_TOPBAR_ROUTES.some(route => path.startsWith(route));
    }
    return false; // On server, default to showing TopBar
  });
  
  // Also check pathname when it's available (for navigation)
  useEffect(() => {
    if (pathname) {
      const shouldHide = HIDE_TOPBAR_ROUTES.some(route => pathname.startsWith(route));
      setShouldHideTopBar(shouldHide);
    }
  }, [pathname]);
  
  const activeGraphId = searchParams?.get('graph_id') || undefined;
  
  // Hide FAB on certain pages
  const hideFAB = HIDE_TOPBAR_ROUTES.some(route => pathname?.startsWith(route)) || 
                  pathname?.startsWith('/debug') || 
                  pathname?.startsWith('/admin');
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {!shouldHideTopBar && <TopBar />}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {children}
      </div>
      {!hideFAB && (
        <FloatingActionButton activeGraphId={activeGraphId} />
      )}
    </div>
  );
}

