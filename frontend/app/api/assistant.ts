import { API_BASE_URL, getApiHeaders } from './base';

export type AssistantProfile = {
  assistant_name?: string;
  tone?: string;
  verbosity?: string;
  teaching_mode?: string;
  voice_style?: string;
  constraints?: string[];
};

export async function getAssistantProfile(): Promise<{ user_id: string; tenant_id: string; profile: AssistantProfile }> {
  const res = await fetch(`${API_BASE_URL}/assistant/profile`, {
    headers: await getApiHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load assistant profile');
  return res.json();
}

export async function patchAssistantProfile(profile: AssistantProfile): Promise<{ user_id: string; tenant_id: string; profile: AssistantProfile }> {
  const res = await fetch(`${API_BASE_URL}/assistant/profile`, {
    method: 'PATCH',
    headers: await getApiHeaders(),
    body: JSON.stringify({ profile }),
  });
  if (!res.ok) throw new Error('Failed to save assistant profile');
  return res.json();
}

export async function getAssistantStylePrompt(): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/assistant/style-prompt`, {
    headers: await getApiHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load assistant style prompt');
  const data = await res.json();
  return data?.style_prompt || '';
}

export type AssistantAction = {
  type: 'web_search' | 'save_note' | 'set_reminder' | 'summarize_answer' | string;
  label: string;
  query?: string;
};

export async function planAssistantActions(message: string, answer?: string): Promise<AssistantAction[]> {
  const res = await fetch(`${API_BASE_URL}/assistant/actions/plan`, {
    method: 'POST',
    headers: await getApiHeaders(),
    body: JSON.stringify({ message, answer }),
  });
  if (!res.ok) throw new Error('Failed to plan assistant actions');
  const data = await res.json();
  return data?.actions || [];
}
