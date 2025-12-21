async function getApiBase() {
  const { bw_api_base } = await chrome.storage.sync.get(["bw_api_base"]);
  return bw_api_base || "http://127.0.0.1:8000";
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setStatus(el, kind, text) {
  el.classList.remove("status--ok", "status--bad", "status--unknown");
  el.classList.add(kind);
  el.textContent = text;
}

async function pingBackend(apiBase) {
  // We can rely on GET / from your FastAPI main.py returning {"status":"ok"...}
  try {
    const res = await fetch(`${apiBase}/`, { method: "GET" });
    if (!res.ok) throw new Error(`Backend ping failed: ${res.status}`);
    return res.json();
  } catch (e) {
    // Try fallback if network error: localhost <-> 127.0.0.1
    if (e.message.includes("Failed to fetch") || e.message.includes("NetworkError")) {
      let fallbackBase = null;
      if (apiBase.includes("localhost")) {
        fallbackBase = apiBase.replace("localhost", "127.0.0.1");
      } else if (apiBase.includes("127.0.0.1")) {
        fallbackBase = apiBase.replace("127.0.0.1", "localhost");
      }
      
      if (fallbackBase) {
        try {
          const res = await fetch(`${fallbackBase}/`, { method: "GET" });
          if (res.ok) {
            // Update stored value to use the working URL
            await chrome.storage.sync.set({ bw_api_base: fallbackBase });
            return res.json();
          }
        } catch (fallbackError) {
          // Both failed, continue to error message
        }
      }
      
      // Both attempts failed
      throw new Error(`Cannot connect to ${apiBase}${fallbackBase ? ` or ${fallbackBase}` : ""}. Is the backend running?`);
    }
    throw e;
  }
}

function parseTags(raw) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function getSelectedMode() {
  const el = document.querySelector('input[name="mode"]:checked');
  return el ? el.value : "reader";
}

function formatQueue(queue) {
  if (!queue || queue.length === 0) return "No captures yet.";

  return queue
    .slice(0, 8)
    .map((item) => {
      const title = item?.payload?.title || item?.payload?.url || "Untitled";
      const status = item.status;
      const when = item.createdAt ? new Date(item.createdAt).toLocaleTimeString() : "";
      const result = item.result
        ? `run=${item.result.run_id || "—"} chunks=${item.result.chunks_created} claims=${item.result.claims_created}`
        : "";
      const err = item.error ? `error=${item.error}` : "";
      return `• [${status}] ${when} — ${title}\n  ${result || err}`.trim();
    })
    .join("\n\n");
}

async function refreshQueue() {
  const queueEl = document.getElementById("queue");
  queueEl.textContent = "Loading…";

  const resp = await chrome.runtime.sendMessage({ type: "BW_CAPTURE_LIST" });
  if (!resp?.ok) {
    queueEl.textContent = `Failed to load: ${resp?.error || "unknown error"}`;
    return;
  }

  queueEl.textContent = formatQueue(resp.queue);
}

async function main() {
  const statusEl = document.getElementById("status");
  const pageTitleEl = document.getElementById("pageTitle");
  const pageUrlEl = document.getElementById("pageUrl");
  const captureBtn = document.getElementById("captureBtn");
  const openBtn = document.getElementById("openBtn");
  const resultEl = document.getElementById("result");
  const refreshBtn = document.getElementById("refresh");
  const clearBtn = document.getElementById("clear");

  const apiBase = await getApiBase();
  const tab = await getActiveTab();

  pageTitleEl.textContent = tab?.title || "Untitled";
  pageUrlEl.textContent = tab?.url || "No URL";

  // Connectivity status
  try {
    await pingBackend(apiBase);
    setStatus(statusEl, "status--ok", "Connected");
    resultEl.textContent = "";
  } catch (e) {
    console.error("Backend connection error:", e);
    setStatus(statusEl, "status--bad", "Not running");
    resultEl.textContent = `${e.message}\n\nBackend URL: ${apiBase}`;
  }

  openBtn.addEventListener("click", async () => {
    // If your Next.js UI is at localhost:3000, open it.
    await chrome.tabs.create({ url: "http://localhost:3000" });
  });

  captureBtn.addEventListener("click", async () => {
    resultEl.textContent = "";

    const mode = getSelectedMode();
    const domain = document.getElementById("domain").value.trim() || "General";
    const tags = parseTags(document.getElementById("tags").value);
    const note = document.getElementById("note").value.trim() || null;

    if (!tab?.id || !tab?.url) {
      resultEl.textContent = "No active tab URL found.";
      return;
    }

    const payload = {
      tabId: tab.id,
      url: tab.url,
      title: tab.title || null,
      capture_mode: mode,
      domain,
      tags,
      note,
      metadata: {
        initiated_at: new Date().toISOString()
      }
    };

    const resp = await chrome.runtime.sendMessage({
      type: "BW_CAPTURE_ENQUEUE",
      payload
    });

    if (!resp?.ok) {
      resultEl.textContent = `Enqueue failed: ${resp?.error || "unknown error"}`;
      return;
    }

    resultEl.textContent = `Queued capture: ${resp.itemId}\nTip: If this is a PDF, use Selection mode for now unless you add PDF text extraction later.`;
    await refreshQueue();
  });

  refreshBtn.addEventListener("click", refreshQueue);

  clearBtn.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "BW_CAPTURE_CLEAR" });
    await refreshQueue();
  });

  await refreshQueue();
}

main();

