// frontend/lib/search/search_router.ts
import { offlineSearchArtifacts } from "@/lib/offline/offline_search";

async function fetchJSON(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

/**
 * If offlineSearchEnabled:
 * - If offline: use offline artifacts search
 * - If online: use offline first, if weak results then call server search
 */
export async function searchAll(params: {
  query: string;
  offlineSearchEnabled: boolean;
  graph_id?: string;
  branch_id?: string;
}) {
  const q = params.query.trim();
  if (!q) return { mode: "none", results: [] };

  const online = typeof navigator === "undefined" ? true : navigator.onLine;

  if (params.offlineSearchEnabled) {
    const local = await offlineSearchArtifacts(q, 20, params.graph_id, params.branch_id);
    if (!online) return { mode: "offline", results: local };

    // online: if local results are good, keep them; otherwise fallback to server
    if (local.length >= 6) return { mode: "offline", results: local };

    // server fallback (your existing /resources/search or semantic search endpoint)
    // choose one:
    // - resources search: /resources/search?query=...
    // - semantic search: /semantic-search
    const server = await fetchJSON(`/resources/search?query=${encodeURIComponent(q)}&limit=20`);
    return { mode: "hybrid", results: server };
  }

  // offline search disabled: always server when online
  if (!online) return { mode: "offline", results: [] };
  const server = await fetchJSON(`/resources/search?query=${encodeURIComponent(q)}&limit=20`);
  return { mode: "online", results: server };
}
