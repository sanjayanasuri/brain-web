// frontend/lib/offline/invalidate.ts
import { readManifest, writeManifest, readBootstrap, cacheBootstrap } from "./cache_db";

async function fetchJSON(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

/**
 * Returns true if cache is fresh, false if stale (and it refreshes).
 */
export async function ensureFreshOfflineCache(params: { graph_id: string; branch_id: string }) {
  const { graph_id, branch_id } = params;

  // If offline, we cannot validate.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;

  const cachedManifest = await readManifest(graph_id, branch_id);
  let serverManifest: any;

  try {
    serverManifest = await fetchJSON(
      `/offline/manifest?graph_id=${encodeURIComponent(graph_id)}&branch_id=${encodeURIComponent(branch_id)}`
    );
  } catch {
    return true; // treat as "ok" if server unreachable
  }

  await writeManifest(graph_id, branch_id, serverManifest);

  const stale =
    !cachedManifest ||
    cachedManifest.graph_updated_at !== serverManifest.graph_updated_at ||
    cachedManifest.branch_updated_at !== serverManifest.branch_updated_at ||
    JSON.stringify(cachedManifest.counts ?? {}) !== JSON.stringify(serverManifest.counts ?? {});

  if (!stale) return true;

  // If stale, re-bootstrap and overwrite caches
  const freshBootstrap = await fetchJSON(
    `/offline/bootstrap?graph_id=${encodeURIComponent(graph_id)}&branch_id=${encodeURIComponent(branch_id)}`
  );
  await cacheBootstrap(graph_id, branch_id, freshBootstrap);

  return false;
}
