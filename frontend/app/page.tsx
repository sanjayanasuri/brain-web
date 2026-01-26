'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Root page redirects to /home
export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/home');
  }, [router]);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: 'var(--page-bg)'
    }}>
      <p>Redirecting...</p>
    </div>
  );
}
