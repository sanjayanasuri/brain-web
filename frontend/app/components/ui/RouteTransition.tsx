'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

const TRANSITION_MS = 480;

export default function RouteTransition() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setActive(true);
    document.body.classList.add('page-transitioning');

    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = window.setTimeout(() => {
      setActive(false);
      document.body.classList.remove('page-transitioning');
    }, TRANSITION_MS);

    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
      document.body.classList.remove('page-transitioning');
    };
  }, [pathname, searchParams]);

  return (
    <>
      <div className={`route-progress${active ? ' is-active' : ''}`} aria-hidden="true" />
      <div className="transition-overlay" aria-hidden="true">
        <div className="transition-spinner" />
      </div>
      <style jsx global>{`
        .route-progress {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          z-index: 9999;
          background: linear-gradient(90deg, #118ab2 0%, #06d6a0 50%, #f4a261 100%);
          transform: scaleX(0);
          transform-origin: left;
          opacity: 0;
          transition: transform ${TRANSITION_MS}ms ease, opacity 180ms ease;
        }
        .route-progress.is-active {
          opacity: 1;
          transform: scaleX(1);
        }
        @media (prefers-reduced-motion: reduce) {
          .route-progress {
            transition: none;
          }
        }
      `}</style>
    </>
  );
}
