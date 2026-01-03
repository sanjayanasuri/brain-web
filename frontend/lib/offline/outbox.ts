// frontend/lib/offline/outbox.ts
import { getOfflineDB, enrichOutboxEvent, OutboxEvent, OutboxEventType, OutboxStatus } from "./db";

function nowMs() {
  return Date.now();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(ms: number) {
  // add up to 20% jitter
  const j = Math.floor(ms * 0.2 * Math.random());
  return ms + j;
}

function backoffMs(attempts: number) {
  // 0->500ms, 1->1s, 2->2s, 3->4s ... capped
  const base = Math.min(30_000, 500 * Math.pow(2, Math.max(0, attempts)));
  return jitter(base);
}

export function makeClientEventId() {
  // good enough; swap to ulid/uuidv7 if you prefer
  return crypto.randomUUID();
}

export async function enqueueOutboxEvent(params: {
  graph_id: string;
  branch_id: string;
  type: OutboxEventType;
  payload: Record<string, any>;
  event_id?: string;
  depends_on?: string[];
}): Promise<string> {
  const db = await getOfflineDB();
  const event_id = params.event_id ?? makeClientEventId();

  const e: OutboxEvent = enrichOutboxEvent({
    event_id,
    graph_id: params.graph_id,
    branch_id: params.branch_id,
    type: params.type,
    payload: params.payload,
    status: "queued",
    attempts: 0,
    created_at: nowMs(),
    updated_at: nowMs(),
    depends_on: params.depends_on,
  });

  await db.put("outbox", e as any);
  return event_id;
}

export async function markOutboxStatus(event_id: string, status: OutboxStatus, fields?: Partial<OutboxEvent>) {
  const db = await getOfflineDB();
  const existing = (await db.get("outbox", event_id)) as any;
  if (!existing) return;

  const updated: any = {
    ...existing,
    ...fields,
    status,
    updated_at: nowMs(),
  };
  enrichOutboxEvent(updated);
  await db.put("outbox", updated);
}

export async function drainOutbox(options?: {
  endpoint?: string; // default: /sync/events
  batchSize?: number; // default: 25
  maxBatches?: number; // default: 4
  minDelayBetweenBatchesMs?: number; // default: 150
}) {
  const endpoint = options?.endpoint ?? "/sync/events";
  const batchSize = options?.batchSize ?? 25;
  const maxBatches = options?.maxBatches ?? 4;
  const minDelay = options?.minDelayBetweenBatchesMs ?? 150;

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, reason: "offline" as const };
  }

  const db = await getOfflineDB();

  for (let batchNum = 0; batchNum < maxBatches; batchNum++) {
    // Pull queued or failed events, oldest first.
    // We store index as status:created_at, so query both prefixes.
    const tx = db.transaction("outbox", "readonly");
    const idx = tx.store.index("by_status_created");

    const queued: any[] = [];
    let cursor = await idx.openCursor(IDBKeyRange.bound("queued:", "queued:~"));
    while (cursor && queued.length < batchSize) {
      queued.push(cursor.value);
      cursor = await cursor.continue();
    }

    const failed: any[] = [];
    if (queued.length < batchSize) {
      cursor = await idx.openCursor(IDBKeyRange.bound("failed:", "failed:~"));
      while (cursor && queued.length + failed.length < batchSize) {
        failed.push(cursor.value);
        cursor = await cursor.continue();
      }
    }

    await tx.done;

    const batch = [...queued, ...failed].slice(0, batchSize);
    if (batch.length === 0) {
      return { ok: true as const, drained: true as const };
    }

    // Mark as sending
    for (const e of batch) {
      await markOutboxStatus(e.event_id, "sending");
    }

    // POST to backend
    let resp: Response | null = null;
    let body: any = null;
    try {
      resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // backend expects {"events":[...]}
        body: JSON.stringify({
          events: batch.map((e) => ({
            event_id: e.event_id,
            graph_id: e.graph_id,
            branch_id: e.branch_id,
            type: e.type,
            payload: e.payload,
            created_at: e.created_at,
          })),
        }),
      });

      body = await resp.json().catch(() => ({}));
    } catch (err: any) {
      // network error: mark back to queued/failed with backoff
      for (const e of batch) {
        const attempts = (e.attempts ?? 0) + 1;
        await markOutboxStatus(e.event_id, "failed", {
          attempts,
          last_error: err?.message ?? "network_error",
          last_http_status: undefined,
        } as any);
        await sleep(backoffMs(attempts));
      }
      return { ok: false as const, reason: "network_error" as const };
    }

    // Interpret per-event results
    const results: Array<{ event_id: string; status: "acked" | "failed"; error?: string; server_ids?: any }> =
      body?.results ?? [];

    const byId = new Map(results.map((r) => [r.event_id, r]));

    for (const e of batch) {
      const r = byId.get(e.event_id);
      if (!r) {
        const attempts = (e.attempts ?? 0) + 1;
        await markOutboxStatus(e.event_id, "failed", {
          attempts,
          last_error: `missing_result (http=${resp.status})`,
          last_http_status: resp.status,
        } as any);
        continue;
      }

      if (r.status === "acked" && resp.ok) {
        await markOutboxStatus(e.event_id, "acked", {
          last_error: undefined,
          last_http_status: resp.status,
        } as any);
      } else {
        const attempts = (e.attempts ?? 0) + 1;
        await markOutboxStatus(e.event_id, "failed", {
          attempts,
          last_error: r.error ?? `failed (http=${resp.status})`,
          last_http_status: resp.status,
        } as any);
      }
    }

    await sleep(minDelay);
  }

  return { ok: true as const, drained: false as const };
}

export function attachOutboxAutoSync() {
  if (typeof window === "undefined") return () => {};

  const onOnline = () => drainOutbox().catch(() => {});
  window.addEventListener("online", onOnline);

  // optional periodic drain (kept conservative)
  const interval = window.setInterval(() => {
    if (navigator.onLine) drainOutbox().catch(() => {});
  }, 8_000);

  return () => {
    window.removeEventListener("online", onOnline);
    window.clearInterval(interval);
  };
}
