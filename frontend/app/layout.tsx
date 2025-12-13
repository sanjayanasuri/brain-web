import type { Metadata } from 'next';
import './globals.css';

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
      <body>{children}</body>
    </html>
  );
}

