/**
 * Content script for extracting readable text from webpages
 * Enhanced version with better content extraction and metadata
 */

// --- Content Extraction Logic ---

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

function removeNoiseNodes(root) {
  const selectors = [
    "script", "style", "noscript", "svg", "canvas",
    "nav", "header", "footer", "aside",
    "[role='navigation']", "[role='banner']", "[role='contentinfo']",
    "[aria-hidden='true']",
    ".advertisement", ".ads", ".ad", ".promo", ".cookie", ".cookie-banner",
    ".newsletter", ".subscribe", ".paywall"
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
  const article = document.querySelector('article');
  if (article) return cleanText(article.innerText);

  const clone = document.body.cloneNode(true);
  removeNoiseNodes(clone);

  const candidates = [];
  clone.querySelectorAll("main, [role='main']").forEach((el) => candidates.push(el));
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

// --- Message Listener ---

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractText') {
    try {
      const text = extractReaderTextFallback();

      sendResponse({
        success: true,
        text: text,
        title: document.title,
        url: window.location.href,
        lang: document.documentElement.lang || navigator.language
      });
    } catch (error) {
      sendResponse({
        success: false,
        error: error.message
      });
    }
    return true;
  }
});
