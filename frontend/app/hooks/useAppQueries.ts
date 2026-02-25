'use client';

import { useQuery } from '@tanstack/react-query';
import { listGraphs, getFocusAreas } from '../api-client';
import { fetchRecentSessions } from '../lib/eventsClient';
import { fetchChatSessions } from '../lib/chatSessions';

/** Use for invalidateQueries so cache stays in sync after create/delete/update. */
export const APP_QUERY_KEYS = {
  graphs: ['graphs'] as const,
  focusAreas: ['focusAreas'] as const,
  recentSessions: (limit: number) => ['recentSessions', limit] as const,
  chatSessions: ['chatSessions'] as const,
};

const QUERY_KEYS = APP_QUERY_KEYS;

/** Shared list-graphs query. Dedupes and caches across SessionDrawer, home, TopBar, etc. */
export function useListGraphs() {
  return useQuery({
    queryKey: QUERY_KEYS.graphs,
    queryFn: listGraphs,
    staleTime: 2 * 60 * 1000,
  });
}

/** Recent study sessions. Shared between home and SessionDrawer. */
export function useRecentSessions(limit: number = 10) {
  return useQuery({
    queryKey: QUERY_KEYS.recentSessions(limit),
    queryFn: () => fetchRecentSessions(limit),
    staleTime: 1 * 60 * 1000,
  });
}

/** Chat sessions from backend. Shared between home and SessionDrawer. */
export function useChatSessions() {
  return useQuery({
    queryKey: QUERY_KEYS.chatSessions,
    queryFn: fetchChatSessions,
    staleTime: 1 * 60 * 1000,
  });
}

/** Focus areas for home. */
export function useFocusAreas() {
  return useQuery({
    queryKey: QUERY_KEYS.focusAreas,
    queryFn: () => getFocusAreas().catch(() => []),
    staleTime: 2 * 60 * 1000,
  });
}
