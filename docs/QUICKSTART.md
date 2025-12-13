# Quick Start Guide

## Prerequisites

1. **Neo4j Database Running**
   - Follow `backend/NEO4J_SETUP.md` to set up Neo4j Desktop
   - Make sure your database is started

2. **Backend API Running**
   ```bash
   cd backend
   source .venv/bin/activate
   python -m uvicorn main:app --reload
   ```
   Backend should be running on `http://127.0.0.1:8000`

3. **Node.js 18+ Installed**
   ```bash
   node --version  # Should be 18 or higher
   ```

## Starting the Frontend

1. **Install Dependencies**
   ```bash
   cd frontend
   npm install
   ```

2. **Start Development Server**
   ```bash
   npm run dev
   ```

3. **Open in Browser**
   - Navigate to `http://localhost:3000`
   - You should see your knowledge graph!

## Using the Graph Explorer

- **Click nodes** to explore their neighbors
- **Search** for concepts by name in the top bar
- **View details** in the sidebar when you click a node
- **Zoom** with mouse wheel
- **Pan** by dragging the background
- **Hover** over nodes to highlight connections

## Troubleshooting

### Frontend can't connect to backend
- Make sure backend is running on port 8000
- Check CORS settings in `backend/main.py`
- Verify `NEXT_PUBLIC_API_URL` in `.env.local` (optional, defaults to localhost:8000)

### Graph is empty
- Make sure Neo4j has data (run import scripts if needed)
- Check that the root node (N001) exists
- Open browser console for error messages

### Installation issues
- Make sure you're using Node.js 18+
- Try deleting `node_modules` and `package-lock.json`, then `npm install` again
