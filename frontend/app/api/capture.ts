import { API_BASE_URL, getApiHeaders } from './base';

export type CaptureSource = 'text' | 'voice' | 'note' | 'file';

export type CaptureItem = {
  id: string;
  source: CaptureSource | string;
  content: string;
  status: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
};

export async function createCapture(content: string, source: CaptureSource = 'text'): Promise<CaptureItem> {
  const res = await fetch(`${API_BASE_URL}/capture`, {
    method: 'POST',
    headers: await getApiHeaders(),
    body: JSON.stringify({ content, source }),
  });
  if (!res.ok) throw new Error('Failed to create capture');
  return res.json();
}

export async function listCapture(status: 'new' | 'promoted' | 'all' = 'new', limit = 10): Promise<CaptureItem[]> {
  const res = await fetch(`${API_BASE_URL}/capture?status=${status}&limit=${limit}`, {
    headers: await getApiHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load capture inbox');
  return res.json();
}

export async function promoteCapture(captureId: string, target: 'task' | 'concept' | 'memory', title?: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE_URL}/capture/${captureId}/promote`, {
    method: 'POST',
    headers: await getApiHeaders(),
    body: JSON.stringify({ target, title }),
  });
  if (!res.ok) throw new Error('Failed to promote capture');
  return res.json();
}
