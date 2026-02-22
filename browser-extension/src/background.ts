type Anchor = {
  kind: "range_v1";
  start_xpath: string;
  start_offset: number;
  end_xpath: string;
  end_offset: number;
  selected_text_hash: string;
  rects?: Array<{ x: number; y: number; w: number; h: number }>;
};

type CaptureSelectionRequest = {
  selected_text: string;
  page_url: string;
  page_title?: string | null;
  frame_url?: string | null;

  attach_concept_id?: string | null;
  graph_id?: string | null;
  branch_id?: string | null;

  context_before?: string | null;
  context_after?: string | null;
  anchor?: Anchor | null;
};

const MENU_ID = "brainweb_add_selection";
const DEFAULT_API_BASE = "http://localhost:8000";
const SESSION_STORAGE_KEY = "BW_SESSION_ID";
const API_BASE_KEY = "BW_API_BASE";

async function getApiBase(): Promise<string> {
  const stored = await chrome.storage.local.get([API_BASE_KEY]);
  const syncStored = await chrome.storage.sync.get([API_BASE_KEY]);
  return (stored[API_BASE_KEY] as string) || (syncStored[API_BASE_KEY] as string) || DEFAULT_API_BASE;
}

function uuidLike(): string {
  // Good enough session ID generator for your middleware (<=128 chars).
  return crypto.randomUUID().replace(/-/g, "");
}

async function getOrCreateSessionId(): Promise<string> {
  const stored = await chrome.storage.local.get([SESSION_STORAGE_KEY]);
  const existing = stored[SESSION_STORAGE_KEY] as string | undefined;
  if (existing && existing.length <= 128) return existing;

  const sid = uuidLike();
  await chrome.storage.local.set({ [SESSION_STORAGE_KEY]: sid });
  return sid;
}

// Minimal fallback icon (1x1 transparent PNG) to prevent "Unable to download" errors
// if the main assets are flaky.
const FALLBACK_ICON_DATA = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

async function notify(title: string, message: string) {
  try {
    console.log(`[Brain Web] Notification: ${title} - ${message}`);

    if (!chrome.notifications) {
      console.warn(`[Brain Web] chrome.notifications API not available.`);
      return;
    }

    const notificationId = `brainweb-${Date.now()}`;

    // First attempt with the actual icon
    chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("assets/icon128.png"),
      title: title || "Brain Web",
      message: message || ""
    }, (id) => {
      if (chrome.runtime.lastError) {
        const err = chrome.runtime.lastError.message;
        console.warn(`[Brain Web] Primary notification failed: ${err}. Attempting fallback...`);

        // Fallback attempt with a data URI (which doesn't require "downloading")
        chrome.notifications.create(`${notificationId}-fallback`, {
          type: "basic",
          iconUrl: FALLBACK_ICON_DATA,
          title: title || "Brain Web",
          message: message || ""
        }, (fallbackId) => {
          if (chrome.runtime.lastError) {
            console.error(`[Brain Web] Fallback notification also failed: ${chrome.runtime.lastError.message}`);
          } else if (fallbackId) {
            setTimeout(() => chrome.notifications.clear(fallbackId), 5000);
          }
        });
      } else if (id) {
        setTimeout(() => chrome.notifications.clear(id), 5000);
      }
    });

  } catch (error: any) {
    console.error(`[Brain Web] Notify helper error:`, error.message);
  }
}

// Inject a function into the page to extract selection + context + anchor.
async function extractSelectionFromTab(tabId: number): Promise<{
  selected_text: string;
  context_before: string | null;
  context_after: string | null;
  anchor: Anchor | null;
}> {
  const injectionResults = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      function sha256Hex(input: string): string {
        // Minimal inline SHA-256 using SubtleCrypto is async; we can hash cheaply instead.
        // For anchoring, a fast deterministic hash is fine:
        let h = 2166136261;
        for (let i = 0; i < input.length; i++) {
          h ^= input.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        return ("00000000" + (h >>> 0).toString(16)).slice(-8);
      }

      function getXPath(node: Node): string {
        if (node.nodeType === Node.TEXT_NODE) {
          const parent = node.parentNode;
          if (!parent) return "";
          const parentPath = getXPath(parent);
          const textSiblings = Array.from(parent.childNodes).filter((n: Node) => n.nodeType === Node.TEXT_NODE) as Node[];
          const idx = textSiblings.indexOf(node) + 1;
          return `${parentPath}/text()[${idx}]`;
        }

        if (!(node instanceof Element)) {
          return "";
        }

        if (node === document.documentElement) return "/html";
        const parent = node.parentElement;
        if (!parent) return `/${node.tagName.toLowerCase()}`;

        const tag = node.tagName.toLowerCase();
        const siblings = Array.from(parent.children).filter((el: Element) => el.tagName.toLowerCase() === tag);
        const idx = siblings.indexOf(node) + 1;
        return `${getXPath(parent)}/${tag}[${idx}]`;
      }

      function getRectsForRange(r: Range): Array<{ x: number; y: number; w: number; h: number }> {
        const rects = Array.from(r.getClientRects()).slice(0, 8); // cap
        return rects.map(rc => ({ x: rc.x, y: rc.y, w: rc.width, h: rc.height }));
      }

      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) {
        return { selected_text: "", context_before: null, context_after: null, anchor: null };
      }

      const range = sel.getRangeAt(0);
      const selectedText = (sel.toString() || "").trim();
      if (!selectedText) {
        return { selected_text: "", context_before: null, context_after: null, anchor: null };
      }

      // Context extraction: take surrounding text from the start/end containers.
      const CONTEXT_CHARS = 240;

      const startNode = range.startContainer;
      const endNode = range.endContainer;

      const startText = (startNode.nodeType === Node.TEXT_NODE ? startNode.textContent : startNode.textContent) || "";
      const endText = (endNode.nodeType === Node.TEXT_NODE ? endNode.textContent : endNode.textContent) || "";

      const before = startText.slice(Math.max(0, range.startOffset - CONTEXT_CHARS), range.startOffset).trim() || null;
      const after = endText.slice(range.endOffset, Math.min(endText.length, range.endOffset + CONTEXT_CHARS)).trim() || null;

      const anchor = {
        kind: "range_v1" as const,
        start_xpath: getXPath(startNode),
        start_offset: range.startOffset,
        end_xpath: getXPath(endNode),
        end_offset: range.endOffset,
        selected_text_hash: sha256Hex(selectedText),
        rects: getRectsForRange(range)
      };

      return { selected_text: selectedText, context_before: before, context_after: after, anchor };
    }
  });

  return injectionResults[0]?.result as any;
}

// Expose test notification function for debugging
// Call from service worker console: testBrainWebNotification()
(globalThis as any).testBrainWebNotification = async () => {
  console.log("[Brain Web] Testing notification...");
  await notify("Brain Web Test", "If you see this, notifications are working!");
  return "Test notification sent";
};

chrome.runtime.onInstalled.addListener(async (details) => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Add to Brain Web",
    contexts: ["selection"]
  });

  // Test notification on install/reload for debugging
  if (details.reason === "install" || details.reason === "update") {
    console.log("[Brain Web] Extension installed/updated, testing notification...");
    setTimeout(async () => {
      await notify("Brain Web", "Extension loaded successfully!");
    }, 1000);
  }
});

// Handle messages from content scripts (for quote highlighting)
chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (message.type === 'FETCH_QUOTES') {
    (async () => {
      try {
        const apiBase = await getApiBase();
        const url = message.url;
        const res = await fetch(`${apiBase}/quotes/by_source?url=${encodeURIComponent(url)}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'x-session-id': await getOrCreateSessionId()
          },
          credentials: 'include'
        });

        if (!res.ok) {
          sendResponse({ error: `HTTP ${res.status}` });
          return;
        }

        const data = await res.json();
        sendResponse({ quotes: data.quotes || [] });
      } catch (error: any) {
        console.error('[Brain Web] Error fetching quotes in background:', error);
        sendResponse({ error: String(error?.message || error) });
      }
    })();
    return true; // Indicates we will send a response asynchronously
  }
  return false;
});

chrome.contextMenus.onClicked.addListener(async (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
  console.log("[Brain Web] Context menu clicked", { menuItemId: info.menuItemId, tabId: tab?.id });

  if (info.menuItemId !== MENU_ID) return;

  const tabId = tab?.id;
  if (!tabId) {
    console.error("[Brain Web] No active tab found");
    await notify("Brain Web", "No active tab found.");
    return;
  }

  // Use optional chaining for safety
  const pageUrl = info.pageUrl || tab?.url || "";
  const pageTitle = tab?.title || "Untitled";

  console.log("[Brain Web] Extracting selection from tab", tabId);

  // Extract selection + context + anchor from the page.
  let extracted;
  try {
    extracted = await extractSelectionFromTab(tabId);
    console.log("[Brain Web] Extracted selection:", {
      textLength: extracted.selected_text?.length,
      hasContext: !!extracted.context_before || !!extracted.context_after,
      hasAnchor: !!extracted.anchor
    });
  } catch (e: any) {
    console.error("[Brain Web] Extraction error:", e);
    await notify("Brain Web", `Could not read selection: ${String(e?.message || e)}`.slice(0, 180));
    return;
  }

  const selectedText = (extracted.selected_text || "").trim();
  if (!selectedText) {
    console.warn("[Brain Web] No text selected");
    await notify("Brain Web", "No text selected.");
    return;
  }

  const apiBase = await getApiBase();
  const sid = await getOrCreateSessionId();
  console.log("[Brain Web] Sending to API:", { apiBase, sessionId: sid.substring(0, 8) + "..." });

  const payload: CaptureSelectionRequest = {
    selected_text: selectedText,
    page_url: pageUrl,
    page_title: pageTitle,
    frame_url: info.frameUrl || null,
    attach_concept_id: null,
    graph_id: null,
    branch_id: null,
    context_before: extracted.context_before,
    context_after: extracted.context_after,
    anchor: extracted.anchor
  };

  try {
    console.log("[Brain Web] POST request to:", `${apiBase}/sync/capture-selection`);
    const res = await fetch(`${apiBase}/sync/capture-selection`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-session-id": sid
      },
      // Cookie mode is fine to keep, but header is what will actually work reliably.
      credentials: "include",
      body: JSON.stringify(payload)
    });

    console.log("[Brain Web] Response status:", res.status, res.statusText);

    if (!res.ok) {
      let errorText = "";
      try {
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          try {
            const errorJson = await res.json();
            errorText = errorJson?.detail || errorJson?.message || JSON.stringify(errorJson) || "";
          } catch (jsonError) {
            // If JSON parsing fails, try text
            errorText = await res.text().catch(() => "") || "";
          }
        } else {
          errorText = await res.text().catch(() => "") || "";
        }
      } catch (e: any) {
        errorText = `Failed to read error response: ${e?.message || String(e)}`;
      }
      const errorMsg = errorText ? String(errorText).slice(0, 140) : `HTTP ${res.status}`;
      console.error("[Brain Web] Capture failed:", res.status, errorText);
      try {
        await notify("Brain Web", `Capture failed (${res.status}). ${errorMsg}`);
      } catch (notifErr) {
        console.error("[Brain Web] Failed to show error notification:", notifErr);
      }
      return;
    }

    let out: any = {};
    try {
      out = await res.json();
      console.log("[Brain Web] Capture successful:", out);
    } catch (e) {
      console.error("[Brain Web] Failed to parse response JSON:", e);
      await notify("Brain Web", "Capture completed but response format error");
      return;
    }

    const quoteId = out?.quote_id ? `Saved ${out.quote_id}` : "Saved";
    await notify("Brain Web", quoteId);
  } catch (e: any) {
    console.error("[Brain Web] Capture error:", e);
    await notify("Brain Web", `Capture error: ${String(e?.message || e)}`.slice(0, 180));
  }
});
