'use client';

import { useEffect } from 'react';
import { attachOutboxAutoSync } from '@/lib/offline/outbox';
import { getOfflineBootstrap } from '@/lib/offline/bootstrap';
import { getLastSession } from '../../lib/sessionState';

/**
 * Initializes offline functionality on app startup:
 * - Outbox auto-sync for queued events
 * - Automatic bootstrap loading if offline
 */
export default function OfflineSyncInitializer() {
  useEffect(() => {
    // Initialize outbox auto-sync
    const cleanup = attachOutboxAutoSync();

    // Preload bootstrap if we have a session (works both online and offline)
    const preloadBootstrap = async () => {
      const session = getLastSession();
      if (!session?.graph_id) {
        // Try sessionStorage as fallback
        if (typeof window !== 'undefined') {
          try {
            const cachedGraphId = sessionStorage.getItem('brainweb:activeGraphId');
            const cachedBranchId = sessionStorage.getItem('brainweb:activeBranchId') || 'main';
            if (cachedGraphId) {
              await getOfflineBootstrap({
                graph_id: cachedGraphId,
                branch_id: cachedBranchId,
              });
            }
          } catch {}
        }
        return;
      }

      try {
        // This will use cache if offline, or fetch and cache if online
        await getOfflineBootstrap({
          graph_id: session.graph_id,
          branch_id: session.branch_id || sessionStorage.getItem('brainweb:activeBranchId') || 'main',
        });
      } catch (err) {
        // Silently fail - bootstrap loading is best effort
        console.debug('Failed to preload bootstrap:', err);
      }
    };

    // Preload bootstrap after a short delay to not block initial render
    setTimeout(preloadBootstrap, 500);

    return cleanup;
  }, []);

  return null;
}

