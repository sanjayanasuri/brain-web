'use client';

import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/query-persist-client-core';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';

const DEFAULT_STALE_TIME_MS = 5 * 60 * 1000;
const DEFAULT_GC_TIME_MS = 30 * 60 * 1000;

export default function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: DEFAULT_STALE_TIME_MS,
            gcTime: DEFAULT_GC_TIME_MS,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const persister = createSyncStoragePersister({
      storage: window.sessionStorage,
    });
    persistQueryClient({
      queryClient,
      persister,
      maxAge: DEFAULT_GC_TIME_MS,
    });
  }, [queryClient]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
