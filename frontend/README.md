# Brain Web Frontend

Interactive graph visualization frontend for exploring your knowledge graph.

## Features

- 🎯 **Interactive Graph Visualization** - Click nodes to explore neighbors
- 🔍 **Search** - Find concepts by name
- 📊 **Node Details** - View metadata (domain, type, notes, etc.)
- 🎨 **Color Coding** - Different colors for domains vs concepts
- 🔄 **Dynamic Loading** - Loads neighbors on-demand when you click nodes
- 🖱️ **Zoom & Pan** - Navigate the graph naturally

## Getting Started

### Prerequisites

- Node.js 18+ installed
- Backend API running on `http://127.0.0.1:8000`

### Installation

```bash
cd frontend
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for Production

```bash
npm run build
npm start
```

## How It Works

1. **Initial Load**: Starts with a root node (default: N001 - Software Architecture)
2. **Click to Explore**: Click any node to load its neighbors and add them to the graph
3. **Search**: Type a concept name and press Enter to jump to that concept
4. **View Details**: Click a node to see its metadata in the sidebar
5. **Zoom/Pan**: Use mouse wheel to zoom, drag to pan

## Customization

- Change the initial node by modifying `initialNodeId` in `app/page.tsx`
- Adjust graph depth by changing `maxDepth` in `fetchGraphData` (default: 2)
- Modify colors in `GraphVisualization.tsx` (nodeColor function)

## API Integration

The frontend connects to your FastAPI backend:
- `GET /concepts/{node_id}` - Get concept details
- `GET /concepts/by-name/{name}` - Search by name
- `GET /concepts/{node_id}/neighbors` - Get connected concepts

Make sure your backend is running and CORS is configured (already done in `main.py`).

