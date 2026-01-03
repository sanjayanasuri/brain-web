// frontend/lib/offline/events.ts
import { enqueueOutboxEvent, makeClientEventId } from "./outbox";

export async function outboxCreateResource(params: {
  graph_id: string;
  branch_id: string;
  resource_id?: string;
  kind: string;
  url: string;
  title?: string;
  mime_type?: string;
  caption?: string;
  source?: string;
  metadata?: Record<string, any>;
}) {
  const event_id = makeClientEventId();
  const resource_id = params.resource_id ?? `R_${event_id.slice(0, 10).toUpperCase()}`;

  await enqueueOutboxEvent({
    graph_id: params.graph_id,
    branch_id: params.branch_id,
    type: "resource.create",
    payload: { ...params, resource_id },
    event_id,
  });

  return { event_id, resource_id };
}

export async function outboxLinkResource(params: {
  graph_id: string;
  branch_id: string;
  concept_id: string;
  resource_id: string;
}) {
  const event_id = makeClientEventId();
  await enqueueOutboxEvent({
    graph_id: params.graph_id,
    branch_id: params.branch_id,
    type: "resource.link",
    payload: params,
    event_id,
  });
  return { event_id };
}

export async function outboxAppendTrailStep(params: {
  graph_id: string;
  branch_id: string;
  trail_id: string;
  kind: string; // "open_page" | "ask" | "note" | "followup"
  label?: string;
  note?: string;
  focus_concept_id?: string;
  focus_quote_id?: string;
  page_url?: string;
}) {
  const event_id = makeClientEventId();
  const step_id = `TS_${event_id.slice(0, 10).toUpperCase()}`;

  await enqueueOutboxEvent({
    graph_id: params.graph_id,
    branch_id: params.branch_id,
    type: "trail.step.append",
    payload: { ...params, step_id, created_at_ms: Date.now() },
    event_id,
  });

  return { event_id, step_id };
}
