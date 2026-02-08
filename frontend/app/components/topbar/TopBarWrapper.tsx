'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import TopBar from './TopBar';
import FloatingActionButton from '../navigation/FloatingActionButton';
import SessionDrawer from '../navigation/SessionDrawer';
import { useSidebar } from '../context-providers/SidebarContext';
import { ChatProvider } from '../graph/hooks/useChatState';

// Routes that should NOT show the Sidebar/TopBar
const HIDE_UI_ROUTES = [
  '/api',
  '/mobile',
];

export default function TopBarWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isSidebarCollapsed, setIsSidebarCollapsed } = useSidebar();

  const shouldHideUI = pathname ? HIDE_UI_ROUTES.some(route => pathname.startsWith(route)) : false;

  const activeGraphId = searchParams?.get('graph_id') || undefined;
  const hideFAB = shouldHideUI || pathname?.startsWith('/debug') || pathname?.startsWith('/admin');

  if (shouldHideUI) {
    return <ChatProvider>{children}</ChatProvider>;
  }

  return (
    <ChatProvider>
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--page-bg)' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <TopBar />
          <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
            {children}
          </div>
          {!hideFAB && (
            <FloatingActionButton activeGraphId={activeGraphId} />
          )}
        </div>
      </div>
    </ChatProvider>
  );
}

