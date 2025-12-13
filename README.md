# Brain Web

> An AI-powered knowledge graph system for visualizing, exploring, and expanding your understanding of interconnected concepts.

[![Status](https://img.shields.io/badge/status-active%20development-green)]()
[![Version](https://img.shields.io/badge/version-0.1.0-blue)]()

## 🎯 Overview

Brain Web is a personal knowledge management tool that learns from your lectures, documents, and interactions to create a living, breathing map of your understanding. Inspired by Notion's "Everything is a block" philosophy, Brain Web treats knowledge as interconnected blocks that can be explored, connected, and visualized in multiple ways.

### Key Features

- 🕸️ **Interactive Knowledge Graph**: Visualize concepts and their relationships in an interactive 2D graph
- 🤖 **AI-Powered Chat**: Ask questions and get context-aware answers powered by GPT-4o-mini
- 📚 **Lecture Ingestion**: Automatically extract concepts and relationships from lecture text using LLM
- 🔗 **Notion Integration**: Sync your Notion pages into the knowledge graph automatically
- 🎨 **Personalization**: Customize response style, teaching style, and learning preferences
- 📊 **Gap Detection**: Identify knowledge gaps and areas needing more coverage
- 🎓 **Teaching Style Analysis**: Learn from your own teaching patterns

## 🚀 Quick Start

### Prerequisites

- Python 3.9+
- Node.js 18+
- Neo4j Database (see [Neo4j Setup Guide](docs/NEO4J_SETUP.md))
- OpenAI API Key (optional, for AI features)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/brain-web.git
   cd brain-web
   ```

2. **Set up backend**
   ```bash
   cd backend
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your Neo4j and OpenAI credentials
   ```

4. **Set up frontend**
   ```bash
   cd ../frontend
   npm install
   ```

5. **Start Neo4j database**
   - Follow [Neo4j Setup Guide](docs/NEO4J_SETUP.md)

6. **Start backend**
   ```bash
   cd backend
   source .venv/bin/activate
   uvicorn main:app --reload
   ```

7. **Start frontend**
   ```bash
   cd frontend
   npm run dev
   ```

8. **Open in browser**
   - Navigate to `http://localhost:3000`

For detailed setup instructions, see [Quick Start Guide](docs/QUICKSTART.md).

## 📖 Documentation

- **[Project Status](PROJECT_STATUS.md)** - Current status, features, and roadmap
- **[Features List](docs/FEATURES.md)** - Complete feature documentation
- **[Codebase Overview](docs/CODEBASE_OVERVIEW.md)** - Architecture and code structure
- **[Quick Start Guide](docs/QUICKSTART.md)** - Getting started guide
- **[Neo4j Setup](docs/NEO4J_SETUP.md)** - Neo4j database setup instructions
- **[Demo Setup](docs/DEMO_SETUP.md)** - Setting up demo/trial mode
- **[Developer Guide](README-dev.md)** - Developer quick reference

## 🏗️ Architecture

### Backend
- **Framework**: FastAPI (Python)
- **Database**: Neo4j (Graph Database)
- **AI**: OpenAI API (GPT-4o-mini, text-embedding-3-small, GPT-4 Vision)
- **API**: RESTful API with 58+ endpoints

### Frontend
- **Framework**: Next.js 14 (React)
- **Visualization**: react-force-graph-2d
- **Styling**: CSS Modules with CSS Variables

### Key Components

```
brain-web/
├── backend/              # FastAPI backend
│   ├── api_*.py         # API routers
│   ├── services_*.py    # Business logic
│   ├── models.py        # Pydantic schemas
│   └── tests/           # Test suite
├── frontend/            # Next.js frontend
│   └── app/             # Next.js app directory
│       ├── components/  # React components
│       └── [routes]/    # Pages
└── docs/                # Documentation
```

## 🎨 Features in Detail

### Knowledge Graph
- Create, read, update, delete concepts (nodes)
- Manage typed relationships between concepts
- Interactive 2D force-directed graph visualization
- Domain-based organization and filtering
- Semantic search using OpenAI embeddings

### Lecture Management
- LLM-powered concept and relationship extraction
- Automatic lecture segmentation
- Analogy extraction and teaching style tagging
- Lecture Studio for comprehensive analysis
- Draft next lecture generation

### AI Chat System
- Context-aware Q&A with graph context
- Semantic search for finding relevant concepts
- Structured responses with suggested actions
- Answer rewriting and style learning
- Feedback system for continuous improvement

### Notion Integration
- Sync Notion pages into knowledge graph
- Automatic background synchronization
- Page indexing with allowlist/blocklist modes
- Source tracking and visualization

### Personalization
- Response style customization (tone, teaching style, structure)
- Focus areas for current learning themes
- User profile (background, interests, weak spots)
- Teaching style profile extracted from lectures
- Personalized explanations based on profile

## 🧪 Testing

Run the test suite:

```bash
cd backend
source .venv/bin/activate
pytest
```

Access the web-based test UI at `/tests` in the frontend.

**Test Coverage:**
- 47+ tests across 8 feature areas
- Graph & Concepts (14 tests)
- Lecture Ingestion (7 tests)
- Teaching Style (4 tests)
- Preferences (6 tests)
- Notion Sync (4 tests)
- Admin & Utilities (6 tests)
- AI & Chat (2 tests)
- Core & Internal (4 tests)

## 🔐 Environment Variables

### Backend (.env)

```bash
# Neo4j Database
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_password

# OpenAI API (optional, for AI features)
OPENAI_API_KEY=sk-...

# Notion API (optional, for Notion integration)
NOTION_API_KEY=secret_...
NOTION_DATABASE_IDS=database_id_1,database_id_2

# Notion Auto-Sync (optional)
ENABLE_NOTION_AUTO_SYNC=false
```

### Frontend (.env.local)

```bash
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
```

**⚠️ Important**: Never commit `.env` or `.env.local` files. They are already in `.gitignore`.

## 🚧 Roadmap

### Current Version (0.1.0)
- ✅ Core knowledge graph infrastructure
- ✅ Lecture ingestion and management
- ✅ AI-powered chat and semantic search
- ✅ Notion integration
- ✅ Personalization and teaching style
- ✅ Resource management
- ✅ Frontend UI components

### Upcoming (v0.2.0)
- 🚧 Demo/trial mode for portfolio website
- 🚧 Pathway creator for learning journeys
- 🚧 Enhanced graph exploration (DFS/BFS modes)
- 🚧 Mobile responsiveness

### Future Vision
- Multi-user support and collaboration
- Advanced AI features (multi-modal understanding)
- Export/import formats (Markdown, Obsidian, Roam)
- Domain-specific applications (education, writing, research)
- 3D graph visualization
- Integration ecosystem

See [Project Status](PROJECT_STATUS.md) for detailed roadmap.

## 💡 Use Cases

### Current Use Cases
1. **Personal Knowledge Management**: Organize and visualize your understanding
2. **Lecture Organization**: Ingest and analyze lecture content
3. **Teaching Style Analysis**: Learn from your own teaching patterns
4. **Knowledge Gap Detection**: Find areas needing more coverage

### Future Use Cases
1. **Education**: Curriculum planning, student progress tracking
2. **Writing**: Character maps, plot development, world-building
3. **Research**: Literature review, hypothesis exploration
4. **Business**: Knowledge management, decision trees

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 License

[To be determined]

## 🙏 Acknowledgments

- Inspired by Notion's "Everything is a block" philosophy
- Built with FastAPI, Next.js, Neo4j, and OpenAI

## 📞 Contact

[Your contact information]

---

**Status**: Active Development  
**Last Updated**: December 2024

For detailed project status, see [PROJECT_STATUS.md](PROJECT_STATUS.md).
