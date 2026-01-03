// frontend/lib/offline/offline_search.ts
import { listCachedArtifacts } from "./cache_db";

export async function offlineSearchArtifacts(query: string, limit = 20, graph_id?: string, branch_id?: string) {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const artifacts = await listCachedArtifacts(graph_id, branch_id);
  const scored = artifacts
    .map((a: any) => {
      const title = (a.title ?? "").toLowerCase();
      const domain = (a.domain ?? "").toLowerCase();
      const text = (a.text ?? "").toLowerCase();

      let score = 0;
      if (title.includes(q)) score += 5;
      if (domain.includes(q)) score += 2;

      // cheap: count occurrences in text, capped
      const idx = text.indexOf(q);
      if (idx >= 0) score += 3;

      return { score, a };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((x) => x.a);

  return scored;
}
