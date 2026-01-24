/**
 * Development helper component to test navigation state management
 * Shows current navigation state and allows testing chat clearing
 */

'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { getChatResetFunction, getMobileSidebarCloseFunction } from '../../lib/globalNavigationState';

export default function NavigationTestHelper() {
  const pathname = usePathname();
  const [chatResetAvailable, setChatResetAvailable] = useState(false);
  const [sidebarCloseAvailable, setSidebarCloseAvailable] = useState(false);
  
  useEffect(() => {
    const checkAvailability = () => {
      setChatResetAvailable(!!getChatResetFunction());
      setSidebarCloseAvailable(!!getMobileSidebarCloseFunction());
    };
    
    // Check immediately and then periodically
    checkAvailability();
    const interval = setInterval(checkAvailability, 1000);
    
    return () => clearInterval(interval);
  }, []);
  
  // Only show in development and on explorer page
  if (process.env.NODE_ENV !== 'development' || pathname !== '/') {
    return null;
  }
  
  return (
    <div style={{
      position: 'fixed',
      top: '10px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(0, 0, 0, 0.8)',
      color: 'white',
      padding: '8px 16px',
      borderRadius: '6px',
      fontSize: '12px',
      zIndex: 10000,
      fontFamily: 'monospace',
      display: 'flex',
      gap: '16px',
      alignItems: 'center',
    }}>
      <span>Nav State:</span>
      <span style={{ color: chatResetAvailable ? '#4CAF50' : '#F44336' }}>
        Chat Reset: {chatResetAvailable ? '✓' : '✗'}
      </span>
      <span style={{ color: sidebarCloseAvailable ? '#4CAF50' : '#F44336' }}>
        Sidebar Close: {sidebarCloseAvailable ? '✓' : '✗'}  
      </span>
      <button
        onClick={() => {
          const resetFn = getChatResetFunction();
          if (resetFn) {
            resetFn();
            console.log('Test: Chat reset triggered');
          } else {
            console.log('Test: No chat reset function available');
          }
        }}
        style={{
          background: '#2196F3',
          color: 'white',
          border: 'none',
          padding: '4px 8px',
          borderRadius: '4px',
          fontSize: '11px',
          cursor: 'pointer',
        }}
      >
        Test Reset
      </button>
    </div>
  );
}