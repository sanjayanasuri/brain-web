import type { Metadata, Viewport } from 'next';
import './globals.css';
import TopBarWrapper from './components/topbar/TopBarWrapper';
import { SidebarProvider } from './components/context-providers/SidebarContext';
import QueryProvider from './components/context-providers/QueryProvider';
import { ThemeProvider } from './components/context-providers/ThemeProvider';
import RouteTransition from './components/ui/RouteTransition';

export const metadata: Metadata = {
  title: 'Brain Web - Knowledge Graph Explorer',
  description: 'Interactive exploration of your personal knowledge graph',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Brain Web',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: '#3b82f6',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ThemeProvider>
          <QueryProvider>
            <RouteTransition />
            <SidebarProvider>
              <TopBarWrapper>{children}</TopBarWrapper>
            </SidebarProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
