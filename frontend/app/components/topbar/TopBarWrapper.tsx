'use client';

import { usePathname } from 'next/navigation';
import TopBar from './TopBar';

// Routes that should NOT show the TopBar
const HIDE_TOPBAR_ROUTES = [
  '/api',
  // Landing page is handled by page.tsx logic, but we can hide TopBar when showing landing
];

export default function TopBarWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  
  // Check if current route should hide TopBar
  const shouldHideTopBar = pathname && HIDE_TOPBAR_ROUTES.some(route => pathname.startsWith(route));
  
  // Also check if we're on landing page (this is handled in page.tsx, but we can check here too)
  // Actually, we'll let the page handle it - TopBar will show but landing page will overlay
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {!shouldHideTopBar && <TopBar />}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {children}
      </div>
    </div>
  );
}

