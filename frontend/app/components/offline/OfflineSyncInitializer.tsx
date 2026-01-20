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
      // Skip if offline - bootstrap is only useful when online to cache data
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return;
      }

      const session = getLastSession();
      let graphId: string | null = session?.graph_id || null;
      let branchId: string = session?.branch_id || 'main';

      if (!graphId && typeof window !== 'undefined') {
        // Try sessionStorage as fallback
        graphId = sessionStorage.getItem('brainweb:activeGraphId');
        branchId = sessionStorage.getItem('brainweb:activeBranchId') || 'main';
      }

      // Skip if no graph ID
      if (!graphId) {
        return;
      }

      try {
        // This will use cache if offline, or fetch and cache if online
        await getOfflineBootstrap({
          graph_id: graphId,
          branch_id: branchId,
        });
      } catch (err) {
        // Silently fail - bootstrap loading is best effort
        // Don't log 404s as they're expected for non-existent graphs
        if (err instanceof Error && !err.message.includes('404')) {
          console.debug('Failed to preload bootstrap:', err);
        }
      }
    };

    // Preload bootstrap after a short delay to not block initial render
    setTimeout(preloadBootstrap, 500);

    return cleanup;
  }, []);

  return null;
}

