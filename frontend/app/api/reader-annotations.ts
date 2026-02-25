import { API_BASE_URL, getApiHeaders } from './base';

export type ReaderAnnotationType = 'highlight' | 'note' | 'link_concept' | 'save_memory';

export async function createReaderAnnotation(payload: {
  doc_id?: string;
  url?: string;
  chunk_id?: string;
  annotation_type: ReaderAnnotationType;
  note?: string;
  concept_id?: string;
  metadata?: Record<string, unknown>;
}) {
  const res = await fetch(`${API_BASE_URL}/web/reader/annotate`, {
    method: 'POST',
    headers: await getApiHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to save annotation');
  return res.json();
}

export async function listReaderAnnotations(params: { doc_id?: string; url?: string; limit?: number }) {
  const q = new URLSearchParams();
  if (params.doc_id) q.set('doc_id', params.doc_id);
  if (params.url) q.set('url', params.url);
  if (params.limit) q.set('limit', String(params.limit));
  const res = await fetch(`${API_BASE_URL}/web/reader/annotations?${q.toString()}`, {
    headers: await getApiHeaders(),
  });
  if (!res.ok) throw new Error('Failed to load annotations');
  return res.json();
}
