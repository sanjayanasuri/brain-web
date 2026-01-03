// frontend/lib/offline/capture.ts
import { enqueueOutboxEvent } from "./outbox";

export type CaptureMode = "selection" | "full_page";

export async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const arr = Array.from(new Uint8Array(buf));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function getDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

export function extractSelectionText(): string {
  const sel = window.getSelection?.();
  const txt = sel?.toString() ?? "";
  return txt.trim();
}

export function extractPageText(): string {
  // conservative “readability-lite”: avoids scripts/styles
  const el = document.body?.cloneNode(true) as HTMLElement | null;
  if (!el) return "";

  el.querySelectorAll("script, style, noscript, iframe").forEach((n) => n.remove());

  // collapse whitespace
  const text = el.innerText || "";
  return text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function captureWebpageToOutbox(params: {
  graph_id: string;
  branch_id: string;
  url?: string;
  title?: string;
  mode: CaptureMode;
  // optional override (extension can pass already-extracted text)
  text_override?: string;
  // extra metadata: selection anchor, viewport, etc.
  metadata?: Record<string, any>;
}) {
  const url = params.url ?? window.location.href;
  const title = params.title ?? document.title;
  const domain = getDomain(url);

  const text =
    params.text_override ??
    (params.mode === "selection" ? extractSelectionText() : extractPageText());

  if (!text || text.length < 20) {
    // keep it strict: prevents syncing garbage
    throw new Error("capture produced empty/too-short text");
  }

  const content_hash = await sha256Hex(`${url}\n\n${text}`);

  // optional stable artifact id (you can also let server generate)
  const artifact_id = `A_${content_hash.slice(0, 12).toUpperCase()}`;

  const captured_at = Date.now();
  const payload = {
    artifact_id,
    url,
    title,
    domain,
    captured_at,
    content_hash,
    text,
    metadata: {
      mode: params.mode,
      ...params.metadata,
    },
  };

  const event_id = await enqueueOutboxEvent({
    graph_id: params.graph_id,
    branch_id: params.branch_id,
    type: "artifact.ingest",
    payload,
  });

  return { event_id, artifact_id, content_hash };
}
