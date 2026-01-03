# 🎯 Brain Web - Bare Minimum Setup

## For End Users (Simplest)

### 1. Install Prerequisites (One Time)

- **Neo4j Desktop**: https://neo4j.com/download/
- **Node.js**: https://nodejs.org/ (v18+)

### 2. Get the Code

```bash
git clone <repo-url>
cd brain-web
```

### 3. Run Quick Install

```bash
./QUICK_INSTALL.sh
```

This will:
- Check prerequisites
- Create `.env.local` (asks for Neo4j password)
- Install the macOS app
- Set everything up

### 4. Launch

1. Open Neo4j Desktop → Start your database
2. Applications → Double-click "Brain Web"

**Done!** 🎉

---

## For Developers

Same as above, or run manually:

```bash
# Backend
cd backend && python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload

# Frontend (new terminal)
cd frontend && npm install
npm run dev
```

---

## What Gets Created

- `~/Applications/Brain Web.app` - The app
- `~/.brainweb/` - Logs and process files
- `.env.local` - Your configuration

---

## Troubleshooting

**"Neo4j not running"** → Start database in Neo4j Desktop  
**"npm not found"** → Install Node.js  
**"Permission denied"** → `chmod +x scripts/*.sh`

See `SETUP_GUIDE.md` for detailed help.

