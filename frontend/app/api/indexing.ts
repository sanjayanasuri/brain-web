import { API_BASE_URL, getApiHeaders } from './base';

export type IndexingHealth = {
  ocr: {
    total_7d: number;
    success_7d: number;
    avg_confidence_7d: number | null;
  };
  transcripts: {
    chunks_24h: number;
  };
  evidence: {
    responses_24h: number;
    with_citations_24h: number;
    citation_rate_24h: number | null;
  };
};

export async function getIndexingHealth(): Promise<IndexingHealth> {
  const res = await fetch(`${API_BASE_URL}/indexing/health`, {
    headers: await getApiHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load indexing health');
  return res.json();
}
