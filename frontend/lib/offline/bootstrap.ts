// frontend/lib/offline/bootstrap.ts
import { cacheBootstrap, readBootstrap } from "./cache_db";

async function fetchJSON(url: string) {
  const res = await fetch(url);
  if (!res.ok) {
    // Don't throw for 404s - graph might not exist yet
    if (res.status === 404) {
      return null;
    }
    throw new Error(`HTTP ${res.status}`);
  }
  return await res.json();
}

/**
 * Strategy:
 * - If offline, return cached bootstrap
 * - If online, return cached bootstrap immediately (if exists) and revalidate in background
 *   (callers can just call again or listen to an event if you want)
 */
export async function getOfflineBootstrap(params: { graph_id: string; branch_id: string }) {
  const { graph_id, branch_id } = params;

  const cached = await readBootstrap(graph_id, branch_id);

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return cached ?? null;
  }

  // online: revalidate
  try {
    const fresh = await fetchJSON(
      `/api/offline/bootstrap?graph_id=${encodeURIComponent(graph_id)}&branch_id=${encodeURIComponent(branch_id)}`
    );
    // If fetch returned null (404), return cached data if available
    if (fresh === null) {
      return cached ?? null;
    }
    await cacheBootstrap(graph_id, branch_id, fresh);
    return fresh;
  } catch {
    return cached ?? null;
  }
}
