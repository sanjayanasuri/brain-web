# 🧠 Brain Web

**Connecting the dots in my digital universe.**

Brain Web is my personal knowledge operating system. It’s more than just a note-taking app—it’s a living, breathing knowledge graph that uses AI to help me visualize, explore, and expand my understanding of the world.

[Live Demo](https://demo.sanjayanasuri.com) • [View My Graph](https://demo.sanjayanasuri.com) • [Technical Docs](docs/TECHNICAL.md)

---

## ✨ What is this?

I built Brain Web because traditional notes feel flat. Knowledge is 3D—it's a web of connections. This system treats every idea as a node in a graph, allowing me to:

- 🕸️ **See the Big Picture**: A real-time 2D graph that shows how my thoughts connect.
- 🤖 **Talk to My Brain**: A GPT-4o powered partner that has read everything I've saved.
- 📚 **Never Start from Scratch**: Automatically extract concepts from lectures, PDFs, and Notion.
- 🔗 **Sync Everything**: Native integration with Notion and a Chrome extension for web capture.
- 📊 **Find the Gaps**: AI that tells me what I'm missing or what I should learn next.

## 🚀 Experience it

You can see the system in action at [demo.sanjayanasuri.com](https://demo.sanjayanasuri.com).

> *Note: This is my personal deployment. It's built on a high-performance Hetzner cluster with Neo4j, Qdrant, and Postgres for near-instant retrieval.*

---

## 🛠️ The Tech Behind the Magic

- **Frontend**: Next.js 14, React, D3-force (for the graph), and Tailwind.
- **Backend**: FastAPI (Python), OpenAI (GPT-4o-mini & Embeddings).
- **Databases**: Neo4j (Graph), Qdrant (Vector/Semantic), Postgres (Events/Storage).
- **Deployment**: Docker Compose on Hetzner + Vercel for the frontend.

## 🏃 Quick Start

If you want to run this yourself:

1. **Clone the repo**: `git clone https://github.com/sanjayanasuri/brain-web`
2. **Setup environment**: Copy `.env.example` to `.env` and add your OpenAI key.
3. **Spin it up**: Run `./scripts/deploy.sh` (Requires Docker).

Detailed installation guides are in [docs/deployment/](docs/deployment/).

---

## 🤝 Contributing & License

This is a personal project, but I love feedback! Feel free to open an issue or reach out. Licensed under MIT.

---

<p align="center">
  Made with ❤️ by <a href="https://sanjayanasuri.com">Sanjay Anasuri</a>
</p>
