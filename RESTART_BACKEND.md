# How to Restart Backend to Load New Endpoint

The `/sync/capture-selection` endpoint exists in the code but isn't being served because the backend needs a **hard restart**.

## Steps to Restart:

1. **Find and kill the backend process:**
   ```bash
   # Find the process
   ps aux | grep uvicorn
   
   # Kill it (replace PID with the actual process ID)
   kill <PID>
   
   # Or kill all uvicorn processes
   pkill -f uvicorn
   ```

2. **Verify port 8000 is free:**
   ```bash
   lsof -i:8000
   # Should show nothing, or kill any process using port 8000
   ```

3. **Start the backend fresh:**
   ```bash
   cd backend
   source .venv/bin/activate  # if using venv
   python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

4. **Test the endpoint:**
   ```bash
   curl -X POST http://localhost:8000/sync/capture-selection \
     -H "Content-Type: application/json" \
     -H "x-session-id: test" \
     -d '{"selected_text":"test","page_url":"https://example.com"}'
   ```
   
   Should return JSON with `quote_id` and `artifact_id`, NOT 404.

## Why This Happens:

- The `--reload` flag doesn't always catch new files
- Python bytecode cache might be stale
- The server needs a full restart to import new modules

## After Restart:

1. Reload the extension in `chrome://extensions/`
2. Try capturing a selection
3. Check the service worker console for `[Brain Web]` logs

