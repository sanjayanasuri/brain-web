import type { Metadata } from 'next';
import './globals.css';
import TopBarWrapper from './components/topbar/TopBarWrapper';
import { SidebarProvider } from './components/context-providers/SidebarContext';
import { LensProvider } from './components/context-providers/LensContext';

export const metadata: Metadata = {
  title: 'Brain Web - Knowledge Graph Explorer',
  description: 'Interactive exploration of your personal knowledge graph',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <SidebarProvider>
          <LensProvider>
            <TopBarWrapper>{children}</TopBarWrapper>
          </LensProvider>
        </SidebarProvider>
      </body>
    </html>
  );
}

