import { API_BASE_URL, getApiHeaders } from './base';

export type InterestSuggestion = {
  id?: string;
  kind: string;
  title: string;
  reason?: string;
  query?: string;
  score?: number;
  created_at?: string;
};

export async function refreshInterestSuggestions(limit = 3): Promise<InterestSuggestion[]> {
  const res = await fetch(`${API_BASE_URL}/interest/suggestions/refresh?limit=${limit}`, {
    method: 'POST',
    headers: await getApiHeaders(),
  });
  if (!res.ok) throw new Error('Failed to refresh interest suggestions');
  return res.json();
}

export async function getInterestSuggestions(limit = 10): Promise<InterestSuggestion[]> {
  const res = await fetch(`${API_BASE_URL}/interest/suggestions?limit=${limit}`, {
    headers: await getApiHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load interest suggestions');
  return res.json();
}

export async function dismissInterestSuggestion(id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/interest/suggestions/${id}/dismiss`, {
    method: 'POST',
    headers: await getApiHeaders(),
  });
  if (!res.ok) throw new Error('Failed to dismiss suggestion');
}

export async function markInterestSuggestionOpened(id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/interest/suggestions/${id}/opened`, {
    method: 'POST',
    headers: await getApiHeaders(),
  });
  if (!res.ok) throw new Error('Failed to mark suggestion opened');
}
