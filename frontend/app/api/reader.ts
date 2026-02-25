import { API_BASE_URL, getApiHeaders } from './base';

export type ReaderSnippet = {
  chunk_id?: string;
  text: string;
  claims: string[];
  score: number;
  breakdown: Record<string, number>;
  why: string[];
};

export type ReaderResponse = {
  found: boolean;
  reason?: string;
  document?: { doc_id?: string; url?: string; title?: string | null; status?: string };
  relevance?: number;
  scoring_policy?: string;
  snippets: ReaderSnippet[];
  interest_terms?: string[];
};

export async function getReaderView(params: { query: string; url?: string; doc_id?: string; limit?: number }): Promise<ReaderResponse> {
  const res = await fetch(`${API_BASE_URL}/web/reader`, {
    method: 'POST',
    headers: await getApiHeaders(),
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error('Failed to load reader view');
  return res.json();
}

export async function checkReaderUnderstanding(params: { query: string; snippet_text: string; user_answer: string; url?: string; doc_id?: string; }) {
  const res = await fetch(`${API_BASE_URL}/web/reader/check`, {
    method: 'POST',
    headers: await getApiHeaders(),
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error('Failed to check understanding');
  return res.json();
}

export async function explainReaderSnippet(params: { query: string; snippet_text: string; question?: string; url?: string; doc_id?: string; }) {
  const res = await fetch(`${API_BASE_URL}/web/reader/explain`, {
    method: 'POST',
    headers: await getApiHeaders(),
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error('Failed to explain snippet');
  return res.json();
}
