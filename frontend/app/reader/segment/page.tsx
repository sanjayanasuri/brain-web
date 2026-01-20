'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

// Redirect /reader/segment to /lecture-studio
// If there's a lectureId, redirect to /lecture-editor instead
export default function ReaderSegmentRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  useEffect(() => {
    const lectureId = searchParams?.get('lectureId');
    
    if (lectureId) {
      // If there's a lectureId, go directly to editor
      router.replace(`/lecture-editor?lectureId=${lectureId}`);
    } else {
      // Otherwise go to lecture-studio landing page
      router.replace('/lecture-studio');
    }
  }, [router, searchParams]);
  
  return (
    <div style={{ padding: '40px', textAlign: 'center' }}>
      <div>Redirecting...</div>
    </div>
  );
}
