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
    return {
      ok: true,
      mode_used: "selection",
      selection_text: selection || null,
      text: selection || "",
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

