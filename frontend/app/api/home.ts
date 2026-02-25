import { API_BASE_URL, getApiHeaders } from './base';

export type HomeTask = {
  id: string;
  title: string;
  priority?: string;
  due_date?: string | null;
};

export type HomePick = {
  id?: string;
  title: string;
  reason?: string;
  query?: string;
  score?: number;
};

export type HomeFeed = {
  today: { tasks: HomeTask[]; task_count: number };
  picks: HomePick[];
  continuity: string[];
  capture_inbox?: { new_count: number };
};

export async function getHomeFeed(): Promise<HomeFeed> {
  const res = await fetch(`${API_BASE_URL}/home/feed`, {
    headers: await getApiHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load home feed');
  return res.json();
}
