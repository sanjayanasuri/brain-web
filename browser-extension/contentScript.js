/**
 * Content script for extracting readable text from webpages
 */

/**
 * Remove navigation, footer, aside, and other non-content elements
 */
function removeNonContentElements() {
  const selectors = [
    'nav',
    'footer',
    'aside',
    'header',
    '.nav',
    '.navigation',
    '.footer',
    '.sidebar',
    '.menu',
    '.advertisement',
    '.ad',
    '[role="navigation"]',
    '[role="banner"]',
    '[role="contentinfo"]',
    '[role="complementary"]'
  ];
  
  const elements = [];
  selectors.forEach(selector => {
    try {
      const found = document.querySelectorAll(selector);
      found.forEach(el => elements.push(el));
    } catch (e) {
      // Ignore invalid selectors
    }
  });
  
  // Clone elements to avoid modifying the original DOM
  elements.forEach(el => {
    if (el && el.parentNode) {
      el.style.display = 'none';
    }
  });
  
  return elements;
}

/**
 * Restore elements that were hidden
 */
function restoreElements(elements) {
  elements.forEach(el => {
    if (el) {
      el.style.display = '';
    }
  });
}

/**
 * Extract readable text from the page
 * Prefers <article> content, falls back to body text
 */
function extractText() {
  // Try to find article element first
  const article = document.querySelector('article');
  
  if (article) {
    // Use article content
    return {
      text: article.innerText || article.textContent || '',
      title: document.title,
      url: window.location.href
    };
  }
  
  // Fall back to body, but try to remove non-content elements
  const hiddenElements = removeNonContentElements();
  
  try {
    const bodyText = document.body.innerText || document.body.textContent || '';
    
    // Restore hidden elements
    restoreElements(hiddenElements);
    
    return {
      text: bodyText,
      title: document.title,
      url: window.location.href
    };
  } catch (e) {
    // Restore hidden elements even on error
    restoreElements(hiddenElements);
    throw e;
  }
}

/**
 * Clean up text: remove excessive whitespace, normalize
 */
function cleanText(text) {
  if (!text) return '';
  
  // Replace multiple whitespace with single space
  return text
    .replace(/\s+/g, ' ')
    .trim();
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractText') {
    try {
      const extracted = extractText();
      const cleaned = cleanText(extracted.text);
      
      sendResponse({
        success: true,
        text: cleaned,
        title: extracted.title,
        url: extracted.url,
        lang: document.documentElement.lang || navigator.language
      });
    } catch (error) {
      sendResponse({
        success: false,
        error: error.message
      });
    }
    
    // Return true to indicate we will send a response asynchronously
    return true;
  }
});

