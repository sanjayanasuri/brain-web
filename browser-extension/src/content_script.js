// content_script.js
// Runs in the page context to extract readable content + metadata on demand.

function cleanText(text) {
  if (!text) return "";
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getMeta(name) {
  const el = document.querySelector(`meta[name="${name}"]`) || document.querySelector(`meta[property="${name}"]`);
  return el?.getAttribute("content") || null;
}

function getCanonicalUrl() {
  const link = document.querySelector('link[rel="canonical"]');
  return link?.getAttribute("href") || null;
}

function isProbablyPDF() {
  const url = window.location.href || "";
  if (url.toLowerCase().includes(".pdf")) return true;
  const contentType = getMeta("content-type") || getMeta("Content-Type");
  if (contentType && contentType.toLowerCase().includes("pdf")) return true;
  return false;
}

function getSelectionText() {
  try {
    const sel = window.getSelection();
    if (!sel) return "";
    return cleanText(sel.toString());
  } catch {
    return "";
  }
}

function getCssSelector(element) {
  if (!element || element === document.body) return null;
  
  try {
    if (element.id) {
      return `#${element.id}`;
    }
    
    if (element.className && typeof element.className === 'string') {
      const classes = element.className.trim().split(/\s+/).filter(c => c).slice(0, 3).join('.');
      if (classes) {
        const tag = element.tagName.toLowerCase();
        return `${tag}.${classes}`;
      }
    }
    
    const tag = element.tagName.toLowerCase();
    if (element.parentElement) {
      const siblings = Array.from(element.parentElement.children).filter(el => el.tagName === element.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(element) + 1;
        return `${tag}:nth-of-type(${index})`;
      }
    }
    
    return tag;
  } catch {
    return null;
  }
}

function getSelectionWithTextQuoteAnchor() {
  try {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    
    const range = sel.getRangeAt(0);
    const exact = cleanText(range.toString());
    if (!exact) return null;
    
    // Get container element for prefix/suffix extraction
    let container = range.commonAncestorContainer;
    if (container.nodeType === Node.TEXT_NODE) {
      container = container.parentElement;
    }
    if (!container) return null;
    
    // Get full text content of container
    const containerText = container.textContent || "";
    const containerLength = containerText.length;
    
    // Find the selection start/end within container text
    // This is approximate - we search for the exact text near the range boundaries
    const startOffset = range.startOffset;
    const endOffset = range.endOffset;
    
    let prefix = "";
    let suffix = "";
    
    try {
      // Get prefix: up to 64 chars before selection start
      if (range.startContainer.nodeType === Node.TEXT_NODE) {
        const startText = range.startContainer.textContent || "";
        const beforeStart = startText.substring(Math.max(0, startOffset - 64), startOffset);
        prefix = beforeStart;
      } else {
        // Fallback: try to get text before selection in container
        const beforeRange = range.cloneRange();
        beforeRange.setStart(container, 0);
        beforeRange.setEnd(range.startContainer, range.startOffset);
        prefix = cleanText(beforeRange.toString()).slice(-64);
      }
    } catch (e) {
      // Prefix extraction failed, leave empty
    }
    
    try {
      // Get suffix: up to 64 chars after selection end
      if (range.endContainer.nodeType === Node.TEXT_NODE) {
        const endText = range.endContainer.textContent || "";
        const afterEnd = endText.substring(endOffset, Math.min(endText.length, endOffset + 64));
        suffix = afterEnd;
      } else {
        // Fallback: try to get text after selection in container
        const afterRange = range.cloneRange();
        afterRange.setStart(range.endContainer, range.endOffset);
        afterRange.setEnd(container, container.childNodes.length);
        suffix = cleanText(afterRange.toString()).slice(0, 64);
      }
    } catch (e) {
      // Suffix extraction failed, leave empty
    }
    
    // Get selector hint (best-effort CSS selector)
    const selectorHint = getCssSelector(container);
    
    return {
      type: "text_quote",
      exact: exact,
      prefix: prefix || null,
      suffix: suffix || null,
      selector_hint: selectorHint || null
    };
  } catch (e) {
    return null;
  }
}

function removeNoiseNodes(root) {
  const selectors = [
    "script","style","noscript","svg","canvas",
    "nav","header","footer","aside",
    "[role='navigation']","[role='banner']","[role='contentinfo']",
    "[aria-hidden='true']",
    ".advertisement",".ads",".ad",".promo",".cookie",".cookie-banner",
    ".newsletter",".subscribe",".paywall"
  ];
  selectors.forEach((s) => root.querySelectorAll(s).forEach((n) => n.remove()));
}

function scoreNode(el) {
  const text = (el.innerText || "").trim();
  const textLen = text.length;
  if (textLen < 200) return 0;

  const pCount = el.querySelectorAll("p").length;
  const aTextLen = Array.from(el.querySelectorAll("a"))
    .map((a) => (a.innerText || "").length)
    .reduce((acc, v) => acc + v, 0);

  const linkDensity = aTextLen / Math.max(1, textLen);
  const headingBonus = el.querySelectorAll("h1,h2").length * 50;

  return textLen + pCount * 200 + headingBonus - linkDensity * 1500;
}

function extractReaderTextFallback() {
  const clone = document.body.cloneNode(true);
  removeNoiseNodes(clone);

  const candidates = [];
  clone.querySelectorAll("article, main, [role='main']").forEach((el) => candidates.push(el));
  clone.querySelectorAll("div, section").forEach((el) => {
    const len = (el.innerText || "").trim().length;
    if (len >= 500) candidates.push(el);
  });

  if (candidates.length === 0) return cleanText(clone.innerText || "");

  let best = null;
  let bestScore = 0;
  for (const el of candidates) {
    const s = scoreNode(el);
    if (s > bestScore) {
      bestScore = s;
      best = el;
    }
  }
  return cleanText(best?.innerText || clone.innerText || "");
}

function extractFullTextFallback() {
  const clone = document.body.cloneNode(true);
  removeNoiseNodes(clone);
  return cleanText(clone.innerText || "");
}

function getMetadata() {
  const url = window.location.href || null;
  const title = document.title || null;

  const canonical = getCanonicalUrl();
  const author =
    getMeta("author") ||
    getMeta("article:author") ||
    getMeta("parsely-author") ||
    null;

  const published =
    getMeta("article:published_time") ||
    getMeta("og:published_time") ||
    getMeta("published_time") ||
    getMeta("date") ||
    null;

  const siteName = getMeta("og:site_name") || null;
  const description = getMeta("description") || getMeta("og:description") || null;

  return {
    url,
    title,
    canonical_url: canonical,
    author,
    published_time: published,
    site_name: siteName,
    page_description: description
  };
}

function clampText(text, maxChars) {
  const t = (text || "").trim();
  if (t.length <= maxChars) return { text: t, truncated: false };
  return { text: t.slice(0, maxChars), truncated: true };
}

function buildResponse({ mode }) {
  const meta = getMetadata();
  const selection = getSelectionText();
  const pdf = isProbablyPDF();

  // If it's a PDF, we avoid pretending we extracted full text.
  // We still capture metadata and let your backend store the URL + context.
  if (pdf && mode !== "selection") {
    return {
      ok: true,
      mode_used: "pdf",
      selection_text: selection || null,
      text: selection || "",
      meta: { ...meta, is_pdf: true }
    };
  }

  if (mode === "selection") {
    const anchor = getSelectionWithTextQuoteAnchor();
    return {
      ok: true,
      mode_used: "selection",
      selection_text: selection || null,
      text: selection || "",
      anchor: anchor || null,
      meta: { ...meta, is_pdf: pdf }
    };
  }

  if (mode === "reader") {
    const readerText = extractReaderTextFallback();
    const composed = cleanText([meta.title || "", "", readerText].join("\n"));
    return {
      ok: true,
      mode_used: "reader",
      selection_text: selection || null,
      text: composed,
      meta: { ...meta, is_pdf: pdf }
    };
  }

  // mode === "full"
  const fullText = extractFullTextFallback();
  const composed = cleanText([meta.title || "", "", fullText].join("\n"));
  return {
    ok: true,
    mode_used: "full",
    selection_text: selection || null,
    text: composed,
    meta: { ...meta, is_pdf: pdf }
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "BW_EXTRACT") return;

  try {
    const mode = msg?.mode || "reader";
    const res = buildResponse({ mode });

    // Payload guard
    const { text, truncated } = clampText(res.text || "", 250_000);
    res.text = text;
    res.meta = { ...(res.meta || {}), extraction_char_count: (res.text || "").length, truncated };

    sendResponse(res);
  } catch (e) {
    sendResponse({ ok: false, error: e?.message || String(e) });
  }

  return true;
});

