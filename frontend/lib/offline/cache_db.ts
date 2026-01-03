// frontend/lib/offline/cache_db.ts
// IndexedDB cache for offline mode.
// Stores are keyed by graph+branch where applicable to keep isolation clean.

export type OfflineBootstrap = {
    graph_id: string;
    branch_id: string;
    recent_artifacts: any[];
    pinned_concepts: any[];
    recent_trails: any[];
    server_time?: string;
  };
  
  type StoreName = "bootstrap" | "artifact" | "trail" | "concept" | "manifest";
  
  const DB_NAME = "brainweb_offline";
  const DB_VERSION = 2;
  
  function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
  
      req.onupgradeneeded = () => {
        const db = req.result;
  
        if (!db.objectStoreNames.contains("bootstrap")) {
          db.createObjectStore("bootstrap", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("artifact")) {
          db.createObjectStore("artifact", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("trail")) {
          db.createObjectStore("trail", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("concept")) {
          db.createObjectStore("concept", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("manifest")) {
          db.createObjectStore("manifest", { keyPath: "key" });
        }
      };
  
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  
  function tx<T>(db: IDBDatabase, store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const r = fn(s);
  
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
  
      t.onabort = () => reject(t.error);
    });
  }
  
  async function get<T>(store: StoreName, key: string): Promise<T | undefined> {
    const db = await openDB();
    return await tx<T | undefined>(db, store, "readonly", (s) => s.get(key));
  }
  
  async function put<T>(store: StoreName, value: T): Promise<void> {
    const db = await openDB();
    await tx(db, store, "readwrite", (s) => s.put(value as any));
  }
  
  async function del(store: StoreName, key: string): Promise<void> {
    const db = await openDB();
    await tx(db, store, "readwrite", (s) => s.delete(key));
  }
  
  async function getAll<T>(store: StoreName): Promise<T[]> {
    const db = await openDB();
    return await tx<T[]>(db, store, "readonly", (s) => s.getAll());
  }
  
  function kGraph(graph_id: string, branch_id: string) {
    return `${graph_id}:${branch_id}`;
  }
  
  function kBootstrap(graph_id: string, branch_id: string) {
    return `bootstrap:${kGraph(graph_id, branch_id)}`;
  }
  
  function kArtifact(graph_id: string, branch_id: string, url: string) {
    return `artifact:${kGraph(graph_id, branch_id)}:${url}`;
  }
  
  function kTrail(graph_id: string, branch_id: string, trail_id: string) {
    return `trail:${kGraph(graph_id, branch_id)}:${trail_id}`;
  }
  
  function kConcept(graph_id: string, branch_id: string, node_id: string) {
    return `concept:${kGraph(graph_id, branch_id)}:${node_id}`;
  }
  
  function kManifest(graph_id: string, branch_id: string) {
    return `manifest:${kGraph(graph_id, branch_id)}`;
  }
  
  // ----------------------------------------
  // Bootstrap
  // ----------------------------------------
  
  export async function cacheBootstrap(graph_id: string, branch_id: string, payload: OfflineBootstrap): Promise<void> {
    await put("bootstrap", {
      key: kBootstrap(graph_id, branch_id),
      graph_id,
      branch_id,
      cached_at_ms: Date.now(),
      payload,
    });
  
    // Also shard artifacts/concepts/trails into their own stores for fast offline lookup.
    const artifacts = payload.recent_artifacts ?? [];
    for (const a of artifacts) {
      const url = a?.url;
      if (typeof url === "string" && url.length > 0) {
        await cacheArtifact(graph_id, branch_id, url, a);
      }
    }
  
    const concepts = payload.pinned_concepts ?? [];
    for (const c of concepts) {
      const node_id = c?.node_id;
      if (typeof node_id === "string" && node_id.length > 0) {
        await cacheConcept(graph_id, branch_id, node_id, c);
      }
    }
  
    const trails = payload.recent_trails ?? [];
    for (const t of trails) {
      const trail_id = t?.trail_id;
      if (typeof trail_id === "string" && trail_id.length > 0) {
        await cacheTrail(graph_id, branch_id, trail_id, t);
      }
    }
  }
  
  export async function readBootstrap(graph_id: string, branch_id: string): Promise<OfflineBootstrap | null> {
    const row = await get<any>("bootstrap", kBootstrap(graph_id, branch_id));
    return row?.payload ?? null;
  }
  
  // ----------------------------------------
  // Artifacts
  // ----------------------------------------
  
  export async function cacheArtifact(graph_id: string, branch_id: string, url: string, artifact: any): Promise<void> {
    await put("artifact", {
      key: kArtifact(graph_id, branch_id, url),
      graph_id,
      branch_id,
      url,
      cached_at_ms: Date.now(),
      artifact,
    });
  }
  
  export async function readArtifactByUrl(graph_id: string, branch_id: string, url: string): Promise<any | null> {
    const row = await get<any>("artifact", kArtifact(graph_id, branch_id, url));
    return row?.artifact ?? null;
  }
  
  export async function listCachedArtifacts(graph_id?: string, branch_id?: string): Promise<any[]> {
    const rows = await getAll<any>("artifact");
    if (!graph_id || !branch_id) return rows.map((r) => r.artifact).filter(Boolean);
    return rows
      .filter((r) => r.graph_id === graph_id && r.branch_id === branch_id)
      .map((r) => r.artifact)
      .filter(Boolean);
  }
  
  // ----------------------------------------
  // Trails
  // ----------------------------------------
  
  export async function cacheTrail(graph_id: string, branch_id: string, trail_id: string, trail: any): Promise<void> {
    await put("trail", {
      key: kTrail(graph_id, branch_id, trail_id),
      graph_id,
      branch_id,
      trail_id,
      cached_at_ms: Date.now(),
      trail,
    });
  }
  
  export async function readTrail(graph_id: string, branch_id: string, trail_id: string): Promise<any | null> {
    const row = await get<any>("trail", kTrail(graph_id, branch_id, trail_id));
    return row?.trail ?? null;
  }
  
  // ----------------------------------------
  // Concepts
  // ----------------------------------------
  
  export async function cacheConcept(graph_id: string, branch_id: string, node_id: string, concept: any): Promise<void> {
    await put("concept", {
      key: kConcept(graph_id, branch_id, node_id),
      graph_id,
      branch_id,
      node_id,
      cached_at_ms: Date.now(),
      concept,
    });
  }
  
  export async function readConcept(graph_id: string, branch_id: string, node_id: string): Promise<any | null> {
    const row = await get<any>("concept", kConcept(graph_id, branch_id, node_id));
    return row?.concept ?? null;
  }
  
  // ----------------------------------------
  // Manifest (cache invalidation signal)
  // ----------------------------------------
  
  export async function writeManifest(graph_id: string, branch_id: string, manifest: any): Promise<void> {
    await put("manifest", {
      key: kManifest(graph_id, branch_id),
      graph_id,
      branch_id,
      cached_at_ms: Date.now(),
      manifest,
    });
  }
  
  export async function readManifest(graph_id: string, branch_id: string): Promise<any | null> {
    const row = await get<any>("manifest", kManifest(graph_id, branch_id));
    return row?.manifest ?? null;
  }
  
  // ----------------------------------------
  // Invalidation / maintenance
  // ----------------------------------------
  
  /**
   * Clears all cached entries for a given graph+branch.
   * Use this when switching graphs/branches or when manifest says stale.
   */
  export async function clearGraphBranch(graph_id: string, branch_id: string): Promise<void> {
    const prefix = `${kGraph(graph_id, branch_id)}:`;
  
    const stores: StoreName[] = ["artifact", "trail", "concept"];
    for (const store of stores) {
      const rows = await getAll<any>(store);
      for (const row of rows) {
        // row.key formats include "artifact:graph:branch:url", etc.
        if (typeof row?.key === "string" && row.key.includes(prefix)) {
          await del(store, row.key);
        }
      }
    }
  
    await del("bootstrap", kBootstrap(graph_id, branch_id));
    await del("manifest", kManifest(graph_id, branch_id));
  }
  