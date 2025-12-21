/**
 * Background service worker for Brain Web Capture extension
 * 
 * Currently minimal - most logic is in popup.js
 * This can be extended for background tasks if needed
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('Brain Web Capture extension installed');
});

// Listen for messages from content script or popup if needed
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle any background tasks here if needed
  return false;
});

