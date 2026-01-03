# 🚀 Brain Web - Installation Guide

## One-Command Setup

After cloning the repository:

```bash
./scripts/install_macos.sh
```

This script does everything automatically!

---

## Prerequisites (Install Once)

Before running the installer, make sure you have:

### 1. Neo4j Desktop
- **Download**: https://neo4j.com/download/
- **Setup**: 
  - Install and open Neo4j Desktop
  - Create a new database
  - Set a password (remember it!)
  - Start the database (click play button)

### 2. Node.js (v18+)
- **Download**: https://nodejs.org/
- **Verify**: `node --version` should show v18 or higher

### 3. Python 3 (v3.9+)
- Usually pre-installed on macOS
- **Verify**: `python3 --version`
- **Install if needed**: `brew install python3`

---

## Configuration

Create `.env.local` in the project root:

```bash
# Minimum required
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_password_here

# Optional (for AI features)
OPENAI_API_KEY=sk-...
```

---

## Installation Steps

### Step 1: Clone/Download
```bash
git clone <repo-url>
cd brain-web
```

### Step 2: Configure
```bash
# Create .env.local with your Neo4j password
nano .env.local
```

### Step 3: Install
```bash
chmod +x scripts/*.sh
./scripts/install_macos.sh
```

### Step 4: Launch
1. Open Neo4j Desktop
2. Start your database
3. Double-click "Brain Web" from Applications

---

## What the Installer Does

✅ Checks all prerequisites  
✅ Creates macOS app bundle  
✅ Installs to Applications folder  
✅ Optionally creates desktop shortcut  
✅ Sets up all dependencies  

---

## After Installation

**To launch:**
- Applications folder → "Brain Web"
- Desktop shortcut (if created)
- Spotlight: `Cmd+Space` → "Brain Web"

**To stop:**
```bash
./scripts/stop_brainweb.sh
```

**To check status:**
```bash
./scripts/status_brainweb.sh
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Neo4j not running" | Open Neo4j Desktop, start database |
| "npm not found" | Install Node.js from nodejs.org |
| "Permission denied" | Run `chmod +x scripts/*.sh` |
| App won't launch | Check `~/.brainweb/launcher.log` |

---

## For Developers

If you want to run manually:

```bash
# Terminal 1: Backend
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload

# Terminal 2: Frontend
cd frontend
npm install
npm run dev
```

---

## Quick Reference

**Files created:**
- `~/Applications/Brain Web.app`
- `~/.brainweb/` (logs and PIDs)

**Ports used:**
- 7687: Neo4j (Bolt)
- 7474: Neo4j Browser
- 8000: Backend API
- 3000: Frontend

**Configuration:**
- `.env.local` in project root

