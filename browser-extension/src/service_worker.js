const DEFAULT_API_BASE = "http://localhost:8000";

async function getSettings() {
  const stored = await chrome.storage.local.get(["apiBase"]);
  return { apiBase: stored.apiBase || DEFAULT_API_BASE };
}

// Queue shape:
// { id, createdAt, status: "queued"|"running"|"done"|"error", payload, result, error }
async function loadQueue() {
  const stored = await chrome.storage.local.get(["captureQueue"]);
  return stored.captureQueue || [];
}

async function saveQueue(queue) {
  await chrome.storage.local.set({ captureQueue: queue });
}

function makeId() {
  return `cap_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

async function enqueueCapture(payload) {
  const queue = await loadQueue();
  const item = {
    id: makeId(),
    createdAt: new Date().toISOString(),
    status: "queued",
    payload,
    result: null,
    error: null
  };
  queue.unshift(item);
  // Keep last 50 items to avoid unbounded growth
  const trimmed = queue.slice(0, 50);
  await saveQueue(trimmed);
  return item;
}

async function updateItem(id, patch) {
  const queue = await loadQueue();
  const idx = queue.findIndex((x) => x.id === id);
  if (idx === -1) return null;
  queue[idx] = { ...queue[idx], ...patch };
  await saveQueue(queue);
  return queue[idx];
}

// Prefer content_script messaging (more stable than inline executeScript)
async function extractFromTab(tabId, mode) {
  // Prefer content_script messaging (more stable than inline executeScript)
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "BW_EXTRACT", mode });
    return res;
  } catch (e) {
    // Fallback to inline script if content script isn't ready yet (rare)
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "ISOLATED",
      func: (mode) => {
        const t = (document.body?.innerText || "").trim();
        return { ok: true, mode_used: mode, selection_text: null, text: t, meta: { url: location.href, title: document.title } };
      },
      args: [mode]
    });
    return result;
  }
}

function safeHostname(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

function clampText(text, maxChars) {
  const t = (text || "").trim();
  if (t.length <= maxChars) return { text: t, truncated: false };
  return { text: t.slice(0, maxChars), truncated: true };
}

async function runCaptureNow(item) {
  const { apiBase } = await getSettings();

  // Mark running
  await updateItem(item.id, { status: "running", startedAt: new Date().toISOString() });

  const { tabId, url, title, capture_mode, domain, tags, note, metadata } = item.payload;

  // Extract inside tab
  const extracted = await extractFromTab(tabId, capture_mode);

  const extractedTextRaw = (extracted?.text || "").trim();
  if (!extractedTextRaw && extracted?.mode_used !== "pdf") {
    throw new Error(
      capture_mode === "selection"
        ? "No selected text found. Highlight something and try again."
        : "No extractable text found on this page."
    );
  }

  // Guard payload size
  const { text: extractedText, truncated } = clampText(extractedTextRaw, 250_000);

  const payload = {
    url,
    title: title || extracted?.meta?.title || null,
    capture_mode: extracted?.mode_used || capture_mode,
    text: extractedText,
    selection_text: extracted?.selection_text || null,
    domain,
    tags,
    note,
    metadata: {
      ...(metadata || {}),
      // new metadata from extraction
      ...(extracted?.meta || {}),
      site_hostname: safeHostname(url),
      captured_at: new Date().toISOString(),
      extraction_mode: extracted?.mode_used || capture_mode,
      truncated
    }
  };

  // Call backend
  const res = await fetch(`${apiBase}/web/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.detail || `Capture failed: ${res.status}`);

  await updateItem(item.id, {
    status: "done",
    finishedAt: new Date().toISOString(),
    result: data,
    error: null
  });

  return data;
}

let runnerActive = false;

async function pumpQueue() {
  if (runnerActive) return;
  runnerActive = true;

  try {
    const queue = await loadQueue();
    const next = queue.find((x) => x.status === "queued");
    if (!next) return;

    try {
      await runCaptureNow(next);
    } catch (e) {
      await updateItem(next.id, {
        status: "error",
        finishedAt: new Date().toISOString(),
        error: e?.message || String(e)
      });
    }

    // Keep pumping in case multiple queued
    await pumpQueue();
  } finally {
    runnerActive = false;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === "BW_CAPTURE_ENQUEUE") {
      const item = await enqueueCapture(msg.payload);
      // Start runner
      await pumpQueue();
      sendResponse({ ok: true, itemId: item.id });
      return;
    }

    if (msg?.type === "BW_CAPTURE_LIST") {
      const queue = await loadQueue();
      sendResponse({ ok: true, queue });
      return;
    }

    if (msg?.type === "BW_CAPTURE_CLEAR") {
      await saveQueue([]);
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message type" });
  })();

  return true; // async response
});

// Opportunistic pump at startup
pumpQueue().catch(() => {});
