// highlight_quotes.js
// Handles highlighting quotes on page load and hover interactions

const HIGHLIGHT_CLASS = 'bw-quote-highlight';
const HIGHLIGHT_ATTR = 'data-bw-quote-id';

let highlightedQuotes = new Map(); // quote_id -> { element, quote data }

/**
 * Get API base URL from storage
 */
async function getApiBase() {
  const { bw_api_base } = await chrome.storage.sync.get(['bw_api_base']);
  return bw_api_base || 'http://127.0.0.1:8000';
}

/**
 * Fetch quotes for current URL
 */
async function fetchQuotesForUrl(url) {
  try {
    const apiBase = await getApiBase();
    const response = await fetch(`${apiBase}/quotes/by_source?url=${encodeURIComponent(url)}`);
    if (!response.ok) {
      console.warn('[Brain Web] Failed to fetch quotes:', response.status);
      return [];
    }
    const data = await response.json();
    return data.quotes || [];
  } catch (error) {
    console.warn('[Brain Web] Error fetching quotes:', error);
    return [];
  }
}

/**
 * Find text in DOM using text-quote anchor
 * Returns the Range if found, null otherwise
 */
function findTextByAnchor(anchor) {
  if (!anchor || anchor.type !== 'text_quote') {
    return null;
  }

  const exact = anchor.exact || '';
  const prefix = anchor.prefix || '';
  const suffix = anchor.suffix || '';

  if (!exact) return null;

  // Walk through text nodes
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null
  );

  let node;
  const candidates = [];

  while ((node = walker.nextNode())) {
    const text = node.textContent || '';
    const index = text.indexOf(exact);
    if (index !== -1) {
      candidates.push({
        node,
        index,
        text
      });
    }
  }

  // Try to match with prefix/suffix context
  for (const candidate of candidates) {
    const { node, index, text } = candidate;
    
    // Check prefix if provided
    if (prefix) {
      const beforeText = text.substring(Math.max(0, index - prefix.length), index);
      if (!beforeText.endsWith(prefix.slice(-Math.min(prefix.length, beforeText.length)))) {
        continue;
      }
    }

    // Check suffix if provided
    if (suffix) {
      const afterText = text.substring(index + exact.length, index + exact.length + suffix.length);
      if (!afterText.startsWith(suffix.substring(0, Math.min(suffix.length, afterText.length)))) {
        continue;
      }
    }

    // Found a match - create range
    try {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + exact.length);
      return range;
    } catch (e) {
      continue;
    }
  }

  return null;
}

/**
 * Highlight a quote by wrapping it in a span
 */
function highlightQuote(quote, range) {
  try {
    // Create highlight span
    const span = document.createElement('span');
    span.className = HIGHLIGHT_CLASS;
    span.setAttribute(HIGHLIGHT_ATTR, quote.quote_id);
    span.style.cssText = `
      background-color: rgba(255, 255, 0, 0.2);
      border-bottom: 2px solid rgba(255, 200, 0, 0.6);
      cursor: pointer;
      position: relative;
    `;
    span.title = quote.text.substring(0, 100) + (quote.text.length > 100 ? '...' : '');

    // Wrap the range
    range.surroundContents(span);
    
    // Store quote data
    highlightedQuotes.set(quote.quote_id, {
      element: span,
      quote: quote
    });

    // Add hover tooltip
    let tooltip = null;
    span.addEventListener('mouseenter', () => {
      tooltip = createTooltip(span, quote);
      document.body.appendChild(tooltip);
      positionTooltip(tooltip, span);
    });

    span.addEventListener('mouseleave', () => {
      if (tooltip) {
        tooltip.remove();
        tooltip = null;
      }
    });

    // Add click handler
    span.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      chrome.runtime.sendMessage({
        type: 'BW_QUOTE_CLICKED',
        quote_id: quote.quote_id,
        quote: quote
      });
    });

    return span;
  } catch (e) {
    console.warn('[Brain Web] Failed to highlight quote:', e);
    return null;
  }
}

/**
 * Create tooltip element
 */
function createTooltip(span, quote) {
  const tooltip = document.createElement('div');
  tooltip.style.cssText = `
    position: absolute;
    background: rgba(0, 0, 0, 0.9);
    color: white;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 12px;
    max-width: 300px;
    z-index: 10000;
    pointer-events: none;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  `;

  const concepts = quote.attached_concepts || [];
  const claimCount = quote.claim_count || 0;

  let html = `<div style="margin-bottom: 4px;">${escapeHtml(quote.text.substring(0, 150))}${quote.text.length > 150 ? '...' : ''}</div>`;
  
  if (concepts.length > 0) {
    html += `<div style="margin-top: 6px; font-size: 11px; opacity: 0.8;">Concepts: ${concepts.map(c => escapeHtml(c.name || c.node_id)).join(', ')}</div>`;
  }
  
  if (claimCount > 0) {
    html += `<div style="margin-top: 4px; font-size: 11px; opacity: 0.8;">${claimCount} claim${claimCount !== 1 ? 's' : ''} supported</div>`;
  }

  tooltip.innerHTML = html;
  return tooltip;
}

/**
 * Position tooltip near the span
 */
function positionTooltip(tooltip, span) {
  const rect = span.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  
  let top = rect.bottom + 5;
  let left = rect.left;

  // Adjust if tooltip would go off screen
  if (left + tooltipRect.width > window.innerWidth) {
    left = window.innerWidth - tooltipRect.width - 10;
  }
  if (top + tooltipRect.height > window.innerHeight) {
    top = rect.top - tooltipRect.height - 5;
  }

  tooltip.style.top = `${top + window.scrollY}px`;
  tooltip.style.left = `${left + window.scrollX}px`;
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Main function: load and highlight quotes for current page
 */
async function highlightQuotesOnPage() {
  const url = window.location.href;
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
    return;
  }

  const quotes = await fetchQuotesForUrl(url);
  if (quotes.length === 0) {
    return;
  }

  // Process each quote
  for (const quote of quotes) {
    if (!quote.anchor) {
      continue;
    }

    const range = findTextByAnchor(quote.anchor);
    if (range) {
      highlightQuote(quote, range);
    }
  }
}

// Run on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', highlightQuotesOnPage);
} else {
  highlightQuotesOnPage();
}

// Also run when navigating in SPA (for history API changes)
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    // Clear existing highlights
    document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach(el => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent), el);
        parent.normalize();
      }
    });
    highlightedQuotes.clear();
    // Re-highlight after a short delay
    setTimeout(highlightQuotesOnPage, 500);
  }
}).observe(document, { subtree: true, childList: true });

