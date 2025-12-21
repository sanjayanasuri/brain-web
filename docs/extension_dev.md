# Browser Extension Development Guide

This guide explains how to develop and test the Brain Web browser extension locally without publishing it to the Chrome Web Store.

## Prerequisites

1. **Backend running locally**: The backend should be running on `http://localhost:8000`
2. **Chrome or Chromium browser**: For loading unpacked extensions
3. **Extension development mode enabled**: Set `ENABLE_EXTENSION_DEV=true` in your backend environment

## Setup

### 1. Enable Extension Development Mode

Add the following to your backend environment configuration (`.env` or `.env.local`):

```bash
ENABLE_EXTENSION_DEV=true
```

This enables CORS for Chrome extension origins (`chrome-extension://*`) and localhost development ports, allowing the extension to communicate with your local backend.

### 2. Load the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `browser-extension/` directory from this repository
5. The extension should now appear in your extensions list

### 3. Verify Backend Connection

The extension is configured to connect to `http://localhost:8000` by default (see `browser-extension/config.js`).

To verify the connection:
- Open the extension popup
- The extension will attempt to connect to the backend when capturing pages
- You can also test the health endpoint directly: `http://localhost:8000/web/ping` should return `{"status":"ok"}`

## Configuration

### Backend URL

The extension's backend URL is configured in `browser-extension/config.js`:

```javascript
const CONFIG = {
  BACKEND_URL: "http://localhost:8000",
  FRONTEND_URL: "http://localhost:3000"
};
```

Update these values if your local backend or frontend run on different ports.

### CORS Configuration

When `ENABLE_EXTENSION_DEV=true`, the backend allows requests from:
- Chrome extension origins: `chrome-extension://*`
- Localhost development: `http://localhost:*` and `http://127.0.0.1:*`

In production (when `ENABLE_EXTENSION_DEV=false`), only the strict origins list is used for security.

## Testing

1. **Health Check**: Visit `http://localhost:8000/web/ping` in your browser to verify the backend is running
2. **Extension Capture**: 
   - Navigate to any webpage
   - Click the Brain Web extension icon
   - Click "Capture Page" to test ingestion
3. **Check Console**: Open Chrome DevTools (F12) and check the Console tab for any errors

## Troubleshooting

### CORS Errors

If you see CORS errors in the browser console:
- Verify `ENABLE_EXTENSION_DEV=true` is set in your backend environment
- Restart the backend after changing environment variables
- Check that the backend is running on the correct port (default: 8000)

### Extension Not Loading

- Ensure Developer mode is enabled in `chrome://extensions/`
- Check for errors in the extension's service worker console (click "service worker" link in the extensions page)
- Verify all files in `browser-extension/` are present

### Backend Connection Issues

- Verify the backend is running: `curl http://localhost:8000/web/ping`
- Check backend logs for incoming requests
- Ensure no firewall is blocking localhost connections

## Development Workflow

1. Make changes to extension files in `browser-extension/`
2. In `chrome://extensions/`, click the refresh icon on the extension card to reload
3. Test your changes by using the extension
4. Check browser console and backend logs for debugging

## Production Deployment

When ready to publish:
1. Set `ENABLE_EXTENSION_DEV=false` in production
2. Build and package the extension for Chrome Web Store submission
3. Update `config.js` with production backend URLs if needed

