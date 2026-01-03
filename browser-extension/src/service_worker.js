// browser-extension/src/service_worker.js
import { BW_IDB } from "./idb_bw.js";

const DEFAULT_API_BASE = "http://localhost:8000";

// -------------------------
// Settings / identity
// -------------------------
async function getSettings() {
  const stored = await chrome.storage.local.get(["apiBase"]);
  return { apiBase: stored.apiBase || DEFAULT_API_BASE };
}

async function getOrCreateDeviceId() {
  // Prefer meta store, fallback to chrome storage for first run.
  let deviceId = await BW_IDB.metaGet("device_id");
  if (deviceId) return deviceId;

  const stored = await chrome.storage.local.get(["bw_device_id"]);
  deviceId = stored.bw_device_id || null;

  if (!deviceId) {
    deviceId = `dev_${Math.random().toString(16).slice(2)}_${Date.now()}`;
    await chrome.storage.local.set({ bw_device_id: deviceId });
  }

  await BW_IDB.metaSet("device_id", deviceId);
  return deviceId;
}

async function nextSeq(deviceId) {
  const key = `seq::${deviceId}`;
  const last = (await BW_IDB.metaGet(key)) || 0;
  const nxt = last + 1;
  await BW_IDB.metaSet(key, nxt);
  return nxt;
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function clampText(text, maxChars) {
  const t = (text || "").trim();
  if (t.length <= maxChars) return { text: t, truncated: false };
  return { text: t.slice(0, maxChars), truncated: true };
}

// -------------------------
// Extraction
// -------------------------
async function extractFromTab(tabId, mode) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "BW_EXTRACT", mode });
    return res;
  } catch (e) {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: (mode) => {
        const t = (document.body?.innerText || "").trim();
        return {
          ok: true,
          mode_used: mode,
          selection_text: null,
          text: t,
          meta: { url: location.href, title: document.title }
        };
      },
      args: [mode]
    });
    return result;
  }
}

// -------------------------
// Event envelope (Phase 1)
// -------------------------
function nowIso() {
  return new Date().toISOString();
}

function makeEventId() {
  return `evt_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

/**
 * Phase 1 event type:
 * artifact.ingested
 *
 * We store the full text in payload for offline integrity.
 * We still POST /web/ingest directly for now.
 */
async function createArtifactIngestEvent({ graph_id, trail_id, payload }) {
  const device_id = await getOrCreateDeviceId();
  const seq = await nextSeq(device_id);

  return {
    event_id: makeEventId(),
    device_id,
    seq,
    created_at: nowIso(),
    graph_id: graph_id || "default",
    trail_id: trail_id || null,
    type: "artifact.ingested",
    status: "queued", // queued|running|acked|error
    attempts: 0,
    last_error: null,
    payload
  };
}

// -------------------------
// Enqueue capture
// -------------------------
async function enqueueCaptureAsEvent(capturePayload) {
  // capturePayload is the light “intent” object you already build (tabId/url/title/mode/etc.)
  // We do extraction at delivery time so events include actual extracted text.
  // (You can move extraction earlier later if you want.)
  const evt = await createArtifactIngestEvent({
    graph_id: capturePayload.graph_id || capturePayload.graphId || "default",
    trail_id: capturePayload.trail_id || capturePayload.trailId || null,
    payload: {
      kind: "web_capture_intent",
      capture_intent: capturePayload
    }
  });

  await BW_IDB.eventPut(evt);
  await BW_IDB.eventsTrim(500);
  return evt;
}

// -------------------------
// Delivery (Phase 1)
// -------------------------
async function deliverArtifactIngestEvent(evt) {
  const { apiBase } = await getSettings();

  // Mark running
  await BW_IDB.eventPatch(evt.event_id, {
    status: "running",
    started_at: nowIso(),
    attempts: (evt.attempts || 0) + 1
  });

  const intent = evt.payload?.capture_intent;
  if (!intent?.tabId || !intent?.url) {
    throw new Error("Invalid capture event payload: missing tabId/url");
  }

  const { tabId, url, title, capture_mode, domain, tags, note, metadata } = intent;

  const extracted = await extractFromTab(tabId, capture_mode);
  const extractedTextRaw = (extracted?.text || "").trim();

  if (!extractedTextRaw && extracted?.mode_used !== "pdf") {
    throw new Error(
      capture_mode === "selection"
        ? "No selected text found. Highlight something and try again."
        : "No extractable text found on this page."
    );
  }

  const { text: extractedText, truncated } = clampText(extractedTextRaw, 250_000);

  // Build the same payload your backend already expects today
  const ingestPayload = {
    url,
    title: title || extracted?.meta?.title || null,
    capture_mode: extracted?.mode_used || capture_mode,
    text: extractedText,
    selection_text: extracted?.selection_text || null,
    anchor: extracted?.anchor || null,
    domain,
    tags,
    note,
    metadata: {
      ...(metadata || {}),
      ...(extracted?.meta || {}),
      site_hostname: safeHostname(url),
      captured_at: nowIso(),
      extraction_mode: extracted?.mode_used || capture_mode,
      truncated,
      // Phase 1: include event identifiers for traceability
      bw_event_id: evt.event_id,
      bw_device_id: evt.device_id,
      bw_seq: evt.seq,
      bw_graph_id: evt.graph_id,
      bw_trail_id: evt.trail_id
    }
  };

  const res = await fetch(`${apiBase}/web/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ingestPayload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.detail || `Capture failed: ${res.status}`);
  }

  await BW_IDB.eventPatch(evt.event_id, {
    status: "acked",
    finished_at: nowIso(),
    result: data,
    last_error: null
  });

  return data;
}

// -------------------------
// Pump (singleflight)
// -------------------------
let runnerActive = false;

async function pumpEvents() {
  if (runnerActive) return;
  runnerActive = true;

  try {
    // Prefer queued first; also allow retrying errors later if you want.
    const queued = await BW_IDB.eventsListByStatus("queued", 25);
    if (!queued.length) return;

    // Deliver in seq order for determinism
    queued.sort((a, b) => (a.seq || 0) - (b.seq || 0));

    for (const evt of queued) {
      try {
        if (evt.type === "artifact.ingested") {
          await deliverArtifactIngestEvent(evt);
        } else {
          // Unknown event type => mark error (future-proofing)
          await BW_IDB.eventPatch(evt.event_id, {
            status: "error",
            finished_at: nowIso(),
            last_error: `Unknown event type: ${evt.type}`
          });
        }
      } catch (e) {
        await BW_IDB.eventPatch(evt.event_id, {
          status: "error",
          finished_at: nowIso(),
          last_error: e?.message || String(e)
        });
        // Do not block delivery of later events; keep going.
      }
    }
  } finally {
    runnerActive = false;
  }
}

// Opportunistic pump at startup
pumpEvents().catch(() => {});

// Also pump when connection comes back (best-effort)
self.addEventListener("online", () => {
  pumpEvents().catch(() => {});
});

// -------------------------
// Toast helper (unchanged)
// -------------------------
async function showToast(tabId, message, actions = []) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "BW_SHOW_TOAST",
      message,
      actions
    });
  } catch (e) {
    // ignore
  }
}

// -------------------------
// Trails helpers (unchanged)
// -------------------------
async function getActiveTrailName(apiBase) {
  try {
    const trailId = await getActiveTrailId();
    if (!trailId) return null;
    const res = await fetch(`${apiBase}/trails/${trailId}`);
    if (res.ok) {
      const data = await res.json();
      return data.title;
    }
  } catch {}
  return null;
}

async function getActiveTrail(apiBase) {
  try {
    const res = await fetch(`${apiBase}/trails?status=active&limit=1`);
    if (res.ok) {
      const data = await res.json();
      return data.trails?.[0] || null;
    }
  } catch {}
  return null;
}

async function createTrail(apiBase, title) {
  const res = await fetch(`${apiBase}/trails/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, pinned: false })
  });
  if (!res.ok) throw new Error("Failed to create trail");
  return res.json();
}

async function getActiveTrailId() {
  const { activeTrailId } = await chrome.storage.local.get(["activeTrailId"]);
  return activeTrailId || null;
}

async function setActiveTrailId(trailId) {
  await chrome.storage.local.set({ activeTrailId: trailId });
}

// -------------------------
// Runtime messages
// -------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === "BW_CAPTURE_ENQUEUE") {
      const evt = await enqueueCaptureAsEvent(msg.payload);
      await pumpEvents();
      sendResponse({ ok: true, event_id: evt.event_id });
      return;
    }

    if (msg?.type === "BW_CAPTURE_LIST") {
      // Back-compat: provide counts by status rather than full dump
      const queued = await BW_IDB.eventsCountByStatus("queued");
      const running = await BW_IDB.eventsCountByStatus("running");
      const acked = await BW_IDB.eventsCountByStatus("acked");
      const error = await BW_IDB.eventsCountByStatus("error");
      sendResponse({ ok: true, counts: { queued, running, acked, error } });
      return;
    }

    if (msg?.type === "BW_CAPTURE_CLEAR") {
      // For Phase 1, do not implement destructive wipe here.
      // Keep the event log as audit trail. You can add a UI to “archive” later.
      sendResponse({ ok: false, error: "Clear not supported in offline-first mode (Phase 1)." });
      return;
    }

    if (msg?.type === "BW_PUMP_NOW") {
      await pumpEvents();
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message type" });
  })();

  return true;
});

// -------------------------
// Keyboard commands
// -------------------------
chrome.commands.onCommand.addListener(async (command) => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab?.url) return;

    const { apiBase } = await getSettings();

    if (command === "capture-selection") {
      const extracted = await extractFromTab(tab.id, "selection");
      if (!extracted?.selection_text) {
        showToast(tab.id, "No selection found. Highlight text first.");
        return;
      }

      const payload = {
        tabId: tab.id,
        url: tab.url,
        title: tab.title || null,
        capture_mode: "selection",
        domain: safeHostname(tab.url) || "General",
        tags: [],
        note: null,
        metadata: { initiated_at: nowIso(), via: "keyboard_shortcut" }
      };

      await enqueueCaptureAsEvent(payload);
      await pumpEvents();

      const trailName = await getActiveTrailName(apiBase);
      showToast(tab.id, `Saved to Trail: ${trailName || "Default"}`, [
        { label: "Attach to concept", action: "attach" }
      ]);
    } else if (command === "capture-page") {
      const payload = {
        tabId: tab.id,
        url: tab.url,
        title: tab.title || null,
        capture_mode: "reader",
        domain: safeHostname(tab.url) || "General",
        tags: [],
        note: null,
        metadata: { initiated_at: nowIso(), via: "keyboard_shortcut" }
      };

      await enqueueCaptureAsEvent(payload);
      await pumpEvents();

      const trailName = await getActiveTrailName(apiBase);
      showToast(tab.id, `Saved to Trail: ${trailName || "Default"}`);
    } else if (command === "start-trail") {
      const activeTrail = await getActiveTrail(apiBase);
      if (activeTrail) {
        showToast(tab.id, `Resuming trail: ${activeTrail.title}`);
      } else {
        const title = `Trail ${new Date().toLocaleDateString()}`;
        const trail = await createTrail(apiBase, title);
        await setActiveTrailId(trail.trail_id);
        showToast(tab.id, `Started trail: ${title}`);
      }
    } else if (command === "extend-mode") {
      chrome.action.openPopup();
    }
  } catch (error) {
    console.error("[ServiceWorker] Command error:", error);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) showToast(tab.id, `Error: ${error.message}`);
  }
});
