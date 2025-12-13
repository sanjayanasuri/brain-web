# Branch Explorer (on top of Brain Web) — Vision

## What exists today (Brain Web)
Brain Web is a working knowledge graph engine:
- A FastAPI backend that stores concepts + relationships in Neo4j
- LLM-powered extraction (lectures, Notion ingestion), chat, search, gaps, preferences
- A Next.js frontend for graph exploration and chat

## What we’re building (Branch Explorer)
Branch Explorer is the product layer on top of the engine. It turns “a single evolving graph” into a place where you can:
- Maintain multiple named graphs (Graph Collections)
- Explore alternate paths/forks of ideas (Branches)
- Compare and collapse branches back into a primary branch
- Save states (Snapshots) of a graph/branch at moments in time
- Customize exploration via profile + preferences
- Manage sources (Notion now; GitHub/PDF/Web later)

Brain Web stays the engine; Branch Explorer provides the workflow primitives.

## The core primitives

### 1) Graph Collections
A Graph Collection is a named container for a graph.
- Example: “CS251”, “Personal Finance”, “Onboarding”, “Startup Research”
- Each collection can have its own preferences and source settings

### 2) Branches
A Branch is an alternate path within a collection.
- Examples: “Hypothesis A”, “Draft lecture v2”, “Counterargument”, “Simplified explanation”
- Branches can be compared and later collapsed into another branch (usually the primary branch)

### 3) Snapshots
A Snapshot is a saved state of a graph/branch.
- Example: “Before ingesting Notion”, “After summarization pass”, “Pre-exam review”
- Snapshots are used for time-travel, undo, and sharing “thinking states”

### 4) Profile + Preferences
A Profile is user-specific context (background, goals, style).
Preferences control how Branch Explorer behaves (expansion depth, clustering, novelty vs familiarity, source trust weighting, etc.).

### 5) Sources
Sources are provenance for knowledge.
- Notion is the first source type
- Next: GitHub repo, PDF, web URLs

## Design goals
- Additive evolution: don’t break the working engine
- Keep backend and frontend compatible while we add “collection/branch/snapshot” layers
- Avoid premature abstractions; introduce minimal schemas + routes first
- Always track provenance (source, timestamps, branch)

## What “done” looks like (first milestone)
- You can create a Graph Collection
- Each collection has a primary branch
- You can fork a branch, add/modify nodes/edges within that branch, and compare branches
- You can save a snapshot and restore it
- UI exposes a “Branch Explorer” graph view with collection + branch selection
