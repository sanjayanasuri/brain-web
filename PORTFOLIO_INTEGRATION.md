# Portfolio Integration Guide

## 🎯 Quick Integration

### Option 1: Project Card (Recommended)

Add this to your portfolio projects section:

```html
<div class="project-card">
  <h3>Brain Web - Knowledge Graph Platform</h3>
  <p class="project-description">
    An interactive knowledge graph platform that visualizes and connects concepts 
    through an AI-powered interface. Built with Next.js, Neo4j, and OpenAI.
  </p>
  <div class="project-features">
    <span class="feature-tag">Next.js</span>
    <span class="feature-tag">Neo4j</span>
    <span class="feature-tag">OpenAI</span>
    <span class="feature-tag">AWS</span>
    <span class="feature-tag">Terraform</span>
  </div>
  <div class="project-links">
    <a href="https://www.demo.sanjayanasuri.com" target="_blank" rel="noopener" class="btn-primary">
      🚀 Try Live Demo
    </a>
    <a href="https://github.com/sanjayanasuri/brain-web" target="_blank" rel="noopener" class="btn-secondary">
      📂 View Code
    </a>
  </div>
</div>
```

### Option 2: Simple Button Link

```html
<a href="https://www.demo.sanjayanasuri.com" 
   target="_blank" 
   rel="noopener"
   class="demo-button">
  Try Brain Web Demo →
</a>
```

### Option 3: Featured Project Section

```html
<section class="featured-project">
  <div class="project-preview">
    <h2>Brain Web</h2>
    <p class="subtitle">Interactive Knowledge Graph Platform</p>
    <p>
      A full-stack application for building and exploring personal knowledge graphs. 
      Features AI-powered chat, semantic search, and interactive graph visualization.
    </p>
    <ul class="tech-stack">
      <li>Frontend: Next.js, React, TypeScript</li>
      <li>Backend: FastAPI, Python</li>
      <li>Database: Neo4j Aura</li>
      <li>AI: OpenAI GPT-4o-mini</li>
      <li>Infrastructure: AWS ECS, Vercel, Terraform</li>
    </ul>
    <div class="project-actions">
      <a href="https://www.demo.sanjayanasuri.com" 
         target="_blank" 
         rel="noopener"
         class="btn btn-primary">
        View Live Demo
      </a>
      <a href="https://github.com/sanjayanasuri/brain-web" 
         target="_blank" 
         rel="noopener"
         class="btn btn-outline">
        GitHub Repository
      </a>
    </div>
  </div>
</section>
```

## 📝 Project Description for Portfolio

### Short Version (1-2 sentences)
**Brain Web** is an interactive knowledge graph platform that helps users visualize, connect, and explore concepts through an AI-powered interface. Built with modern web technologies and deployed on AWS.

### Medium Version (for project cards)
**Brain Web** is a full-stack knowledge graph platform that enables users to build, visualize, and interact with their personal knowledge base. The system features:

- **Interactive Graph Visualization**: Explore concepts and relationships in real-time
- **AI-Powered Chat**: Ask questions and get contextual answers based on your graph
- **Semantic Search**: Find relevant concepts using natural language
- **Node Management**: Create, edit, and connect concepts dynamically
- **Gap Analysis**: Identify knowledge gaps and learning opportunities

**Tech Stack**: Next.js, FastAPI, Neo4j, OpenAI, AWS (ECS, Vercel), Terraform

**Live Demo**: [www.demo.sanjayanasuri.com](https://www.demo.sanjayanasuri.com)

### Long Version (for dedicated project page)

**Brain Web - Knowledge Graph Platform**

Brain Web is a comprehensive knowledge management system that transforms how users organize, visualize, and interact with information. The platform combines graph database technology with AI to create an intelligent, interactive learning environment.

**Key Features:**

1. **Interactive Graph Visualization**
   - Real-time 3D graph rendering using D3.js and React
   - Intuitive node and relationship exploration
   - Focus mode for deep-dive analysis
   - Customizable graph views and filters

2. **AI-Powered Chat Interface**
   - Contextual answers based on your knowledge graph
   - Semantic search across all concepts
   - Personalized responses using your learning style
   - Suggested actions and follow-up questions

3. **Dynamic Node Management**
   - Create and edit concepts on the fly
   - Build relationships between concepts
   - Organize by domains and tags
   - Track learning progress and gaps

4. **Advanced Features**
   - Gap analysis to identify knowledge weaknesses
   - Focus areas for targeted learning
   - Profile customization for personalized experience
   - Source management for multi-source tracking

**Technical Architecture:**

- **Frontend**: Next.js 14 (App Router), React, TypeScript, D3.js
- **Backend**: FastAPI (Python), Neo4j graph database
- **AI Integration**: OpenAI GPT-4o-mini for chat, embeddings for search
- **Infrastructure**: 
  - Frontend: Vercel Edge Network
  - Backend: AWS ECS Fargate with Application Load Balancer
  - Database: Neo4j Aura (managed cloud)
  - Infrastructure as Code: Terraform
  - CI/CD: GitHub Actions

**Deployment:**
- Fully automated CI/CD pipeline
- Zero-downtime deployments
- Auto-scaling backend services
- Global CDN distribution

**Live Demo**: [www.demo.sanjayanasuri.com](https://www.demo.sanjayanasuri.com)  
**GitHub**: [github.com/sanjayanasuri/brain-web](https://github.com/sanjayanasuri/brain-web)

## 🎨 CSS Styling Suggestions

```css
.project-card {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  transition: transform 0.2s, box-shadow 0.2s;
}

.project-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}

.demo-button {
  display: inline-block;
  padding: 12px 24px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  text-decoration: none;
  border-radius: 8px;
  font-weight: 600;
  transition: transform 0.2s;
}

.demo-button:hover {
  transform: translateY(-2px);
}

.feature-tag {
  display: inline-block;
  padding: 4px 12px;
  background: #f0f0f0;
  border-radius: 16px;
  font-size: 12px;
  margin: 4px;
}
```

## 🔗 Direct Links

- **Live Demo**: https://www.demo.sanjayanasuri.com
- **GitHub Repository**: https://github.com/sanjayanasuri/brain-web
- **API Endpoint**: https://api-demo.sanjayanasuri.com

## ✅ Checklist

- [ ] Add project card to portfolio
- [ ] Include "Try Live Demo" button
- [ ] Add GitHub link
- [ ] Write project description
- [ ] Test demo link works
- [ ] Add screenshots (optional)
- [ ] Update resume with project (optional)
