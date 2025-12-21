# Brain Web Browser Extension

Chrome extension for capturing webpages into your Brain Web knowledge graph.

## Setup

1. **Load the extension in Chrome:**
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the `browser-extension/` folder

2. **Configure URLs (if needed):**
   - Edit `config.js` if your backend/frontend run on different ports
   - Default: Backend `http://localhost:8000`, Frontend `http://localhost:3000`

3. **Ensure backend is running:**
   - Backend must be running on port 8000 (or update config.js)
   - Make sure `ENABLE_EXTENSION_DEV=true` in your `.env.local` for CORS

## Usage

1. Navigate to any webpage you want to capture
2. Click the Brain Web extension icon in your toolbar
3. Click the "Capture" button
4. The extension will:
   - Extract readable text from the page
   - Send it to your Brain Web backend
   - Open the artifact page in your frontend (if available)

## How It Works

- **Text Extraction**: Prefers `<article>` content, falls back to `document.body.innerText`
- **Content Cleaning**: Removes navigation, footer, and other non-content elements
- **Backend Integration**: POSTs to `/web/ingest` endpoint with URL, title, text, and metadata
- **Frontend Navigation**: Opens `/artifacts/{artifact_id}` on success

## Icon Files

You'll need to add icon files:
- `icon16.png` (16x16 pixels)
- `icon48.png` (48x48 pixels)
- `icon128.png` (128x128 pixels)

You can create simple placeholder icons or use a design tool to create branded icons.

## Troubleshooting

- **CORS errors**: Make sure `ENABLE_EXTENSION_DEV=true` in `.env.local`
- **Backend not found**: Check that backend is running on port 8000 (or update config.js)
- **Text too short**: The page must have at least 200 characters of readable text

