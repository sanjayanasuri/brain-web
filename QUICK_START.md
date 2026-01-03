# 🚀 Quick Start - Brain Web macOS App

## One-Click Installation & Launch

### Step 1: Install the App

```bash
cd /Users/sanjayanasuri/brain-web
./scripts/install_macos.sh
```

This will:
- ✅ Check all prerequisites
- ✅ Create a native macOS app
- ✅ Install to Applications folder
- ✅ Optionally create desktop shortcut

### Step 2: Launch Brain Web

**Option A: From Applications**
- Open Applications folder
- Double-click "Brain Web"

**Option B: From Spotlight**
- Press `Cmd + Space`
- Type "Brain Web"
- Press Enter

**Option C: From Terminal**
```bash
./scripts/launch_brainweb.sh
```

## What Happens When You Launch

The app automatically:
1. ✅ Checks Neo4j Desktop is running (prompts you to start if not)
2. ✅ Verifies Neo4j connection
3. ✅ Starts backend server (port 8000)
4. ✅ Starts frontend server (port 3000)
5. ✅ Opens browser to http://localhost:3000

## First-Time Setup

Before first launch, make sure:

1. **Neo4j Desktop is installed** (download from neo4j.com/download)
   - Create a database in Neo4j Desktop
   - Start the database (click play button)
   - Default connection: `bolt://localhost:7687`
2. **Environment file exists** with your Neo4j credentials:
   ```bash
   # Create .env.local in project root
   NEO4J_URI=bolt://localhost:7687
   NEO4J_USER=neo4j
   NEO4J_PASSWORD=your_password_here
   OPENAI_API_KEY=sk-... (optional, for AI features)
   ```

## Useful Commands

### Check Status
```bash
./scripts/status_brainweb.sh
```

### Stop All Services
```bash
./scripts/stop_brainweb.sh
```

### View Logs
```bash
# Backend logs
tail -f ~/.brainweb/backend.log

# Frontend logs  
tail -f ~/.brainweb/frontend.log

# All logs
tail -f ~/.brainweb/launcher.log
```

## Troubleshooting

**"Neo4j is not running"**
→ Open Neo4j Desktop, start your database (click play button)

**"Port already in use"**
→ Stop the service using that port, or modify ports in config

**Services won't start**
→ Check logs in `~/.brainweb/` directory

## Uninstall

1. Stop services: `./scripts/stop_brainweb.sh`
2. Delete app: `rm -rf ~/Applications/Brain\ Web.app`
3. Optional: `rm -rf ~/.brainweb`
4. Stop Neo4j in Neo4j Desktop (if desired)

---

For more details, see [LAUNCHER_README.md](LAUNCHER_README.md)

