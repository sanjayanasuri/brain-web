# 🧠 Brain Web

<div align="center">

**An AI-powered knowledge graph system for visualizing, exploring, and expanding your understanding of interconnected concepts.**

[![Status](https://img.shields.io/badge/status-active%20development-brightgreen)]()
[![Version](https://img.shields.io/badge/version-0.1.0-blue)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()
[![Demo](https://img.shields.io/badge/demo-live-orange)](https://demo.sanjayanasuri.com)

[Live Demo](https://demo.sanjayanasuri.com) • [Documentation](#-documentation) • [Quick Start](#-quick-start) • [Features](#-features)

</div>

---

## 📖 Overview

Brain Web is a **standalone, production-ready** knowledge management system that transforms how you organize, visualize, and interact with information. Inspired by Notion's "Everything is a block" philosophy, it treats knowledge as interconnected blocks that can be explored, connected, and visualized in multiple ways.

### What Makes Brain Web Unique?

- 🕸️ **Interactive Knowledge Graph**: Real-time 2D force-directed graph visualization
- 🤖 **AI-Powered Intelligence**: GPT-4o-mini powered chat with semantic search
- 📚 **Automatic Concept Extraction**: LLM-powered extraction from lectures and documents
- 🔗 **Notion Integration**: Seamless sync with your Notion workspace
- 🎨 **Personalized Learning**: Customizable teaching styles and learning preferences
- 📊 **Gap Detection**: AI identifies knowledge gaps and suggests improvements
- 🚀 **Production Ready**: Fully deployed with CI/CD, infrastructure as code, and monitoring

---

## 🛠️ How It Was Built

### Architecture

Brain Web follows a **modern, scalable architecture** with clear separation of concerns:

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│   Frontend      │         │    Backend      │         │   Database      │
│   (Next.js)     │◄───────►│   (FastAPI)     │◄───────►│   (Neo4j)       │
│   Vercel        │   REST  │   AWS ECS       │  Bolt   │   Neo4j Aura    │
└─────────────────┘         └─────────────────┘         └─────────────────┘
        │                           │                           │
        │                           │                           │
        └───────────────────────────┴───────────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │   OpenAI API      │
                    │   (GPT-4o-mini)  │
                    └──────────────────┘
```

### Tech Stack

#### **Frontend**
- **Framework**: [Next.js 14](https://nextjs.org/) (React 18) with App Router
- **Visualization**: [react-force-graph-2d](https://github.com/vasturiano/react-force-graph) for interactive graph rendering
- **Styling**: CSS Modules with CSS Variables for theming
- **Type Safety**: TypeScript for type-safe development
- **Deployment**: [Vercel](https://vercel.com/) for edge-optimized hosting

#### **Backend**
- **Framework**: [FastAPI](https://fastapi.tiangolo.com/) (Python 3.11) for high-performance API
- **Database**: [Neo4j](https://neo4j.com/) graph database for relationship modeling
- **AI Integration**: [OpenAI API](https://openai.com/) (GPT-4o-mini, text-embedding-3-small)
- **API Design**: RESTful API with 58+ endpoints
- **Testing**: pytest with 47+ comprehensive tests
- **Deployment**: AWS ECS (Fargate) with Docker containerization

#### **Infrastructure & DevOps**
- **Infrastructure as Code**: [Terraform](https://www.terraform.io/) for AWS resource management
- **Container Registry**: AWS ECR (Elastic Container Registry)
- **Orchestration**: AWS ECS (Elastic Container Service) with Fargate
- **CI/CD**: GitHub Actions with OIDC authentication
- **Monitoring**: AWS CloudWatch Logs
- **Load Balancing**: AWS Application Load Balancer
- **DNS**: AWS Route53
- **CDN**: Vercel Edge Network (frontend)

#### **Integrations**
- **Notion API**: Real-time synchronization with Notion databases
- **OpenAI API**: GPT-4o-mini for chat, embeddings for semantic search
- **DynamoDB**: Event tracking and analytics (optional)

---

## 🚀 How It Was Deployed

### Production Deployment Architecture

The system is deployed across **multiple cloud services** for optimal performance and reliability:

#### **Frontend Deployment (Vercel)**
- **Platform**: Vercel Edge Network
- **Build**: Automatic builds on git push to `main`
- **Domain**: Custom domain with SSL (demo.sanjayanasuri.com)
- **Features**: 
  - Automatic HTTPS
  - Edge caching
  - Global CDN distribution
  - Zero-downtime deployments

#### **Backend Deployment (AWS)**
- **Compute**: AWS ECS Fargate (serverless containers)
- **Container**: Docker images stored in AWS ECR
- **Networking**: AWS VPC with public/private subnets
- **Load Balancing**: Application Load Balancer (ALB) with health checks
- **Auto-scaling**: ECS service auto-scaling based on CPU/memory
- **Secrets Management**: AWS Systems Manager Parameter Store
- **Logging**: CloudWatch Logs with structured logging

#### **Database (Neo4j)**
- **Provider**: Neo4j Aura (managed Neo4j cloud)
- **Connection**: Bolt protocol over TLS
- **Backup**: Automated daily backups
- **High Availability**: Multi-region replication

### CI/CD Pipeline

**Automated Deployment Workflow:**

1. **Code Push** → GitHub repository
2. **GitHub Actions Trigger** → Detects changes in `backend/` or `frontend/`
3. **Backend Pipeline**:
   - Build Docker image
   - Push to AWS ECR
   - Update ECS task definition
   - Deploy to ECS Fargate
   - Health check verification
4. **Frontend Pipeline**:
   - Build Next.js application
   - Deploy to Vercel
   - Run production optimizations
   - Update DNS records

**Infrastructure Management:**
- Terraform manages all AWS resources
- Infrastructure changes tracked in version control
- Environment-specific configurations (dev, demo, prod)
- Automated DNS and SSL certificate management

### Security & Best Practices

- ✅ **OIDC Authentication**: GitHub Actions uses AWS IAM roles (no long-lived credentials)
- ✅ **Secrets Management**: All secrets stored in AWS Parameter Store
- ✅ **HTTPS Everywhere**: SSL/TLS encryption for all traffic
- ✅ **Rate Limiting**: Built-in rate limiting for API protection
- ✅ **CORS Configuration**: Strict CORS policies
- ✅ **Environment Isolation**: Separate environments for dev/demo/prod
- ✅ **Container Security**: Regular base image updates
- ✅ **Logging & Monitoring**: Comprehensive logging for debugging and analytics

---

## ✨ Features

### Core Features

| Feature | Description | Status |
|---------|-------------|--------|
| **Knowledge Graph** | Interactive 2D visualization of concepts and relationships | ✅ Complete |
| **Concept Management** | Create, read, update, delete concepts with rich metadata | ✅ Complete |
| **Relationship Mapping** | Typed relationships between concepts (DEPENDS_ON, PREREQUISITE, etc.) | ✅ Complete |
| **AI Chat** | Context-aware Q&A powered by GPT-4o-mini with graph context | ✅ Complete |
| **Semantic Search** | OpenAI embeddings-based concept search | ✅ Complete |
| **Lecture Ingestion** | LLM-powered extraction of concepts from lecture text | ✅ Complete |
| **Notion Sync** | Automatic synchronization with Notion databases | ✅ Complete |
| **Gap Detection** | AI identifies knowledge gaps and suggests improvements | ✅ Complete |
| **Personalization** | Customizable teaching styles and learning preferences | ✅ Complete |
| **Resource Management** | Upload and attach files (PDFs, images) to concepts | ✅ Complete |

### Advanced Features

- **Teaching Style Analysis**: Learn from your own teaching patterns
- **Lecture Segmentation**: Automatic breakdown of lectures into logical segments
- **Analogy Extraction**: Identifies teaching analogies from content
- **Answer Rewriting**: Learn from user feedback to improve responses
- **Graph Export/Import**: CSV-based backup and portability
- **Multi-Source Tracking**: Track which sources contributed to each concept
- **Domain Organization**: Color-coded visualization by domain
- **Focus Areas**: Bias answers toward current learning themes

---

## 🎯 Use Cases

### Current Use Cases

1. **Personal Knowledge Management**
   - Organize and visualize your understanding of complex topics
   - Build a living knowledge graph that grows with your learning
   - Track relationships between concepts across domains

2. **Lecture Organization & Analysis**
   - Ingest lecture content and automatically extract concepts
   - Analyze teaching patterns and styles
   - Identify gaps in coverage

3. **Research & Writing**
   - Map out research topics and their connections
   - Track sources and citations
   - Visualize argument structures

4. **Educational Content Creation**
   - Plan curriculum by visualizing concept dependencies
   - Identify prerequisite knowledge
   - Generate teaching materials based on your style

### Future Use Cases

- **Multi-User Collaboration**: Shared knowledge graphs for teams
- **Domain-Specific Applications**: Specialized versions for education, research, business
- **3D Graph Visualization**: Immersive exploration of knowledge spaces
- **Export Formats**: Integration with Obsidian, Roam, Markdown
- **Mobile Applications**: Native mobile apps for on-the-go learning

---

## 🚀 Quick Start

### Prerequisites

- **Python 3.9+**
- **Node.js 18+**
- **Neo4j Database** (local or Neo4j Aura cloud)
- **OpenAI API Key** (optional, for AI features)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/sanjayanasuri/brain-web.git
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
   - Local: Follow [Neo4j Setup Guide](docs/NEO4J_SETUP.md)
   - Cloud: Use [Neo4j Aura](https://neo4j.com/cloud/aura/) (recommended)

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

---

## 📚 Documentation

### Getting Started
- **[Quick Start Guide](docs/QUICKSTART.md)** - Step-by-step setup instructions
- **[Neo4j Setup](docs/NEO4J_SETUP.md)** - Database configuration guide
- **[Architecture Overview](docs/ARCHITECTURE.md)** - System architecture details

### Development
- **[Codebase Overview](docs/CODEBASE_OVERVIEW.md)** - Code structure and organization
- **[API Documentation](docs/FEATURES.md)** - Complete API reference
- **[Developer Guide](README-dev.md)** - Developer quick reference

### Deployment
- **[Demo Setup](docs/DEMO_SETUP.md)** - Setting up demo/trial mode
- **[Infrastructure Guide](infra/)** - Terraform infrastructure documentation

### Project Status
- **[Project Status](PROJECT_STATUS.md)** - Current features and roadmap
- **[Roadmap](docs/ROADMAP.md)** - Future development plans

---

## 🔮 What's Next: Active Development

Brain Web is an **actively developed project** with continuous improvements and new features. Here's what's being worked on:

### 🚧 In Progress (v0.2.0)

- **Pathway Creator**: Visual learning journey builder
- **Enhanced Graph Exploration**: DFS/BFS traversal modes
- **Mobile Responsiveness**: Full mobile support for graph visualization
- **Performance Optimizations**: Graph rendering improvements for large datasets

### 📅 Planned Features

- **Multi-User Support**: Collaboration features for shared knowledge graphs
- **Advanced AI Features**: 
  - Multi-modal understanding (images, audio)
  - Automated concept linking
  - Intelligent relationship suggestions
- **Export/Import Formats**: 
  - Obsidian integration
  - Roam Research compatibility
  - Markdown export
- **3D Graph Visualization**: Immersive 3D exploration
- **Integration Ecosystem**: 
  - Anki flashcards generation
  - Calendar integration for learning schedules
  - Browser extension for web content capture

### 🎯 Long-Term Vision

- **Domain-Specific Versions**: Specialized editions for education, research, business
- **API Marketplace**: Third-party integrations and plugins
- **Community Features**: Public knowledge graphs, sharing, collaboration
- **Enterprise Features**: Team workspaces, advanced analytics, SSO

**Want to contribute?** See [Contributing](#-contributing) below!

---

## 🧪 Testing

Run the comprehensive test suite:

```bash
cd backend
source .venv/bin/activate
pytest
```

**Test Coverage:**
- ✅ 47+ tests across 8 feature areas
- ✅ Graph & Concepts (14 tests)
- ✅ Lecture Ingestion (7 tests)
- ✅ Teaching Style (4 tests)
- ✅ Preferences (6 tests)
- ✅ Notion Sync (4 tests)
- ✅ Admin & Utilities (6 tests)
- ✅ AI & Chat (2 tests)
- ✅ Core & Internal (4 tests)

Access the web-based test UI at `/tests` in the frontend.

---

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

# Demo Mode (optional)
DEMO_MODE=false
DEMO_ALLOW_WRITES=false
```

### Frontend (.env.local)

```bash
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_DEMO_MODE=false
```

**⚠️ Important**: Never commit `.env` or `.env.local` files. They are already in `.gitignore`.

---

## 🤝 Contributing

Contributions are welcome! This is an active project, and we'd love your help.

### How to Contribute

1. **Fork the repository**
2. **Create a feature branch** (`git checkout -b feature/AmazingFeature`)
3. **Make your changes**
4. **Add tests** for new features
5. **Run the test suite** (`pytest`)
6. **Commit your changes** (`git commit -m 'Add some AmazingFeature'`)
7. **Push to the branch** (`git push origin feature/AmazingFeature`)
8. **Open a Pull Request**

### Development Guidelines

- Follow existing code style and patterns
- Write tests for new features
- Update documentation as needed
- Keep commits atomic and well-described

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- Inspired by **Notion's "Everything is a block"** philosophy
- Built with modern, open-source technologies
- Powered by **OpenAI** for AI capabilities
- Graph visualization powered by **react-force-graph**

---

## 📞 Contact & Links

- **Live Demo**: [demo.sanjayanasuri.com](https://demo.sanjayanasuri.com)
- **GitHub**: [github.com/sanjayanasuri/brain-web](https://github.com/sanjayanasuri/brain-web)
- **Issues**: [GitHub Issues](https://github.com/sanjayanasuri/brain-web/issues)

---

<div align="center">

**Built with ❤️ by [Sanjay Anasuri](https://sanjayanasuri.com)**

**Status**: 🟢 Active Development  
**Last Updated**: December 2024

[⬆ Back to Top](#-brain-web)

</div>
