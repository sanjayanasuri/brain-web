import { API_BASE_URL, getApiHeaders } from './base';

export type LearningIntervention = {
  id: string;
  source: string;
  trigger_text: string;
  simplified_explanation?: string;
  prerequisite_gap?: string;
  practice_question?: string;
  status: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export async function getLearningInterventions(status: 'open' | 'resolved' | 'all' = 'open', limit = 20): Promise<LearningIntervention[]> {
  const res = await fetch(`${API_BASE_URL}/learning/interventions?status=${status}&limit=${limit}`, {
    headers: await getApiHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load learning interventions');
  return res.json();
}

export async function resolveLearningIntervention(id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/learning/interventions/${id}/resolve`, {
    method: 'POST',
    headers: await getApiHeaders(),
  });
  if (!res.ok) throw new Error('Failed to resolve intervention');
}
