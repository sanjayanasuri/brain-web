# Bidirectional Sync Verification Guide

This guide helps you verify that CSV files and Neo4j are staying in sync automatically.

## How to Verify Updates Are Working

### 1. Check Startup Auto-Import

**What to look for:**
When you start the backend server, you should see import messages in the console.

**Steps:**
1. Start the backend server:
   ```bash
   cd backend
   source .venv/bin/activate
   python -m uvicorn main:app --reload
   ```

2. Look for these messages in the console:
   ```
   [OK] Constraints ensured.
   [OK] Imported X Concept nodes from nodes_semantic.csv.
   [OK] Imported Y edges from edges_semantic.csv.
   [DONE] CSV import complete.
   ```

**If you don't see these messages:**
- Check that CSV files exist in `graph/nodes_semantic.csv` and `graph/edges_semantic.csv`
- Check backend logs for errors (they won't crash the app, but will log warnings)

### 2. Verify Auto-Export on Create/Update

**Test: Create a new node via the frontend**

1. Open the frontend (http://localhost:3000)
2. In the chat, type: `add node Test Sync domain Testing type concept`
3. Check the backend console - you should see:
   ```
   [OK] Exported X Concept nodes to nodes_semantic.csv.
   [OK] Exported Y edges to edges_semantic.csv.
   [DONE] CSV export complete.
   ```

4. **Verify CSV file was updated:**
   ```bash
   # Check the modification time of the CSV file
   ls -lh graph/nodes_semantic.csv
   
   # Or view the last few lines to see your new node
   tail -5 graph/nodes_semantic.csv
   ```

**Test: Create a relationship**

1. In the frontend chat, type: `link Test Sync to Machine Learning as RELATES_TO`
2. Check backend console for export messages
3. Verify `graph/edges_semantic.csv` was updated:
   ```bash
   tail -5 graph/edges_semantic.csv
   ```

### 3. Verify Frontend Auto-Refresh

**What should happen:**
- After creating a node, the graph should automatically refresh and show the new node
- After creating a relationship, the graph should show the new link
- No page reload needed - it should be smooth

**Test:**
1. Create a node via chat: `add node Frontend Test domain Testing`
2. Watch the graph - it should automatically update within 1-2 seconds
3. The new node should appear with smooth animation

### 4. Verify Bidirectional Sync

**Test the full cycle:**

1. **Add via CSV:**
   - Manually edit `graph/nodes_semantic.csv` and add a new row:
     ```csv
     N999,CSV Test,Testing,concept,,,
     ```
   - Restart the backend server
   - The new node should appear in Neo4j (check via Neo4j Browser or frontend)

2. **Add via Frontend:**
   - Create a node in the frontend: `add node Frontend Test 2 domain Testing`
   - Check `graph/nodes_semantic.csv` - the new node should be there
   - The CSV file's modification time should be recent

3. **Add via Neo4j Browser (if you have it):**
   - Create a node directly in Neo4j
   - Restart the backend (or wait for next startup)
   - The CSV export on next mutation will include the Neo4j node

### 5. Check CSV File Timestamps

**Quick verification:**
```bash
# Check when CSV files were last modified
ls -lh graph/*.csv

# The timestamps should be recent (within the last few minutes if you just made changes)
```

### 6. Debugging Tips

**If exports aren't happening:**

1. **Check backend logs:**
   - Look for error messages in the console
   - Export errors are logged but don't crash the API

2. **Check file permissions:**
   ```bash
   ls -la graph/
   # Make sure the backend process can write to these files
   ```

3. **Manually test export:**
   ```bash
   cd backend
   source .venv/bin/activate
   python scripts/export_csv_from_neo4j.py
   ```

4. **Manually test import:**
   ```bash
   cd backend
   source .venv/bin/activate
   python scripts/import_csv_to_neo4j.py
   ```

**If frontend isn't refreshing:**

1. Check browser console for errors
2. Verify `reloadGraph()` is being called (check Network tab for API calls)
3. The graph should automatically reload after any mutation

### 7. Expected Behavior Summary

✅ **On Backend Startup:**
- CSV files are automatically imported into Neo4j
- Existing Neo4j data is preserved (merge, not replace)

✅ **On Create/Update/Delete:**
- Neo4j is updated immediately
- CSV files are exported in the background (non-blocking)
- Frontend graph refreshes automatically

✅ **On Frontend Load:**
- Graph loads all nodes from Neo4j (via `/concepts/all/graph` endpoint)
- Any changes made via frontend are immediately reflected

### 8. Quick Test Checklist

- [ ] Backend startup shows import messages
- [ ] Creating a node updates CSV file (check timestamp)
- [ ] Creating a relationship updates CSV file
- [ ] Frontend graph refreshes after mutations
- [ ] CSV file contains all nodes from Neo4j
- [ ] Neo4j contains all nodes from CSV (after restart)

## Troubleshooting

**Problem: CSV files not updating**
- Check backend console for export errors
- Verify file paths are correct
- Check file permissions

**Problem: Frontend not showing new nodes**
- Check browser console for errors
- Verify API calls are succeeding (Network tab)
- Try manually refreshing the page

**Problem: Import not working on startup**
- Check that CSV files exist
- Verify file paths in `import_csv_to_neo4j.py`
- Check backend logs for import errors

