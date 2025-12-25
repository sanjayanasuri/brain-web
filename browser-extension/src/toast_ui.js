// toast_ui.js
// Toast notification system for content script

let toastContainer = null;

function createToastContainer() {
  if (toastContainer) return toastContainer;

  const container = document.createElement('div');
  container.id = 'bw-toast-container';
  container.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 100000;
    display: flex;
    flex-direction: column;
    gap: 10px;
    pointer-events: none;
  `;
  document.body.appendChild(container);
  toastContainer = container;
  return container;
}

function showToast(message, actions = [], duration = 4000) {
  const container = createToastContainer();
  
  const toast = document.createElement('div');
  toast.style.cssText = `
    background: rgba(0, 0, 0, 0.9);
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    min-width: 300px;
    max-width: 400px;
    pointer-events: auto;
    animation: slideIn 0.3s ease-out;
  `;

  const messageEl = document.createElement('div');
  messageEl.textContent = message;
  messageEl.style.cssText = 'margin-bottom: 8px; font-size: 14px;';
  toast.appendChild(messageEl);

  if (actions.length > 0) {
    const actionsEl = document.createElement('div');
    actionsEl.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap;';
    
    actions.forEach(action => {
      const btn = document.createElement('button');
      btn.textContent = action.label;
      btn.style.cssText = `
        padding: 4px 12px;
        background: rgba(255, 255, 255, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.3);
        border-radius: 4px;
        color: white;
        cursor: pointer;
        font-size: 12px;
        transition: background 0.2s;
      `;
      btn.onmouseenter = () => {
        btn.style.background = 'rgba(255, 255, 255, 0.3)';
      };
      btn.onmouseleave = () => {
        btn.style.background = 'rgba(255, 255, 255, 0.2)';
      };
      btn.onclick = () => {
        handleToastAction(action);
        removeToast(toast);
      };
      actionsEl.appendChild(btn);
    });
    
    toast.appendChild(actionsEl);
  }

  // Add animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    @keyframes slideOut {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(100%);
        opacity: 0;
      }
    }
  `;
  if (!document.getElementById('bw-toast-styles')) {
    style.id = 'bw-toast-styles';
    document.head.appendChild(style);
  }

  container.appendChild(toast);

  // Auto-dismiss
  if (duration > 0) {
    setTimeout(() => {
      removeToast(toast);
    }, duration);
  }

  return toast;
}

function removeToast(toast) {
  if (!toast || !toast.parentNode) return;
  
  toast.style.animation = 'slideOut 0.3s ease-out';
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 300);
}

function handleToastAction(action) {
  if (action.action === 'undo' && action.itemId) {
    // Send message to service worker to undo
    chrome.runtime.sendMessage({
      type: 'BW_UNDO_CAPTURE',
      itemId: action.itemId
    }).catch(() => {
      // Ignore errors
    });
  } else if (action.action === 'attach') {
    // Open extension popup focused on quote
    chrome.runtime.sendMessage({
      type: 'BW_OPEN_POPUP',
      action: 'attach_quote'
    }).catch(() => {
      // Ignore errors
    });
  }
}

// Listen for toast messages
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'BW_SHOW_TOAST') {
    showToast(msg.message, msg.actions || []);
    sendResponse({ ok: true });
  }
  return true;
});

