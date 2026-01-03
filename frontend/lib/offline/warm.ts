// frontend/lib/offline/warm.ts
import { cacheBootstrap } from "./cache_db";

async function fetchJSON(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

/**
 * Warms local cache with artifacts/resources/concepts bundle.
 * We store them using the same stores as bootstrap does.
 */
export async function warmOfflineCache(params: {
  graph_id: string;
  branch_id: string;
  trail_id?: string;
  urls?: string[];
  artifact_ids?: string[];
  limit?: number;
}) {
  const body = {
    graph_id: params.graph_id,
    branch_id: params.branch_id,
    trail_id: params.trail_id ?? null,
    urls: params.urls ?? null,
    artifact_ids: params.artifact_ids ?? null,
    limit: params.limit ?? 50,
  };

  const bundle = await fetchJSON("/offline/warm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // Reuse bootstrap caching path by shaping the same keys
  const shaped = {
    graph_id: params.graph_id,
    branch_id: params.branch_id,
    recent_artifacts: bundle.artifacts ?? [],
    pinned_concepts: bundle.concepts ?? [],
    recent_trails: [], // warm endpoint doesn't return trails by design
  };

  await cacheBootstrap(params.graph_id, params.branch_id, shaped);
  return bundle;
}
