/**
 * Popup script for Brain Web Capture extension
 */

// Load config
const CONFIG = typeof CONFIG !== 'undefined' ? CONFIG : {
  BACKEND_URL: "http://localhost:8000",
  FRONTEND_URL: "http://localhost:3000"
};

const captureBtn = document.getElementById('captureBtn');
const statusDiv = document.getElementById('status');

function showStatus(message, type = 'info') {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.style.display = 'block';
}

function hideStatus() {
  statusDiv.style.display = 'none';
}

async function capturePage() {
  captureBtn.disabled = true;
  showStatus('Extracting text from page...', 'info');
  
  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      throw new Error('No active tab found');
    }
    
    // Send message to content script to extract text
    // Content script is already injected via manifest.json
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: 'extractText' });
    } catch (error) {
      // Content script might not be loaded yet, try injecting it
      if (error.message.includes('Could not establish connection')) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['contentScript.js']
        });
        // Wait a bit for script to initialize
        await new Promise(resolve => setTimeout(resolve, 100));
        response = await chrome.tabs.sendMessage(tab.id, { action: 'extractText' });
      } else {
        throw error;
      }
    }
    
    if (!response || !response.success) {
      throw new Error(response?.error || 'Failed to extract text from page');
    }
    
    const { text, title, url, lang } = response;
    
    if (!text || text.length < 200) {
      throw new Error(`Text too short: ${text.length} characters. Minimum 200 characters required.`);
    }
    
    showStatus('Sending to Brain Web...', 'info');
    
    // Prepare payload
    const payload = {
      url: url,
      title: title,
      text: text,
      domain: new URL(url).hostname,
      metadata: {
        userAgent: navigator.userAgent,
        lang: lang || navigator.language,
        capturedAt: new Date().toISOString()
      }
    };
    
    // Send to backend
    const backendUrl = `${CONFIG.BACKEND_URL}/web/ingest`;
    const fetchResponse = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });
    
    if (!fetchResponse.ok) {
      const errorData = await fetchResponse.json().catch(() => ({ detail: fetchResponse.statusText }));
      throw new Error(errorData.detail || `Server error: ${fetchResponse.status}`);
    }
    
    const result = await fetchResponse.json();
    const artifactId = result.artifact_id;
    
    showStatus('Success! Opening artifact...', 'success');
    
    // Open frontend page or show artifact ID
    const frontendUrl = `${CONFIG.FRONTEND_URL}/artifacts/${artifactId}`;
    
    // Try to open frontend page, fallback to alert
    try {
      // Check if frontend is accessible
      const frontendCheck = await fetch(`${CONFIG.FRONTEND_URL}`, { method: 'HEAD', mode: 'no-cors' }).catch(() => null);
      
      if (frontendCheck !== null) {
        chrome.tabs.create({ url: frontendUrl });
      } else {
        // Frontend not accessible, show alert
        alert(`Artifact captured!\n\nArtifact ID: ${artifactId}\n\nFrontend URL: ${frontendUrl}`);
      }
    } catch (e) {
      // Fallback to alert
      alert(`Artifact captured!\n\nArtifact ID: ${artifactId}\n\nFrontend URL: ${frontendUrl}`);
    }
    
    // Close popup after a short delay
    setTimeout(() => {
      window.close();
    }, 1000);
    
  } catch (error) {
    console.error('Capture error:', error);
    showStatus(`Error: ${error.message}`, 'error');
    captureBtn.disabled = false;
  }
}

// Set up event listener
captureBtn.addEventListener('click', capturePage);

// Initialize: check if we can access the current tab
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs.length === 0) {
    showStatus('No active tab found', 'error');
    captureBtn.disabled = true;
  }
});

