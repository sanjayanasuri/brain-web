# Debugging Brain Web Extension

## Quick Debug Checklist

### 1. Check Backend is Running
```bash
curl http://localhost:8000/
# Should return: {"status":"ok","message":"Brain Web backend is running"}
```

### 2. Check Endpoint Exists
```bash
curl -X POST http://localhost:8000/sync/capture-selection \
  -H "Content-Type: application/json" \
  -H "x-session-id: test" \
  -d '{"selected_text":"test","page_url":"https://example.com"}'
# Should return JSON with quote_id and artifact_id, NOT 404
```

### 3. Check Extension Console
1. Go to `chrome://extensions/`
2. Find "Brain Web Capture"
3. Click "service worker" (or "inspect views: service worker")
4. Look for `[Brain Web]` logs when you try to capture

### 4. Check Network Tab
1. Open DevTools (F12)
2. Go to Network tab
3. Try capturing a selection
4. Look for `capture-selection` request
5. Check status code (should be 200, not 404)

## Common Issues

### 404 on /sync/capture-selection
**Problem:** Backend hasn't restarted after adding the endpoint
**Solution:** Restart your backend server

### CORS errors
**Problem:** Extension origin not allowed
**Solution:** Make sure `ENABLE_EXTENSION_DEV=true` in backend config

### No notification appears
**Problem:** Chrome notifications disabled or icon path wrong
**Solution:** 
- Check Chrome notification settings: `chrome://settings/content/notifications`
- Check system notification settings (macOS: System Settings > Notifications)
- Look in service worker console for errors

### Context menu doesn't appear
**Problem:** Extension not loaded or error in service worker
**Solution:**
- Go to `chrome://extensions/`
- Check for red error badge
- Click "service worker" to see errors
- Reload extension

## Testing Steps

1. **Restart Backend:**
   ```bash
   # Stop your backend (Ctrl+C)
   # Start it again
   cd backend
   python main.py  # or however you run it
   ```

2. **Reload Extension:**
   - Go to `chrome://extensions/`
   - Click reload icon on "Brain Web Capture"

3. **Test Capture:**
   - Go to any webpage
   - Select some text
   - Right-click → "Add to Brain Web"
   - Check service worker console for logs
   - Check for notification (top-right on macOS)

4. **Verify in Backend:**
   - Check backend logs for POST to `/sync/capture-selection`
   - Should see successful response with quote_id

