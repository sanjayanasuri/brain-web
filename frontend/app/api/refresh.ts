/**
 * Generic refresh bindings API (per concept / per workspace)
 */

import { API_BASE_URL, getApiHeaders } from './base';
import type {
  ConceptRefreshBindingResponse,
  ConceptRefreshRunResponse,
  GraphRefreshDefaultsResponse,
  RefreshBindingConfig,
} from './types';

export async function getConceptRefreshBinding(conceptId: string): Promise<ConceptRefreshBindingResponse> {
  const res = await fetch(`${API_BASE_URL}/refresh/concepts/${encodeURIComponent(conceptId)}`, {
    headers: await getApiHeaders(),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Failed to fetch concept refresh binding: ${res.statusText}${t ? ` - ${t}` : ''}`);
  }
  return res.json();
}

export async function updateConceptRefreshBinding(
  conceptId: string,
  config: RefreshBindingConfig
): Promise<ConceptRefreshBindingResponse> {
  const res = await fetch(`${API_BASE_URL}/refresh/concepts/${encodeURIComponent(conceptId)}`, {
    method: 'PUT',
    headers: await getApiHeaders(),
    body: JSON.stringify({ config }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Failed to update concept refresh binding: ${res.statusText}${t ? ` - ${t}` : ''}`);
  }
  return res.json();
}

export async function runConceptRefresh(
  conceptId: string,
  options?: { trigger?: string; force?: boolean }
): Promise<ConceptRefreshRunResponse> {
  const res = await fetch(`${API_BASE_URL}/refresh/concepts/${encodeURIComponent(conceptId)}/run`, {
    method: 'POST',
    headers: await getApiHeaders(),
    body: JSON.stringify({
      trigger: options?.trigger || 'manual',
      force: Boolean(options?.force),
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Failed to run concept refresh: ${res.statusText}${t ? ` - ${t}` : ''}`);
  }
  return res.json();
}

export async function getGraphRefreshDefaults(graphId: string): Promise<GraphRefreshDefaultsResponse> {
  const res = await fetch(`${API_BASE_URL}/refresh/graphs/${encodeURIComponent(graphId)}`, {
    headers: await getApiHeaders(),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Failed to fetch graph refresh defaults: ${res.statusText}${t ? ` - ${t}` : ''}`);
  }
  return res.json();
}

export async function updateGraphRefreshDefaults(
  graphId: string,
  refreshDefaults: RefreshBindingConfig
): Promise<GraphRefreshDefaultsResponse> {
  const res = await fetch(`${API_BASE_URL}/refresh/graphs/${encodeURIComponent(graphId)}`, {
    method: 'PUT',
    headers: await getApiHeaders(),
    body: JSON.stringify({ refresh_defaults: refreshDefaults }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Failed to update graph refresh defaults: ${res.statusText}${t ? ` - ${t}` : ''}`);
  }
  return res.json();
}

