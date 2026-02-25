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
