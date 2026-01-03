// frontend/lib/offline/db.ts
import { openDB, DBSchema, IDBPDatabase } from "idb";

export type OutboxStatus = "queued" | "sending" | "acked" | "failed";

export type OutboxEventType =
  | "artifact.ingest"
  | "resource.create"
  | "resource.link"
  | "trail.step.append"
  | "concept.create"
  | "concept.update"
  | "relationship.propose"
  | "relationship.accept"
  | "feedback.create";

export interface LocalArtifact {
  artifact_id: string; // deterministic recommended (sha256) or server-issued after sync
  graph_id: string;
  branch_id: string;
  url: string;
  title?: string;
  domain?: string;
  captured_at: number; // ms
  content_hash: string;
  text: string;
  metadata?: Record<string, any>;
  status?: "local_only" | "synced" | "failed";
  last_error?: string;
  updated_at: number; // ms
}

export interface OutboxEvent {
  event_id: string; // uuid/ulid
  graph_id: string;
  branch_id: string;
  type: OutboxEventType;
  payload: Record<string, any>;
  status: OutboxStatus;
  attempts: number;
  created_at: number; // ms
  updated_at: number; // ms
  last_error?: string;
  last_http_status?: number;
  // Optional dependency ordering: if set, drain will prefer older first anyway.
  depends_on?: string[];
}

export interface LocalConceptCache {
  graph_id: string;
  node_id: string;
  name: string;
  domain?: string;
  type?: string;
  updated_at: number; // ms
}

export interface LocalTrailState {
  graph_id: string;
  branch_id: string;
  trail_id: string;
  title?: string;
  // keep minimal: UI resume pointers
  focused_concept_id?: string;
  focused_quote_id?: string;
  last_step_index?: number;
  updated_at: number; // ms
}

interface BrainWebOfflineDB extends DBSchema {
  artifacts: {
    key: string; // artifact_id
    value: LocalArtifact;
    indexes: { "by_graph_branch": string; "by_url": string };
  };
  outbox: {
    key: string; // event_id
    value: OutboxEvent;
    indexes: { "by_status_created": string; "by_graph_branch": string };
  };
  concept_cache: {
    key: string; // `${graph_id}:${node_id}`
    value: LocalConceptCache;
    indexes: { "by_graph": string; "by_name": string };
  };
  trail_state: {
    key: string; // `${graph_id}:${branch_id}:${trail_id}`
    value: LocalTrailState;
    indexes: { "by_graph_branch": string };
  };
}

let _db: Promise<IDBPDatabase<BrainWebOfflineDB>> | null = null;

export function getOfflineDB(): Promise<IDBPDatabase<BrainWebOfflineDB>> {
  if (_db) return _db;

  _db = openDB<BrainWebOfflineDB>("brainweb_offline_v1", 1, {
    upgrade(db) {
      const artifacts = db.createObjectStore("artifacts", { keyPath: "artifact_id" });
      artifacts.createIndex("by_graph_branch", "graph_id");
      artifacts.createIndex("by_url", "url");

      const outbox = db.createObjectStore("outbox", { keyPath: "event_id" });
      // Encode composite sort key into one string index
      outbox.createIndex("by_status_created", "statusCreatedKey");
      outbox.createIndex("by_graph_branch", "graphBranchKey");

      const concepts = db.createObjectStore("concept_cache", { keyPath: "cache_key" });
      concepts.createIndex("by_graph", "graph_id");
      concepts.createIndex("by_name", "name_lc");

      const trails = db.createObjectStore("trail_state", { keyPath: "trail_key" });
      trails.createIndex("by_graph_branch", "graphBranchKey");
    },
  });

  return _db;
}

// Helpers to create derived keys used by indexes
export function enrichOutboxEvent(e: OutboxEvent) {
  // index fields
  (e as any).statusCreatedKey = `${e.status}:${String(e.created_at).padStart(15, "0")}`;
  (e as any).graphBranchKey = `${e.graph_id}:${e.branch_id}`;
  return e;
}

export function makeConceptCacheKey(graph_id: string, node_id: string) {
  return `${graph_id}:${node_id}`;
}

export function makeTrailKey(graph_id: string, branch_id: string, trail_id: string) {
  return `${graph_id}:${branch_id}:${trail_id}`;
}
