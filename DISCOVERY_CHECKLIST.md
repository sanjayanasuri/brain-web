========================
DISCOVERY CHECKLIST
========================

Fill this out by pasting outputs from your repo and Neo4j. This will inform the offline-first and local file ingestion implementation plan.

---

## 0) REPO MAP

**Paste the output of:**
```bash
# Root directory structure
ls -la

# Frontend structure (4 levels deep)
cd frontend && find . -maxdepth 4 -type f -name "*.tsx" -o -name "*.ts" -o -name "*.json" | head -n 50

# Backend structure (4 levels deep)  
cd ../backend && find . -maxdepth 4 -type f -name "*.py" | head -n 50

# Extension structure
cd ../browser-extension && find . -type f | head -n 30
```

**OR if you have `tree` installed:**
```bash
tree -L 4 -I 'node_modules|__pycache__|.git|*.pyc' frontend/ backend/ browser-extension/
```

---

## 1) ARCHITECTURE + RUNTIME

**Paste outputs of:**
```bash
# Frontend framework version
cat frontend/package.json | grep -A 5 '"next"'

# Backend dependencies
cat backend/requirements.txt

# Docker compose (if used)
cat docker-compose.yml

# How you start locally
cat Makefile 2>/dev/null || echo "No Makefile"
cat backend/run.sh 2>/dev/null || echo "No run.sh"
```

**Answer these questions:**
- How do you start the backend locally? (uvicorn command? docker-compose? script?)
- How do you start the frontend locally? (npm run dev? docker?)
- Are there any Next.js API routes in `frontend/app/api/` or `frontend/pages/api/`? (yes/no)
- What port does backend run on? (default: 8000)
- What port does frontend run on? (default: 3000)

---

## 2) NEO4J TOPOLOGY

**Paste outputs of:**
```bash
# Neo4j connection config
grep -R "NEO4J" backend/config.py backend/db_neo4j.py | head -n 20

# Connection strings
grep -R "bolt://\|neo4j://" backend/ docker-compose.yml 2>/dev/null | head -n 20

# Environment variable usage
grep -R "NEO4J_URI\|NEO4J_USER\|NEO4J_PASSWORD" backend/ | head -n 30
```

**Answer these questions:**
- Are you using Neo4j Aura (cloud) or local Neo4j? (Aura/local)
- What is your NEO4J_URI? (e.g., `bolt://localhost:7687` or `neo4j+s://xxx.databases.neo4j.io`)
- How is auth configured? (env vars in .env? docker-compose? AWS Parameter Store?)
- Do you have multiple Neo4j instances? (dev/staging/prod?) (yes/no)
- If using docker-compose, paste the Neo4j service block:
```yaml
# Paste the neo4j service section from docker-compose.yml here
```

---

## 3) CURRENT CRUD ON GRAPH

**Paste outputs of:**
```bash
# All API routers
grep -R "APIRouter\|@router\." backend/api_*.py | head -n 50

# Upsert/create operations
grep -R "upsert_\|create_\|MERGE\|CREATE" backend/api_*.py backend/services_*.py | grep -v "^#" | head -n 50

# Key endpoints for nodes/edges
grep -R "@router\.(post|put|patch|delete)" backend/api_concepts.py backend/api_graphs.py | head -n 30
```

**Paste key data models:**
```bash
# Concept/Node models
grep -A 20 "class Concept\|class ConceptCreate\|class ConceptUpdate" backend/models.py | head -n 60

# Relationship/Edge models  
grep -A 15 "class Relationship\|class.*Create.*Relationship" backend/models.py | head -n 40
```

**Answer these questions:**
- What are the main endpoints for creating nodes? (list 3-5 endpoint paths)
- What are the main endpoints for creating edges/relationships? (list 2-3 endpoint paths)
- How are notes stored? (separate node type? property on Concept? separate table/collection?)
- Do you have a `/concepts/{id}/notes` or similar endpoint? (yes/no, paste if exists)

---

## 4) RETRIEVAL / RAG / SEARCH BEHAVIOR

**Paste outputs of:**
```bash
# Embedding/vector usage
grep -R "embedding\|vector\|embed\|openai.*embed" backend/ -i | head -n 40

# GraphRAG/retrieval services
grep -R "GraphRAG\|retrieval\|semantic" backend/ -i | head -n 30

# Where embeddings are stored
grep -R "CREATE.*INDEX.*vector\|vector.*index\|embedding.*property" backend/ -i | head -n 20
```

**Answer these questions:**
- How does semantic search work? (OpenAI embeddings? stored in Neo4j? external vector DB?)
- Are embeddings stored as properties on nodes in Neo4j? (yes/no)
- Do you use Neo4j vector indexes? (yes/no)
- What is the retrieval flow? (GraphRAG? hybrid? pure semantic?)
- Paste a sample query endpoint:
```bash
# Show one retrieval/search endpoint implementation
grep -A 30 "@router.*search\|@router.*retrieve" backend/api_*.py | head -n 50
```

---

## 5) BROWSER EXTENSION DETAILS

**Paste outputs of:**
```bash
# Manifest
cat browser-extension/manifest.json

# Storage usage
grep -R "chrome\.storage\|indexedDB\|localStorage" browser-extension/ | head -n 30

# Service worker / background
grep -R "service_worker\|background\|serviceWorker" browser-extension/ | head -n 20

# API communication
grep -R "fetch\|axios" browser-extension/src/ | head -n 30
```

**Answer these questions:**
- Manifest version: MV2 or MV3? (from manifest.json)
- What permissions does the extension request? (list them)
- How does extension talk to backend? (fetch to localhost:8000? configurable API base?)
- Does extension already store anything locally? (chrome.storage.local? indexedDB?) (yes/no, what?)
- Does extension have offline queue already? (yes/no - I see `captureQueue` in service_worker.js, confirm if this is for offline)

---

## 6) OFFLINE EXPECTATIONS AND CONSTRAINTS

**Answer in plain text (no commands needed):**

**A) What must work offline? (check all that apply)**
- [ ] Create nodes (concepts)
- [ ] Create edges (relationships)
- [ ] Edit notes (if notes exist)
- [ ] Run queries (search, get neighbors, etc.)
- [ ] View graph visualization
- [ ] Full text search
- [ ] Semantic search (embeddings)
- [ ] LLM summarization (GPT calls)

**B) Platforms:**
- Chrome only? (yes/no)
- Also Safari/Firefox? (yes/no)
- Mobile browsers? (yes/no)

**C) Security posture:**
- Is storing graph data in browser acceptable? (yes/no)
- Should offline data be encrypted? (yes/no)
- Any compliance requirements? (HIPAA, GDPR, etc.) (list if any)

**D) Expected dataset size offline:**
- Rough estimate: 1k nodes? 10k? 50k? 100k+?
- Expected number of relationships: 1k? 10k? 50k? 100k+?
- Expected total storage size: <10MB? 10-100MB? 100MB-1GB? >1GB?

**E) Sync target:**
- Sync to local Neo4j only? (yes/no)
- Also sync to cloud Neo4j (Aura)? (yes/no)
- Multiple sync targets? (list if yes)

**F) Conflict resolution preference:**
- Last-write-wins (LWW)? (yes/no)
- Merge conflicts manually? (yes/no)
- Auto-merge when possible? (yes/no)
- User prompt for conflicts? (yes/no)

---

## 7) LOCAL FILE INGESTION CONSTRAINTS

**Answer in plain text (no commands needed):**

**A) "Local files" means:**
- [ ] file:// URLs (opening local files in browser)
- [ ] Drag-and-drop files into extension popup
- [ ] File picker (input type="file")
- [ ] Directory selection (selecting a folder)
- [ ] Other: _______________

**B) File types to support:**
- [ ] PDF
- [ ] HTML
- [ ] TXT
- [ ] MD (Markdown)
- [ ] DOCX
- [ ] Other: _______________

**C) Privacy/security:**
- Should content ever leave the machine? (yes/no)
- Should embeddings be computed locally? (yes/no - if yes, need local model)
- Should LLM processing happen locally? (yes/no - if yes, need local LLM)

**D) Processing requirements:**
- Do we need OCR for PDFs/images? (yes/no)
- Do we need incremental re-indexing when file changes? (yes/no)
- Should we watch file system for changes? (yes/no)

**E) Integration:**
- Should ingested files create nodes automatically? (yes/no)
- Should ingested files link to existing concepts? (yes/no, how?)
- Should we extract metadata (title, author, dates)? (yes/no)

---

## 8) CURRENT SYNC/EXPORT MECHANISMS

**Paste outputs of:**
```bash
# Any existing sync/export code
grep -R "sync\|export\|import\|backup" backend/services_*.py -i | head -n 30

# CSV export/import
grep -R "csv\|CSV" backend/ | head -n 20

# Check services_sync.py if it exists
cat backend/services_sync.py 2>/dev/null | head -n 100
```

**Answer:**
- Do you have any existing sync/export mechanisms? (yes/no, describe)
- How do you currently backup/restore graph data? (CSV? Neo4j dump? other?)

---

## 9) TESTING INFRASTRUCTURE

**Paste outputs of:**
```bash
# Test structure
ls -la backend/tests/

# Test examples
grep -R "@pytest\|def test_" backend/tests/ | head -n 20
```

**Answer:**
- Do you have integration tests for Neo4j operations? (yes/no)
- What test framework? (pytest? jest? other?)
- Should offline tests run against a local Neo4j instance? (yes/no)

---

## 10) PERFORMANCE CONSTRAINTS

**Answer in plain text:**
- What is acceptable query latency offline? (<100ms? <500ms? <1s?)
- What is acceptable sync time when connectivity returns? (<1s? <10s? <1min?)
- Should offline operations be batched? (yes/no)
- Maximum offline queue size before blocking? (100? 1000? unlimited?)

---

**END OF CHECKLIST**

Once you've filled this out, paste all outputs back and I'll produce:
1. Reference architecture for offline-first
2. Reference architecture for local file ingestion  
3. Detailed phased implementation plan
4. Risk register with mitigations

