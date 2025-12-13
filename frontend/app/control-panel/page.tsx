'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ControlPanelRedirect() {
  const router = useRouter();
  
  useEffect(() => {
    router.replace('/profile-customization');
  }, [router]);

  return (
    <div style={{ padding: 24, textAlign: 'center' }}>
      Redirecting to Profile Customization...
    </div>
  );
}
