import React, { Suspense } from 'react';
import type { Metadata, Viewport } from 'next';
import './globals.css';
import TopBarWrapper from './components/topbar/TopBarWrapper';
import { SidebarProvider } from './components/context-providers/SidebarContext';
import QueryProvider from './components/context-providers/QueryProvider';
import { ThemeProvider } from './components/context-providers/ThemeProvider';
import RouteTransition from './components/ui/RouteTransition';
import OfflineSyncInitializer from './components/offline/OfflineSyncInitializer';

export const metadata: Metadata = {
  title: 'Brain Web - AI Study Assistant',
  description: 'Your comprehensive study assistant for organizing documents, taking notes, tracking timelines, and exploring knowledge gaps',
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.ico',
    apple: '/icon-192.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: '#2563eb',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <ThemeProvider>
          <QueryProvider>
            <Suspense fallback={null}>
              <RouteTransition />
              <SidebarProvider>
                <OfflineSyncInitializer />
                <TopBarWrapper>{children}</TopBarWrapper>
              </SidebarProvider>
            </Suspense>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
